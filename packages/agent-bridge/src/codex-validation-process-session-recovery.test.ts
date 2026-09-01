import { describe, expect, it } from 'vitest';

import type { SupervisorProcessBinding } from './supervision-lifecycle';
import {
  CodexValidationProcessSessionRecoveryError,
  validateCodexValidationProcessSessionRecoveryWorkItem,
} from './codex-validation-process-session-recovery';

const binding: SupervisorProcessBinding = {
  schemaVersion: 1,
  supervisionId: 'supervision-recovery-test',
  launchNonce: 'launch-recovery-test',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  runtimeId: 'runtime-recovery-test',
  connectionId: 'connection-recovery-test',
  platform: 'LINUX',
  manifestHash: '1'.repeat(64),
  admissionEvidenceHash: '2'.repeat(64),
  admissionBindingHash: '3'.repeat(64),
  testOnly: true,
};

const processClaimedAt = '2026-09-01T12:00:00.000Z';
const processExpiresAt = '2026-09-01T12:01:00.000Z';
const leaseClaimedAt = '2026-09-01T12:01:01.000Z';
const leaseExpiresAt = '2026-09-01T12:01:16.000Z';

function workItem() {
  return {
    schemaVersion: 1,
    recoveryLeaseId: 'recovery-lease-test',
    recoveryGeneration: 1,
    claimId: 'process-claim-test',
    handoffAttemptId: 'handoff-attempt-test',
    validationDispatchCandidateHash: '4'.repeat(64),
    sessionId: 'session-recovery-test',
    dispatchId: 'dispatch-recovery-test',
    runId: 'run-recovery-test',
    binding,
    processClaimedAt,
    processExpiresAt,
    leaseClaimedAt,
    leaseExpiresAt,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

describe('Codex validation process-session recovery work item', () => {
  it('revalidates and freezes the exact active lease-bound metadata envelope', () => {
    const result = validateCodexValidationProcessSessionRecoveryWorkItem(
      workItem(),
      new Date('2026-09-01T12:01:05.000Z'),
    );

    expect(result).toEqual(workItem());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.binding)).toBe(true);
    expect(result.runtimeConnection).toBe('NOT_CONFIGURED');
  });

  it.each([
    ['before lease', new Date('2026-09-01T12:01:00.999Z')],
    ['at expiry', new Date(leaseExpiresAt)],
    ['after expiry', new Date('2026-09-01T12:01:16.001Z')],
  ])('rejects an otherwise valid work item %s', (_label, observedAt) => {
    expect(() =>
      validateCodexValidationProcessSessionRecoveryWorkItem(workItem(), observedAt),
    ).toThrowError(expect.objectContaining({ code: 'LEASE_INACTIVE' }));
  });

  it.each([
    ['wrong schema', { schemaVersion: 2 }],
    ['zero generation', { recoveryGeneration: 0 }],
    ['connected truth', { runtimeConnection: 'CONNECTED' }],
    ['secret-like identity', { recoveryLeaseId: 'secret-token' }],
    ['token-like run identity', { runId: 'refresh-token' }],
    ['invalid digest', { validationDispatchCandidateHash: '4'.repeat(63) }],
    ['claim window', { processClaimedAt: processExpiresAt }],
    ['early recovery', { leaseClaimedAt: '2026-09-01T12:00:59.999Z' }],
    ['extended lease', { leaseExpiresAt: '2026-09-01T12:01:16.001Z' }],
    ['invalid binding', { binding: { ...binding, runtimeId: '' } }],
  ])('rejects %s', (_label, drift) => {
    expect(() =>
      validateCodexValidationProcessSessionRecoveryWorkItem(
        { ...workItem(), ...drift },
        new Date('2026-09-01T12:01:05.000Z'),
      ),
    ).toThrow(CodexValidationProcessSessionRecoveryError);
  });

  it('rejects missing, additional, non-canonical timestamp, and invalid clock fields', () => {
    const { runId: _removed, ...missing } = workItem();
    for (const input of [
      missing,
      { ...workItem(), payload: 'forbidden' },
      { ...workItem(), leaseClaimedAt: '2026-09-01T12:01:01Z' },
    ])
      expect(() =>
        validateCodexValidationProcessSessionRecoveryWorkItem(
          input,
          new Date('2026-09-01T12:01:05.000Z'),
        ),
      ).toThrow(CodexValidationProcessSessionRecoveryError);
    expect(() =>
      validateCodexValidationProcessSessionRecoveryWorkItem(workItem(), new Date('invalid')),
    ).toThrow(CodexValidationProcessSessionRecoveryError);
  });
});
