import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canonicalJson } from './codec';
import {
  AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer,
  type RetainedNativeRecoveryNativeAuthority,
  type RetainedNativeSupervisorPeerIdentity,
} from './retained-native-supervisor-peer';
import {
  createRetainedNativeSupervisorRecoveryRequest,
  retainedNativeSupervisorRecoveryResponsePayload,
  type RetainedNativeSupervisorRecoveryRequest,
} from './retained-native-supervisor-recovery';
import type { SupervisorProcessBinding } from './supervision-lifecycle';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;
const nativeSource = resolve(__dirname, '..', 'test', 'native', 'retained-pidfd-recovery-addon.c');
const nativeRequire = createRequire(__filename);

interface NativeRetainedPidfdObservation {
  readonly identityEstablishedAtMs: number;
  readonly identityVerifiedAtMs: number;
  readonly exitedAtMs: number;
  readonly observedAtMs: number;
  readonly cleanupCompletedAtMs: number;
}

interface RetainedPidfdRecoveryAddon {
  launch(supervisionId: string, launchNonce: string): number;
  observeAndCleanup(
    requestId: string,
    requestHash: string,
    challengeNonce: string,
    supervisionId: string,
    launchNonce: string,
  ): NativeRetainedPidfdObservation;
}

class LinuxRetainedPidfdAuthority implements RetainedNativeRecoveryNativeAuthority {
  calls = 0;

  constructor(private readonly addon: RetainedPidfdRecoveryAddon) {}

  async observeAndCleanup(
    request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    signal: AbortSignal,
  ): Promise<unknown> {
    expect(signal.aborted).toBe(false);
    expect(Object.isFrozen(request)).toBe(true);
    this.calls += 1;
    const native = this.addon.observeAndCleanup(
      request.requestId,
      request.requestHash,
      request.challengeNonce,
      request.supervisionId,
      request.launchNonce,
    );
    return {
      schemaVersion: 1,
      requestId: request.requestId,
      requestHash: request.requestHash,
      challengeNonce: request.challengeNonce,
      supervisionId: request.supervisionId,
      launchNonce: request.launchNonce,
      identityEstablishedAt: new Date(native.identityEstablishedAtMs).toISOString(),
      identityVerifiedAt: new Date(native.identityVerifiedAtMs).toISOString(),
      exitedAt: new Date(native.exitedAtMs).toISOString(),
      observedAt: new Date(native.observedAtMs).toISOString(),
      cleanupCompletedAt: new Date(native.cleanupCompletedAtMs).toISOString(),
      processState: 'EXITED',
      exitCode: 0,
      signal: null,
      identityAuthority: 'RETAINED_NATIVE_IDENTITY',
      retainedIdentityKind: 'PIDFD',
      cleanupState: 'PROCESS_GROUP_GONE',
      runtimeConnection: 'NOT_CONFIGURED',
    };
  }
}

const delayUntil = async (milliseconds: number): Promise<void> => {
  const remaining = milliseconds - Date.now();
  if (remaining > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, remaining));
};

