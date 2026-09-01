import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import { observeCodexValidationProcessSessionRecoveryExit } from './codex-validation-process-session-recovery-evidence';
import type { SupervisorProcessBinding } from './supervision-lifecycle';
import {
  AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource,
  BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier,
  DenyRetainedNativeSupervisorRecoveryResponseVerifier,
  DenyRetainedNativeSupervisorRecoveryTransport,
  RetainedNativeSupervisorRecoveryError,
  createRetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorRecoveryResponsePayload,
  type RetainedNativeSupervisorRecoveryTransport,
  type RetainedNativeSupervisorTrustRecord,
} from './retained-native-supervisor-recovery';

const binding: SupervisorProcessBinding = {
  schemaVersion: 1,
  supervisionId: 'supervision-retained-native',
  launchNonce: 'launch-retained-native',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  runtimeId: 'runtime-retained-native',
  connectionId: 'connection-retained-native',
  platform: 'LINUX',
  manifestHash: '1'.repeat(64),
  admissionEvidenceHash: '2'.repeat(64),
  admissionBindingHash: '3'.repeat(64),
  testOnly: false,
};

function workItem() {
  return {
    schemaVersion: 1 as const,
    recoveryLeaseId: 'recovery-lease-retained-native',
    recoveryGeneration: 3,
    claimId: 'process-claim-retained-native',
    handoffAttemptId: 'handoff-retained-native',
    validationDispatchCandidateHash: '4'.repeat(64),
    sessionId: 'session-retained-native',
    dispatchId: 'dispatch-retained-native',
    runId: 'run-retained-native',
    binding,
    processClaimedAt: '2026-09-03T12:00:00.000Z',
    processExpiresAt: '2026-09-03T12:01:00.000Z',
    leaseClaimedAt: '2026-09-03T12:01:01.000Z',
    leaseExpiresAt: '2026-09-03T12:01:16.000Z',
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
}

const keyPair = generateKeyPairSync('ed25519');

function trustRecord(
  drift: Partial<RetainedNativeSupervisorTrustRecord> = {},
): RetainedNativeSupervisorTrustRecord {
  const publicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' });
  return {
    schemaVersion: 1,
    trustRecordId: 'native-supervisor-root-v1',
    trustRecordVersion: 1,
    supervisorInstanceId: 'native-supervisor-instance-a',
    supervisorKeyId: 'native-supervisor-key-a',
    algorithm: 'ED25519',
    purpose: 'RETAINED_NATIVE_RECOVERY_OBSERVATION',
    publicKeySpkiBase64: publicKey.toString('base64'),
    publicKeySpkiSha256: createHash('sha256').update(publicKey).digest('hex'),
    validFrom: '2026-09-03T00:00:00.000Z',
    validUntil: '2026-09-04T00:00:00.000Z',
    revokedAt: null,
    testOnly: false,
    ...drift,
  };
}

function responsePayload(
  request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
  drift: Partial<RetainedNativeSupervisorRecoveryResponsePayload> = {},
): RetainedNativeSupervisorRecoveryResponsePayload {
  return {
    schemaVersion: 1,
    responseId: 'native-recovery-observation-a',
    requestId: request.requestId,
    requestHash: request.requestHash,
    supervisorInstanceId: 'native-supervisor-instance-a',
    supervisorKeyId: 'native-supervisor-key-a',
    identityEstablishedAt: '2026-09-03T12:00:01.000Z',
    identityVerifiedAt: '2026-09-03T12:01:02.400Z',
    exitedAt: '2026-09-03T12:00:50.000Z',
    observedAt: '2026-09-03T12:01:02.500Z',
    processState: 'EXITED',
    exitCode: 0,
    signal: null,
    identityAuthority: 'RETAINED_NATIVE_IDENTITY',
    runtimeConnection: 'NOT_CONFIGURED',
    ...drift,
  };
}

function signedResponse(
  request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
  drift: Partial<RetainedNativeSupervisorRecoveryResponsePayload> = {},
  signingKey: KeyObject = keyPair.privateKey,
) {
  const payload = responsePayload(request, drift);
  return {
    ...payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), signingKey).toString('base64'),
  };
}

class SigningTransport implements RetainedNativeSupervisorRecoveryTransport {
  readonly requests: Readonly<RetainedNativeSupervisorRecoveryRequest>[] = [];

