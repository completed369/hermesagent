import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { FinanceController } from './finance.controller';

const mocks = vi.hoisted(() => ({
  getRevenueRunOutcomeEvidence: vi.fn(),
  recordRevenueRunCostReconciliation: vi.fn(),
  createRevenueRunPlan: vi.fn(),
  linkRevenueRunRevenueEntry: vi.fn(),
  linkRevenueRunExpense: vi.fn(),
  linkRevenueRunUsage: vi.fn(),
  recordRevenueRunCommercialEvidence: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  Prisma: { sql: vi.fn() },
  enforceWorkspaceCapability: vi.fn(),
  prisma: {},
}));

vi.mock('@ventureos/finance-engine', () => ({
  REVENUE_RUN_COMMERCIAL_EVIDENCE_KINDS: [
    'PAYMENT_SETTLEMENT',
    'DELIVERY_CONFIRMATION',
    'REFUND_OBSERVATION',
  ],
  REVENUE_RUN_COMMERCIAL_EVIDENCE_SOURCE_TYPES: [
    'MARKETPLACE_EXPORT',
    'PAYMENT_PROCESSOR_EXPORT',
    'BANK_SETTLEMENT_EXPORT',
    'FULFILLMENT_EXPORT',
    'FOUNDER_OBSERVED',
  ],
  getRevenueRunOutcomeEvidence: mocks.getRevenueRunOutcomeEvidence,
  recordRevenueRunCostReconciliation: mocks.recordRevenueRunCostReconciliation,
  createRevenueRunPlan: mocks.createRevenueRunPlan,
  linkRevenueRunRevenueEntry: mocks.linkRevenueRunRevenueEntry,
  linkRevenueRunExpense: mocks.linkRevenueRunExpense,
  linkRevenueRunUsage: mocks.linkRevenueRunUsage,
  recordRevenueRunCommercialEvidence: mocks.recordRevenueRunCommercialEvidence,
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
    commercialEvidence: {
      evidenceCount: 0,
      paymentSettlementCount: 0,
      deliveryConfirmationCount: 0,
      refundObservationCount: 0,
      evidenceSetHash: null,
      state: 'NO_COMMERCIAL_EVIDENCE' as const,
    },
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
        commercialEvidence: {
          evidenceCount: 0,
          paymentSettlementCount: 0,
          deliveryConfirmationCount: 0,
          refundObservationCount: 0,
          evidenceSetHash: null,
          state: 'NO_COMMERCIAL_EVIDENCE',
        },
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

describe('Finance revenue-run cost-reconciliation API', () => {
  const revenueRunId = '11111111-1111-4111-8111-111111111111';
  const reconciliation = {
    id: 'reconciliation',
    workspaceId: 'authenticated-workspace',
    revenueRunId,
    currency: 'EUR',
    expenseEvidenceSetHash: 'a'.repeat(64),
    usageEvidenceSetHash: 'b'.repeat(64),
    expenseTotalMinorUnits: 9_007_199_254_740_995n,
    runtimeChargeMinorUnits: 800n,
    overlapMinorUnits: 300n,
    basisReference: 'audit:cost-overlap-review-1',
    reconciliationHash: 'c'.repeat(64),
    idempotencyKey: 'cost-reconciliation-1',
    reconciledBy: 'authenticated-user',
    createdAt: new Date('2026-09-08T08:00:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordRevenueRunCostReconciliation.mockResolvedValue(reconciliation);
  });

  it('requires session auth, the permission guard, and finance:manage', () => {
    const reflector = new Reflector();
    const guards = reflector.get('__guards__', FinanceController) as unknown[];
    expect(guards).toContain(SessionAuthGuard);
    expect(guards).toContain(PermissionGuard);
    expect(
      reflector.get(PERMISSION_KEY, FinanceController.prototype.recordRevenueRunCostReconciliation),
    ).toBe('finance:manage');
  });

  it('takes tenant and actor scope exclusively from the authenticated session', async () => {
    const recordRevenueRunCostReconciliation = vi.fn().mockResolvedValue({
      id: 'reconciliation',
    });
    const controller = new FinanceController({ recordRevenueRunCostReconciliation } as never);

    await controller.recordRevenueRunCostReconciliation(
      revenueRunId,
      {
        overlapMinorUnits: '300',
        basisReference: 'audit:cost-overlap-review-1',
        idempotencyKey: 'cost-reconciliation-1',
        workspaceId: 'attacker-workspace',
        reconciledBy: 'attacker-user',
      },
      { workspaceId: 'authenticated-workspace', userId: 'authenticated-user' } as never,
    );

    expect(recordRevenueRunCostReconciliation).toHaveBeenCalledWith(
      'authenticated-workspace',
      revenueRunId,
      {
        overlapMinorUnits: 300n,
        basisReference: 'audit:cost-overlap-review-1',
        idempotencyKey: 'cost-reconciliation-1',
      },
      'authenticated-user',
    );
  });

  it('returns and audits an explicit JSON-safe immutable evidence shape', async () => {
    const audit = { record: vi.fn() };
    const service = new FinanceService(audit as never);

    const result = await service.recordRevenueRunCostReconciliation(
      'authenticated-workspace',
      revenueRunId,
      {
        overlapMinorUnits: 300n,
        basisReference: 'audit:cost-overlap-review-1',
        idempotencyKey: 'cost-reconciliation-1',
      },
      'authenticated-user',
    );

    expect(mocks.recordRevenueRunCostReconciliation).toHaveBeenCalledWith({
      workspaceId: 'authenticated-workspace',
      revenueRunId,
      overlapMinorUnits: 300n,
      basisReference: 'audit:cost-overlap-review-1',
      idempotencyKey: 'cost-reconciliation-1',
      reconciledBy: 'authenticated-user',
    });
    expect(result).toEqual({
      id: 'reconciliation',
      revenueRunId,
      currency: 'EUR',
      expenseEvidenceSetHash: 'a'.repeat(64),
      usageEvidenceSetHash: 'b'.repeat(64),
      expenseTotalMinorUnits: '9007199254740995',
      runtimeChargeMinorUnits: '800',
      overlapMinorUnits: '300',
      basisReference: 'audit:cost-overlap-review-1',
      reconciliationHash: 'c'.repeat(64),
      idempotencyKey: 'cost-reconciliation-1',
      reconciledBy: 'authenticated-user',
      createdAt: reconciliation.createdAt,
    });
    expect(audit.record).toHaveBeenCalledWith('authenticated-workspace', {
      actorId: 'authenticated-user',
      action: 'REVENUE_RUN_COST_RECONCILED',
      entityType: 'RevenueRunCostReconciliation',
      entityId: 'reconciliation',
      after: result,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it.each([
    [new RevenueRunNotFoundError('Revenue run not found'), NotFoundException],
    [new RevenueRunInvalidInputError('overlap exceeds aggregate'), BadRequestException],
    [new RevenueRunOutcomeEvidenceDriftError('Expense evidence changed'), ConflictException],
  ])('maps reconciliation boundary errors without leaking internals', async (error, expected) => {
    mocks.recordRevenueRunCostReconciliation.mockRejectedValue(error);
    const service = new FinanceService({ record: vi.fn() } as never);

    await expect(
      service.recordRevenueRunCostReconciliation(
        'authenticated-workspace',
        revenueRunId,
        {
          overlapMinorUnits: 0n,
          basisReference: 'audit:cost-overlap-review-1',
          idempotencyKey: 'cost-reconciliation-1',
        },
        'authenticated-user',
      ),
    ).rejects.toBeInstanceOf(expected);
  });
});

describe('Finance revenue-run planning and fact-link APIs', () => {
  const ids = {
    revenueRun: '11111111-1111-4111-8111-111111111111',
    opportunity: '22222222-2222-4222-8222-222222222222',
    proposal: '33333333-3333-4333-8333-333333333333',
    fact: '44444444-4444-4444-8444-444444444444',
  };
  const planInput = {
    opportunityId: ids.opportunity,
    ventureProposalId: ids.proposal,
    currency: 'EUR',
    expectedRevenueMinorUnits: 12_000n,
    expectedCostMinorUnits: 3_000n,
    downsideMinorUnits: 1_000n,
    confidenceBps: 6500,
    timeToCashDays: 30,
    forecastEvidenceHash: 'a'.repeat(64),
    idempotencyKey: 'revenue-run-plan-1',
  };
  const plannedRun = {
    id: ids.revenueRun,
    workspaceId: 'authenticated-workspace',
    ...planInput,
    approvalRequestId: null,
    experimentId: null,
    taskId: null,
    runId: null,
    status: 'PLANNED',
    createdBy: 'authenticated-user',
    createdAt: new Date('2026-09-08T08:00:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRevenueRunPlan.mockResolvedValue(plannedRun);
    for (const link of [
      mocks.linkRevenueRunRevenueEntry,
      mocks.linkRevenueRunExpense,
      mocks.linkRevenueRunUsage,
    ]) {
      link.mockResolvedValue({
        revenueRunId: ids.revenueRun,
        workspaceId: 'authenticated-workspace',
        evidenceHash: 'b'.repeat(64),
        linkedBy: 'authenticated-user',
        createdAt: new Date('2026-09-08T08:01:00.000Z'),
      });
    }
  });

  it('requires finance:manage on every planning and linking route', () => {
    const reflector = new Reflector();
    for (const method of [
      FinanceController.prototype.createRevenueRunPlan,
      FinanceController.prototype.linkRevenueRunRevenueEntry,
      FinanceController.prototype.linkRevenueRunExpense,
      FinanceController.prototype.linkRevenueRunUsage,
    ]) {
      expect(reflector.get(PERMISSION_KEY, method)).toBe('finance:manage');
    }
  });

  it('derives plan workspace and creator exclusively from the session', async () => {
    const createRevenueRunPlan = vi.fn().mockResolvedValue({ id: ids.revenueRun });
    const controller = new FinanceController({ createRevenueRunPlan } as never);

    await controller.createRevenueRunPlan(
      {
        opportunityId: ids.opportunity,
        ventureProposalId: ids.proposal,
        currency: 'EUR',
        expectedRevenueMinorUnits: '12000',
        expectedCostMinorUnits: '3000',
        downsideMinorUnits: '1000',
        confidenceBps: 6500,
        timeToCashDays: 30,
        forecastEvidenceHash: 'a'.repeat(64),
        idempotencyKey: 'revenue-run-plan-1',
        workspaceId: 'attacker-workspace',
        createdBy: 'attacker-user',
      },
      { workspaceId: 'authenticated-workspace', userId: 'authenticated-user' } as never,
    );

    expect(createRevenueRunPlan).toHaveBeenCalledWith(
      'authenticated-workspace',
      planInput,
      'authenticated-user',
    );
  });

  it.each([
    ['linkRevenueRunRevenueEntry', 'linkRevenueRunRevenueEntry'],
    ['linkRevenueRunExpense', 'linkRevenueRunExpense'],
    ['linkRevenueRunUsage', 'linkRevenueRunUsage'],
  ] as const)(
    'derives %s tenant and actor scope from the session',
    async (route, serviceMethod) => {
      const service = { [serviceMethod]: vi.fn().mockResolvedValue({ factId: ids.fact }) };
      const controller = new FinanceController(service as never);

      await controller[route](ids.revenueRun, ids.fact, {
        workspaceId: 'authenticated-workspace',
        userId: 'authenticated-user',
      } as never);

      expect(service[serviceMethod]).toHaveBeenCalledWith(
        'authenticated-workspace',
        ids.revenueRun,
        ids.fact,
        'authenticated-user',
      );
    },
  );

  it('creates a JSON-safe immutable plan and attributed audit evidence', async () => {
    const audit = { record: vi.fn() };
    const service = new FinanceService(audit as never);

    const result = await service.createRevenueRunPlan(
      'authenticated-workspace',
      planInput,
      'authenticated-user',
    );

    expect(mocks.createRevenueRunPlan).toHaveBeenCalledWith({
      workspaceId: 'authenticated-workspace',
      ...planInput,
      createdBy: 'authenticated-user',
    });
    expect(result.expectedRevenueMinorUnits).toBe('12000');
    expect(result.expectedCostMinorUnits).toBe('3000');
    expect(result.downsideMinorUnits).toBe('1000');
    expect(result.status).toBe('PLANNED');
    expect(audit.record).toHaveBeenCalledWith(
      'authenticated-workspace',
      expect.objectContaining({
        actorId: 'authenticated-user',
        action: 'REVENUE_RUN_PLANNED',
        entityId: ids.revenueRun,
        after: result,
      }),
    );
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it.each([
    [
      'linkRevenueRunRevenueEntry',
      mocks.linkRevenueRunRevenueEntry,
      'REVENUE_RUN_REVENUE_ENTRY_LINKED',
    ],
    ['linkRevenueRunExpense', mocks.linkRevenueRunExpense, 'REVENUE_RUN_EXPENSE_LINKED'],
    ['linkRevenueRunUsage', mocks.linkRevenueRunUsage, 'REVENUE_RUN_USAGE_LINKED'],
  ] as const)(
    'uses the authoritative %s writer and audits the link',
    async (method, writer, action) => {
      const audit = { record: vi.fn() };
      const service = new FinanceService(audit as never);

      const result = await service[method](
        'authenticated-workspace',
        ids.revenueRun,
        ids.fact,
        'authenticated-user',
      );

      expect(writer).toHaveBeenCalledWith({
        workspaceId: 'authenticated-workspace',
        revenueRunId: ids.revenueRun,
        factId: ids.fact,
        linkedBy: 'authenticated-user',
      });
      expect(result).toEqual(
        expect.objectContaining({
          revenueRunId: ids.revenueRun,
          factId: ids.fact,
          linkedBy: 'authenticated-user',
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        'authenticated-workspace',
        expect.objectContaining({ action, entityId: ids.revenueRun, after: result }),
      );
    },
  );
});

describe('Finance revenue-run commercial-evidence API', () => {
  const revenueRunId = '11111111-1111-4111-8111-111111111111';
  const revenueEntryId = '22222222-2222-4222-8222-222222222222';
  const input = {
    kind: 'PAYMENT_SETTLEMENT' as const,
    sourceType: 'MARKETPLACE_EXPORT' as const,
    sourceReferenceHash: 'a'.repeat(64),
    sourceArtifactSha256: 'b'.repeat(64),
    observedAt: new Date('2026-09-08T01:00:00.000Z'),
    idempotencyKey: 'commercial-evidence-1',
  };
  const evidence = {
    id: 'commercial-evidence',
    workspaceId: 'authenticated-workspace',
    revenueRunId,
    revenueEntryId,
    ...input,
    verificationState: 'UNVERIFIED_EXTERNAL_ASSERTION',
    evidenceHash: 'c'.repeat(64),
    recordedBy: 'authenticated-user',
    createdAt: new Date('2026-09-08T01:01:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordRevenueRunCommercialEvidence.mockResolvedValue(evidence);
  });

  it('requires session auth, permission guard, and finance:manage', () => {
    const reflector = new Reflector();
    const guards = reflector.get('__guards__', FinanceController) as unknown[];
    expect(guards).toContain(SessionAuthGuard);
    expect(guards).toContain(PermissionGuard);
    expect(
      reflector.get(PERMISSION_KEY, FinanceController.prototype.recordRevenueRunCommercialEvidence),
    ).toBe('finance:manage');
  });

  it('takes tenant and actor exclusively from the session and strips truth injection', async () => {
    const recordRevenueRunCommercialEvidence = vi.fn().mockResolvedValue({
      id: 'commercial-evidence',
    });
    const controller = new FinanceController({ recordRevenueRunCommercialEvidence } as never);

    await controller.recordRevenueRunCommercialEvidence(
      revenueRunId,
      revenueEntryId,
      {
        kind: 'PAYMENT_SETTLEMENT',
        sourceType: 'MARKETPLACE_EXPORT',
        sourceReferenceHash: 'a'.repeat(64),
        sourceArtifactSha256: 'b'.repeat(64),
        observedAt: '2026-09-08T01:00:00.000Z',
        idempotencyKey: 'commercial-evidence-1',
        workspaceId: 'attacker-workspace',
        recordedBy: 'attacker-user',
        verificationState: 'VERIFIED',
      },
      { workspaceId: 'authenticated-workspace', userId: 'authenticated-user' } as never,
    );

    expect(recordRevenueRunCommercialEvidence).toHaveBeenCalledWith(
      'authenticated-workspace',
      revenueRunId,
      revenueEntryId,
      input,
      'authenticated-user',
    );
  });

  it('returns and audits only the immutable unverified evidence shape', async () => {
    const audit = { record: vi.fn() };
    const service = new FinanceService(audit as never);

    const result = await service.recordRevenueRunCommercialEvidence(
      'authenticated-workspace',
      revenueRunId,
      revenueEntryId,
      input,
      'authenticated-user',
    );

    expect(mocks.recordRevenueRunCommercialEvidence).toHaveBeenCalledWith({
      workspaceId: 'authenticated-workspace',
      revenueRunId,
      revenueEntryId,
      ...input,
      recordedBy: 'authenticated-user',
    });
    expect(result).toEqual({
      id: 'commercial-evidence',
      revenueRunId,
      revenueEntryId,
      kind: 'PAYMENT_SETTLEMENT',
      sourceType: 'MARKETPLACE_EXPORT',
      sourceReferenceHash: 'a'.repeat(64),
      sourceArtifactSha256: 'b'.repeat(64),
      observedAt: input.observedAt,
      verificationState: 'UNVERIFIED_EXTERNAL_ASSERTION',
      evidenceHash: 'c'.repeat(64),
      idempotencyKey: 'commercial-evidence-1',
      recordedBy: 'authenticated-user',
      createdAt: evidence.createdAt,
    });
    expect(audit.record).toHaveBeenCalledWith('authenticated-workspace', {
      actorId: 'authenticated-user',
      action: 'REVENUE_RUN_COMMERCIAL_EVIDENCE_RECORDED',
      entityType: 'RevenueRunCommercialEvidence',
      entityId: 'commercial-evidence',
      after: result,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it.each([
    [new RevenueRunNotFoundError('Exact link not found'), NotFoundException],
    [new RevenueRunInvalidInputError('Future observation'), BadRequestException],
    [new RevenueRunOutcomeEvidenceDriftError('Evidence drift'), ConflictException],
  ])('maps commercial-evidence boundary errors safely', async (error, expected) => {
    mocks.recordRevenueRunCommercialEvidence.mockRejectedValue(error);
    const service = new FinanceService({ record: vi.fn() } as never);

    await expect(
      service.recordRevenueRunCommercialEvidence(
        'authenticated-workspace',
        revenueRunId,
        revenueEntryId,
        input,
        'authenticated-user',
      ),
    ).rejects.toBeInstanceOf(expected);
  });
});
