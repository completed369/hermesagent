import { createHash } from 'node:crypto';

export interface AcpApprovalBinding {
  readonly workspaceId: string;
  readonly objectiveId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly actionCode: string;
  readonly exactTarget: string;
  readonly artifactVersionId: string;
  readonly evidenceHash: string;
  readonly policyVersion: string;
  readonly policyHash: string;
}

export interface AcpApprovalRequestInput extends AcpApprovalBinding {
  readonly idempotencyKey: string;
  readonly expiresAt: string;
}

export class AcpApprovalPolicyError extends Error {}

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$/u;
const ACTION_CODE = /^[A-Z][A-Z0-9_.-]{0,63}$/u;
const SHA_256 = /^[0-9a-f]{64}$/u;
const SENSITIVE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret|token)/iu;
const SECRET_VALUE =
  /(?:\b(?:sk|gh[opusr]|github_pat|npm|glpat|xox[baprs]|hf)[-_][A-Za-z0-9_-]{12,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\b|^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$)/u;

function safeReference(value: string, field: string): void {
  if (!SAFE_REFERENCE.test(value) || SENSITIVE_TEXT.test(value) || SECRET_VALUE.test(value)) {
    throw new AcpApprovalPolicyError(`${field} must be a safe non-sensitive reference`);
  }
}

export function validateAcpApprovalReference(value: string, field = 'reference'): void {
  safeReference(value, field);
}

export function validateAcpApprovalBinding(binding: AcpApprovalBinding): void {
  if (!binding || Object.getPrototypeOf(binding) !== Object.prototype) {
    throw new AcpApprovalPolicyError('Approval binding must be a plain object');
  }
  safeReference(binding.workspaceId, 'workspaceId');
  safeReference(binding.objectiveId, 'objectiveId');
  safeReference(binding.taskId, 'taskId');
  safeReference(binding.runId, 'runId');
  if (!ACTION_CODE.test(binding.actionCode) || SENSITIVE_TEXT.test(binding.actionCode)) {
    throw new AcpApprovalPolicyError('actionCode must be a safe action code');
  }
  safeReference(binding.exactTarget, 'exactTarget');
  safeReference(binding.artifactVersionId, 'artifactVersionId');
  safeReference(binding.policyVersion, 'policyVersion');
  if (!SHA_256.test(binding.evidenceHash)) {
    throw new AcpApprovalPolicyError('evidenceHash must be a lowercase SHA-256 digest');
  }
  if (!SHA_256.test(binding.policyHash)) {
    throw new AcpApprovalPolicyError('policyHash must be a lowercase SHA-256 digest');
  }
}

export function validateAcpApprovalRequestInput(input: AcpApprovalRequestInput, now: Date): void {
  validateAcpApprovalBinding(input);
  safeReference(input.idempotencyKey, 'idempotencyKey');
  const expiry = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== input.expiresAt) {
    throw new AcpApprovalPolicyError('expiresAt must be a canonical ISO timestamp');
  }
  if (expiry <= now.getTime() || expiry > now.getTime() + 7 * 24 * 60 * 60 * 1_000) {
    throw new AcpApprovalPolicyError(
      'Approval expiry must be in the future and no more than 7 days',
    );
  }
}

export function computeAcpApprovalBindingHash(binding: AcpApprovalBinding): string {
  validateAcpApprovalBinding(binding);
  return createHash('sha256')
    .update(
      JSON.stringify([
        binding.workspaceId,
        binding.objectiveId,
        binding.taskId,
        binding.runId,
        binding.actionCode,
        binding.exactTarget,
        binding.artifactVersionId,
        binding.evidenceHash,
        binding.policyVersion,
        binding.policyHash,
      ]),
      'utf8',
    )
    .digest('hex');
}

export function assertAcpApprovalBindingMatch(
  approved: AcpApprovalBinding,
  current: AcpApprovalBinding,
): void {
  validateAcpApprovalBinding(approved);
  validateAcpApprovalBinding(current);
  const fields = [
    'workspaceId',
    'objectiveId',
    'taskId',
    'runId',
    'actionCode',
    'exactTarget',
    'artifactVersionId',
    'evidenceHash',
    'policyVersion',
    'policyHash',
  ] as const;
  for (const field of fields) {
    if (approved[field] !== current[field]) {
      throw new AcpApprovalPolicyError(`Approval binding mismatch: ${field}`);
    }
  }
}
