import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deterministicLinuxAdmission,
  deterministicWindowsAdmission,
} from './__tests__/fixtures/deterministic-supervision';
import {
  DenyRuntimeProcessLauncher,
  type RuntimeProcessLaunchRequest,
  type RuntimeProcessLauncher,
} from './policy';
import { canonicalJson } from './codec';
import {
  CODEX_APP_SERVER_ADAPTER_KIND,
  CODEX_APP_SERVER_ARGUMENT_POLICY,
  CODEX_APP_SERVER_ARGV,
  validateCodexAppServerManifest,
} from './codex-app-server-policy';
import {
  linuxExecutableAuthorizationHash,
  type LinuxExecutableAuthorization,
  type LinuxExecutableAuthorizationVerifier,
  TestOnlyLinuxExecutableAuthorizationVerifier,
} from './supervision-authorization';
import type {
  RuntimeLaunchManifest,
  TrustedSupervisorAdmissionEvidence,
} from './supervision-policy';
import {
  DenyTrustedSupervisorAuthorizationSource,
  type PerAdmissionSupervisorEvidenceReader,
  TrustedSupervisorComposition,
  type TrustedNativeLaunchHandoffConsumer,
  type TrustedSupervisorAuthorizationRequest,
  type TrustedSupervisorAuthorizationSource,
} from './supervisor-composition';

let fixtureDecisionSequence = 0;

class FixtureAuthorizationSource implements TrustedSupervisorAuthorizationSource {
  readonly requests: Readonly<TrustedSupervisorAuthorizationRequest>[] = [];

  constructor(
    private readonly authorization: unknown,
    private readonly fixed: Readonly<{
      decisionId?: string;
      supervisionId?: string;
      launchNonce?: string;
    }> = {},
  ) {}

  async read(request: Readonly<TrustedSupervisorAuthorizationRequest>): Promise<unknown> {
    this.requests.push(request);
    fixtureDecisionSequence += 1;
    return {
      schemaVersion: 1,
      decisionId: this.fixed.decisionId ?? `decision-${fixtureDecisionSequence}`,
      supervisionId: this.fixed.supervisionId ?? `supervision-${fixtureDecisionSequence}`,
      launchNonce: this.fixed.launchNonce ?? `launch-nonce-${fixtureDecisionSequence}`,
      requestHash: createHash('sha256').update(canonicalJson(request)).digest('hex'),
      authorization: this.authorization,
    };
  }
}

class FixtureEvidenceReader implements PerAdmissionSupervisorEvidenceReader {
  calls = 0;

  constructor(
    private readonly evidence: ReturnType<typeof deterministicLinuxAdmission>['evidence'],
  ) {}

  async read() {
    this.calls += 1;
    return this.evidence;
  }
}

class RecordingDenyLauncher implements RuntimeProcessLauncher {
  request?: Readonly<RuntimeProcessLaunchRequest>;
  calls = 0;
  private consume?: TrustedNativeLaunchHandoffConsumer;

  factory() {
    return (consume: TrustedNativeLaunchHandoffConsumer): RuntimeProcessLauncher => {
      this.consume = consume;
      return this;
    };
  }

  async launch(handoff: unknown): Promise<never> {
    this.calls += 1;
    if (!this.consume) throw new Error('fixture launcher was not composed');
    this.request = this.consume(handoff).request;
    throw new Error('fixture launcher denied');
  }
}

function input(manifest: unknown = deterministicLinuxAdmission().manifest) {
  return {
    schemaVersion: 1 as const,
    manifest,
  };
}

class ExactFixtureAuthorizationVerifier implements LinuxExecutableAuthorizationVerifier {
  constructor(private readonly expected: Readonly<LinuxExecutableAuthorization>) {}

  verify(input: unknown): Readonly<LinuxExecutableAuthorization> {
    if (canonicalJson(input) !== canonicalJson(this.expected))
      throw new Error('fixture authorization denied');
    return Object.freeze({ ...this.expected });
  }
}