describeLinux('Linux retained-pidfd recovery authority evidence', () => {
  let ownedRoot: string;
  let addon: RetainedPidfdRecoveryAddon;

  beforeAll(() => {
    expect(spawnSync('cc', ['--version'], { encoding: 'utf8', timeout: 5_000 }).status).toBe(0);
    ownedRoot = mkdtempSync(join(tmpdir(), 'ventureos-retained-pidfd-'));
    const addonPath = join(ownedRoot, 'retained-pidfd-recovery.node');
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
        '-DNODE_GYP_MODULE_NAME=retained_pidfd_recovery',
        '-fstack-protector-strong',
        '-fPIC',
        '-shared',
        '-I',
        nodeInclude,
        nativeSource,
        '-o',
        addonPath,
        '-Wl,-z,relro,-z,now',
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(compilation.status, compilation.stderr).toBe(0);
    addon = nativeRequire(addonPath) as RetainedPidfdRecoveryAddon;
  }, 40_000);

  afterAll(() => {
    if (ownedRoot) rmSync(ownedRoot, { recursive: true, force: true });
  });

  it('retains launch identity across a fresh challenge and proves process-group cleanup', async () => {
    const binding: SupervisorProcessBinding = {
      schemaVersion: 1,
      supervisionId: 'retained-pidfd-supervision',
      launchNonce: 'retained-pidfd-launch',
      workspaceId: '00000000-0000-4000-8000-000000000003',
      runtimeId: 'retained-pidfd-runtime',
      connectionId: 'retained-pidfd-connection',
      platform: 'LINUX',
      manifestHash: 'a'.repeat(64),
      admissionEvidenceHash: 'b'.repeat(64),
      admissionBindingHash: 'c'.repeat(64),
      testOnly: false,
    };
    const establishedAt = addon.launch(binding.supervisionId, binding.launchNonce);
    const processExpiresAt = establishedAt + 200;
    await delayUntil(processExpiresAt + 25);
    const issuedAt = new Date();
    const request = createRetainedNativeSupervisorRecoveryRequest(
      {
        schemaVersion: 1,
        recoveryLeaseId: 'retained-pidfd-recovery-lease',
        recoveryGeneration: 1,
        claimId: 'retained-pidfd-process-claim',
        handoffAttemptId: 'retained-pidfd-handoff',
        validationDispatchCandidateHash: 'd'.repeat(64),
        sessionId: 'retained-pidfd-session',
        dispatchId: 'retained-pidfd-dispatch',
        runId: 'retained-pidfd-run',
        binding,
        processClaimedAt: new Date(establishedAt - 1_000).toISOString(),
        processExpiresAt: new Date(processExpiresAt).toISOString(),
        leaseClaimedAt: new Date(processExpiresAt + 1).toISOString(),
        leaseExpiresAt: new Date(issuedAt.getTime() + 10_000).toISOString(),
        runtimeConnection: 'NOT_CONFIGURED',
      },
      issuedAt,
    );
    expect(() =>
      addon.observeAndCleanup(
        request.requestId,
        request.requestHash,
        request.challengeNonce,
        'substituted-supervision',
        request.launchNonce,
      ),
    ).toThrow();

    const keyPair = generateKeyPairSync('ed25519');
    const publicSpki = keyPair.publicKey.export({ format: 'der', type: 'spki' });
    const identity: RetainedNativeSupervisorPeerIdentity = {
      schemaVersion: 1,
      supervisorInstanceId: 'retained-pidfd-supervisor-instance',
      supervisorKeyId: 'retained-pidfd-supervisor-key',
      algorithm: 'ED25519',
      purpose: 'RETAINED_NATIVE_RECOVERY_OBSERVATION',
      privateKey: keyPair.privateKey,
      publicKeySpkiSha256: createHash('sha256').update(publicSpki).digest('hex'),
      testOnly: false,
    };
    const authority = new LinuxRetainedPidfdAuthority(addon);
    const peer = new AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer(authority, identity);
    const response = await peer.exchange(request, new AbortController().signal);

    expect(authority.calls).toBe(1);
    expect(response).toMatchObject({
      requestId: request.requestId,
      requestHash: request.requestHash,
      processState: 'EXITED',
      exitCode: 0,
      signal: null,
      identityAuthority: 'RETAINED_NATIVE_IDENTITY',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(Date.parse(response.identityEstablishedAt)).toBe(establishedAt);
    expect(Date.parse(response.exitedAt)).toBeLessThanOrEqual(processExpiresAt);
    expect(Date.parse(response.identityVerifiedAt)).toBeGreaterThanOrEqual(issuedAt.getTime());
    expect(
      verify(
        null,
        Buffer.from(canonicalJson(retainedNativeSupervisorRecoveryResponsePayload(response))),
        keyPair.publicKey,
        Buffer.from(response.signature, 'base64'),
      ),
    ).toBe(true);
    expect(() =>
      addon.observeAndCleanup(
        request.requestId,
        request.requestHash,
        request.challengeNonce,
        request.supervisionId,
        request.launchNonce,
      ),
    ).toThrow();
  });
});
