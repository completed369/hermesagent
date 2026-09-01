import { createHash } from 'node:crypto';

import { canonicalJson } from './codec';
import type { CodexValidationProcessSessionRecoveryWorkItem } from './codex-validation-process-session-owner';
import { validateCodexValidationProcessSessionRecoveryWorkItem } from './codex-validation-process-session-recovery';

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|token|secret|transcript|prompt)/iu;

export type CodexValidationProcessSessionRecoveryEvidenceErrorCode =
  'EVIDENCE_DENIED' | 'INVALID_EVIDENCE';

export class CodexValidationProcessSessionRecoveryEvidenceError extends Error {
  constructor(readonly code: CodexValidationProcessSessionRecoveryEvidenceErrorCode) {
    super(`Codex validation process-session recovery evidence denied: ${code}`);
  }
}

/**
 * Exit observation produced by a source that independently retains the native
 * process identity established at launch. It contains no process locator or
 * action capability and cannot promote runtime truth.
 */
export interface CodexValidationProcessSessionRecoveryExitEvidence {
  readonly schemaVersion: 1;
  readonly evidenceId: string;
  readonly recoveryLeaseId: string;
  readonly recoveryGeneration: number;
  readonly claimId: string;
  readonly supervisionId: string;
  readonly launchNonce: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly validationDispatchCandidateHash: string;
  readonly identityEstablishedAt: string;
  readonly exitedAt: string;
  readonly verifiedAt: string;
  readonly processState: 'EXITED';
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly identityAuthority: 'RETAINED_NATIVE_IDENTITY';
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly evidenceHash: string;
}

export interface CodexValidationProcessSessionRecoveryEvidenceSource {
  /**
   * Must inspect an independently retained launch identity. Reusable process
   * identifiers and caller assertions are never sufficient.
   */
  observe(workItem: Readonly<CodexValidationProcessSessionRecoveryWorkItem>): Promise<unknown>;
}

export class DenyCodexValidationProcessSessionRecoveryEvidenceSource implements CodexValidationProcessSessionRecoveryEvidenceSource {
  async observe(
    _workItem: Readonly<CodexValidationProcessSessionRecoveryWorkItem>,
  ): Promise<never> {
    throw new CodexValidationProcessSessionRecoveryEvidenceError('EVIDENCE_DENIED');
  }
}

function invalid(): never {
  throw new CodexValidationProcessSessionRecoveryEvidenceError('INVALID_EVIDENCE');
}

function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const value = input as Record<string, unknown>;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    invalid();
  return value;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value) || PRIVATE_TEXT.test(value)) invalid();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) invalid();
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid();
  return value;
}

export function createCodexValidationProcessSessionRecoveryExitEvidenceHash(
  evidence: Omit<CodexValidationProcessSessionRecoveryExitEvidence, 'evidenceHash'>,
): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        domain: 'ventureos.codex-validation.process-session-recovery-exit.v1',
        evidence,
      }),
    )
    .digest('hex');
}