function productionShapedCodexAdmission(): {
  manifest: RuntimeLaunchManifest;
  evidence: TrustedSupervisorAdmissionEvidence;
  authorization: LinuxExecutableAuthorization;
} {
  const fixture = deterministicLinuxAdmission();
  const manifest: RuntimeLaunchManifest = {
    ...fixture.manifest,
    manifestId: 'codex-supervisor-manifest-v1',
    runtimeId: 'runtime-codex',
    connectionId: 'connection-codex',
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
    testOnly: false,
    executable: {
      canonicalPath: '/opt/ventureos/runtimes/codex/codex',
      sha256: '8'.repeat(64),
      identityReference: 'device-8:inode-12',
    },
    argv: [...CODEX_APP_SERVER_ARGV],
    argumentPolicyReference: CODEX_APP_SERVER_ARGUMENT_POLICY,
  };
  const authorization: LinuxExecutableAuthorization = {
    ...fixture.authorization,
    authorizationId: 'codex-production-shaped-authorization-v1',
    signerKeyId: 'fixture-explicit-authority-v1',
    adapterKind: manifest.adapterKind,
    testOnly: false,
    canonicalPath: manifest.executable.canonicalPath,
    sha256: manifest.executable.sha256,
    identityReference: manifest.executable.identityReference,
    authorizedWorktreeRoot: manifest.worktreeRoot,
    argumentPolicyReference: manifest.argumentPolicyReference,
    signature: 'fixture-explicit-signature',
  };
  const hash = (value: unknown): string =>
    createHash('sha256').update(canonicalJson(value)).digest('hex');
  const evidence: TrustedSupervisorAdmissionEvidence = {
    ...fixture.evidence,
    evidenceId: 'codex-production-shaped-evidence-v1',
    runtimeId: manifest.runtimeId,
    connectionId: manifest.connectionId,
    manifestId: manifest.manifestId,
    authorizedManifestHash: hash(manifest),
    adapterKind: manifest.adapterKind,
    testOnly: false,
    canonicalPath: manifest.executable.canonicalPath,
    sha256: manifest.executable.sha256,
    identityReference: manifest.executable.identityReference,
    argvHash: hash(manifest.argv),
    argumentPolicyReference: manifest.argumentPolicyReference,
    authorizationId: authorization.authorizationId,
    authorizationHash: linuxExecutableAuthorizationHash(authorization),
    authorizationSignerKeyId: authorization.signerKeyId,
    authorizationSignature: authorization.signature,
  };
  return { manifest, evidence, authorization };
}