  constructor(
    private readonly produce: (
      request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    ) => unknown = (request) => signedResponse(request),
  ) {}

  async exchange(
    request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    signal: AbortSignal,
  ): Promise<unknown> {
    expect(signal.aborted).toBe(false);
    this.requests.push(request);
    return this.produce(request);
  }
}

function clock(...values: string[]): () => Date {
  const dates = values.map((value) => new Date(value));
  return () => dates.shift()!;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('authenticated retained-native supervisor recovery', () => {
  it('binds the full work item to a fresh, frozen, two-second request', () => {
    const first = createRetainedNativeSupervisorRecoveryRequest(
      workItem(),
      new Date('2026-09-03T12:01:02.000Z'),
    );
    const second = createRetainedNativeSupervisorRecoveryRequest(
      workItem(),
      new Date('2026-09-03T12:01:02.000Z'),
    );

    expect(first).toMatchObject({
      workspaceId: binding.workspaceId,
      runtimeId: binding.runtimeId,
      connectionId: binding.connectionId,
      recoveryLeaseId: 'recovery-lease-retained-native',
      claimId: 'process-claim-retained-native',
      supervisionId: binding.supervisionId,
      launchNonce: binding.launchNonce,
      platform: 'LINUX',
      testOnly: false,
      sessionId: 'session-retained-native',
      dispatchId: 'dispatch-retained-native',
      manifestHash: binding.manifestHash,
      admissionEvidenceHash: binding.admissionEvidenceHash,
      admissionBindingHash: binding.admissionBindingHash,
      issuedAt: '2026-09-03T12:01:02.000Z',
      expiresAt: '2026-09-03T12:01:04.000Z',
      runtimeConnection: 'NOT_CONFIGURED',
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.challengeNonce).not.toBe(second.challengeNonce);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('rejects non-Linux and test-only bindings before creating a challenge', () => {
    for (const bindingDrift of [{ platform: 'WIN32' as const }, { testOnly: true }])
      expect(() =>
        createRetainedNativeSupervisorRecoveryRequest(
          { ...workItem(), binding: { ...binding, ...bindingDrift } },
          new Date('2026-09-03T12:01:02.000Z'),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it('accepts one freshly signed observation and returns only normalized exit evidence', async () => {
    const transport = new SigningTransport();
    const source = new AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource(
      transport,
      new BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier(trustRecord()),
      clock('2026-09-03T12:01:02.000Z', '2026-09-03T12:01:03.000Z'),
    );

    const evidence = await source.observe(workItem());

    expect(transport.requests).toHaveLength(1);
    expect(evidence).toEqual({
      schemaVersion: 1,
      evidenceId: 'native-recovery-observation-a',
      recoveryLeaseId: 'recovery-lease-retained-native',
      recoveryGeneration: 3,
      claimId: 'process-claim-retained-native',
      supervisionId: binding.supervisionId,
      launchNonce: binding.launchNonce,
      sessionId: 'session-retained-native',
      dispatchId: 'dispatch-retained-native',
      validationDispatchCandidateHash: '4'.repeat(64),
      identityEstablishedAt: '2026-09-03T12:00:01.000Z',
      exitedAt: '2026-09-03T12:00:50.000Z',
      verifiedAt: '2026-09-03T12:01:02.500Z',
      processState: 'EXITED',
      exitCode: 0,
      signal: null,
      identityAuthority: 'RETAINED_NATIVE_IDENTITY',
      runtimeConnection: 'NOT_CONFIGURED',
      evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(evidence).not.toHaveProperty('signature');
    expect(evidence).not.toHaveProperty('supervisorKeyId');
    expect(evidence).not.toHaveProperty('processId');
  });

  it('composes with the existing lease-fresh observation boundary', async () => {
    const source = new AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource(
      new SigningTransport(),
      new BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier(trustRecord()),
      clock('2026-09-03T12:01:02.100Z', '2026-09-03T12:01:03.000Z'),
    );
    const outerClock = clock('2026-09-03T12:01:02.000Z', '2026-09-03T12:01:03.100Z');

    await expect(
      observeCodexValidationProcessSessionRecoveryExit(workItem(), source, outerClock),
    ).resolves.toMatchObject({
      evidenceId: 'native-recovery-observation-a',
      processState: 'EXITED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
  });

  it.each([
    ['request hash drift', { requestHash: '9'.repeat(64) }],
    ['request replay', { requestId: 'replayed-request' }],
    ['wrong supervisor', { supervisorInstanceId: 'native-supervisor-instance-b' }],
    ['wrong key', { supervisorKeyId: 'native-supervisor-key-b' }],
    ['identity before claim', { identityEstablishedAt: '2026-09-03T11:59:59.999Z' }],
    ['exit after claim window', { exitedAt: '2026-09-03T12:01:00.001Z' }],
    ['identity not freshly verified', { identityVerifiedAt: '2026-09-03T12:01:01.999Z' }],
    ['identity verified after response', { identityVerifiedAt: '2026-09-03T12:01:02.501Z' }],
    ['cached observation', { observedAt: '2026-09-03T12:01:01.999Z' }],
    ['future observation', { observedAt: '2026-09-03T12:01:03.001Z' }],
    ['invalid signal', { exitCode: null, signal: 'TERM' }],
    ['connected truth', { runtimeConnection: 'CONNECTED' }],
  ] as const)('rejects a signed response with %s', async (_label, drift) => {
    const source = new AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource(
      new SigningTransport((request) => signedResponse(request, drift as never)),
      new BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier(trustRecord()),
      clock('2026-09-03T12:01:02.000Z', '2026-09-03T12:01:03.000Z'),
    );

    await expect(source.observe(workItem())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects an invalid signature, additional fields, and accessor-bearing responses', async () => {
    const otherKey = generateKeyPairSync('ed25519').privateKey;
    const cases: Array<(request: Readonly<RetainedNativeSupervisorRecoveryRequest>) => unknown> = [
      (request) => signedResponse(request, {}, otherKey),
      (request) => ({ ...signedResponse(request), processId: 123 }),
      (request) => {
        const response = signedResponse(request) as Record<string, unknown>;
        Object.defineProperty(response, 'responseId', {
          enumerable: true,
          get: () => 'native-recovery-observation-a',
        });
        return response;
      },
    ];

    for (const produce of cases) {
      const source = new AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource(
        new SigningTransport(produce),
        new BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier(trustRecord()),
        clock('2026-09-03T12:01:02.000Z', '2026-09-03T12:01:03.000Z'),
      );
      await expect(source.observe(workItem())).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });

  it('rejects invalid or revoked trust and incomplete deny-default composition', () => {
    expect(
      () =>
        new BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier(
          trustRecord({ revokedAt: '2026-09-03T11:00:00.000Z' }),
        ),
    ).toThrow(RetainedNativeSupervisorRecoveryError);
    expect(
      () =>
        new BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier(
          trustRecord({ publicKeySpkiSha256: '0'.repeat(64) }),
        ),
    ).toThrow(RetainedNativeSupervisorRecoveryError);
    expect(
      () =>
        new AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource(
          new DenyRetainedNativeSupervisorRecoveryTransport(),
          new BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier(trustRecord()),
        ),
    ).toThrowError(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    expect(
      () =>
        new AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource(
          new SigningTransport(),
          new DenyRetainedNativeSupervisorRecoveryResponseVerifier(),
        ),
    ).toThrowError(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
  });

  it('times out an unresponsive exchange within the request lifetime', async () => {
    vi.useFakeTimers();
    const source = new AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource(
      {
        exchange: async () => new Promise<never>(() => undefined),
      },
      new BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier(trustRecord()),
      () => new Date('2026-09-03T12:01:02.000Z'),
    );
    const observation = source.observe(workItem());
    const expectation = expect(observation).rejects.toMatchObject({ code: 'EXCHANGE_DENIED' });

    await vi.advanceTimersByTimeAsync(2_000);
    await expectation;
  });

  it('revalidates the recovery lease after exchange before accepting a response', async () => {
    const source = new AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource(
      new SigningTransport(),
      new BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier(trustRecord()),
      clock('2026-09-03T12:01:15.000Z', '2026-09-03T12:01:16.000Z'),
    );

    await expect(source.observe(workItem())).rejects.toMatchObject({ code: 'LEASE_INACTIVE' });
  });
});
