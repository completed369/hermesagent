import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  enforceFinanceMutation: vi.fn(),
  enforceFinanceRead: vi.fn(),
  revenueRunFindFirst: vi.fn(),
  revenueEntryFindFirst: vi.fn(),
  expenseFindFirst: vi.fn(),
  usageFindFirst: vi.fn(),
  revenueLinkFindUnique: vi.fn(),
  revenueLinkCreate: vi.fn(),
  expenseLinkFindUnique: vi.fn(),
  expenseLinkCreate: vi.fn(),
  usageLinkFindUnique: vi.fn(),
  usageLinkCreate: vi.fn(),
  reconciliationFindUnique: vi.fn(),
  reconciliationCreate: vi.fn(),
}));

const tx = {
  $queryRaw: mocks.queryRaw,
  revenueRun: { findFirst: mocks.revenueRunFindFirst },
  revenueEntry: { findFirst: mocks.revenueEntryFindFirst },
  expense: { findFirst: mocks.expenseFindFirst },
  acpRunUsage: { findFirst: mocks.usageFindFirst },
  revenueRunRevenueEntry: {
    findUnique: mocks.revenueLinkFindUnique,
    create: mocks.revenueLinkCreate,
  },
  revenueRunExpense: {
    findUnique: mocks.expenseLinkFindUnique,
    create: mocks.expenseLinkCreate,
  },
  revenueRunUsage: {
    findUnique: mocks.usageLinkFindUnique,
    create: mocks.usageLinkCreate,
  },
  revenueRunCostReconciliation: {
    findUnique: mocks.reconciliationFindUnique,
    create: mocks.reconciliationCreate,
  },
};

vi.mock('../capability-guard.js', () => ({
  enforceFinanceMutation: mocks.enforceFinanceMutation,
  enforceFinanceRead: mocks.enforceFinanceRead,
}));
vi.mock('@ventureos/database', () => ({
  Prisma: {
    sql: vi.fn((strings: TemplateStringsArray) => strings.join('?')),
    TransactionIsolationLevel: { RepeatableRead: 'RepeatableRead' },
  },
  prisma: {
    $transaction: mocks.transaction,
    revenueRun: { findFirst: mocks.revenueRunFindFirst },
  },
}));

import {
  getRevenueRunOutcomeEvidence,
  linkRevenueRunExpense,
  linkRevenueRunRevenueEntry,
  linkRevenueRunUsage,
  recordRevenueRunCostReconciliation,
} from '../revenue-run-outcome.js';

const params = {
  workspaceId: 'workspace',
  revenueRunId: 'revenue-run',
  factId: 'fact',
  linkedBy: 'founder:user-1',
};
const reconciliationParams = {
  workspaceId: 'workspace',
  revenueRunId: 'revenue-run',
  overlapMinorUnits: 20n,
  basisReference: 'audit:cost-overlap-review-1',
  idempotencyKey: 'cost-reconciliation-1',
  reconciledBy: 'founder:user-1',
};
const decimal = (value: string) => ({ toString: () => value });
const revenueEntry = {
  id: 'fact',
  workspaceId: 'workspace',
  ventureProposalId: 'proposal',
  listingVersionId: null,
  unitsSold: 2,
  grossRevenueEur: decimal('12.34'),
  marketplaceFeeEur: decimal('1.00'),
  paymentProcessingFeeEur: decimal('0.25'),
  listingFeeEur: decimal('0'),
  vatEur: decimal('0'),
  refundsEur: decimal('0'),
  netRevenueEur: decimal('11.09'),
  source: 'MANUAL',
  occurredAt: new Date('2026-09-08T01:00:00.000Z'),
  recordedBy: 'founder:user-1',
  createdAt: new Date('2026-09-08T01:01:00.000Z'),
};
const expense = {
  id: 'fact',
  workspaceId: 'workspace',
  ventureProposalId: 'proposal',
  category: 'AI_GENERATION',
  amountEur: decimal('2.50'),
  description: 'recorded expense',
  source: 'MANUAL',
  incurredAt: new Date('2026-09-08T01:02:00.000Z'),
  createdAt: new Date('2026-09-08T01:03:00.000Z'),
};
const usage = {
  id: 'fact',
  workspaceId: 'workspace',
  dispatchId: 'dispatch',
  runId: 'acp-run',
  sessionId: 'session',
  receiptId: 'receipt',
  sequence: 1,
  computeUnits: 5n,
  costMinorUnits: 25n,
  cumulativeComputeUnits: 5n,
  cumulativeCostMinorUnits: 25n,
  currency: 'EUR',
  evidenceHash: 'b'.repeat(64),
  recordedAt: new Date('2026-09-08T01:04:00.000Z'),
  costLedgerEntry: {
    id: 'ledger',
    workspaceId: 'workspace',
    usageId: 'fact',
    runId: 'acp-run',
    currency: 'EUR',
    costMinorUnits: 25n,
    computeUnits: 5n,
    checksum: 'c'.repeat(64),
    recordedAt: new Date('2026-09-08T01:05:00.000Z'),
  },
};

