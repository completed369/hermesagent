import { createHash, sign } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  deriveBridgeKeys,
  digestBridgePayload,
  digestSecretReference,
  signBridgeEnvelope,
} from './auth';
import {
  AuthenticatedRuntimeJsonlSession,
  type AuthenticatedJsonlSessionContext,
} from './authenticated-jsonl-session';
import { canonicalJson, encodeBridgeLine } from './codec';
import type { RuntimeProcessLauncher } from './policy';
import { type BridgeSecretLeaseRequest, ScopedBridgeSecretLeaseResolver } from './secret-lease';
import {
  linuxExecutableAuthorizationHash,
  TestOnlyLinuxExecutableAuthorizationVerifier,
  type LinuxExecutableAuthorization,
  type LinuxExecutableAuthorizationPayload,
} from './supervision-authorization';
import {
  type PerAdmissionSupervisorEvidenceReader,
  type TrustedNativeLaunchHandoffConsumer,
  TrustedSupervisorComposition,
  type TrustedSupervisorAuthorizationRequest,
  type TrustedSupervisorAuthorizationSource,
} from './supervisor-composition';
import type {
  RuntimeLaunchManifest,
  TrustedSupervisorAdmissionEvidence,
} from './supervision-policy';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;
const nativeSourceRoot = resolve(__dirname, '..', 'test', 'native');
const nativeRequire = createRequire(__filename);
const SECRET = new Uint8Array(32).fill(23);
const TEST_SIGNER_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIDXgLTsIlYz/jfY7Or5Ylt4TinBgk8MUM5C+13sON7Uo
-----END PRIVATE KEY-----`;
const hash = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

type LifecycleMode = 'authenticated-success' | 'authenticated-cancel' | 'authenticated-dispatch';

interface LifecycleNativeEvidence {
  readonly schemaVersion: 1;
  readonly sourceDigest: string;
  readonly sealedDigest: string;
  readonly transcriptDigest: string;
  readonly dispatchInputDigest: string | null;
  readonly execveatSucceeded: true;
  readonly emptyEnvironment: true;
  readonly secretPassedByAnonymousFd: true;
  readonly transcriptBounded: true;
  readonly stdinOwned: boolean;
  readonly expectedTerminal: 'RESULT' | 'CANCELLED';
  readonly pidfdObservedExit: true;
  readonly processGroupGone: true;
  readonly cleanupCompletedBeforeEvidence: true;
}

interface LifecycleCompletionEvidence {
  readonly schemaVersion: 1;
  readonly mode: LifecycleMode;
  readonly transcriptDigest: string;
  readonly dispatchInputDigest: string | null;
  readonly frameTypes: readonly string[];
  readonly sequences: readonly number[];
  readonly cleanupCompletedBeforeVerification: true;
}

interface LifecycleAddonResult {
  readonly evidence: string;
  readonly transcript: Uint8Array;
}

interface LifecycleAddon {
  bind(
    consumer: (handoff: unknown) => readonly string[],
  ): (handoff: unknown, secret: Uint8Array, dispatch: Uint8Array) => LifecycleAddonResult;
}

class FixtureCompleted extends Error {}

class RecordingSecretSource {
  readonly requests: BridgeSecretLeaseRequest[] = [];

  constructor(private readonly verifyMaterial: Uint8Array = SECRET) {}

  async resolve(request: Readonly<BridgeSecretLeaseRequest>): Promise<Uint8Array> {
    this.requests.push(request);
    if (
      request.workspaceId !== 'lifecycle-workspace' ||
      request.runtimeId !== 'lifecycle-runtime' ||
      request.connectionId !== 'lifecycle-connection' ||
      request.secretReference !== 'lifecycle-material-reference' ||
      request.expectedDigest !== digestSecretReference(SECRET) ||
      request.authGeneration !== 1 ||
      (request.purpose !== 'AUTHENTICATE' && request.purpose !== 'VERIFY_FRAME')
    )
      throw new Error('Synthetic lifecycle secret scope denied');
    return request.purpose === 'VERIFY_FRAME' ? this.verifyMaterial : SECRET;
  }
}

class AuthorizationSource implements TrustedSupervisorAuthorizationSource {
  static sequence = 0;
  constructor(private readonly authorization: LinuxExecutableAuthorization) {}

  async read(request: Readonly<TrustedSupervisorAuthorizationRequest>): Promise<unknown> {
    AuthorizationSource.sequence += 1;
    return {
      schemaVersion: 1,
      decisionId: `lifecycle-decision-${AuthorizationSource.sequence}`,
      supervisionId: `lifecycle-supervision-${AuthorizationSource.sequence}`,
      launchNonce: `lifecycle-launch-${AuthorizationSource.sequence}`,
      requestHash: hash(request),
      authorization: this.authorization,
    };
  }
}

class EvidenceReader implements PerAdmissionSupervisorEvidenceReader {
  constructor(private readonly evidence: TrustedSupervisorAdmissionEvidence) {}
  async read(): Promise<TrustedSupervisorAdmissionEvidence> {
    return this.evidence;
  }
}

class AuthenticatedLifecycleLauncher implements RuntimeProcessLauncher {
  completion?: Readonly<LifecycleCompletionEvidence>;
  authorizedNativeCalls = 0;
  #consumeHandoff?: TrustedNativeLaunchHandoffConsumer;
  #launch?: (token: unknown, secret: Uint8Array, dispatch: Uint8Array) => LifecycleAddonResult;
  #lastHandoff?: unknown;
  readonly #nativeTokens = new WeakMap<
    object,
    { state: 'ACTIVE' | 'CONSUMED'; readonly tuple: readonly string[]; readonly expiresAt: number }
  >();

  constructor(
    private readonly addon: LifecycleAddon,
    private readonly manifest: Readonly<RuntimeLaunchManifest>,
    private readonly executableSize: bigint,
    private readonly secretResolver: ScopedBridgeSecretLeaseResolver,
    private readonly sessionContext: Readonly<AuthenticatedJsonlSessionContext>,
    private readonly transformTranscript: (input: Uint8Array) => Uint8Array = (input) => input,
    private readonly transformDispatch: (input: Uint8Array) => Uint8Array = (input) => input,
  ) {}

  factory() {
    return (consume: TrustedNativeLaunchHandoffConsumer): RuntimeProcessLauncher => {
      this.#consumeHandoff = consume;
      this.#launch = this.addon.bind((token) => this.consumeNativeToken(token));
      return this;
    };
  }

  private buildTuple(envelope: ReturnType<TrustedNativeLaunchHandoffConsumer>): readonly string[] {
    const manifest = envelope.request.manifest;
    if (
      canonicalJson(manifest) !== canonicalJson(this.manifest) ||
      envelope.admission.manifestHash !== hash(manifest) ||
      envelope.admission.bindingHash.length !== 64 ||
      envelope.planHash.length !== 64 ||
      envelope.expiresAt !== Date.parse(envelope.admission.evidence.expiresAt) ||
      manifest.adapterKind !== 'DETERMINISTIC_FAKE' ||
      manifest.testOnly !== true ||
      manifest.platform !== 'LINUX' ||
      manifest.workspaceId !== 'lifecycle-workspace' ||
      manifest.runtimeId !== 'lifecycle-runtime' ||
      manifest.connectionId !== 'lifecycle-connection' ||
      manifest.workspaceId !== this.sessionContext.workspaceId ||
      manifest.runtimeId !== this.sessionContext.runtimeId ||
      manifest.connectionId !== this.sessionContext.connectionId ||
      manifest.platformPolicy.kind !== 'LINUX' ||
      manifest.secretTransport !== 'INHERITED_HANDLE' ||
      canonicalJson(manifest.argv) !== canonicalJson(['--mode', this.manifest.argv[1]]) ||
      manifest.limits.maximumStdoutBytes !== 8_192 ||
      manifest.limits.maximumChildProcesses !== 0 ||
      envelope.expiresAt <= Date.now()
    )
      throw new Error('Lifecycle native binding denied');
    const identity = /^linux:dev-([a-f0-9]+):ino-([a-f0-9]+)$/u.exec(
      envelope.admission.evidence.identityReference,
    );
    if (!identity) throw new Error('Lifecycle native identity denied');
    return Object.freeze([
      manifest.executable.canonicalPath,
      manifest.worktreeRoot,
      manifest.executable.sha256,
      String(manifest.platformPolicy.ownerUid),
      String(manifest.platformPolicy.ownerGid),
      String(manifest.platformPolicy.mode),
      BigInt(`0x${identity[1]}`).toString(),
      BigInt(`0x${identity[2]}`).toString(),
      this.executableSize.toString(),
      String(envelope.expiresAt),
      String(manifest.argv[1]),
    ]);
  }

  private consumeNativeToken(token: unknown): readonly string[] {
    if ((typeof token !== 'object' && typeof token !== 'function') || token === null)
      throw new Error('Lifecycle native token denied');
    const state = this.#nativeTokens.get(token);
    if (!state || state.state !== 'ACTIVE' || Date.now() >= state.expiresAt)
      throw new Error('Lifecycle native token denied');
    state.state = 'CONSUMED';
    this.authorizedNativeCalls += 1;
    return state.tuple;
  }

  private verifyNativeEvidence(
    input: string,
    transcript: Uint8Array,
    expectedTerminal: 'RESULT' | 'CANCELLED',
    dispatch: Uint8Array,
  ): Readonly<LifecycleNativeEvidence> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new Error('Lifecycle native evidence denied');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new Error('Lifecycle native evidence denied');
    const evidence = parsed as Record<string, unknown>;
    const exactKeys = [
      'cleanupCompletedBeforeEvidence',
      'dispatchInputDigest',
      'emptyEnvironment',
      'execveatSucceeded',
      'expectedTerminal',
      'pidfdObservedExit',
      'processGroupGone',
      'schemaVersion',
      'sealedDigest',
      'secretPassedByAnonymousFd',
      'sourceDigest',
      'stdinOwned',
      'transcriptBounded',
      'transcriptDigest',
    ];
    if (canonicalJson(Object.keys(evidence).sort()) !== canonicalJson(exactKeys))
      throw new Error('Lifecycle native evidence denied');
    const transcriptDigest = createHash('sha256').update(transcript).digest('hex');
    const dispatchInputDigest =
      dispatch.byteLength === 0 ? null : createHash('sha256').update(dispatch).digest('hex');
    if (
      evidence.schemaVersion !== 1 ||
      evidence.sourceDigest !== this.manifest.executable.sha256 ||
      evidence.sealedDigest !== this.manifest.executable.sha256 ||
      evidence.transcriptDigest !== transcriptDigest ||
      evidence.dispatchInputDigest !== dispatchInputDigest ||
      evidence.expectedTerminal !== expectedTerminal ||
      evidence.execveatSucceeded !== true ||
      evidence.emptyEnvironment !== true ||
      evidence.secretPassedByAnonymousFd !== true ||
      evidence.transcriptBounded !== true ||
      evidence.stdinOwned !== dispatch.byteLength > 0 ||
      evidence.pidfdObservedExit !== true ||
      evidence.processGroupGone !== true ||
      evidence.cleanupCompletedBeforeEvidence !== true
    )
      throw new Error('Lifecycle native evidence denied');
    return Object.freeze(evidence as unknown as LifecycleNativeEvidence);
  }

  private dispatchFrame(secret: Uint8Array, mode: LifecycleMode): Uint8Array {
    if (mode !== 'authenticated-dispatch') return new Uint8Array();
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(issuedAt) + 30_000).toISOString();
    const payload = Object.freeze({
      challenge: 'VENTUREOS_ZERO_SPEND_VALIDATE',
      dispatchId: 'lifecycle-dispatch',
    });
    const keys = deriveBridgeKeys(secret, {
      workspaceId: this.sessionContext.workspaceId,
      runtimeId: this.sessionContext.runtimeId,
      connectionId: this.sessionContext.connectionId,
      sessionId: this.sessionContext.sessionId,
      principalReference: this.sessionContext.principalReference,
      parentNonce: this.sessionContext.parentNonce,
      runtimeNonce: this.sessionContext.runtimeNonce,
    });
    try {
      return encodeBridgeLine(
        signBridgeEnvelope(
          {
            protocolVersion: 'ventureos.bridge.v1',
            workspaceId: this.sessionContext.workspaceId,
            runtimeId: this.sessionContext.runtimeId,
            connectionId: this.sessionContext.connectionId,
            sessionId: this.sessionContext.sessionId,
            principalReference: this.sessionContext.principalReference,
            messageId: 'lifecycle-parent-dispatch-1',
            sequence: 1,
            type: 'DISPATCH',
            issuedAt,
            expiresAt,
            payload,
            payloadDigest: digestBridgePayload(payload),
          },
          keys.parentToRuntime,
        ),
      );
    } finally {
      keys.parentToRuntime.fill(0);
      keys.runtimeToParent.fill(0);
    }
  }

  async launch(handoff: unknown): Promise<never> {
    if (!this.#launch || !this.#consumeHandoff) throw new Error('Lifecycle addon was not bound');
    this.#lastHandoff = handoff;
    this.completion = undefined;

    // Consume composition authority before any secret resolution. The native addon
    // receives only a launcher-private, one-use token and cannot consume the handoff.
    const envelope = this.#consumeHandoff(handoff);
    const tuple = this.buildTuple(envelope);
    const contextExpiresAt = Date.parse(this.sessionContext.expiresAt);
    if (!Number.isSafeInteger(contextExpiresAt) || Date.now() >= contextExpiresAt)
      throw new Error('Lifecycle authenticated context denied');
    const token = Object.freeze(Object.create(null)) as object;
    const tokenState: {
      state: 'ACTIVE' | 'CONSUMED';
      readonly tuple: readonly string[];
      readonly expiresAt: number;
    } = {
      state: 'ACTIVE',
      tuple,
      expiresAt: Math.min(envelope.expiresAt, contextExpiresAt),
    };
    this.#nativeTokens.set(token, tokenState);
    const request: Readonly<BridgeSecretLeaseRequest> = Object.freeze({
      workspaceId: this.sessionContext.workspaceId,
      runtimeId: this.sessionContext.runtimeId,
      connectionId: this.sessionContext.connectionId,
      secretReference: this.sessionContext.secretReference,
      expectedDigest: this.sessionContext.expectedSecretDigest,
      authGeneration: this.sessionContext.authGeneration,
      purpose: 'AUTHENTICATE',
    });
    let result: Readonly<LifecycleAddonResult>;
    let dispatch: Uint8Array<ArrayBufferLike> = new Uint8Array();
    try {
      result = await this.secretResolver.withSecret(request, (secret) => {
        dispatch = this.transformDispatch(
          this.dispatchFrame(secret, this.manifest.argv[1] as LifecycleMode),
        );
        const nativeResult = this.#launch!(token, secret, dispatch);
        return Object.freeze({
          evidence: nativeResult.evidence,
          transcript: Uint8Array.from(nativeResult.transcript),
        });
      });
    } finally {
      tokenState.state = 'CONSUMED';
    }

    const transcript = this.transformTranscript(result.transcript);
    const mode = this.manifest.argv[1] as LifecycleMode;
    const expectedTerminal = mode === 'authenticated-cancel' ? 'CANCELLED' : 'RESULT';
    const nativeEvidence = this.verifyNativeEvidence(
      result.evidence,
      result.transcript,
      expectedTerminal,
      dispatch,
    );
    const session = new AuthenticatedRuntimeJsonlSession(this.sessionContext, this.secretResolver);
    const verified = await session.ingest(transcript);
    const expectedTypes =
      mode === 'authenticated-dispatch'
        ? (['CAPABILITIES', 'HEARTBEAT', 'DISPATCH_ACCEPTED', 'RESULT'] as const)
        : (['CAPABILITIES', 'HEARTBEAT', expectedTerminal] as const);
    const expectedPayloads =
      mode === 'authenticated-dispatch'
        ? ([
            { protocol: 'jsonl-v1' },
            { health: 'HEALTHY' },
            { dispatchId: 'lifecycle-dispatch' },
            { outcome: 'SUCCEEDED' },
          ] as const)
        : ([
            { protocol: 'jsonl-v1' },
            { health: 'HEALTHY' },
            expectedTerminal === 'RESULT'
              ? { outcome: 'SUCCEEDED' }
              : { reason: 'PARENT_CANCELLED' },
          ] as const);
    const expectedSequences = expectedTypes.map((_, index) => index + 1);
    if (
      verified.length !== expectedTypes.length ||
      canonicalJson(verified.map((frame) => frame.type)) !== canonicalJson(expectedTypes) ||
      canonicalJson(verified.map((frame) => frame.sequence)) !== canonicalJson(expectedSequences) ||
      canonicalJson(verified.map((frame) => frame.payload)) !== canonicalJson(expectedPayloads) ||
      session.snapshot().acceptedFrames !== expectedTypes.length ||
      session.snapshot().nextSequence !== expectedTypes.length + 1 ||
      !session.snapshot().capabilitiesAccepted
    )
      throw new Error('Lifecycle authenticated transcript denied');

    this.completion = Object.freeze({
      schemaVersion: 1,
      mode,
      transcriptDigest: nativeEvidence.transcriptDigest,
      dispatchInputDigest: nativeEvidence.dispatchInputDigest,
      frameTypes: Object.freeze(expectedTypes),
      sequences: Object.freeze(expectedSequences),
      cleanupCompletedBeforeVerification: true,
    });
    throw new FixtureCompleted('Authenticated lifecycle fixture completed');
  }

  async replay(): Promise<never> {
    if (this.#lastHandoff === undefined) throw new Error('Lifecycle handoff unavailable');
    return await this.launch(this.#lastHandoff);
  }
}

describeLinux('test-only authenticated supervised lifecycle transcript', () => {
  let ownedRoot: string;
  let fixture: string;
  let fixtureDigest: string;
  const addons = new Map<string, LifecycleAddon>();

  const compile = (source: string, output: string) => {
    const compilation = spawnSync(
      'cc',
      [
        '-std=c11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-D_FORTIFY_SOURCE=2',
        '-fstack-protector-strong',
        '-fPIE',
        '-pie',
        '-Wl,-z,relro,-z,now',
        source,
        '-o',
        output,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(compilation.status, compilation.stderr).toBe(0);
  };

  const compileAddon = (output: string, moduleName: string) => {
    const nodeInclude = resolve(dirname(process.execPath), '..', 'include', 'node');
    const compilation = spawnSync(
      'cc',
      [
        '-std=c11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-D_FORTIFY_SOURCE=2',
        `-DNODE_GYP_MODULE_NAME=${moduleName}`,
        '-fstack-protector-strong',
        '-fPIC',
        '-shared',
        '-I',
        nodeInclude,
        join(nativeSourceRoot, 'authenticated-lifecycle-addon.c'),
        '-o',
        output,
        '-Wl,-z,relro,-z,now',
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(compilation.status, compilation.stderr).toBe(0);
  };

  const createWorktree = (name: string): string => {
    const root = join(ownedRoot, name);
    const work = join(root, 'work');
    mkdirSync(work, { recursive: true, mode: 0o700 });
    writeFileSync(join(work, 'fixture.marker'), 'trusted', { mode: 0o600 });
    return root;
  };

  const admission = (root: string, mode: LifecycleMode) => {
    const metadata = statSync(fixture, { bigint: true });
    const ownerUid = Number(metadata.uid);
    const ownerGid = Number(metadata.gid);
    const executableMode = Number(metadata.mode & 0o7777n);
    const now = Date.now();
    const manifest: RuntimeLaunchManifest = {
      schemaVersion: 1,
      manifestId: `lifecycle-${mode}-v1`,
      manifestVersion: 1,
      workspaceId: 'lifecycle-workspace',
      runtimeId: 'lifecycle-runtime',
      connectionId: 'lifecycle-connection',
      adapterKind: 'DETERMINISTIC_FAKE',
      platform: 'LINUX',
      testOnly: true,
      executable: {
        canonicalPath: fixture,
        sha256: fixtureDigest,
        identityReference: `linux:dev-${metadata.dev.toString(16)}:ino-${metadata.ino.toString(16)}`,
      },
      argv: ['--mode', mode],
      argumentPolicyReference: `lifecycle-${mode}-arguments-v1`,
      worktreeRoot: root,
      workingDirectory: `${root}/work`,
      protocol: 'JSONL_STDIO',
      network: 'DENY',
      shell: false,
      environmentVariableNames: [],
      secretTransport: 'INHERITED_HANDLE',
      limits: {
        maximumRuntimeMs: 60_000,
        maximumMemoryBytes: 64 * 1_024 * 1_024,
        maximumCpuTimeMs: 2_000,
        maximumInputBytes: 1,
        maximumStdoutBytes: 8_192,
        maximumStderrBytes: 1_024,
        maximumChildProcesses: 0,
      },
      platformPolicy: {
        kind: 'LINUX',
        ownerUid,
        ownerGid,
        mode: executableMode,
        symbolicLink: false,
      },
    };
    const authorizationPayload: LinuxExecutableAuthorizationPayload = {
      schemaVersion: 1,
      authorizationId: `lifecycle-${mode}-authorization-v1`,
      authorizationVersion: 1,
      signerKeyId: 'ventureos-test-executable-authority-v1',
      validFrom: new Date(now - 5_000).toISOString(),
      validUntil: new Date(now + 60_000).toISOString(),
      adapterKind: manifest.adapterKind,
      testOnly: true,
      canonicalPath: fixture,
      sha256: fixtureDigest,
      identityReference: manifest.executable.identityReference,
      ownerUid,
      ownerGid,
      mode: executableMode,
      authorizedWorktreeRoot: root,
      argumentPolicyReference: manifest.argumentPolicyReference,
    };
    const authorization: LinuxExecutableAuthorization = {
      ...authorizationPayload,
      signature: sign(
        null,
        Buffer.from(canonicalJson(authorizationPayload)),
        TEST_SIGNER_PRIVATE_KEY,
      ).toString('base64'),
    };
    const evidence: TrustedSupervisorAdmissionEvidence = {
      schemaVersion: 2,
      evidenceId: `lifecycle-${mode}-evidence-v1`,
      workspaceId: manifest.workspaceId,
      runtimeId: manifest.runtimeId,
      connectionId: manifest.connectionId,
      manifestId: manifest.manifestId,
      manifestVersion: manifest.manifestVersion,
      authorizedManifestHash: hash(manifest),
      adapterKind: manifest.adapterKind,
      platform: 'LINUX',
      testOnly: true,
      observedAt: new Date(now - 2_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      canonicalPath: fixture,
      sha256: fixtureDigest,
      identityReference: manifest.executable.identityReference,
      authorizedWorktreeRoot: root,
      argvHash: hash(manifest.argv),
      argumentPolicyReference: manifest.argumentPolicyReference,
      authorizationId: authorization.authorizationId,
      authorizationVersion: authorization.authorizationVersion,
      authorizationHash: linuxExecutableAuthorizationHash(authorization),
      authorizationSignerKeyId: authorization.signerKeyId,
      authorizationValidFrom: authorization.validFrom,
      authorizationValidUntil: authorization.validUntil,
      authorizationSignature: authorization.signature,
      fileKind: 'REGULAR',
      platformEvidence: manifest.platformPolicy,
    };
    return { authorization, evidence, manifest };
  };

  const context = (
    override: Partial<AuthenticatedJsonlSessionContext> = {},
  ): Readonly<AuthenticatedJsonlSessionContext> =>
    Object.freeze({
      schemaVersion: 1,
      workspaceId: 'lifecycle-workspace',
      runtimeId: 'lifecycle-runtime',
      connectionId: 'lifecycle-connection',
      sessionId: 'lifecycle-session',
      principalReference: 'lifecycle-principal',
      parentNonce: 'lifecycle-parent-nonce',
      runtimeNonce: 'lifecycle-runtime-nonce',
      secretReference: 'lifecycle-material-reference',
      expectedSecretDigest: digestSecretReference(SECRET),
      authGeneration: 1,
      authenticatedAt: new Date(Date.now() - 30_000).toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      ...override,
    });

  beforeAll(() => {
    expect(spawnSync('cc', ['--version'], { encoding: 'utf8', timeout: 5_000 }).status).toBe(0);
    ownedRoot = mkdtempSync(join(tmpdir(), 'ventureos-authenticated-lifecycle-'));
    fixture = join(ownedRoot, 'native-runtime-fixture');
    compile(join(nativeSourceRoot, 'native-runtime-fixture.c'), fixture);
    chmodSync(fixture, 0o500);
    fixtureDigest = createHash('sha256').update(readFileSync(fixture)).digest('hex');
    for (const key of [
      'authenticated-success',
      'authenticated-cancel',
      'authenticated-dispatch',
      'dispatch-tamper',
      'tamper',
      'wrong-key',
      'session',
      'nonce',
      'generation',
      'expiry',
      'expired-handoff',
      'evidence-extra',
      'evidence-digest',
    ] as const) {
      const addonPath = join(ownedRoot, `${key}.node`);
      compileAddon(addonPath, `lifecycle_${key.replaceAll('-', '_')}`);
      const loaded = nativeRequire(addonPath) as LifecycleAddon;
      addons.set(
        key,
        key === 'evidence-extra' || key === 'evidence-digest'
          ? {
              bind(consumer) {
                const launch = loaded.bind(consumer);
                return (handoff, secret, dispatch) => {
                  const result = launch(handoff, secret, dispatch);
                  const evidence = JSON.parse(result.evidence) as Record<string, unknown>;
                  if (key === 'evidence-extra') evidence.untrusted = true;
                  else evidence.transcriptDigest = '0'.repeat(64);
                  return { ...result, evidence: JSON.stringify(evidence) };
                };
              },
            }
          : loaded,
      );
    }
  }, 60_000);

  afterAll(() => {
    if (ownedRoot) rmSync(ownedRoot, { recursive: true, force: true });
  });

  it('denies an expired composition handoff before secret or native authority is reached', async () => {
    const mode = 'authenticated-success';
    const fixtureAdmission = admission(createWorktree('expired-handoff'), mode);
    const source = new RecordingSecretSource();
    const resolver = new ScopedBridgeSecretLeaseResolver(source);
    const launcher = new AuthenticatedLifecycleLauncher(
      addons.get('expired-handoff')!,
      fixtureAdmission.manifest,
      statSync(fixture, { bigint: true }).size,
      resolver,
      context(),
    );
    const composition = new TrustedSupervisorComposition(
      new AuthorizationSource(fixtureAdmission.authorization),
      new EvidenceReader(fixtureAdmission.evidence),
      launcher.factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const plan = await composition.prepare({
      schemaVersion: 1,
      manifest: fixtureAdmission.manifest,
    });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(plan.expiresAt));
    try {
      await expect(composition.execute(plan)).rejects.toThrow();
    } finally {
      clock.mockRestore();
    }
    expect(source.requests).toHaveLength(0);
    expect(launcher.authorizedNativeCalls).toBe(0);
    expect(launcher.completion).toBeUndefined();
  });

  it.each([
    ['authenticated-success', ['CAPABILITIES', 'HEARTBEAT', 'RESULT']],
    ['authenticated-cancel', ['CAPABILITIES', 'HEARTBEAT', 'CANCELLED']],
    ['authenticated-dispatch', ['CAPABILITIES', 'HEARTBEAT', 'DISPATCH_ACCEPTED', 'RESULT']],
  ] as const)('verifies the %s transcript only after native cleanup', async (mode, types) => {
    const fixtureAdmission = admission(createWorktree(mode), mode);
    const source = new RecordingSecretSource();
    const resolver = new ScopedBridgeSecretLeaseResolver(source);
    const launcher = new AuthenticatedLifecycleLauncher(
      addons.get(mode)!,
      fixtureAdmission.manifest,
      statSync(fixture, { bigint: true }).size,
      resolver,
      context(),
    );
    const composition = new TrustedSupervisorComposition(
      new AuthorizationSource(fixtureAdmission.authorization),
      new EvidenceReader(fixtureAdmission.evidence),
      launcher.factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const plan = await composition.prepare({
      schemaVersion: 1,
      manifest: fixtureAdmission.manifest,
    });
    await expect(launcher.launch(plan.launchRequest)).rejects.toThrow();
    await expect(launcher.launch({ ...plan.launchRequest })).rejects.toThrow();
    expect(source.requests).toHaveLength(0);
    expect(launcher.authorizedNativeCalls).toBe(0);

    await expect(composition.execute(plan)).rejects.toBeInstanceOf(FixtureCompleted);
    expect(launcher.authorizedNativeCalls).toBe(1);
    expect(launcher.completion).toEqual({
      schemaVersion: 1,
      mode,
      transcriptDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      dispatchInputDigest:
        mode === 'authenticated-dispatch' ? expect.stringMatching(/^[a-f0-9]{64}$/u) : null,
      frameTypes: types,
      sequences: types.map((_, index) => index + 1),
      cleanupCompletedBeforeVerification: true,
    });
    expect(Object.isFrozen(launcher.completion)).toBe(true);

    const sourceCallCount = source.requests.length;
    await expect(launcher.replay()).rejects.toThrow();
    expect(source.requests).toHaveLength(sourceCallCount);
    expect(launcher.authorizedNativeCalls).toBe(1);
    expect(source.requests.map((request) => request.purpose)).toEqual([
      'AUTHENTICATE',
      'VERIFY_FRAME',
    ]);
  });

  it('denies a mutated parent dispatch before accepting runtime completion evidence', async () => {
    const mode = 'authenticated-dispatch';
    const fixtureAdmission = admission(createWorktree('dispatch-tamper'), mode);
    const source = new RecordingSecretSource();
    const resolver = new ScopedBridgeSecretLeaseResolver(source);
    const launcher = new AuthenticatedLifecycleLauncher(
      addons.get('dispatch-tamper')!,
      fixtureAdmission.manifest,
      statSync(fixture, { bigint: true }).size,
      resolver,
      context(),
      (input) => input,
      (input) => {
        const mutated = Uint8Array.from(input);
        const marker = Buffer.from(mutated).indexOf('"mac":"') + 7;
        mutated[marker] = mutated[marker] === 65 ? 66 : 65;
        return mutated;
      },
    );
    const composition = new TrustedSupervisorComposition(
      new AuthorizationSource(fixtureAdmission.authorization),
      new EvidenceReader(fixtureAdmission.evidence),
      launcher.factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const plan = await composition.prepare({
      schemaVersion: 1,
      manifest: fixtureAdmission.manifest,
    });

    await expect(composition.execute(plan)).rejects.not.toBeInstanceOf(FixtureCompleted);
    expect(launcher.authorizedNativeCalls).toBe(1);
    expect(launcher.completion).toBeUndefined();
    expect(source.requests.map((request) => request.purpose)).toEqual(['AUTHENTICATE']);
  });

  it.each([
    'tamper',
    'wrong-key',
    'session',
    'nonce',
    'generation',
    'expiry',
    'evidence-extra',
    'evidence-digest',
  ] as const)('denies %s drift before emitting combined completion evidence', async (key) => {
    const mode = 'authenticated-success';
    const fixtureAdmission = admission(createWorktree(key), mode);
    const verifyMaterial = key === 'wrong-key' ? new Uint8Array(32).fill(99) : SECRET;
    const override: Partial<AuthenticatedJsonlSessionContext> =
      key === 'session'
        ? { sessionId: 'lifecycle-other-session' }
        : key === 'nonce'
          ? { runtimeNonce: 'lifecycle-other-runtime-nonce' }
          : key === 'generation'
            ? { authGeneration: 2 }
            : key === 'expiry'
              ? { expiresAt: new Date(Date.now() + 30_000).toISOString() }
              : {};
    const source = new RecordingSecretSource(verifyMaterial);
    const resolver = new ScopedBridgeSecretLeaseResolver(source);
    const transform = (input: Uint8Array): Uint8Array => {
      const owned = Uint8Array.from(input);
      if (key === 'tamper') {
        const marker = Buffer.from(owned).indexOf('"mac":"') + 7;
        owned[marker] = owned[marker] === 65 ? 66 : 65;
      }
      return owned;
    };
    const launcher = new AuthenticatedLifecycleLauncher(
      addons.get(key)!,
      fixtureAdmission.manifest,
      statSync(fixture, { bigint: true }).size,
      resolver,
      context(override),
      transform,
    );
    const composition = new TrustedSupervisorComposition(
      new AuthorizationSource(fixtureAdmission.authorization),
      new EvidenceReader(fixtureAdmission.evidence),
      launcher.factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const plan = await composition.prepare({
      schemaVersion: 1,
      manifest: fixtureAdmission.manifest,
    });

    await expect(composition.execute(plan)).rejects.not.toBeInstanceOf(FixtureCompleted);
    expect(launcher.completion).toBeUndefined();
    if (key === 'generation') {
      expect(source.requests).toHaveLength(1);
      expect(launcher.authorizedNativeCalls).toBe(0);
    } else if (key === 'evidence-extra' || key === 'evidence-digest') {
      expect(source.requests.map((request) => request.purpose)).toEqual(['AUTHENTICATE']);
      expect(launcher.authorizedNativeCalls).toBe(1);
    } else {
      expect(source.requests.map((request) => request.purpose)).toEqual([
        'AUTHENTICATE',
        'VERIFY_FRAME',
      ]);
      expect(launcher.authorizedNativeCalls).toBe(1);
    }
  });
});
