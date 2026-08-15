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
} from '@ventureos/finance-engine';
import type {
  CreateExpenseInput,
  CreateRevenueEntryInput,
  CreateBudgetInput,
  CreateExperimentInput,
  RecordExperimentResultInput,
  DecideExperimentInput,
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
    if (err instanceof BudgetLimitExceededError || err instanceof ExperimentInvalidStateError) {
      return new ConflictException(err.message);
    }
    if (err instanceof BudgetNotFoundError || err instanceof ExperimentNotFoundError) {
      return new NotFoundException(err.message);
    }
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
