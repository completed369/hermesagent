import { describe, expect, it } from 'vitest';

import type { SupervisorProcessBinding } from './supervision-lifecycle';
import {
  createCodexValidationProcessSessionRecoveryExitEvidenceHash,
  type CodexValidationProcessSessionRecoveryEvidenceSource,
} from './codex-validation-process-session-recovery-evidence';
import {
  BoundedCodexValidationProcessSessionRecoveryCoordinator,
  CodexValidationProcessSessionRecoveryCoordinatorError,
  type CodexValidationProcessSessionRecoveryCompletionAuthority,
  type CodexValidationProcessSessionRecoveryCompletionRequest,
} from './codex-validation-process-session-recovery-coordinator';

const binding: SupervisorProcessBinding = {
  schemaVersion: 1,
  supervisionId: 'supervision-recovery-coordinator',
  launchNonce: 'launch-recovery-coordinator',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  runtimeId: 'runtime-recovery-coordinator',
  connectionId: 'connection-recovery-coordinator',
  platform: 'LINUX',
  manifestHash: '1'.repeat(64),
  admissionEvidenceHash: '2'.repeat(64),
  admissionBindingHash: '3'.repeat(64),
  testOnly: true,
};

function workItem() {
  return {
    schemaVersion: 1,
    recoveryLeaseId: 'lease-recovery-coordinator',
    recoveryGeneration: 1,
    claimId: 'claim-recovery-coordinator',
    handoffAttemptId: 'handoff-recovery-coordinator',
    validationDispatchCandidateHash: '4'.repeat(64),
    sessionId: 'session-recovery-coordinator',
    dispatchId: 'dispatch-recovery-coordinator',
    runId: 'run-recovery-coordinator',
    binding,
    processClaimedAt: '2026-09-01T12:00:00.000Z',
    processExpiresAt: '2026-09-01T12:01:00.000Z',
    leaseClaimedAt: '2026-09-01T12:01:01.000Z',
    leaseExpiresAt: '2026-09-01T12:01:16.000Z',
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function evidence() {
  const value = {
    schemaVersion: 1 as const,
    evidenceId: 'exit-recovery-coordinator',
    recoveryLeaseId: 'lease-recovery-coordinator',
    recoveryGeneration: 1,
    claimId: 'claim-recovery-coordinator',
    supervisionId: binding.supervisionId,
    launchNonce: binding.launchNonce,
    sessionId: 'session-recovery-coordinator',
    dispatchId: 'dispatch-recovery-coordinator',
    validationDispatchCandidateHash: '4'.repeat(64),
    identityEstablishedAt: '2026-09-01T12:00:01.000Z',
    exitedAt: '2026-09-01T12:00:50.000Z',
    verifiedAt: '2026-09-01T12:01:03.000Z',
    processState: 'EXITED' as const,
    exitCode: 0,
    signal: null,
    identityAuthority: 'RETAINED_NATIVE_IDENTITY' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  return {
    ...value,
    evidenceHash: createCodexValidationProcessSessionRecoveryExitEvidenceHash(value),
  };
}

function clock(...values: string[]) {
  const times = values.map((value) => new Date(value));
  return () => times.shift()!;
}

describe('bounded Codex validation process-session recovery coordinator', () => {
  it('observes before durable completion and preserves unconfigured truth', async () => {
    const order: string[] = [];
    let completed: Readonly<CodexValidationProcessSessionRecoveryCompletionRequest> | undefined;
    const source: CodexValidationProcessSessionRecoveryEvidenceSource = {
      observe: async () => {
        order.push('observe');
        return evidence();
      },
    };
    const authority: CodexValidationProcessSessionRecoveryCompletionAuthority = {
      complete: async (request) => {
        order.push('complete');
        completed = request;
      },
    };
    const coordinator = new BoundedCodexValidationProcessSessionRecoveryCoordinator(
      source,
      authority,
      clock(
        '2026-09-01T12:01:02.000Z',
        '2026-09-01T12:01:02.500Z',
        '2026-09-01T12:01:03.000Z',
        '2026-09-01T12:01:04.000Z',
      ),
    );

    const result = await coordinator.execute(workItem());

    expect(order).toEqual(['observe', 'complete']);
    expect(completed).toMatchObject({
      workItem: { recoveryLeaseId: 'lease-recovery-coordinator' },
      exitEvidence: { evidenceHash: evidence().evidenceHash },
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(Object.isFrozen(completed)).toBe(true);
    expect(result).toMatchObject({
      completionState: 'RECORDED',
      runtimeConnection: 'NOT_CONFIGURED',
      connectionTransition: 'NOT_APPLIED',
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('denies by default and never calls completion when observation fails', async () => {
    let called = false;
    const authority: CodexValidationProcessSessionRecoveryCompletionAuthority = {
      complete: async () => {
        called = true;
      },
    };
    const coordinator = new BoundedCodexValidationProcessSessionRecoveryCoordinator(
      undefined,
      authority,
      () => new Date('2026-09-01T12:01:02.000Z'),
    );

    await expect(coordinator.execute(workItem())).rejects.toThrow();
    expect(called).toBe(false);
  });

  it('fails closed when completion authority denies', async () => {
    const coordinator = new BoundedCodexValidationProcessSessionRecoveryCoordinator(
      { observe: async () => evidence() },
      undefined,
      clock(
        '2026-09-01T12:01:02.000Z',
        '2026-09-01T12:01:02.500Z',
        '2026-09-01T12:01:03.000Z',
        '2026-09-01T12:01:04.000Z',
      ),
    );

    await expect(coordinator.execute(workItem())).rejects.toMatchObject({
      code: 'COMPLETION_DENIED',
    });
  });

  it('rejects concurrent use of the same lease and releases it after failure', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const source: CodexValidationProcessSessionRecoveryEvidenceSource = {
      observe: async () => {
        await pending;
        throw new Error('source refused');
      },
    };
    const coordinator = new BoundedCodexValidationProcessSessionRecoveryCoordinator(
      source,
      undefined,
      () => new Date('2026-09-01T12:01:02.000Z'),
    );
    const first = coordinator.execute(workItem());
    await expect(coordinator.execute(workItem())).rejects.toMatchObject({
      code: 'CONCURRENT_RECOVERY',
    });
    release();
    await expect(first).rejects.toThrow();
    await expect(coordinator.execute(workItem())).rejects.not.toBeInstanceOf(
      CodexValidationProcessSessionRecoveryCoordinatorError,
    );
  });

  it('withholds completion when the lease expires after observation', async () => {
    let called = false;
    const coordinator = new BoundedCodexValidationProcessSessionRecoveryCoordinator(
      { observe: async () => evidence() },
      {
        complete: async () => {
          called = true;
        },
      },
      clock(
        '2026-09-01T12:01:02.000Z',
        '2026-09-01T12:01:02.500Z',
        '2026-09-01T12:01:03.000Z',
        '2026-09-01T12:01:16.000Z',
      ),
    );

    await expect(coordinator.execute(workItem())).rejects.toMatchObject({
      code: 'LEASE_INACTIVE',
    });
    expect(called).toBe(false);
  });
});
