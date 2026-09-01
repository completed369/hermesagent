import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { observeCodexValidationProcessSessionRecoveryExit } from './codex-validation-process-session-recovery-evidence';
import type { SupervisorProcessBinding } from './supervision-lifecycle';
import {
  AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer,
  DenyRetainedNativeRecoveryNativeAuthority,
  RetainedNativeSupervisorPeerError,
  type RetainedNativeRecoveryNativeAuthority,
  type RetainedNativeRecoveryNativeObservation,
  type RetainedNativeSupervisorPeerIdentity,
} from './retained-native-supervisor-peer';
import {
  AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource,
  BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier,
  createRetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorTrustRecord,
} from './retained-native-supervisor-recovery';

const binding: SupervisorProcessBinding = {
  schemaVersion: 1,
  supervisionId: 'supervision-native-peer',
  launchNonce: 'launch-native-peer',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  runtimeId: 'runtime-native-peer',
  connectionId: 'connection-native-peer',
  platform: 'LINUX',
  manifestHash: 'a'.repeat(64),
  admissionEvidenceHash: 'b'.repeat(64),
  admissionBindingHash: 'c'.repeat(64),
  testOnly: false,
};

function workItem() {
  return {
    schemaVersion: 1 as const,
    recoveryLeaseId: 'recovery-lease-native-peer',
    recoveryGeneration: 4,
    claimId: 'process-claim-native-peer',
    handoffAttemptId: 'handoff-native-peer',
    validationDispatchCandidateHash: 'd'.repeat(64),
    sessionId: 'session-native-peer',
    dispatchId: 'dispatch-native-peer',
    runId: 'run-native-peer',
    binding,
    processClaimedAt: '2026-09-03T12:00:00.000Z',
    processExpiresAt: '2026-09-03T12:01:00.000Z',
    leaseClaimedAt: '2026-09-03T12:01:01.000Z',
    leaseExpiresAt: '2026-09-03T12:01:16.000Z',
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
}

const keyPair = generateKeyPairSync('ed25519');
const publicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' });
const publicKeySpkiSha256 = createHash('sha256').update(publicKey).digest('hex');

function identity(
  drift: Partial<RetainedNativeSupervisorPeerIdentity> = {},
): RetainedNativeSupervisorPeerIdentity {
  return {
    schemaVersion: 1,
    supervisorInstanceId: 'native-supervisor-instance-peer',
    supervisorKeyId: 'native-supervisor-key-peer',
    algorithm: 'ED25519',
    purpose: 'RETAINED_NATIVE_RECOVERY_OBSERVATION',
    privateKey: keyPair.privateKey,
    publicKeySpkiSha256,
    testOnly: false,
    ...drift,
  };
}

function trustRecord(): RetainedNativeSupervisorTrustRecord {
  return {
    schemaVersion: 1,
    trustRecordId: 'native-supervisor-peer-trust-v1',
    trustRecordVersion: 1,
    supervisorInstanceId: 'native-supervisor-instance-peer',
    supervisorKeyId: 'native-supervisor-key-peer',
    algorithm: 'ED25519',
    purpose: 'RETAINED_NATIVE_RECOVERY_OBSERVATION',
    publicKeySpkiBase64: publicKey.toString('base64'),
    publicKeySpkiSha256,
    validFrom: '2026-09-03T00:00:00.000Z',
    validUntil: '2026-09-04T00:00:00.000Z',
    revokedAt: null,
    testOnly: false,
  };
}

function nativeObservation(
  request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
  drift: Partial<RetainedNativeRecoveryNativeObservation> = {},
): RetainedNativeRecoveryNativeObservation {
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    requestHash: request.requestHash,
    challengeNonce: request.challengeNonce,
    supervisionId: request.supervisionId,
    launchNonce: request.launchNonce,
    identityEstablishedAt: '2026-09-03T12:00:01.000Z',
    identityVerifiedAt: '2026-09-03T12:01:02.300Z',
    exitedAt: '2026-09-03T12:00:50.000Z',
    observedAt: '2026-09-03T12:01:02.400Z',
    cleanupCompletedAt: '2026-09-03T12:01:02.500Z',
    processState: 'EXITED',
    exitCode: 0,
    signal: null,
    identityAuthority: 'RETAINED_NATIVE_IDENTITY',
    retainedIdentityKind: 'PIDFD',
    cleanupState: 'PROCESS_GROUP_GONE',
    runtimeConnection: 'NOT_CONFIGURED',
    ...drift,
  };
}

class NativeAuthority implements RetainedNativeRecoveryNativeAuthority {
  calls = 0;
  request?: Readonly<RetainedNativeSupervisorRecoveryRequest>;

  constructor(
    private readonly produce: (
      request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    ) => unknown = (request) => nativeObservation(request),
  ) {}

  async observeAndCleanup(
    request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    signal: AbortSignal,
  ): Promise<unknown> {
    expect(signal.aborted).toBe(false);
    expect(Object.isFrozen(request)).toBe(true);
    this.calls += 1;
    this.request = request;
    return this.produce(request);
  }
}

function sequenceClock(...values: string[]): () => Date {
  const dates = values.map((value) => new Date(value));
  return () => dates.shift()!;
}