describe('trusted supervisor composition', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-08-26T00:00:00.000Z') }));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reads live authorization per admission and produces one deeply frozen exact plan', async () => {
    const fixture = deterministicLinuxAdmission();
    const source = new FixtureAuthorizationSource(fixture.authorization);
    const evidence = new FixtureEvidenceReader(fixture.evidence);
    const composition = new TrustedSupervisorComposition(
      source,
      evidence,
      new RecordingDenyLauncher().factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );

    const first = await composition.prepare(input(fixture.manifest));
    const second = await composition.prepare({
      ...input(fixture.manifest),
    });

    expect(source.requests).toHaveLength(2);
    expect(evidence.calls).toBe(2);
    expect(source.requests[0]).toMatchObject({
      workspaceId: fixture.manifest.workspaceId,
      runtimeId: fixture.manifest.runtimeId,
      connectionId: fixture.manifest.connectionId,
      adapterKind: 'DETERMINISTIC_FAKE',
      platform: 'LINUX',
      testOnly: true,
      manifestHash: first.admission.manifestHash,
    });
    expect(Object.isFrozen(source.requests[0])).toBe(true);
    expect(Object.isFrozen(source.requests[0]?.manifest)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.admission.evidence)).toBe(true);
    expect(Object.isFrozen(first.launchRequest.manifest)).toBe(true);
    expect(first.processBinding).toEqual(first.launchRequest.processBinding);
    expect(first.processBinding.supervisionId).toMatch(/^supervision-\d+$/u);
    expect(first.processBinding.launchNonce).toMatch(/^launch-nonce-\d+$/u);
    expect(first.authorizationDecision.decisionId).toMatch(/^decision-\d+$/u);
    expect(first.expiresAt).toBe(
      new Date(
        Math.min(
          Date.parse(fixture.authorization.validUntil),
          Date.parse(fixture.evidence.expiresAt),
        ),
      ).toISOString(),
    );
    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.processBinding.supervisionId).not.toBe(first.processBinding.supervisionId);
  });

  it('fails before evidence or launcher access when production authorization is not configured', async () => {
    const evidence = new FixtureEvidenceReader(deterministicLinuxAdmission().evidence);
    const launcher = new RecordingDenyLauncher();
    const composition = new TrustedSupervisorComposition(
      new DenyTrustedSupervisorAuthorizationSource(),
      evidence,
      launcher.factory(),
    );

    await expect(composition.prepare(input())).rejects.toMatchObject({
      code: 'AUTHORIZATION_NOT_CONFIGURED',
    });
    expect(evidence.calls).toBe(0);
    expect(launcher.request).toBeUndefined();
  });

  it('requires an explicit verifier for a production-shaped Codex authorization', async () => {
    const fixture = productionShapedCodexAdmission();
    expect(validateCodexAppServerManifest(fixture.manifest).manifest).toEqual(fixture.manifest);

    const deniedEvidence = new FixtureEvidenceReader(fixture.evidence);
    const denied = new TrustedSupervisorComposition(
      new FixtureAuthorizationSource(fixture.authorization),
      deniedEvidence,
      new RecordingDenyLauncher().factory(),
    );
    await expect(denied.prepare(input(fixture.manifest))).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(deniedEvidence.calls).toBe(0);

    const verifier = new ExactFixtureAuthorizationVerifier(fixture.authorization);
    const admittedEvidence = new FixtureEvidenceReader(fixture.evidence);
    const admitted = new TrustedSupervisorComposition(
      new FixtureAuthorizationSource(fixture.authorization),
      admittedEvidence,
      new RecordingDenyLauncher().factory(),
      verifier,
    );
    const plan = await admitted.prepare(input(fixture.manifest));

    expect(plan.admission.manifest.testOnly).toBe(false);
    expect(plan.admission.manifest.adapterKind).toBe(CODEX_APP_SERVER_ADAPTER_KIND);
    expect(plan.authorizationDecision.authorization.signerKeyId).toBe(
      'fixture-explicit-authority-v1',
    );
    expect(admittedEvidence.calls).toBe(1);
  });

  it('rejects malformed requests and unsupported platforms before consulting authority', async () => {
    const fixture = deterministicLinuxAdmission();
    const source = new FixtureAuthorizationSource(fixture.authorization);
    const composition = new TrustedSupervisorComposition(
      source,
      new FixtureEvidenceReader(fixture.evidence),
      new RecordingDenyLauncher().factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );

    await expect(
      composition.prepare({ ...input(), supervisionId: 'caller-controlled' } as never),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      composition.prepare({ ...input(), launchNonce: 'caller-controlled' } as never),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      composition.prepare({ ...input(), unexpected: true } as never),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      composition.prepare(input(deterministicWindowsAdmission().manifest)),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_PLATFORM',
    });
    expect(source.requests).toHaveLength(0);
  });

  it('consumes trusted decisions and nonces exactly once before evidence acquisition', async () => {
    const fixture = deterministicLinuxAdmission();
    const evidence = new FixtureEvidenceReader(fixture.evidence);
    const replayedDecision = new TrustedSupervisorComposition(
      new FixtureAuthorizationSource(fixture.authorization, {
        decisionId: 'replay-decision',
        supervisionId: 'replay-supervision',
        launchNonce: 'replay-nonce',
      }),
      evidence,
      new RecordingDenyLauncher().factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );

    await replayedDecision.prepare(input());
    await expect(replayedDecision.prepare(input())).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(evidence.calls).toBe(1);

    const duplicateNonceEvidence = new FixtureEvidenceReader(fixture.evidence);
    const duplicateNonce = new TrustedSupervisorComposition(
      new FixtureAuthorizationSource(fixture.authorization, {
        launchNonce: 'duplicate-nonce',
      }),
      duplicateNonceEvidence,
      new RecordingDenyLauncher().factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    await duplicateNonce.prepare(input());
    await expect(duplicateNonce.prepare(input())).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(duplicateNonceEvidence.calls).toBe(1);
  });

  it('rejects malformed, stale, or mismatched live authorization and evidence', async () => {
    const fixture = deterministicLinuxAdmission();
    const malformed = new TrustedSupervisorComposition(
      new FixtureAuthorizationSource({ ...fixture.authorization, authorizationVersion: 2 }),
      new FixtureEvidenceReader(fixture.evidence),
      new RecordingDenyLauncher().factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    await expect(malformed.prepare(input())).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });

    const mismatchedEvidence = new TrustedSupervisorComposition(
      new FixtureAuthorizationSource(fixture.authorization),
      new FixtureEvidenceReader({
        ...fixture.evidence,
        authorizationId: 'different-authorization',
      }),
      new RecordingDenyLauncher().factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    await expect(mismatchedEvidence.prepare(input())).rejects.toMatchObject({
      code: 'BINDING_MISMATCH',
    });
  });

  it('revalidates the complete admission and exact request before the deny launcher', async () => {
    const fixture = deterministicLinuxAdmission();
    const launcher = new RecordingDenyLauncher();
    const composition = new TrustedSupervisorComposition(
      new FixtureAuthorizationSource(fixture.authorization),
      new FixtureEvidenceReader(fixture.evidence),
      launcher.factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const plan = await composition.prepare(input());

    await expect(composition.execute(plan.launchRequest)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(launcher.calls).toBe(0);

    for (const drifted of [
      { ...plan, planHash: '9'.repeat(64) },
      {
        ...plan,
        admission: {
          ...plan.admission,
          evidence: { ...plan.admission.evidence, evidenceId: 'drifted-evidence' },
        },
      },
      {
        ...plan,
        launchRequest: {
          ...plan.launchRequest,
          manifest: { ...plan.launchRequest.manifest, runtimeId: 'runtime-other' },
        },
      },
      {
        ...plan,
        processBinding: { ...plan.processBinding, launchNonce: 'nonce-other' },
      },
    ]) {
      await expect(composition.execute(drifted)).rejects.toMatchObject({
        code: 'AUTHORIZATION_DENIED',
      });
      expect(launcher.calls).toBe(0);
    }

    await expect(composition.execute(plan)).rejects.toThrow('fixture launcher denied');
    expect(launcher.calls).toBe(1);
    expect(launcher.request).toEqual(plan.launchRequest);
    await expect(composition.execute(plan)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(launcher.calls).toBe(1);
  });

  it('binds every plan to the exact composition owner and never calls a foreign launcher', async () => {
    const fixture = deterministicLinuxAdmission();
    const ownerLauncher = new RecordingDenyLauncher();
    const foreignLauncher = new RecordingDenyLauncher();
    const owner = new TrustedSupervisorComposition(
      new FixtureAuthorizationSource(fixture.authorization),
      new FixtureEvidenceReader(fixture.evidence),
      ownerLauncher.factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const foreign = new TrustedSupervisorComposition(
      new DenyTrustedSupervisorAuthorizationSource(),
      new FixtureEvidenceReader(fixture.evidence),
      foreignLauncher.factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const plan = await owner.prepare(input());

    await expect(foreign.execute(plan)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(ownerLauncher.calls).toBe(0);
    expect(foreignLauncher.calls).toBe(0);

    await expect(owner.execute(plan)).rejects.toThrow('fixture launcher denied');
    expect(ownerLauncher.calls).toBe(1);
    expect(foreignLauncher.calls).toBe(0);
    await expect(owner.execute(plan)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(ownerLauncher.calls).toBe(1);
  });

  it('denies plans and activated requests at their earliest evidence or authority expiry', async () => {
    const fixture = deterministicLinuxAdmission();
    const expiredPlanLauncher = new RecordingDenyLauncher();
    const expiredPlanComposition = new TrustedSupervisorComposition(
      new FixtureAuthorizationSource(fixture.authorization),
      new FixtureEvidenceReader(fixture.evidence),
      expiredPlanLauncher.factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const expiredPlan = await expiredPlanComposition.prepare(input());
    vi.setSystemTime(new Date(expiredPlan.expiresAt));
    await expect(expiredPlanComposition.execute(expiredPlan)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(expiredPlanLauncher.calls).toBe(0);

    vi.setSystemTime(new Date('2026-08-26T00:00:00.000Z'));
    const expiredRequestLauncher = new RecordingDenyLauncher();
    const expiredRequestComposition = new TrustedSupervisorComposition(
      new FixtureAuthorizationSource(fixture.authorization),
      new FixtureEvidenceReader(fixture.evidence),
      expiredRequestLauncher.factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const expiredRequestPlan = await expiredRequestComposition.prepare(input());
    const activeTime = Date.parse('2026-08-26T00:00:00.000Z');
    const requestExpiry = Date.parse(expiredRequestPlan.expiresAt);
    vi.spyOn(Date, 'now').mockImplementation(() =>
      new Error().stack?.includes('consumeRuntimeProcessLaunchRequest')
        ? requestExpiry
        : activeTime,
    );
    await expect(expiredRequestComposition.execute(expiredRequestPlan)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(expiredRequestLauncher.calls).toBe(0);
  });

  it('routes the only production composition path into the fixed deny launcher', async () => {
    const fixture = deterministicLinuxAdmission();
    const evidence = new FixtureEvidenceReader(fixture.evidence);
    const composition = new TrustedSupervisorComposition(
      new FixtureAuthorizationSource(fixture.authorization),
      evidence,
      () => new DenyRuntimeProcessLauncher(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const plan = await composition.prepare(input());

    await expect(composition.execute(plan)).rejects.toThrow(
      'Runtime process launching is not enabled',
    );
    await expect(composition.execute(plan)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(evidence.calls).toBe(1);
  });
});
