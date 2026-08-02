import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const mocks = vi.hoisted(() => ({
  proposalFindFirst: vi.fn(),
  listingVersionFindFirst: vi.fn(),
  revenueCreate: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  enforceWorkspaceCapability: vi.fn(),
  enforceCapabilityAdmission: vi.fn(),
  auditRecord: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  Prisma: { sql: vi.fn() },
  enforceWorkspaceCapability: mocks.enforceWorkspaceCapability,
  prisma: {
    ventureProposal: { findFirst: mocks.proposalFindFirst },
    listingVersion: { findFirst: mocks.listingVersionFindFirst },
    revenueEntry: { create: mocks.revenueCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@ventureos/finance-engine', () => ({
  BudgetLimitExceededError: class extends Error {},
  BudgetNotFoundError: class extends Error {},
  ExperimentNotFoundError: class extends Error {},
  ExperimentInvalidStateError: class extends Error {},
}));

vi.mock('../../common/policy/capability-admission', () => ({
  enforceCapabilityAdmission: mocks.enforceCapabilityAdmission,
}));

import { FinanceService } from './finance.service';

const input = {
  listingVersionId: '10000000-0000-4000-8000-000000000001',
  unitsSold: 1,
  grossRevenueEur: 10,
  marketplaceFeeEur: 1,
  paymentProcessingFeeEur: 1,
  listingFeeEur: 0,
  vatEur: 0,
  refundsEur: 0,
  occurredAt: '2026-08-02T00:00:00.000Z',
};

describe('FinanceService revenue tenant binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceCapabilityAdmission.mockResolvedValue(undefined);
    mocks.enforceWorkspaceCapability.mockResolvedValue(undefined);
    mocks.proposalFindFirst.mockResolvedValue({ id: 'proposal' });
    mocks.listingVersionFindFirst.mockResolvedValue(null);
    mocks.revenueCreate.mockResolvedValue({ id: 'revenue' });
    mocks.auditRecord.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        $queryRaw: mocks.queryRaw,
        revenueEntry: { create: mocks.revenueCreate },
      }),
    );
  });

  it('rejects a listing version that is not owned by the same workspace and venture', async () => {
    const service = new FinanceService({ record: mocks.auditRecord } as never);

    await expect(
      service.createRevenueEntry('workspace', 'proposal', input, 'founder'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mocks.listingVersionFindFirst).toHaveBeenCalledWith({
      where: {
        id: input.listingVersionId,
        listing: {
          workspaceId: 'workspace',
          product: { ventureProposalId: 'proposal' },
        },
      },
      select: { id: true },
    });
    expect(mocks.revenueCreate).not.toHaveBeenCalled();
  });

  it('rechecks FINANCE_ACCESS inside the final transaction before revenue mutation', async () => {
    mocks.listingVersionFindFirst.mockResolvedValue({ id: input.listingVersionId });
    mocks.enforceWorkspaceCapability.mockRejectedValue(new Error('Operation is not available'));
    const service = new FinanceService({ record: mocks.auditRecord } as never);

    await expect(
      service.createRevenueEntry('workspace', 'proposal', input, 'founder'),
    ).rejects.toThrow('Operation is not available');

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.revenueCreate).not.toHaveBeenCalled();
  });
});
