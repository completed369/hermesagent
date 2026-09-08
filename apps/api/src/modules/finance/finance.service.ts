import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { enforceWorkspaceCapability, prisma, Prisma } from '@ventureos/database';
import {
  upsertFinancialAssumption,
  getActiveFinancialAssumption,
  generateForecast,
  compareForecastToActual,
  createExperiment,
  startExperiment,
  recordExperimentResult,
  getCommercialObservationProvenanceMap,
  requestScaleDecisionApproval,
  recordExperimentDecision,
  BudgetLimitExceededError,
  BudgetNotFoundError,
  ExperimentNotFoundError,
  ExperimentInvalidStateError,
  RevenueRunNotFoundError,
  RevenueRunInvalidInputError,
  RevenueRunConflictError,
  RevenueRunOutcomeEvidenceDriftError,
  getRevenueRunOutcomeEvidence,
  recordRevenueRunCostReconciliation,
  createRevenueRunPlan,
  linkRevenueRunRevenueEntry,
  linkRevenueRunExpense,
  linkRevenueRunUsage,
  recordRevenueRunCommercialEvidence,
} from '@ventureos/finance-engine';
import type {
  CreateExpenseInput,
  CreateRevenueEntryInput,
  CreateBudgetInput,
  CreateExperimentInput,
  RecordExperimentResultInput,
  DecideExperimentInput,
  RecordRevenueRunCostReconciliationInput,
  CreateRevenueRunPlanInput,
  RecordRevenueRunCommercialEvidenceInput,
} from './finance.dto';
import { AuditService } from '../audit/audit.service';
import { enforceCapabilityAdmission } from '../../common/policy/capability-admission';

/**
 * Phase 7 API surface. All real arithmetic/persistence lives in
 * `@ventureos/finance-engine` (assumptions/forecast/experiment runners,
 * budget guard) -- this service only scopes requests to the caller's
 * workspace, translates errors into HTTP responses, and records the audit
 * trail for every state-changing action, mirroring every prior phase's
 * module (MarketplaceService, ProductsService).
 */
@Injectable()
export class FinanceService {
  constructor(private readonly auditService: AuditService) {}