describe('authenticated local retained-native supervisor peer', () => {
  it('requires native identity revalidation and cleanup before signing normalized evidence', async () => {
    const authority = new NativeAuthority();
    const peer = new AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer(
      authority,
      identity(),
      sequenceClock('2026-09-03T12:01:02.100Z', '2026-09-03T12:01:02.600Z'),
    );
    const source = new AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource(
      peer,
      new BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier(trustRecord()),
      sequenceClock('2026-09-03T12:01:02.000Z', '2026-09-03T12:01:02.700Z'),
    );

    const evidence = await observeCodexValidationProcessSessionRecoveryExit(
      workItem(),
      source,
      sequenceClock('2026-09-03T12:01:02.000Z', '2026-09-03T12:01:02.800Z'),
    );

    expect(authority.calls).toBe(1);
    expect(authority.request).toMatchObject({
      challengeNonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      supervisionId: binding.supervisionId,
      launchNonce: binding.launchNonce,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(evidence).toMatchObject({
      recoveryLeaseId: 'recovery-lease-native-peer',
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
    expect(evidence).not.toHaveProperty('challengeNonce');
    expect(evidence).not.toHaveProperty('retainedIdentityKind');
    expect(evidence).not.toHaveProperty('cleanupState');
    expect(evidence).not.toHaveProperty('signature');
  });

  it('rejects incomplete deny composition and unbound signing identities', () => {
    expect(
      () =>
        new AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer(
          new DenyRetainedNativeRecoveryNativeAuthority(),
          identity(),
        ),
    ).toThrow(RetainedNativeSupervisorPeerError);

    const rsaKey: KeyObject = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const invalidIdentities: unknown[] = [
      identity({ privateKey: rsaKey }),
      identity({ publicKeySpkiSha256: '0'.repeat(64) }),
      { ...identity(), testOnly: true },
      { ...identity(), extra: 'not-allowed' },
    ];
    for (const invalidIdentity of invalidIdentities) {
      expect(
        () =>
          new AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer(
            new NativeAuthority(),
            invalidIdentity,
          ),
      ).toThrow(RetainedNativeSupervisorPeerError);
    }
  });

  it('denies request drift, expiry, and aborted exchange before native authority', async () => {
    const request = createRetainedNativeSupervisorRecoveryRequest(
      workItem(),
      new Date('2026-09-03T12:01:02.000Z'),
    );
    const authority = new NativeAuthority();
    const peer = (now: string) =>
      new AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer(
        authority,
        identity(),
        sequenceClock(now, '2026-09-03T12:01:02.600Z'),
      );

    await expect(
      peer('2026-09-03T12:01:02.100Z').exchange(
        { ...request, launchNonce: 'substituted-launch' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      peer(request.expiresAt).exchange(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      peer('2026-09-03T12:01:02.100Z').exchange(request, aborted.signal),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(authority.calls).toBe(0);
  });

  it('rejects every native binding, retained-identity, cleanup, and time drift', async () => {
    const request = createRetainedNativeSupervisorRecoveryRequest(
      workItem(),
      new Date('2026-09-03T12:01:02.000Z'),
    );
    const cases: Array<Partial<RetainedNativeRecoveryNativeObservation>> = [
      { requestId: 'other-request' },
      { requestHash: '0'.repeat(64) },
      { challengeNonce: 'A'.repeat(43) },
      { supervisionId: 'other-supervision' },
      { launchNonce: 'other-launch' },
      { retainedIdentityKind: 'HANDLE' as 'PIDFD' },
      { cleanupState: 'ACTIVE' as 'PROCESS_GROUP_GONE' },
      { identityVerifiedAt: '2026-09-03T12:01:01.999Z' },
      { cleanupCompletedAt: request.expiresAt },
      { exitCode: null, signal: null },
      { exitCode: 0, signal: 'SIGTERM' },
    ];

    for (const drift of cases) {
      const authority = new NativeAuthority((input) => nativeObservation(input, drift));
      const peer = new AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer(
        authority,
        identity(),
        sequenceClock('2026-09-03T12:01:02.100Z', '2026-09-03T12:01:02.700Z'),
      );
      await expect(peer.exchange(request, new AbortController().signal)).rejects.toMatchObject({
        code: 'INVALID_NATIVE_OBSERVATION',
      });
      expect(authority.calls).toBe(1);
    }
  });

  it('rejects accessor-backed native observations without invoking them', async () => {
    const request = createRetainedNativeSupervisorRecoveryRequest(
      workItem(),
      new Date('2026-09-03T12:01:02.000Z'),
    );
    let getterCalls = 0;
    const authority = new NativeAuthority((input) => {
      const observation = nativeObservation(input) as unknown as Record<string, unknown>;
      Object.defineProperty(observation, 'challengeNonce', {
        configurable: true,
        enumerable: true,
        get() {
          getterCalls += 1;
          return input.challengeNonce;
        },
      });
      return observation;
    });
    const peer = new AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer(
      authority,
      identity(),
      sequenceClock('2026-09-03T12:01:02.100Z', '2026-09-03T12:01:02.700Z'),
    );

    await expect(peer.exchange(request, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_NATIVE_OBSERVATION',
    });
    expect(getterCalls).toBe(0);
  });

  it('maps native authority failures and over-deadline completion to denial', async () => {
    const request = createRetainedNativeSupervisorRecoveryRequest(
      workItem(),
      new Date('2026-09-03T12:01:02.000Z'),
    );
    const failing: RetainedNativeRecoveryNativeAuthority = {
      async observeAndCleanup() {
        throw new Error('native details must not cross the boundary');
      },
    };
    await expect(
      new AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer(
        failing,
        identity(),
        sequenceClock('2026-09-03T12:01:02.100Z'),
      ).exchange(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'NATIVE_AUTHORITY_DENIED' });

    await expect(
      new AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer(
        new NativeAuthority(),
        identity(),
        sequenceClock('2026-09-03T12:01:02.100Z', request.expiresAt),
      ).exchange(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'NATIVE_AUTHORITY_DENIED' });
  });
});
