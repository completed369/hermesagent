import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  enforceFinanceMutation: vi.fn(),
  revenueRunFindUnique: vi.fn(),
  revenueRunCreate: vi.fn(),
  opportunityFindFirst: vi.fn(),
  proposalFindFirst: vi.fn(),
  approvalFindFirst: vi.fn(),
  experimentFindFirst: vi.fn(),
  taskFindUnique: vi.fn(),
  runFindFirst: vi.fn(),
}));

const tx = {
  revenueRun: { findUnique: mocks.revenueRunFindUnique, create: mocks.revenueRunCreate },
  opportunity: { findFirst: mocks.opportunityFindFirst },
  ventureProposal: { findFirst: mocks.proposalFindFirst },
  approvalRequest: { findFirst: mocks.approvalFindFirst },
  experiment: { findFirst: mocks.experimentFindFirst },
  acpTask: { findUnique: mocks.taskFindUnique },
  acpRun: { findFirst: mocks.runFindFirst },
};

vi.mock('../capability-guard.js', () => ({
  enforceFinanceMutation: mocks.enforceFinanceMutation,
}));
vi.mock('@ventureos/database', () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { createRevenueRunPlan, type CreateRevenueRunPlanParams } from '../revenue-run.js';

const base: CreateRevenueRunPlanParams = {
  workspaceId: 'workspace',
  opportunityId: 'opportunity',
  ventureProposalId: 'proposal',
  currency: 'EUR',
  expectedRevenueMinorUnits: 100_00n,
  expectedCostMinorUnits: 20_00n,
  downsideMinorUnits: 20_00n,
  confidenceBps: 6_500,
  timeToCashDays: 30,
  forecastEvidenceHash: 'a'.repeat(64),
  idempotencyKey: 'revenue-plan-1',
  createdBy: 'founder:user-1',
};

function stored(params: CreateRevenueRunPlanParams = base) {
  return {
    id: 'revenue-run',
    ...params,
    approvalRequestId: params.approvalRequestId ?? null,
    experimentId: params.experimentId ?? null,
    taskId: params.taskId ?? null,
    runId: params.runId ?? null,
    status: 'PLANNED',
    createdAt: new Date('2026-09-08T04:00:00.000Z'),
  };
}

describe('revenue-run planning spine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );
    mocks.enforceFinanceMutation.mockResolvedValue(undefined);
    mocks.revenueRunFindUnique.mockResolvedValue(null);
    mocks.opportunityFindFirst.mockResolvedValue({ id: 'opportunity' });
    mocks.proposalFindFirst.mockResolvedValue({ id: 'proposal' });
    mocks.approvalFindFirst.mockResolvedValue({ id: 'approval' });
    mocks.experimentFindFirst.mockResolvedValue({ id: 'experiment' });
    mocks.taskFindUnique.mockResolvedValue({ id: 'task' });
    mocks.runFindFirst.mockResolvedValue({ id: 'run' });
    mocks.revenueRunCreate.mockResolvedValue(stored());
  });

  it('fails before database access when finance capability is unavailable', async () => {
    mocks.enforceFinanceMutation.mockRejectedValue(new Error('Operation is not available'));

    await expect(createRevenueRunPlan(base)).rejects.toThrow('Operation is not available');

    expect(mocks.revenueRunFindUnique).not.toHaveBeenCalled();
    expect(mocks.opportunityFindFirst).not.toHaveBeenCalled();
    expect(mocks.revenueRunCreate).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...base, runId: 'run' }, 'runId requires'],
    [{ ...base, currency: 'eur' }, 'currency'],
    [{ ...base, expectedCostMinorUnits: -1n }, 'expectedCostMinorUnits'],
    [{ ...base, confidenceBps: 10_001 }, 'confidenceBps'],
    [{ ...base, timeToCashDays: 36_501 }, 'timeToCashDays'],
    [{ ...base, forecastEvidenceHash: 'not-a-hash' }, 'forecastEvidenceHash'],
  ])('rejects malformed plans before opening a transaction', async (params, message) => {
    await expect(createRevenueRunPlan(params)).rejects.toThrow(message);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('creates only a PLANNED immutable forecast after exact tenant-scoped lookups', async () => {
    const params = {
      ...base,
      approvalRequestId: 'approval',
      experimentId: 'experiment',
      taskId: 'task',
      runId: 'run',
    };
    mocks.revenueRunCreate.mockResolvedValue(stored(params));

    const result = await createRevenueRunPlan(params);

    expect(result.status).toBe('PLANNED');
    expect(mocks.approvalFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'approval',
          workspaceId: 'workspace',
          ventureProposalId: 'proposal',
          state: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS'] },
          revokedAt: null,
        }),
      }),
    );
    expect(mocks.runFindFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace', id: 'run', taskId: 'task' },
      select: { id: true },
    });
    expect(mocks.revenueRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'PLANNED' }),
    });
  });

  it('returns an exact idempotent replay without re-reading dependencies or writing', async () => {
    const existing = stored();
    mocks.revenueRunFindUnique.mockResolvedValue(existing);

    await expect(createRevenueRunPlan(base)).resolves.toBe(existing);

    expect(mocks.opportunityFindFirst).not.toHaveBeenCalled();
    expect(mocks.revenueRunCreate).not.toHaveBeenCalled();
  });

  it('rejects idempotency-key reuse with changed forecast inputs', async () => {
    mocks.revenueRunFindUnique.mockResolvedValue(stored({ ...base, confidenceBps: 5_000 }));

    await expect(createRevenueRunPlan(base)).rejects.toThrow(
      'idempotency key was reused with different inputs',
    );
    expect(mocks.revenueRunCreate).not.toHaveBeenCalled();
  });

  it('fails closed when the proposal does not belong to the opportunity and workspace', async () => {
    mocks.proposalFindFirst.mockResolvedValue(null);

    await expect(createRevenueRunPlan(base)).rejects.toThrow('Venture proposal not found');

    expect(mocks.proposalFindFirst).toHaveBeenCalledWith({
      where: { id: 'proposal', workspaceId: 'workspace', opportunityId: 'opportunity' },
      select: { id: true },
    });
    expect(mocks.revenueRunCreate).not.toHaveBeenCalled();
  });

  it('fails closed when optional approval evidence is not currently approving and in scope', async () => {
    mocks.approvalFindFirst.mockResolvedValue(null);

    await expect(createRevenueRunPlan({ ...base, approvalRequestId: 'approval' })).rejects.toThrow(
      'Current approving evidence not found',
    );
    expect(mocks.revenueRunCreate).not.toHaveBeenCalled();
  });

  it('fails closed when a supplied ACP run is not bound to the exact task', async () => {
    mocks.runFindFirst.mockResolvedValue(null);

    await expect(createRevenueRunPlan({ ...base, taskId: 'task', runId: 'run' })).rejects.toThrow(
      'ACP run not found for the exact task',
    );
    expect(mocks.revenueRunCreate).not.toHaveBeenCalled();
  });
});
