import type { CodexValidationProcessSessionRecoveryWorkItem } from './codex-validation-process-session-owner';
import {
  validateSupervisorProcessBinding,
  type SupervisorProcessBinding,
} from './supervision-lifecycle';

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|token|secret|transcript|prompt)/iu;
const LEASE_DURATION_MS = 15_000;

export type CodexValidationProcessSessionRecoveryErrorCode = 'INVALID_WORK_ITEM' | 'LEASE_INACTIVE';

export class CodexValidationProcessSessionRecoveryError extends Error {
  constructor(readonly code: CodexValidationProcessSessionRecoveryErrorCode) {
    super(`Codex validation process-session recovery denied: ${code}`);
  }
}

function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new CodexValidationProcessSessionRecoveryError('INVALID_WORK_ITEM');
  const value = input as Record<string, unknown>;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new CodexValidationProcessSessionRecoveryError('INVALID_WORK_ITEM');
  return value;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value) || PRIVATE_TEXT.test(value))
    throw new CodexValidationProcessSessionRecoveryError('INVALID_WORK_ITEM');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new CodexValidationProcessSessionRecoveryError('INVALID_WORK_ITEM');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string')
    throw new CodexValidationProcessSessionRecoveryError('INVALID_WORK_ITEM');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new CodexValidationProcessSessionRecoveryError('INVALID_WORK_ITEM');
  return value;
}

function binding(input: unknown): Readonly<SupervisorProcessBinding> {
  try {
    return validateSupervisorProcessBinding(input);
  } catch {
    throw new CodexValidationProcessSessionRecoveryError('INVALID_WORK_ITEM');
  }
}

/**
 * Revalidates the complete immutable metadata envelope immediately before a
 * future injected recovery owner may consume it. It performs no process action.
 */
export function validateCodexValidationProcessSessionRecoveryWorkItem(
  input: unknown,
  observedAt: Date = new Date(),
): Readonly<CodexValidationProcessSessionRecoveryWorkItem> {
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime()))
    throw new CodexValidationProcessSessionRecoveryError('INVALID_WORK_ITEM');
  const value = exact(input, [
    'binding',
    'claimId',
    'dispatchId',
    'handoffAttemptId',
    'leaseClaimedAt',
    'leaseExpiresAt',
    'processClaimedAt',
    'processExpiresAt',
    'recoveryGeneration',
    'recoveryLeaseId',
    'runId',
    'runtimeConnection',
    'schemaVersion',
    'sessionId',
    'validationDispatchCandidateHash',
  ]);
  const trustedBinding = binding(value.binding);
  const processClaimedAt = timestamp(value.processClaimedAt);
  const processExpiresAt = timestamp(value.processExpiresAt);
  const leaseClaimedAt = timestamp(value.leaseClaimedAt);
  const leaseExpiresAt = timestamp(value.leaseExpiresAt);
  const processClaimedAtMs = Date.parse(processClaimedAt);
  const processExpiresAtMs = Date.parse(processExpiresAt);
  const leaseClaimedAtMs = Date.parse(leaseClaimedAt);
  const leaseExpiresAtMs = Date.parse(leaseExpiresAt);
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.recoveryGeneration) ||
    (value.recoveryGeneration as number) < 1 ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    processClaimedAtMs >= processExpiresAtMs ||
    leaseClaimedAtMs < processExpiresAtMs ||
    leaseExpiresAtMs !== leaseClaimedAtMs + LEASE_DURATION_MS
  )
    throw new CodexValidationProcessSessionRecoveryError('INVALID_WORK_ITEM');
  if (observedAt.getTime() < leaseClaimedAtMs || observedAt.getTime() >= leaseExpiresAtMs)
    throw new CodexValidationProcessSessionRecoveryError('LEASE_INACTIVE');

  const workItem = Object.freeze({
    schemaVersion: 1 as const,
    recoveryLeaseId: reference(value.recoveryLeaseId),
    recoveryGeneration: value.recoveryGeneration as number,
    claimId: reference(value.claimId),
    handoffAttemptId: reference(value.handoffAttemptId),
    validationDispatchCandidateHash: digest(value.validationDispatchCandidateHash),
    sessionId: reference(value.sessionId),
    dispatchId: reference(value.dispatchId),
    runId: reference(value.runId),
    binding: trustedBinding,
    processClaimedAt,
    processExpiresAt,
    leaseClaimedAt,
    leaseExpiresAt,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  });
  return workItem;
}
