import { describe, expect, it } from 'vitest';
import {
  assertBudgetAllows,
  costBudgetPolicyHash,
  costLedgerChecksum,
  CostGovernancePolicyError,
} from '../cost-governance';

const periodStart = '2026-08-01T00:00:00.000Z';
const periodEnd = '2026-09-01T00:00:00.000Z';

describe('cost governance policy', () => {
  it('hashes canonical workspace policy and exact ledger bindings deterministically', () => {
    const workspacePolicyHash = costBudgetPolicyHash({
      schemaVersion: 1,
      policyId: 'workspace-budget-august',
      workspaceId: 'workspace-one',
      scope: 'WORKSPACE',
      taskId: null,
      currency: 'EUR',
      limitMinorUnits: 1_000n,
      periodStart,
      periodEnd,
      policyVersion: 'cost-policy-v1',
    });
    const binding = {
      schemaVersion: 1 as const,
      workspaceId: 'workspace-one',
      usageId: 'usage-one',
      receiptId: 'receipt-one',
      dispatchId: 'dispatch-one',
      sessionId: 'session-one',
      runId: 'run-one',
      taskId: 'task-one',
      runtimeId: 'runtime-one',
      connectionId: 'connection-one',
      sequence: 1,
      currency: 'EUR',
      costMinorUnits: 7n,
      computeUnits: 11n,
      workspacePolicyId: 'workspace-budget-august',
      workspacePolicyHash,
      taskPolicyId: 'task-budget-august',
      taskPolicyHash: 'a'.repeat(64),
      workspaceSpendMinorUnits: 7n,
      taskSpendMinorUnits: 7n,
      workspaceLimitMinorUnits: 100n,
      taskLimitMinorUnits: 50n,
      periodStart,
      periodEnd,
      recordedAt: '2026-08-15T00:00:00.000Z',
    };
    expect(costLedgerChecksum(binding)).toBe(costLedgerChecksum({ ...binding }));
    expect(costLedgerChecksum({ ...binding, sequence: 2 })).not.toBe(costLedgerChecksum(binding));
  });

  it('rejects malformed currency, periods, digests, references, and negative values', () => {
    const base = {
      schemaVersion: 1 as const,
      workspaceId: 'workspace-one',
      usageId: 'usage-one',
      receiptId: 'receipt-one',
      dispatchId: 'dispatch-one',
      sessionId: 'session-one',
      runId: 'run-one',
      taskId: 'task-one',
      runtimeId: 'runtime-one',
      connectionId: 'connection-one',
      sequence: 1,
      currency: 'EUR',
      costMinorUnits: 7n,
      computeUnits: 11n,
      workspacePolicyId: 'workspace-budget',
      workspacePolicyHash: 'a'.repeat(64),
      taskPolicyId: 'task-budget',
      taskPolicyHash: 'b'.repeat(64),
      periodStart,
      periodEnd,
      workspaceSpendMinorUnits: 7n,
      taskSpendMinorUnits: 7n,
      workspaceLimitMinorUnits: 100n,
      taskLimitMinorUnits: 50n,
      recordedAt: '2026-08-15T00:00:00.000Z',
    };
    for (const invalid of [
      { ...base, currency: 'eur' },
      { ...base, periodEnd: periodStart },
      { ...base, taskPolicyHash: 'not-a-digest' },
      { ...base, runtimeId: 'password=hunter2' },
      { ...base, runtimeId: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature' },
      { ...base, workspacePolicyId: 'glpat-abcdefghijklmnop' },
      { ...base, costMinorUnits: -1n },
      { ...base, workspaceLimitMinorUnits: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
      { ...base, sequence: 0 },
    ])
      expect(() => costLedgerChecksum(invalid)).toThrow(CostGovernancePolicyError);
  });

  it('denies workspace and task overspend at the exact boundary', () => {
    expect(() => assertBudgetAllows(90n, 100n, 40n, 50n, 10n)).not.toThrow();
    expect(() => assertBudgetAllows(90n, 99n, 40n, 50n, 10n)).toThrow(CostGovernancePolicyError);
    expect(() => assertBudgetAllows(90n, 100n, 41n, 50n, 10n)).toThrow(CostGovernancePolicyError);
  });
});