export function validateCodexValidationProcessSessionRecoveryExitEvidence(
  input: unknown,
  workItemInput: unknown,
  observedAt: Date = new Date(),
): Readonly<CodexValidationProcessSessionRecoveryExitEvidence> {
  const workItem = validateCodexValidationProcessSessionRecoveryWorkItem(workItemInput, observedAt);
  const value = exact(input, [
    'claimId',
    'dispatchId',
    'evidenceHash',
    'evidenceId',
    'exitCode',
    'exitedAt',
    'identityAuthority',
    'identityEstablishedAt',
    'launchNonce',
    'processState',
    'recoveryGeneration',
    'recoveryLeaseId',
    'runtimeConnection',
    'schemaVersion',
    'sessionId',
    'signal',
    'supervisionId',
    'validationDispatchCandidateHash',
    'verifiedAt',
  ]);
  const identityEstablishedAt = timestamp(value.identityEstablishedAt);
  const exitedAt = timestamp(value.exitedAt);
  const verifiedAt = timestamp(value.verifiedAt);
  const exitCode = value.exitCode;
  const signal = value.signal;
  const trustedSignal = signal === null ? null : reference(signal);
  if (
    value.schemaVersion !== 1 ||
    value.recoveryLeaseId !== workItem.recoveryLeaseId ||
    value.recoveryGeneration !== workItem.recoveryGeneration ||
    value.claimId !== workItem.claimId ||
    value.supervisionId !== workItem.binding.supervisionId ||
    value.launchNonce !== workItem.binding.launchNonce ||
    value.sessionId !== workItem.sessionId ||
    value.dispatchId !== workItem.dispatchId ||
    value.validationDispatchCandidateHash !== workItem.validationDispatchCandidateHash ||
    value.processState !== 'EXITED' ||
    value.identityAuthority !== 'RETAINED_NATIVE_IDENTITY' ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    (exitCode !== null &&
      (!Number.isSafeInteger(exitCode) ||
        (exitCode as number) < 0 ||
        (exitCode as number) > 255)) ||
    (signal !== null && typeof signal !== 'string') ||
    (exitCode === null) === (signal === null) ||
    Date.parse(identityEstablishedAt) < Date.parse(workItem.processClaimedAt) ||
    Date.parse(identityEstablishedAt) > Date.parse(exitedAt) ||
    Date.parse(exitedAt) > Date.parse(workItem.processExpiresAt) ||
    Date.parse(verifiedAt) < Date.parse(workItem.leaseClaimedAt) ||
    Date.parse(verifiedAt) < Date.parse(exitedAt) ||
    Date.parse(verifiedAt) > observedAt.getTime() ||
    Date.parse(verifiedAt) >= Date.parse(workItem.leaseExpiresAt)
  )
    invalid();
  const evidence = Object.freeze({
    schemaVersion: 1 as const,
    evidenceId: reference(value.evidenceId),
    recoveryLeaseId: workItem.recoveryLeaseId,
    recoveryGeneration: workItem.recoveryGeneration,
    claimId: workItem.claimId,
    supervisionId: workItem.binding.supervisionId,
    launchNonce: workItem.binding.launchNonce,
    sessionId: workItem.sessionId,
    dispatchId: workItem.dispatchId,
    validationDispatchCandidateHash: workItem.validationDispatchCandidateHash,
    identityEstablishedAt,
    exitedAt,
    verifiedAt,
    processState: 'EXITED' as const,
    exitCode: exitCode as number | null,
    signal: trustedSignal,
    identityAuthority: 'RETAINED_NATIVE_IDENTITY' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  });
  const expectedHash = createCodexValidationProcessSessionRecoveryExitEvidenceHash(evidence);
  if (digest(value.evidenceHash) !== expectedHash) invalid();
  return Object.freeze({ ...evidence, evidenceHash: expectedHash });
}

/**
 * Revalidates lease freshness before and after the injected evidence source.
 * The default source denies and this function performs no process action.
 */
export async function observeCodexValidationProcessSessionRecoveryExit(
  workItemInput: unknown,
  source: CodexValidationProcessSessionRecoveryEvidenceSource = new DenyCodexValidationProcessSessionRecoveryEvidenceSource(),
  clock: () => Date = () => new Date(),
): Promise<Readonly<CodexValidationProcessSessionRecoveryExitEvidence>> {
  const startedAt = clock();
  const workItem = validateCodexValidationProcessSessionRecoveryWorkItem(workItemInput, startedAt);
  let candidate: unknown;
  try {
    candidate = await source.observe(workItem);
  } catch {
    throw new CodexValidationProcessSessionRecoveryEvidenceError('EVIDENCE_DENIED');
  }
  const finishedAt = clock();
  if (
    !(finishedAt instanceof Date) ||
    !Number.isFinite(finishedAt.getTime()) ||
    finishedAt.getTime() < startedAt.getTime()
  )
    invalid();
  const evidence = validateCodexValidationProcessSessionRecoveryExitEvidence(
    candidate,
    workItem,
    finishedAt,
  );
  if (Date.parse(evidence.verifiedAt) < startedAt.getTime()) invalid();
  return evidence;
}
