import { describe, expect, it } from 'vitest';

import type { SupervisorProcessBinding } from './supervision-lifecycle';
import {
  CodexValidationProcessSessionRecoveryEvidenceError,
  createCodexValidationProcessSessionRecoveryExitEvidenceHash,
  observeCodexValidationProcessSessionRecoveryExit,
  validateCodexValidationProcessSessionRecoveryExitEvidence,
  type CodexValidationProcessSessionRecoveryEvidenceSource,
  type CodexValidationProcessSessionRecoveryExitEvidence,
} from './codex-validation-process-session-recovery-evidence';

const binding: SupervisorProcessBinding = {
  schemaVersion: 1,
  supervisionId: 'supervision-recovery-evidence',
  launchNonce: 'launch-recovery-evidence',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  runtimeId: 'runtime-recovery-evidence',
  connectionId: 'connection-recovery-evidence',
  platform: 'LINUX',
  manifestHash: '1'.repeat(64),
  admissionEvidenceHash: '2'.repeat(64),
  admissionBindingHash: '3'.repeat(64),
  testOnly: true,
};

function workItem() {
  return {
    schemaVersion: 1,
    recoveryLeaseId: 'recovery-lease-evidence',
    recoveryGeneration: 2,
    claimId: 'process-claim-evidence',
    handoffAttemptId: 'handoff-evidence',
    validationDispatchCandidateHash: '4'.repeat(64),
    sessionId: 'session-recovery-evidence',
    dispatchId: 'dispatch-recovery-evidence',
    runId: 'run-recovery-evidence',
    binding,
    processClaimedAt: '2026-09-01T12:00:00.000Z',
    processExpiresAt: '2026-09-01T12:01:00.000Z',
    leaseClaimedAt: '2026-09-01T12:01:01.000Z',
    leaseExpiresAt: '2026-09-01T12:01:16.000Z',
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function evidence(
  drift: Partial<CodexValidationProcessSessionRecoveryExitEvidence> = {},
): CodexValidationProcessSessionRecoveryExitEvidence {
  const value = {
    schemaVersion: 1 as const,
    evidenceId: 'recovery-exit-evidence',
    recoveryLeaseId: 'recovery-lease-evidence',
    recoveryGeneration: 2,
    claimId: 'process-claim-evidence',
    supervisionId: binding.supervisionId,
    launchNonce: binding.launchNonce,
    sessionId: 'session-recovery-evidence',
    dispatchId: 'dispatch-recovery-evidence',
    validationDispatchCandidateHash: '4'.repeat(64),
    identityEstablishedAt: '2026-09-01T12:00:01.000Z',
    exitedAt: '2026-09-01T12:00:50.000Z',
    verifiedAt: '2026-09-01T12:01:02.000Z',
    processState: 'EXITED' as const,
    exitCode: 0,
    signal: null,
    identityAuthority: 'RETAINED_NATIVE_IDENTITY' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
    ...drift,
  };
  return {
    ...value,
    evidenceHash: createCodexValidationProcessSessionRecoveryExitEvidenceHash(value),
  };
}

describe('Codex validation process-session recovery exit evidence', () => {
  it('accepts and freezes exact retained-identity exit evidence during the active lease', () => {
    const result = validateCodexValidationProcessSessionRecoveryExitEvidence(
      evidence(),
      workItem(),
      new Date('2026-09-01T12:01:03.000Z'),
    );

    expect(result).toEqual(evidence());
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.runtimeConnection).toBe('NOT_CONFIGURED');
  });

  it('observes through an injected source and revalidates the lease afterward', async () => {
    const source: CodexValidationProcessSessionRecoveryEvidenceSource = {
      observe: async (item) => {
        expect(item.recoveryLeaseId).toBe('recovery-lease-evidence');
        return evidence();
      },
    };
    const times = [new Date('2026-09-01T12:01:01.500Z'), new Date('2026-09-01T12:01:03.000Z')];

    await expect(
      observeCodexValidationProcessSessionRecoveryExit(workItem(), source, () => times.shift()!),
    ).resolves.toEqual(evidence());
  });

  it('denies by default and maps an injected source failure to a closed error', async () => {
    await expect(
      observeCodexValidationProcessSessionRecoveryExit(
        workItem(),
        undefined,
        () => new Date('2026-09-01T12:01:02.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'EVIDENCE_DENIED' });
    await expect(
      observeCodexValidationProcessSessionRecoveryExit(
        workItem(),
        { observe: async () => Promise.reject(new Error('untrusted source')) },
        () => new Date('2026-09-01T12:01:02.000Z'),
      ),
    ).rejects.toBeInstanceOf(CodexValidationProcessSessionRecoveryEvidenceError);
  });

  it.each([
    ['wrong lease', { recoveryLeaseId: 'other-lease' }],
    ['wrong generation', { recoveryGeneration: 3 }],
    ['wrong claim', { claimId: 'other-claim' }],
    ['wrong supervisor', { supervisionId: 'other-supervisor' }],
    ['wrong launch identity', { launchNonce: 'other-launch' }],
    ['wrong session', { sessionId: 'other-session' }],
    ['wrong dispatch', { dispatchId: 'other-dispatch' }],
    ['connected truth', { runtimeConnection: 'CONNECTED' }],
    ['unretained authority', { identityAuthority: 'PROCESS_LOOKUP' }],
    ['not exited', { processState: 'RUNNING' }],
    ['identity before claim', { identityEstablishedAt: '2026-09-01T11:59:59.999Z' }],
    ['exit after claim expiry', { exitedAt: '2026-09-01T12:01:00.001Z' }],
    ['verification before lease', { verifiedAt: '2026-09-01T12:01:00.999Z' }],
    ['invalid exit pair', { signal: 'SIGTERM' }],
  ])('rejects %s', (_label, drift) => {
    expect(() =>
      validateCodexValidationProcessSessionRecoveryExitEvidence(
        evidence(drift as never),
        workItem(),
        new Date('2026-09-01T12:01:03.000Z'),
      ),
    ).toThrow(CodexValidationProcessSessionRecoveryEvidenceError);
  });

  it('rejects added fields, secret-like references, forged hashes, and future verification', () => {
    for (const input of [
      { ...evidence(), nativeProcessId: 123 },
      evidence({ evidenceId: 'secret-token' }),
      { ...evidence(), evidenceHash: '0'.repeat(64) },
      evidence({ verifiedAt: '2026-09-01T12:01:04.000Z' }),
    ])
      expect(() =>
        validateCodexValidationProcessSessionRecoveryExitEvidence(
          input,
          workItem(),
          new Date('2026-09-01T12:01:03.000Z'),
        ),
      ).toThrow(CodexValidationProcessSessionRecoveryEvidenceError);
  });

  it('rejects evidence when the lease expires while the source is observing', async () => {
    const times = [new Date('2026-09-01T12:01:02.000Z'), new Date('2026-09-01T12:01:16.000Z')];
    await expect(
      observeCodexValidationProcessSessionRecoveryExit(
        workItem(),
        { observe: async () => evidence() },
        () => times.shift()!,
      ),
    ).rejects.toMatchObject({ code: 'LEASE_INACTIVE' });
  });

  it('rejects a cached pre-call observation and a clock that moves backward', async () => {
    await expect(
      observeCodexValidationProcessSessionRecoveryExit(
        workItem(),
        {
          observe: async () => evidence({ verifiedAt: '2026-09-01T12:01:01.500Z' }),
        },
        (() => {
          const times = [
            new Date('2026-09-01T12:01:02.000Z'),
            new Date('2026-09-01T12:01:03.000Z'),
          ];
          return () => times.shift()!;
        })(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_EVIDENCE' });

    await expect(
      observeCodexValidationProcessSessionRecoveryExit(
        workItem(),
        { observe: async () => evidence() },
        (() => {
          const times = [
            new Date('2026-09-01T12:01:03.000Z'),
            new Date('2026-09-01T12:01:02.000Z'),
          ];
          return () => times.shift()!;
        })(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_EVIDENCE' });
  });
});
