import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { FinanceController } from './finance.controller';

const mocks = vi.hoisted(() => ({
  getRevenueRunOutcomeEvidence: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  Prisma: { sql: vi.fn() },
  enforceWorkspaceCapability: vi.fn(),
  prisma: {},
}));

vi.mock('@ventureos/finance-engine', () => ({
  getRevenueRunOutcomeEvidence: mocks.getRevenueRunOutcomeEvidence,
  BudgetLimitExceededError: class extends Error {},
  BudgetNotFoundError: class extends Error {},
  ExperimentNotFoundError: class extends Error {},
  ExperimentInvalidStateError: class extends Error {},
  RevenueRunNotFoundError: class extends Error {},
  RevenueRunInvalidInputError: class extends Error {},
  RevenueRunConflictError: class extends Error {},
  RevenueRunOutcomeEvidenceDriftError: class extends Error {},
}));

vi.mock('../../common/policy/capability-admission', () => ({
  enforceCapabilityAdmission: vi.fn(),
}));

import {
  RevenueRunInvalidInputError,
  RevenueRunNotFoundError,
  RevenueRunOutcomeEvidenceDriftError,
} from '@ventureos/finance-engine';
import { FinanceService } from './finance.service';

const outcome = {
  id: 'revenue-run',
  workspaceId: 'workspace',
  currency: 'EUR',
  forecast: {
    expectedRevenueMinorUnits: 9_007_199_254_740_993n,
    expectedCostMinorUnits: 2_000n,
    downsideMinorUnits: 500n,
    confidenceBps: 6500,
    timeToCashDays: 30,
    evidenceHash: 'forecast-hash',
  },
  recordedRevenue: {
    evidenceCount: 1,
    grossMinorUnits: 12_345n,
    netMinorUnits: 10_000n,
    verificationState: 'UNVERIFIED_SOURCE_RECORDS' as const,
  },
  recordedCosts: {
    expenseEvidenceCount: 1,
    expenseMinorUnits: 2_500n,
    recognizedRuntimeUsageCount: 1,
    recognizedRuntimeChargeMinorUnits: 400n,
    recognizedRuntimeComputeUnits: 9_007_199_254_740_995n,
    overlapState: 'POTENTIAL_EXPENSE_RUNTIME_OVERLAP' as const,
    reconciledOverlapMinorUnits: null,
    deduplicatedTotalMinorUnits: null,
    reconciliation: null,
  },
  profit: {
    minorUnits: null,
    state: 'NOT_CALCULATED_POTENTIAL_COST_OVERLAP' as const,
  },
};

describe('Finance revenue-run outcome API projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRevenueRunOutcomeEvidence.mockResolvedValue(outcome);
  });

  it('requires session auth, the permission guard, and finance:view', () => {
    const reflector = new Reflector();
    const guards = reflector.get('__guards__', FinanceController) as unknown[];
    expect(guards).toContain(SessionAuthGuard);
    expect(guards).toContain(PermissionGuard);
    expect(reflector.get(PERMISSION_KEY, FinanceController.prototype.getRevenueRunOutcome)).toBe(
      'finance:view',
    );
  });

  it('takes tenant scope exclusively from the authenticated session', async () => {
    const getRevenueRunOutcome = vi.fn().mockResolvedValue({ id: 'revenue-run' });
    const controller = new FinanceController({ getRevenueRunOutcome } as never);

    await controller.getRevenueRunOutcome('revenue-run', {
      workspaceId: 'authenticated-workspace',
    } as never);

    expect(getRevenueRunOutcome).toHaveBeenCalledWith('authenticated-workspace', 'revenue-run');
  });

  it('returns exact JSON-safe decimal strings without weakening truth labels', async () => {
    const service = new FinanceService({ record: vi.fn() } as never);
    const result = await service.getRevenueRunOutcome('workspace', 'revenue-run');

    expect(mocks.getRevenueRunOutcomeEvidence).toHaveBeenCalledWith('workspace', 'revenue-run');
    expect(result).toEqual({
      id: 'revenue-run',
      workspaceId: 'workspace',
      currency: 'EUR',
      forecast: {
        expectedRevenueMinorUnits: '9007199254740993',
        expectedCostMinorUnits: '2000',
        downsideMinorUnits: '500',
        confidenceBps: 6500,
        timeToCashDays: 30,
        evidenceHash: 'forecast-hash',
      },
      recordedRevenue: {
        evidenceCount: 1,
        grossMinorUnits: '12345',
        netMinorUnits: '10000',
        verificationState: 'UNVERIFIED_SOURCE_RECORDS',
      },
      recordedCosts: {
        expenseEvidenceCount: 1,
        expenseMinorUnits: '2500',
        recognizedRuntimeUsageCount: 1,
        recognizedRuntimeChargeMinorUnits: '400',
        recognizedRuntimeComputeUnits: '9007199254740995',
        overlapState: 'POTENTIAL_EXPENSE_RUNTIME_OVERLAP',
        reconciledOverlapMinorUnits: null,
        deduplicatedTotalMinorUnits: null,
        reconciliation: null,
      },
      profit: {
        minorUnits: null,
        state: 'NOT_CALCULATED_POTENTIAL_COST_OVERLAP',
      },
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('serializes reconciled cost and explicitly unverified profit without precision loss', async () => {
    mocks.getRevenueRunOutcomeEvidence.mockResolvedValue({
      ...outcome,
      recordedCosts: {
        ...outcome.recordedCosts,
        overlapState: 'RECONCILED_EXACT_EVIDENCE_SET',
        reconciledOverlapMinorUnits: 300n,
        deduplicatedTotalMinorUnits: 9_007_199_254_740_999n,
        reconciliation: {
          id: 'reconciliation',
          evidenceHash: 'e'.repeat(64),
          basisReference: 'audit:cost-overlap-review-1',
        },
      },
      profit: {
        minorUnits: -9_007_199_254_730_999n,
        state: 'CALCULATED_FROM_UNVERIFIED_REVENUE_AND_RECONCILED_COSTS',
      },
    });
    const service = new FinanceService({ record: vi.fn() } as never);

    const result = await service.getRevenueRunOutcome('workspace', 'revenue-run');

    expect(result.recordedCosts.reconciledOverlapMinorUnits).toBe('300');
    expect(result.recordedCosts.deduplicatedTotalMinorUnits).toBe('9007199254740999');
    expect(result.profit).toEqual({
      minorUnits: '-9007199254730999',
      state: 'CALCULATED_FROM_UNVERIFIED_REVENUE_AND_RECONCILED_COSTS',
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it.each([
    [new RevenueRunNotFoundError('Revenue run not found'), NotFoundException],
    [new RevenueRunInvalidInputError('revenueRunId must be bounded'), BadRequestException],
    [
      new RevenueRunOutcomeEvidenceDriftError('Revenue-entry evidence changed after linking'),
      ConflictException,
    ],
  ])('maps finance-engine boundary errors without leaking internals', async (error, expected) => {
    mocks.getRevenueRunOutcomeEvidence.mockRejectedValue(error);
    const service = new FinanceService({ record: vi.fn() } as never);

    await expect(service.getRevenueRunOutcome('workspace', 'revenue-run')).rejects.toBeInstanceOf(
      expected,
    );
  });
});
