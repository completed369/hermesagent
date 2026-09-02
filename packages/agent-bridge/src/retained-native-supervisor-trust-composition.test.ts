import { describe, expect, it, vi } from 'vitest';

import type { SupervisorProcessBinding } from './supervision-lifecycle';
import {
  DenyRetainedNativeSupervisorRecoveryTransport,
  RetainedNativeSupervisorRecoveryError,
  type RetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorRecoveryResponse,
  type RetainedNativeSupervisorRecoveryResponseVerifier,
  type RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';
import {
  DenyRetainedNativeSupervisorTrustSource,
  type RetainedNativeSupervisorTrustSource,
  type VerifiedRetainedNativeSupervisorTrustSnapshot,
} from './retained-native-supervisor-trust-source';
import { FreshTrustRetainedNativeSupervisorRecoveryEvidenceSource } from './retained-native-supervisor-trust-composition';

const binding: SupervisorProcessBinding = {
  schemaVersion: 1,
  supervisionId: 'supervision-fresh-trust',
  launchNonce: 'launch-fresh-trust',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  runtimeId: 'runtime-fresh-trust',
  connectionId: 'connection-fresh-trust',
  platform: 'LINUX',
  manifestHash: '1'.repeat(64),
  admissionEvidenceHash: '2'.repeat(64),
  admissionBindingHash: '3'.repeat(64),
  testOnly: false,
};

function workItem() {
  return {
    schemaVersion: 1 as const,
    recoveryLeaseId: 'recovery-lease-fresh-trust',
    recoveryGeneration: 2,
    claimId: 'process-claim-fresh-trust',
    handoffAttemptId: 'handoff-fresh-trust',
    validationDispatchCandidateHash: '4'.repeat(64),
    sessionId: 'session-fresh-trust',
    dispatchId: 'dispatch-fresh-trust',
    runId: 'run-fresh-trust',
    binding,
    processClaimedAt: '2026-09-03T12:00:00.000Z',
    processExpiresAt: '2026-09-03T12:01:00.000Z',
    leaseClaimedAt: '2026-09-03T12:01:01.000Z',
    leaseExpiresAt: '2026-09-03T12:01:16.000Z',
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
}

function response(
  request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
): Readonly<RetainedNativeSupervisorRecoveryResponse> {
  return Object.freeze({
    schemaVersion: 1,
    responseId: 'native-recovery-observation-fresh-trust',
    requestId: request.requestId,
    requestHash: request.requestHash,
    supervisorInstanceId: 'native-supervisor-instance-a',
    supervisorKeyId: 'native-supervisor-key-a',
    identityEstablishedAt: '2026-09-03T12:00:01.000Z',
    identityVerifiedAt: '2026-09-03T12:01:02.300Z',
    exitedAt: '2026-09-03T12:00:50.000Z',
    observedAt: '2026-09-03T12:01:02.400Z',
    processState: 'EXITED',
    exitCode: 0,
    signal: null,
    identityAuthority: 'RETAINED_NATIVE_IDENTITY',
    runtimeConnection: 'NOT_CONFIGURED',
    signature: `${'A'.repeat(86)}==`,
  });
}

function verifier(
  calls: string[],
  label: string,
  implementation: (
    request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
  ) => Readonly<RetainedNativeSupervisorRecoveryResponse> = response,
): RetainedNativeSupervisorRecoveryResponseVerifier {
  return {
    verify(_candidate, request) {
      calls.push(label);
      return implementation(request);
    },
  };
}

function snapshot(
  responseVerifier: RetainedNativeSupervisorRecoveryResponseVerifier,
  drift: Partial<VerifiedRetainedNativeSupervisorTrustSnapshot> = {},
): Readonly<VerifiedRetainedNativeSupervisorTrustSnapshot> {
  return Object.freeze({
    schemaVersion: 1,
    snapshotId: 'supervisor-trust-snapshot-7',
    snapshotVersion: 7,
    snapshotHash: '5'.repeat(64),
    signerKeyId: 'supervisor-root-key-a',
    rootRecordId: 'supervisor-root-record-a',
    rootRecordVersion: 3,
    supervisorInstanceId: 'native-supervisor-instance-a',
    supervisorKeyId: 'native-supervisor-key-a',
    trustRecordId: 'native-supervisor-trust-a',
    trustRecordVersion: 4,
    issuedAt: '2026-09-03T12:00:00.000Z',
    validUntil: '2026-09-03T12:15:00.000Z',
    responseVerifier,
    ...drift,
  });
}

class ScriptedTrustSource implements RetainedNativeSupervisorTrustSource {
  readonly read = vi.fn(async () => {
    const next = this.values.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('missing scripted trust');
    this.calls.push(`trust:${next.snapshotId}`);
    return next;
  });

  constructor(
    private readonly values: (Readonly<VerifiedRetainedNativeSupervisorTrustSnapshot> | Error)[],
    private readonly calls: string[],
  ) {}
}

class FixtureTransport implements RetainedNativeSupervisorRecoveryTransport {
  readonly exchange = vi.fn(
    async (request: Readonly<RetainedNativeSupervisorRecoveryRequest>, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      this.calls.push('exchange');
      return { requestId: request.requestId };
    },
  );

  constructor(private readonly calls: string[]) {}
}

function clock(): () => Date {
  const values = [new Date('2026-09-03T12:01:02.000Z'), new Date('2026-09-03T12:01:02.500Z')];
  return () => values.shift()!;
}

describe('fresh retained-native supervisor trust composition', () => {
  it('reads identical authenticated trust around the exchange and verifies only afterward', async () => {
    const calls: string[] = [];
    const preVerifier = verifier(calls, 'pre-verifier', () => {
      throw new Error('pre-exchange verifier must not be used');
    });
    const postVerifier = verifier(calls, 'post-verifier');
    const trust = new ScriptedTrustSource([snapshot(preVerifier), snapshot(postVerifier)], calls);
    const transport = new FixtureTransport(calls);

    const evidence = await new FreshTrustRetainedNativeSupervisorRecoveryEvidenceSource(
      transport,
      trust,
      clock(),
    ).observe(workItem());

    expect(calls).toEqual([
      'trust:supervisor-trust-snapshot-7',
      'exchange',
      'trust:supervisor-trust-snapshot-7',
      'post-verifier',
    ]);
    expect(trust.read).toHaveBeenCalledTimes(2);
    expect(transport.exchange).toHaveBeenCalledOnce();
    expect(evidence).toMatchObject({
      evidenceId: 'native-recovery-observation-fresh-trust',
      recoveryLeaseId: 'recovery-lease-fresh-trust',
      identityAuthority: 'RETAINED_NATIVE_IDENTITY',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(evidence.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it.each([
    ['schemaVersion', 2 as unknown as 1],
    ['snapshotId', 'supervisor-trust-snapshot-8'],
    ['snapshotVersion', 8],
    ['snapshotHash', '6'.repeat(64)],
    ['signerKeyId', 'supervisor-root-key-b'],
    ['rootRecordId', 'supervisor-root-record-b'],
    ['rootRecordVersion', 4],
    ['supervisorInstanceId', 'native-supervisor-instance-b'],
    ['supervisorKeyId', 'native-supervisor-key-b'],
    ['trustRecordId', 'native-supervisor-trust-b'],
    ['trustRecordVersion', 5],
    ['issuedAt', '2026-09-03T12:00:01.000Z'],
    ['validUntil', '2026-09-03T12:14:59.000Z'],
  ] as const)('denies post-exchange trust drift in %s', async (field, value) => {
    const calls: string[] = [];
    const stableVerifier = verifier(calls, 'verifier');
    const trust = new ScriptedTrustSource(
      [snapshot(stableVerifier), snapshot(stableVerifier, { [field]: value })],
      calls,
    );

    await expect(
      new FreshTrustRetainedNativeSupervisorRecoveryEvidenceSource(
        new FixtureTransport(calls),
        trust,
        clock(),
      ).observe(workItem()),
    ).rejects.toMatchObject({ code: 'EXCHANGE_DENIED' });
    expect(calls).not.toContain('verifier');
  });

  it('fails closed before transport when the initial trust read denies', async () => {
    const calls: string[] = [];
    const transport = new FixtureTransport(calls);
    await expect(
      new FreshTrustRetainedNativeSupervisorRecoveryEvidenceSource(
        transport,
        new ScriptedTrustSource([new Error('trust unavailable')], calls),
        clock(),
      ).observe(workItem()),
    ).rejects.toMatchObject({ code: 'EXCHANGE_DENIED' });
    expect(transport.exchange).not.toHaveBeenCalled();
  });

  it('discards the response when the post-exchange trust read denies', async () => {
    const calls: string[] = [];
    const responseVerifier = verifier(calls, 'verifier');
    const transport = new FixtureTransport(calls);
    await expect(
      new FreshTrustRetainedNativeSupervisorRecoveryEvidenceSource(
        transport,
        new ScriptedTrustSource([snapshot(responseVerifier), new Error('trust revoked')], calls),
        clock(),
      ).observe(workItem()),
    ).rejects.toMatchObject({ code: 'EXCHANGE_DENIED' });
    expect(transport.exchange).toHaveBeenCalledOnce();
    expect(calls).not.toContain('verifier');
  });

  it('preserves invalid-response denial from the post-exchange verifier', async () => {
    const calls: string[] = [];
    const rejectingVerifier = verifier(calls, 'verifier', () => {
      throw new RetainedNativeSupervisorRecoveryError('INVALID_RESPONSE');
    });
    await expect(
      new FreshTrustRetainedNativeSupervisorRecoveryEvidenceSource(
        new FixtureTransport(calls),
        new ScriptedTrustSource([snapshot(rejectingVerifier), snapshot(rejectingVerifier)], calls),
        clock(),
      ).observe(workItem()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects explicit deny-only transport and trust dependencies at construction', () => {
    const calls: string[] = [];
    const configuredTrust = new ScriptedTrustSource([], calls);
    expect(
      () =>
        new FreshTrustRetainedNativeSupervisorRecoveryEvidenceSource(
          new DenyRetainedNativeSupervisorRecoveryTransport(),
          configuredTrust,
        ),
    ).toThrowError(RetainedNativeSupervisorRecoveryError);
    expect(
      () =>
        new FreshTrustRetainedNativeSupervisorRecoveryEvidenceSource(
          new FixtureTransport(calls),
          new DenyRetainedNativeSupervisorTrustSource(),
        ),
    ).toThrowError(RetainedNativeSupervisorRecoveryError);
  });
});