  private async runFinalFinanceMutation<T>(
    workspaceId: string,
    correlationReference: string,
    mutation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "subscriptions" WHERE "workspaceId" = ${workspaceId}::uuid FOR UPDATE`,
      );
      await enforceWorkspaceCapability(
        {
          workspaceId,
          capability: 'FINANCE_ACCESS',
          stage: 'DISPATCH',
          providerMode: 'internal',
          recordAllow: true,
          correlationReference,
        },
        tx,
        prisma,
      );
      return mutation(tx);
    });
  }

  private async getScopedVentureProposal(workspaceId: string, ventureProposalId: string) {
    await enforceCapabilityAdmission(workspaceId, 'FINANCE_ACCESS', 'internal');
    const proposal = await prisma.ventureProposal.findFirst({
      where: { id: ventureProposalId, workspaceId },
    });
    if (!proposal) throw new NotFoundException('Venture proposal not found');
    return proposal;
  }

  private translateError(err: unknown): Error {
    if (
      err instanceof BudgetLimitExceededError ||
      err instanceof ExperimentInvalidStateError ||
      err instanceof RevenueRunConflictError ||
      err instanceof RevenueRunOutcomeEvidenceDriftError
    ) {
      return new ConflictException(err.message);
    }
    if (
      err instanceof BudgetNotFoundError ||
      err instanceof ExperimentNotFoundError ||
      err instanceof RevenueRunNotFoundError
    ) {
      return new NotFoundException(err.message);
    }
    if (err instanceof RevenueRunInvalidInputError) return new BadRequestException(err.message);
    return err instanceof Error ? err : new Error('Unknown finance error');
  }

  // --- Assumptions & forecasts ---------------------------------------------

  async getAssumption(workspaceId: string, ventureProposalId: string) {
    await this.getScopedVentureProposal(workspaceId, ventureProposalId);
    return getActiveFinancialAssumption(workspaceId, ventureProposalId);
  }

  async upsertAssumption(
    workspaceId: string,
    ventureProposalId: string,
    input: Record<string, number>,
    actorId: string,
  ) {
    await this.getScopedVentureProposal(workspaceId, ventureProposalId);
    const assumption = await upsertFinancialAssumption({
      workspaceId,
      ventureProposalId,
      assumptions: input,
    });
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'FINANCIAL_ASSUMPTION_UPDATED',
      entityType: 'VentureProposal',
      entityId: ventureProposalId,
      after: assumption as unknown as Record<string, unknown>,
    });
    return assumption;
  }

  async createForecast(
    workspaceId: string,
    ventureProposalId: string,
    baseUnitsSold: number,
    scenarioMultipliers: { low: number; high: number } | undefined,
    actorId: string,
  ) {
    await this.getScopedVentureProposal(workspaceId, ventureProposalId);
    const result = await generateForecast({
      workspaceId,
      ventureProposalId,
      baseUnitsSold,
      scenarioMultipliers,
    });
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'FINANCIAL_FORECAST_GENERATED',
      entityType: 'VentureProposal',
      entityId: ventureProposalId,
      after: { forecastId: result.forecast.id, baseUnitsSold },
    });
    return result;
  }

  async getLatestForecast(workspaceId: string, ventureProposalId: string) {
    await this.getScopedVentureProposal(workspaceId, ventureProposalId);
    return prisma.financialForecast.findFirst({
      where: { workspaceId, ventureProposalId },
      orderBy: { createdAt: 'desc' as const },
      include: { scenarios: true },
    });
  }

  async getForecastVsActual(workspaceId: string, ventureProposalId: string) {
    await this.getScopedVentureProposal(workspaceId, ventureProposalId);
    return compareForecastToActual(workspaceId, ventureProposalId);
  }

  // --- Expenses & revenue ---------------------------------------------------

  async createExpense(
    workspaceId: string,
    ventureProposalId: string | undefined,
    input: CreateExpenseInput,
    actorId: string,
  ) {
    if (ventureProposalId) await this.getScopedVentureProposal(workspaceId, ventureProposalId);
    else await enforceCapabilityAdmission(workspaceId, 'FINANCE_ACCESS', 'internal');
    const expense = await this.runFinalFinanceMutation(
      workspaceId,
      `expense:${ventureProposalId ?? 'workspace'}`,
      (tx) =>
        tx.expense.create({
          data: {
            workspaceId,
            ventureProposalId,
            category: input.category,
            amountEur: input.amountEur,
            description: input.description,
            source: 'MANUAL',
            incurredAt: new Date(input.incurredAt),
          },
        }),
    );
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'EXPENSE_RECORDED',
      entityType: 'Expense',
      entityId: expense.id,
      after: expense as unknown as Record<string, unknown>,
    });
    return expense;
  }

  async listExpenses(workspaceId: string, ventureProposalId?: string) {
    await enforceCapabilityAdmission(workspaceId, 'FINANCE_ACCESS', 'internal');
    return prisma.expense.findMany({
      where: { workspaceId, ventureProposalId },
      orderBy: { incurredAt: 'desc' as const },
    });
  }

  async createRevenueEntry(
    workspaceId: string,
    ventureProposalId: string,
    input: CreateRevenueEntryInput,
    actorId: string,
  ) {
    await this.getScopedVentureProposal(workspaceId, ventureProposalId);
    if (input.listingVersionId) {
      const listingVersion = await prisma.listingVersion.findFirst({
        where: {
          id: input.listingVersionId,
          listing: {
            workspaceId,
            product: { ventureProposalId },
          },
        },
        select: { id: true },
      });
      if (!listingVersion) throw new NotFoundException('Listing version not found');
    }
    const netRevenueEur =
      input.grossRevenueEur -
      input.marketplaceFeeEur -
      input.paymentProcessingFeeEur -
      input.listingFeeEur -
      input.vatEur -
      input.refundsEur;

    const entry = await this.runFinalFinanceMutation(
      workspaceId,
      `revenue:${ventureProposalId}`,
      (tx) =>
        tx.revenueEntry.create({
          data: {
            workspaceId,
            ventureProposalId,
            listingVersionId: input.listingVersionId,
            unitsSold: input.unitsSold,
            grossRevenueEur: input.grossRevenueEur,
            marketplaceFeeEur: input.marketplaceFeeEur,
            paymentProcessingFeeEur: input.paymentProcessingFeeEur,
            listingFeeEur: input.listingFeeEur,
            vatEur: input.vatEur,
            refundsEur: input.refundsEur,
            netRevenueEur,
            source: 'MANUAL',
            occurredAt: new Date(input.occurredAt),
            recordedBy: actorId,
          },
        }),
    );
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'REVENUE_RECORDED',
      entityType: 'RevenueEntry',
      entityId: entry.id,
      after: entry as unknown as Record<string, unknown>,
    });
    return entry;
  }

  async listRevenueEntries(workspaceId: string, ventureProposalId: string) {
    await this.getScopedVentureProposal(workspaceId, ventureProposalId);
    return prisma.revenueEntry.findMany({
      where: { workspaceId, ventureProposalId },
      orderBy: { occurredAt: 'desc' as const },
    });
  }

  /**
   * JSON-safe, read-only projection of the finance engine's tamper-evident
   * outcome view. Minor/compute units remain exact decimal strings rather
   * than lossy JavaScript numbers. The finance engine retains responsibility
   * for fresh capability admission, tenant scoping, and drift detection.
   */
  async getRevenueRunOutcome(workspaceId: string, revenueRunId: string) {
    try {
      const outcome = await getRevenueRunOutcomeEvidence(workspaceId, revenueRunId);
      return {
        id: outcome.id,
        workspaceId: outcome.workspaceId,
        currency: outcome.currency,
        forecast: {
          expectedRevenueMinorUnits: outcome.forecast.expectedRevenueMinorUnits.toString(),
          expectedCostMinorUnits: outcome.forecast.expectedCostMinorUnits.toString(),
          downsideMinorUnits: outcome.forecast.downsideMinorUnits.toString(),
          confidenceBps: outcome.forecast.confidenceBps,
          timeToCashDays: outcome.forecast.timeToCashDays,
          evidenceHash: outcome.forecast.evidenceHash,
        },
        recordedRevenue: {
          evidenceCount: outcome.recordedRevenue.evidenceCount,
          grossMinorUnits: outcome.recordedRevenue.grossMinorUnits.toString(),
          netMinorUnits: outcome.recordedRevenue.netMinorUnits.toString(),
          verificationState: outcome.recordedRevenue.verificationState,
          commercialEvidence: outcome.recordedRevenue.commercialEvidence,
        },
        recordedCosts: {
          expenseEvidenceCount: outcome.recordedCosts.expenseEvidenceCount,
          expenseMinorUnits: outcome.recordedCosts.expenseMinorUnits.toString(),
          recognizedRuntimeUsageCount: outcome.recordedCosts.recognizedRuntimeUsageCount,
          recognizedRuntimeChargeMinorUnits:
            outcome.recordedCosts.recognizedRuntimeChargeMinorUnits.toString(),
          recognizedRuntimeComputeUnits:
            outcome.recordedCosts.recognizedRuntimeComputeUnits.toString(),
          overlapState: outcome.recordedCosts.overlapState,
          reconciledOverlapMinorUnits:
            outcome.recordedCosts.reconciledOverlapMinorUnits?.toString() ?? null,
          deduplicatedTotalMinorUnits:
            outcome.recordedCosts.deduplicatedTotalMinorUnits?.toString() ?? null,
          reconciliation: outcome.recordedCosts.reconciliation,
        },
        profit: {
          minorUnits: outcome.profit.minorUnits?.toString() ?? null,
          state: outcome.profit.state,
        },
      };
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async createRevenueRunPlan(
    workspaceId: string,
    input: CreateRevenueRunPlanInput,
    actorId: string,
  ) {
    try {
      const run = await createRevenueRunPlan({
        workspaceId,
        ...input,
        createdBy: actorId,
      });
      const response = {
        id: run.id,
        opportunityId: run.opportunityId,
        ventureProposalId: run.ventureProposalId,
        approvalRequestId: run.approvalRequestId,
        experimentId: run.experimentId,
        taskId: run.taskId,
        runId: run.runId,
        status: run.status,
        currency: run.currency,
        expectedRevenueMinorUnits: run.expectedRevenueMinorUnits.toString(),
        expectedCostMinorUnits: run.expectedCostMinorUnits.toString(),
        downsideMinorUnits: run.downsideMinorUnits.toString(),
        confidenceBps: run.confidenceBps,
        timeToCashDays: run.timeToCashDays,
        forecastEvidenceHash: run.forecastEvidenceHash,
        idempotencyKey: run.idempotencyKey,
        createdBy: run.createdBy,
        createdAt: run.createdAt,
      };
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'REVENUE_RUN_PLANNED',
        entityType: 'RevenueRun',
        entityId: run.id,
        after: response as unknown as Record<string, unknown>,
      });
      return response;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  private async linkRevenueRunFact(
    kind: 'REVENUE_ENTRY' | 'EXPENSE' | 'USAGE',
    workspaceId: string,
    revenueRunId: string,
    factId: string,
    actorId: string,
  ) {
    try {
      const params = { workspaceId, revenueRunId, factId, linkedBy: actorId };
      const link =
        kind === 'REVENUE_ENTRY'
          ? await linkRevenueRunRevenueEntry(params)
          : kind === 'EXPENSE'
            ? await linkRevenueRunExpense(params)
            : await linkRevenueRunUsage(params);
      const response = {
        revenueRunId: link.revenueRunId,
        factId,
        evidenceHash: link.evidenceHash,
        linkedBy: link.linkedBy,
        createdAt: link.createdAt,
      };
      await this.auditService.record(workspaceId, {
        actorId,
        action: `REVENUE_RUN_${kind}_LINKED`,
        entityType: 'RevenueRun',
        entityId: revenueRunId,
        after: response as unknown as Record<string, unknown>,
      });
      return response;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  linkRevenueRunRevenueEntry(
    workspaceId: string,
    revenueRunId: string,
    factId: string,
    actorId: string,
  ) {
    return this.linkRevenueRunFact('REVENUE_ENTRY', workspaceId, revenueRunId, factId, actorId);
  }

  linkRevenueRunExpense(
    workspaceId: string,
    revenueRunId: string,
    factId: string,
    actorId: string,
  ) {
    return this.linkRevenueRunFact('EXPENSE', workspaceId, revenueRunId, factId, actorId);
  }

  linkRevenueRunUsage(workspaceId: string, revenueRunId: string, factId: string, actorId: string) {
    return this.linkRevenueRunFact('USAGE', workspaceId, revenueRunId, factId, actorId);
  }

  async recordRevenueRunCommercialEvidence(
    workspaceId: string,
    revenueRunId: string,
    revenueEntryId: string,
    input: RecordRevenueRunCommercialEvidenceInput,
    actorId: string,
  ) {
    try {
      const evidence = await recordRevenueRunCommercialEvidence({
        workspaceId,
        revenueRunId,
        revenueEntryId,
        ...input,
        recordedBy: actorId,
      });
      const response = {
        id: evidence.id,
        revenueRunId: evidence.revenueRunId,
        revenueEntryId: evidence.revenueEntryId,
        kind: evidence.kind,
        sourceType: evidence.sourceType,
        sourceReferenceHash: evidence.sourceReferenceHash,
        sourceArtifactSha256: evidence.sourceArtifactSha256,
        observedAt: evidence.observedAt,
        verificationState: evidence.verificationState,
        evidenceHash: evidence.evidenceHash,
        idempotencyKey: evidence.idempotencyKey,
        recordedBy: evidence.recordedBy,
        createdAt: evidence.createdAt,
      };
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'REVENUE_RUN_COMMERCIAL_EVIDENCE_RECORDED',
        entityType: 'RevenueRunCommercialEvidence',
        entityId: evidence.id,
        after: response as unknown as Record<string, unknown>,
      });
      return response;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * Records a bounded operator assertion for overlap between the complete
   * current expense and recognized-runtime evidence sets. Tenant and actor
   * identity are derived only from the authenticated session; the finance
   * engine retains the parent lock, fresh capability decision, exact-set
   * hashing, idempotency, and immutable persistence boundary.
   */
  async recordRevenueRunCostReconciliation(
    workspaceId: string,
    revenueRunId: string,
    input: RecordRevenueRunCostReconciliationInput,
    actorId: string,
  ) {
    try {
      const reconciliation = await recordRevenueRunCostReconciliation({
        workspaceId,
        revenueRunId,
        overlapMinorUnits: input.overlapMinorUnits,
        basisReference: input.basisReference,
        idempotencyKey: input.idempotencyKey,
        reconciledBy: actorId,
      });
      const response = {
        id: reconciliation.id,
        revenueRunId: reconciliation.revenueRunId,
        currency: reconciliation.currency,
        expenseEvidenceSetHash: reconciliation.expenseEvidenceSetHash,
        usageEvidenceSetHash: reconciliation.usageEvidenceSetHash,
        expenseTotalMinorUnits: reconciliation.expenseTotalMinorUnits.toString(),
        runtimeChargeMinorUnits: reconciliation.runtimeChargeMinorUnits.toString(),
        overlapMinorUnits: reconciliation.overlapMinorUnits.toString(),
        basisReference: reconciliation.basisReference,
        reconciliationHash: reconciliation.reconciliationHash,
        idempotencyKey: reconciliation.idempotencyKey,
        reconciledBy: reconciliation.reconciledBy,
        createdAt: reconciliation.createdAt,
      };
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'REVENUE_RUN_COST_RECONCILED',
        entityType: 'RevenueRunCostReconciliation',
        entityId: reconciliation.id,
        after: response as unknown as Record<string, unknown>,
      });
      return response;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  // --- Budgets ---------------------------------------------------------------

  async createBudget(workspaceId: string, input: CreateBudgetInput, actorId: string) {
    if (input.ventureProposalId) {
      await this.getScopedVentureProposal(workspaceId, input.ventureProposalId);
    } else {
      await enforceCapabilityAdmission(workspaceId, 'FINANCE_ACCESS', 'internal');
    }
    const budget = await this.runFinalFinanceMutation(
      workspaceId,
      `budget:${input.ventureProposalId ?? 'workspace'}`,
      (tx) =>
        tx.budget.create({
          data: {
            workspaceId,
            ventureProposalId: input.ventureProposalId,
            name: input.name,
            periodStart: new Date(input.periodStart),
            periodEnd: new Date(input.periodEnd),
            totalLimitEur: input.totalLimitEur,
            allocations: {
              create: input.allocations.map((a) => ({
                category: a.category,
                limitEur: a.limitEur,
              })),
            },
          },
          include: { allocations: true },
        }),
    );
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'BUDGET_CREATED',
      entityType: 'Budget',
      entityId: budget.id,
      after: budget as unknown as Record<string, unknown>,
    });
    return budget;
  }

  async listBudgets(workspaceId: string) {
    await enforceCapabilityAdmission(workspaceId, 'FINANCE_ACCESS', 'internal');
    return prisma.budget.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' as const },
      include: { allocations: true },
    });
  }

  async listCostLedger(workspaceId: string) {
    await enforceCapabilityAdmission(workspaceId, 'FINANCE_ACCESS', 'internal');
    return prisma.costLedgerEntry.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' as const },
      take: 200,
    });
  }

  async listModelUsage(workspaceId: string) {
    await enforceCapabilityAdmission(workspaceId, 'FINANCE_ACCESS', 'internal');
    return prisma.modelUsage.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' as const },
      take: 200,
    });
  }

  // --- Experiments -------------------------------------------------------

  async createExperimentForVenture(
    workspaceId: string,
    ventureProposalId: string,
    input: CreateExperimentInput,
    actorId: string,
  ) {
    await this.getScopedVentureProposal(workspaceId, ventureProposalId);
    const experiment = await createExperiment({
      workspaceId,
      ventureProposalId,
      listingVersionId: input.listingVersionId,
      name: input.name,
      hypothesis: input.hypothesis,
      variants: input.variants,
      metrics: input.metrics,
    });
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'EXPERIMENT_CREATED',
      entityType: 'Experiment',
      entityId: experiment.id,
      after: { name: experiment.name, hypothesis: experiment.hypothesis },
    });
    return experiment;
  }

  async listExperiments(workspaceId: string, ventureProposalId: string) {
    await this.getScopedVentureProposal(workspaceId, ventureProposalId);
    return prisma.experiment.findMany({
      where: { workspaceId, ventureProposalId },
      orderBy: { createdAt: 'desc' as const },
      include: { variants: true, metrics: true },
    });
  }

  private async getScopedExperiment(workspaceId: string, experimentId: string) {
    await enforceCapabilityAdmission(workspaceId, 'FINANCE_ACCESS', 'internal');
    const experiment = await prisma.experiment.findFirst({
      where: { id: experimentId, workspaceId },
      include: {
        variants: true,
        metrics: true,
        decisions: { orderBy: { decidedAt: 'desc' as const } },
      },
    });
    if (!experiment) throw new NotFoundException('Experiment not found');
    return experiment;
  }

  async getExperiment(workspaceId: string, experimentId: string) {
    const experiment = await this.getScopedExperiment(workspaceId, experimentId);
    const results = await prisma.experimentResult.findMany({
      where: { variant: { experimentId } },
      orderBy: { measuredAt: 'desc' as const },
    });
    const provenanceByResultId = await getCommercialObservationProvenanceMap(
      results.map((result) => result.id),
    );
    return {
      ...experiment,
      results: results.map((result) => ({
        ...result,
        provenance: provenanceByResultId.get(result.id) ?? null,
      })),
    };
  }

  async startExperimentRun(workspaceId: string, experimentId: string, actorId: string) {
    await this.getScopedExperiment(workspaceId, experimentId);
    try {
      const experiment = await startExperiment(workspaceId, experimentId);
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'EXPERIMENT_STARTED',
        entityType: 'Experiment',
        entityId: experimentId,
      });
      return experiment;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async recordResult(
    workspaceId: string,
    experimentId: string,
    input: RecordExperimentResultInput,
    actorId: string,
  ) {
    await this.getScopedExperiment(workspaceId, experimentId);
    try {
      const result = await recordExperimentResult({
        workspaceId,
        experimentId,
        experimentVariantId: input.experimentVariantId,
        experimentMetricId: input.experimentMetricId,
        value: input.value,
        sampleSize: input.sampleSize,
        evidenceMode: input.evidenceMode,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        observedAt: input.observedAt ? new Date(input.observedAt) : undefined,
        recordedBy: actorId,
      });
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'EXPERIMENT_RESULT_RECORDED',
        entityType: 'Experiment',
        entityId: experimentId,
        after: result as unknown as Record<string, unknown>,
      });
      return result;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async requestScaleApproval(workspaceId: string, experimentId: string, actorId: string) {
    await this.getScopedExperiment(workspaceId, experimentId);
    try {
      const result = await requestScaleDecisionApproval({
        workspaceId,
        experimentId,
        requestedBy: actorId,
      });
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'SCALE_DECISION_APPROVAL_REQUESTED',
        entityType: 'Experiment',
        entityId: experimentId,
        after: result as unknown as Record<string, unknown>,
        approvalReference: result.approvalRequestId,
      });
      return result;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async decideExperimentOutcome(
    workspaceId: string,
    experimentId: string,
    input: DecideExperimentInput,
    actorId: string,
  ) {
    await this.getScopedExperiment(workspaceId, experimentId);
    if (input.decision === 'SCALE' && !input.approvalRequestId) {
      throw new BadRequestException('approvalRequestId is required for a SCALE decision (Gate 6)');
    }
    try {
      const decision = await recordExperimentDecision({
        workspaceId,
        experimentId,
        decision: input.decision,
        rationale: input.rationale,
        decidedBy: actorId,
        approvalRequestId: input.approvalRequestId,
      });
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'EXPERIMENT_DECIDED',
        entityType: 'Experiment',
        entityId: experimentId,
        after: decision as unknown as Record<string, unknown>,
        approvalReference: input.approvalRequestId,
      });
      return decision;
    } catch (err) {
      throw this.translateError(err);
    }
  }
}
