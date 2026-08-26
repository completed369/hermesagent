import { createHash } from 'node:crypto';
import { validateAcpApprovalReference } from './approval-bridge';

const CURRENCY = /^[A-Z]{3}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export class CostGovernancePolicyError extends Error {}

export interface CostLedgerBinding {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly usageId: string;
  readonly receiptId: string;
  readonly dispatchId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sequence: number;
  readonly currency: string;
  readonly costMinorUnits: bigint;
  readonly computeUnits: bigint;
  readonly workspacePolicyId: string;
  readonly workspacePolicyHash: string;
  readonly taskPolicyId: string;
  readonly taskPolicyHash: string;
  readonly workspaceSpendMinorUnits: bigint;
  readonly taskSpendMinorUnits: bigint;
  readonly workspaceLimitMinorUnits: bigint;
  readonly taskLimitMinorUnits: bigint;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly recordedAt: string;
}

export interface CostBudgetPolicyBinding {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly workspaceId: string;
  readonly scope: 'WORKSPACE' | 'TASK';
  readonly taskId: string | null;
  readonly currency: string;
  readonly limitMinorUnits: bigint;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly policyVersion: string;
}

function canonical(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

function ref(value: string, field: string): void {
  try {
    validateAcpApprovalReference(value, field);
  } catch {
    throw new CostGovernancePolicyError(`${field} is invalid`);
  }
}

export function assertCanonicalCurrency(value: string): void {
  if (!CURRENCY.test(value))
    throw new CostGovernancePolicyError('currency must be ISO-style uppercase');
}

export function costBudgetPolicyHash(binding: CostBudgetPolicyBinding): string {
  ref(binding.policyId, 'policyId');
  ref(binding.workspaceId, 'workspaceId');
  ref(binding.policyVersion, 'policyVersion');
  if (binding.scope === 'TASK') {
    if (!binding.taskId) throw new CostGovernancePolicyError('task policy requires taskId');
    ref(binding.taskId, 'taskId');
  } else if (binding.taskId !== null) {
    throw new CostGovernancePolicyError('workspace policy cannot bind taskId');
  }
  assertCanonicalCurrency(binding.currency);
  if (binding.limitMinorUnits < 0n || binding.limitMinorUnits > MAX_SAFE_BIGINT)
    throw new CostGovernancePolicyError('limit must be a non-negative safe integer');
  const start = new Date(binding.periodStart);
  const end = new Date(binding.periodEnd);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.toISOString() !== binding.periodStart ||
    end.toISOString() !== binding.periodEnd ||
    start >= end
  )
    throw new CostGovernancePolicyError('budget period must be canonical and ordered');
  return createHash('sha256').update(canonical(binding)).digest('hex');
}

export function costLedgerChecksum(binding: CostLedgerBinding): string {
  for (const field of [
    'workspaceId',
    'usageId',
    'receiptId',
    'dispatchId',
    'sessionId',
    'runId',
    'taskId',
    'runtimeId',
    'connectionId',
    'workspacePolicyId',
    'taskPolicyId',
  ] as const)
    ref(binding[field], field);
  for (const [field, digest] of [
    ['workspacePolicyHash', binding.workspacePolicyHash],
    ['taskPolicyHash', binding.taskPolicyHash],
  ] as const)
    if (!SHA256.test(digest)) throw new CostGovernancePolicyError(`${field} must be SHA-256`);
  assertCanonicalCurrency(binding.currency);
  if (!Number.isSafeInteger(binding.sequence) || binding.sequence < 1)
    throw new CostGovernancePolicyError('sequence must be a positive safe integer');
  if (
    binding.costMinorUnits < 0n ||
    binding.computeUnits < 0n ||
    binding.workspaceSpendMinorUnits < binding.costMinorUnits ||
    binding.taskSpendMinorUnits < binding.costMinorUnits ||
    binding.workspaceSpendMinorUnits > binding.workspaceLimitMinorUnits ||
    binding.taskSpendMinorUnits > binding.taskLimitMinorUnits ||
    [
      binding.costMinorUnits,
      binding.computeUnits,
      binding.workspaceSpendMinorUnits,
      binding.taskSpendMinorUnits,
      binding.workspaceLimitMinorUnits,
      binding.taskLimitMinorUnits,
    ].some((value) => value > MAX_SAFE_BIGINT)
  )
    throw new CostGovernancePolicyError('usage values cannot be negative');
  const start = new Date(binding.periodStart);
  const end = new Date(binding.periodEnd);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.toISOString() !== binding.periodStart ||
    end.toISOString() !== binding.periodEnd ||
    start >= end
  )
    throw new CostGovernancePolicyError('budget period must be canonical and ordered');
  const recorded = new Date(binding.recordedAt);
  if (
    Number.isNaN(recorded.getTime()) ||
    recorded.toISOString() !== binding.recordedAt ||
    recorded < start ||
    recorded >= end
  )
    throw new CostGovernancePolicyError('recordedAt must be canonical and within period');
  return createHash('sha256').update(canonical(binding)).digest('hex');
}

export function assertBudgetAllows(
  currentWorkspaceSpend: bigint,
  workspaceLimit: bigint,
  currentTaskSpend: bigint,
  taskLimit: bigint,
  delta: bigint,
): void {
  if (
    [currentWorkspaceSpend, workspaceLimit, currentTaskSpend, taskLimit, delta].some(
      (v) => v < 0n || v > MAX_SAFE_BIGINT,
    )
  )
    throw new CostGovernancePolicyError('budget values cannot be negative');
  if (currentWorkspaceSpend + delta > workspaceLimit || currentTaskSpend + delta > taskLimit)
    throw new CostGovernancePolicyError('usage exceeds governed budget');
}