describe('revenue-run outcome evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );
    mocks.enforceFinanceMutation.mockResolvedValue(undefined);
    mocks.enforceFinanceRead.mockResolvedValue(undefined);
    mocks.queryRaw.mockResolvedValue([{ id: 'fact' }]);
    mocks.revenueRunFindFirst.mockResolvedValue({
      id: 'revenue-run',
      workspaceId: 'workspace',
      ventureProposalId: 'proposal',
      runId: 'acp-run',
      currency: 'EUR',
    });
    mocks.revenueEntryFindFirst.mockResolvedValue(revenueEntry);
    mocks.expenseFindFirst.mockResolvedValue(expense);
    mocks.usageFindFirst.mockResolvedValue(usage);
    mocks.revenueLinkFindUnique.mockResolvedValue(null);
    mocks.expenseLinkFindUnique.mockResolvedValue(null);
    mocks.usageLinkFindUnique.mockResolvedValue(null);
    mocks.reconciliationFindUnique.mockResolvedValue(null);
    mocks.revenueLinkCreate.mockImplementation(async ({ data }: { data: object }) => data);
    mocks.expenseLinkCreate.mockImplementation(async ({ data }: { data: object }) => data);
    mocks.usageLinkCreate.mockImplementation(async ({ data }: { data: object }) => data);
    mocks.reconciliationCreate.mockImplementation(async ({ data }: { data: object }) => ({
      id: 'reconciliation',
      createdAt: new Date('2026-09-08T01:06:00.000Z'),
      ...data,
    }));
  });

  it('denies link mutation before reading the fact or revenue run', async () => {
    mocks.enforceFinanceMutation.mockRejectedValue(new Error('Operation is not available'));

    await expect(linkRevenueRunRevenueEntry(params)).rejects.toThrow('Operation is not available');

    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.revenueRunFindFirst).not.toHaveBeenCalled();
    expect(mocks.revenueLinkCreate).not.toHaveBeenCalled();
  });

  it('hash-binds and appends an exact tenant-and-venture revenue entry', async () => {
    const result = await linkRevenueRunRevenueEntry(params);

    expect(mocks.revenueEntryFindFirst).toHaveBeenCalledWith({
      where: { id: 'fact', workspaceId: 'workspace', ventureProposalId: 'proposal' },
    });
    expect(result).toEqual(
      expect.objectContaining({
        workspaceId: 'workspace',
        revenueRunId: 'revenue-run',
        revenueEntryId: 'fact',
        evidenceHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
  });

  it('rejects a EUR fact for a non-EUR revenue run before reading or writing it', async () => {
    mocks.revenueRunFindFirst.mockResolvedValue({
      id: 'revenue-run',
      workspaceId: 'workspace',
      ventureProposalId: 'proposal',
      currency: 'USD',
    });

    await expect(linkRevenueRunExpense(params)).rejects.toThrow(
      'EUR expense evidence cannot be linked',
    );

    expect(mocks.expenseFindFirst).not.toHaveBeenCalled();
    expect(mocks.expenseLinkCreate).not.toHaveBeenCalled();
  });

  it('requires matching immutable cost-ledger evidence before linking ACP usage', async () => {
    mocks.usageFindFirst.mockResolvedValue({ ...usage, costLedgerEntry: null });

    await expect(linkRevenueRunUsage(params)).rejects.toThrow(
      'Recognized ACP cost-ledger evidence not found',
    );
    expect(mocks.usageLinkCreate).not.toHaveBeenCalled();
  });

  it('rejects drift between ACP usage and its recognized charge', async () => {
    mocks.usageFindFirst.mockResolvedValue({
      ...usage,
      costLedgerEntry: { ...usage.costLedgerEntry, costMinorUnits: 26n },
    });

    await expect(linkRevenueRunUsage(params)).rejects.toThrow(
      'ACP usage and recognized cost-ledger evidence do not match',
    );
    expect(mocks.usageLinkCreate).not.toHaveBeenCalled();
  });

  it('accepts an exact link replay and rejects changed actor evidence', async () => {
    const first = await linkRevenueRunExpense(params);
    mocks.expenseLinkFindUnique.mockResolvedValue(first);

    await expect(linkRevenueRunExpense(params)).resolves.toBe(first);
    await expect(linkRevenueRunExpense({ ...params, linkedBy: 'founder:user-2' })).rejects.toThrow(
      'different correlation evidence',
    );
  });

  it('binds cost overlap to the exact current expense and recognized-usage evidence sets', async () => {
    const expenseLink = await linkRevenueRunExpense(params);
    const usageLink = await linkRevenueRunUsage(params);
    mocks.revenueRunFindFirst.mockResolvedValue({
      id: 'revenue-run',
      workspaceId: 'workspace',
      currency: 'EUR',
      expenses: [{ ...expenseLink, expense }],
      usages: [{ ...usageLink, usage }],
    });

    const result = await recordRevenueRunCostReconciliation(reconciliationParams);

    expect(result).toEqual(
      expect.objectContaining({
        workspaceId: 'workspace',
        revenueRunId: 'revenue-run',
        expenseTotalMinorUnits: 250n,
        runtimeChargeMinorUnits: 25n,
        overlapMinorUnits: 20n,
        expenseEvidenceSetHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        usageEvidenceSetHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        reconciliationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
  });

  it('denies cost reconciliation before locking or reading the revenue run', async () => {
    mocks.enforceFinanceMutation.mockRejectedValue(new Error('Operation is not available'));

    await expect(recordRevenueRunCostReconciliation(reconciliationParams)).rejects.toThrow(
      'Operation is not available',
    );

    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.revenueRunFindFirst).not.toHaveBeenCalled();
    expect(mocks.reconciliationCreate).not.toHaveBeenCalled();
  });

  it('accepts only an exact cost-reconciliation replay for an idempotency key', async () => {
    const expenseLink = await linkRevenueRunExpense(params);
    const usageLink = await linkRevenueRunUsage(params);
    mocks.revenueRunFindFirst.mockResolvedValue({
      id: 'revenue-run',
      workspaceId: 'workspace',
      currency: 'EUR',
      expenses: [{ ...expenseLink, expense }],
      usages: [{ ...usageLink, usage }],
    });
    const first = await recordRevenueRunCostReconciliation(reconciliationParams);
    mocks.reconciliationFindUnique.mockResolvedValue(first);

    await expect(recordRevenueRunCostReconciliation(reconciliationParams)).resolves.toBe(first);
    await expect(
      recordRevenueRunCostReconciliation({
        ...reconciliationParams,
        basisReference: 'audit:different-review',
      }),
    ).rejects.toThrow('idempotency key already has different evidence');
  });

  it('rejects overlap larger than either authoritative aggregate', async () => {
    const expenseLink = await linkRevenueRunExpense(params);
    const usageLink = await linkRevenueRunUsage(params);
    mocks.revenueRunFindFirst.mockResolvedValue({
      id: 'revenue-run',
      workspaceId: 'workspace',
      currency: 'EUR',
      expenses: [{ ...expenseLink, expense }],
      usages: [{ ...usageLink, usage }],
    });

    await expect(
      recordRevenueRunCostReconciliation({
        ...reconciliationParams,
        overlapMinorUnits: 26n,
      }),
    ).rejects.toThrow('exceeds an authoritative cost aggregate');
    expect(mocks.reconciliationCreate).not.toHaveBeenCalled();
  });

  it('keeps recorded revenue, expenses, and recognized runtime charges separate from profit', async () => {
    const revenueLink = await linkRevenueRunRevenueEntry(params);
    const expenseLink = await linkRevenueRunExpense(params);
    const usageLink = await linkRevenueRunUsage(params);
    mocks.revenueRunFindFirst.mockResolvedValue({
      id: 'revenue-run',
      workspaceId: 'workspace',
      currency: 'EUR',
      expectedRevenueMinorUnits: 2_000n,
      expectedCostMinorUnits: 500n,
      downsideMinorUnits: 500n,
      confidenceBps: 6_500,
      timeToCashDays: 30,
      forecastEvidenceHash: 'a'.repeat(64),
      revenueEntries: [{ ...revenueLink, revenueEntry }],
      expenses: [{ ...expenseLink, expense }],
      usages: [{ ...usageLink, usage }],
      costReconciliations: [],
    });

    const outcome = await getRevenueRunOutcomeEvidence('workspace', 'revenue-run');

    expect(mocks.transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(outcome.recordedRevenue).toEqual({
      evidenceCount: 1,
      grossMinorUnits: 1_234n,
      netMinorUnits: 1_109n,
      verificationState: 'UNVERIFIED_SOURCE_RECORDS',
    });
    expect(outcome.recordedCosts).toEqual({
      expenseEvidenceCount: 1,
      expenseMinorUnits: 250n,
      recognizedRuntimeUsageCount: 1,
      recognizedRuntimeChargeMinorUnits: 25n,
      recognizedRuntimeComputeUnits: 5n,
      overlapState: 'POTENTIAL_EXPENSE_RUNTIME_OVERLAP',
      reconciledOverlapMinorUnits: null,
      deduplicatedTotalMinorUnits: null,
      reconciliation: null,
    });
    expect(outcome.profit).toEqual({
      minorUnits: null,
      state: 'NOT_CALCULATED_POTENTIAL_COST_OVERLAP',
    });
  });

  it('calculates only an explicitly unverified profit after exact-set cost reconciliation', async () => {
    const revenueLink = await linkRevenueRunRevenueEntry(params);
    const expenseLink = await linkRevenueRunExpense(params);
    const usageLink = await linkRevenueRunUsage(params);
    mocks.revenueRunFindFirst.mockResolvedValue({
      id: 'revenue-run',
      workspaceId: 'workspace',
      currency: 'EUR',
      expenses: [{ ...expenseLink, expense }],
      usages: [{ ...usageLink, usage }],
    });
    const reconciliation = await recordRevenueRunCostReconciliation(reconciliationParams);
    mocks.revenueRunFindFirst.mockResolvedValue({
      id: 'revenue-run',
      workspaceId: 'workspace',
      currency: 'EUR',
      expectedRevenueMinorUnits: 2_000n,
      expectedCostMinorUnits: 500n,
      downsideMinorUnits: 500n,
      confidenceBps: 6_500,
      timeToCashDays: 30,
      forecastEvidenceHash: 'a'.repeat(64),
      revenueEntries: [{ ...revenueLink, revenueEntry }],
      expenses: [{ ...expenseLink, expense }],
      usages: [{ ...usageLink, usage }],
      costReconciliations: [reconciliation],
    });

    const outcome = await getRevenueRunOutcomeEvidence('workspace', 'revenue-run');

    expect(outcome.recordedCosts).toEqual(
      expect.objectContaining({
        overlapState: 'RECONCILED_EXACT_EVIDENCE_SET',
        reconciledOverlapMinorUnits: 20n,
        deduplicatedTotalMinorUnits: 255n,
        reconciliation: {
          id: 'reconciliation',
          evidenceHash: reconciliation.reconciliationHash,
          basisReference: 'audit:cost-overlap-review-1',
        },
      }),
    );
    expect(outcome.profit).toEqual({
      minorUnits: 854n,
      state: 'CALCULATED_FROM_UNVERIFIED_REVENUE_AND_RECONCILED_COSTS',
    });
  });

  it('invalidates profit when a reconciliation no longer matches the current evidence sets', async () => {
    const revenueLink = await linkRevenueRunRevenueEntry(params);
    const expenseLink = await linkRevenueRunExpense(params);
    const usageLink = await linkRevenueRunUsage(params);
    mocks.revenueRunFindFirst.mockResolvedValue({
      id: 'revenue-run',
      workspaceId: 'workspace',
      currency: 'EUR',
      expenses: [{ ...expenseLink, expense }],
      usages: [{ ...usageLink, usage }],
    });
    const reconciliation = await recordRevenueRunCostReconciliation(reconciliationParams);
    mocks.revenueRunFindFirst.mockResolvedValue({
      id: 'revenue-run',
      workspaceId: 'workspace',
      currency: 'EUR',
      expectedRevenueMinorUnits: 2_000n,
      expectedCostMinorUnits: 500n,
      downsideMinorUnits: 500n,
      confidenceBps: 6_500,
      timeToCashDays: 30,
      forecastEvidenceHash: 'a'.repeat(64),
      revenueEntries: [{ ...revenueLink, revenueEntry }],
      expenses: [{ ...expenseLink, expense }],
      usages: [{ ...usageLink, usage }],
      costReconciliations: [{ ...reconciliation, usageEvidenceSetHash: 'd'.repeat(64) }],
    });

    const outcome = await getRevenueRunOutcomeEvidence('workspace', 'revenue-run');

    expect(outcome.recordedCosts).toEqual(
      expect.objectContaining({
        overlapState: 'STALE_RECONCILIATION_EVIDENCE_SET',
        reconciledOverlapMinorUnits: null,
        deduplicatedTotalMinorUnits: null,
        reconciliation: null,
      }),
    );
    expect(outcome.profit).toEqual({
      minorUnits: null,
      state: 'NOT_CALCULATED_POTENTIAL_COST_OVERLAP',
    });
  });

  it('fails the read projection when a linked source fact drifts', async () => {
    const revenueLink = await linkRevenueRunRevenueEntry(params);
    mocks.revenueRunFindFirst.mockResolvedValue({
      id: 'revenue-run',
      workspaceId: 'workspace',
      currency: 'EUR',
      expectedRevenueMinorUnits: 2_000n,
      expectedCostMinorUnits: 500n,
      downsideMinorUnits: 500n,
      confidenceBps: 6_500,
      timeToCashDays: 30,
      forecastEvidenceHash: 'a'.repeat(64),
      revenueEntries: [
        { ...revenueLink, revenueEntry: { ...revenueEntry, netRevenueEur: decimal('11.10') } },
      ],
      expenses: [],
      usages: [],
      costReconciliations: [],
    });

    await expect(getRevenueRunOutcomeEvidence('workspace', 'revenue-run')).rejects.toThrow(
      'Revenue-entry evidence changed after linking',
    );
  });
});
