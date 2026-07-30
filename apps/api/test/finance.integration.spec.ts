import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import {
  upsertFinancialAssumption,
  getActiveFinancialAssumption,
  generateForecast,
  compareForecastToActual,
  createExperiment,
  startExperiment,
  recordExperimentResult,
  requestScaleDecisionApproval,
  recordExperimentDecision,
  assertWithinBudget,
  chargeToBudget,
  resolveBudgetAllocation,
  recordModelUsage,
  BudgetLimitExceededError,
  BudgetNotFoundError,
  ExperimentInvalidStateError,
  ExperimentNotFoundError,
} from '@ventureos/finance-engine';
import { decideApprovalRequest } from '@ventureos/agent-runtime';
import { FinanceService } from '../src/modules/finance/finance.service';
import { AuditService } from '../src/modules/audit/audit.service';

/**
 * Hits a real (dockerized) Postgres, exactly like
 * marketplace.integration.spec.ts -- run with
 * `pnpm --filter @ventureos/api test:integration`. Exercises Phase 7 (Finance
 * and Analytics) end to end: assumption upsert/supersession (task #77),
 * forecast generation + forecast-vs-actual (tasks #77/#80), budget hard-stop
 * enforcement (task #79), expense/revenue recording (task #77), model-usage
 * cost tracking (task #78), the experiment lifecycle (task #81), Gate 6
 * (Scale Decision) approval-gated scaling (task #83), and the audit trail
 * every mutating action writes (closing out task #84).
 */
describe('Finance and Analytics (integration)', () => {
  const auditService = new AuditService();
  const financeService = new FinanceService(auditService);

  let workspace: { id: string };
  let otherWorkspace: { id: string };
  let actor: { id: string };

  async function buildVentureProposal(workspaceId: string, suffix: string) {
    const opp = await prisma.opportunity.create({
      data: {
        workspaceId,
        title: `Finance Test Opportunity ${suffix}`,
        description: 'Created by finance.integration.spec.ts',
        status: 'PROMOTED',
        suggestedProductType: 'DIGITAL_TEMPLATE_BUNDLE',
        suggestedMarketplace: 'etsy',
        latestOpportunityScore: 90,
        latestProfitConfidence: 85,
        isSpeculative: false,
        estimatedCostEur: 50,
        estimatedRevenueEur: 900,
        estimatedProfitEur: 850,
        risks: [],
      },
    });
    const proposal = await prisma.ventureProposal.create({
      data: { workspaceId, opportunityId: opp.id, status: 'DRAFT' },
    });
    await prisma.ventureProposalVersion.create({
      data: {
        ventureProposalId: proposal.id,
        opportunityId: opp.id,
        versionNumber: 1,
        snapshot: { note: 'v' + randomUUID() },
      },
    });
    return { opportunityId: opp.id, proposalId: proposal.id };
  }

  async function cleanupWorkspace(workspaceId: string) {
    await prisma.auditEvent.deleteMany({ where: { workspaceId } });
    // Every Phase 7 model, plus VentureProposal/Opportunity, cascades from
    // Workspace directly or transitively (FinancialAssumption/Forecast/
    // Scenario, Expense, RevenueEntry + MarketplaceFee/RefundRequest,
    // Budget/BudgetAllocation, CostLedgerEntry, ModelUsage,
    // Experiment/Variant/Metric/Result/Decision, and ApprovalRequest via
    // VentureProposalVersion) -- deleting the Workspace row cascades
    // everything else in one statement (verified against schema.prisma's
    // onDelete rules).
    await prisma.workspace.delete({ where: { id: workspaceId } });
  }

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: { name: `Finance Test Workspace ${randomUUID()}`, slug: `test-fin-${randomUUID()}` },
    });
    otherWorkspace = await prisma.workspace.create({
      data: {
        name: `Finance Test Workspace (other) ${randomUUID()}`,
        slug: `test-fin-other-${randomUUID()}`,
      },
    });
    actor = await prisma.user.create({
      data: {
        email: `finance-integration-actor-${randomUUID()}@ventureos.local`,
        displayName: 'Finance Integration Test Actor',
      },
    });
  });

  afterAll(async () => {
    await cleanupWorkspace(workspace.id);
    await cleanupWorkspace(otherWorkspace.id);
    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.$disconnect();
  });

  describe('Financial assumptions: upsert + supersession (task #77)', () => {
    it('seeds development defaults on first upsert and never mutates a prior row in place', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'assumptions');

      const first = await upsertFinancialAssumption({
        workspaceId: workspace.id,
        ventureProposalId: proposalId,
      });
      expect(Number(first.productPriceEur)).toBe(14.99);
      expect(first.supersededAt).toBeNull();

      const second = await upsertFinancialAssumption({
        workspaceId: workspace.id,
        ventureProposalId: proposalId,
        assumptions: { productPriceEur: 24.99 },
      });
      expect(Number(second.productPriceEur)).toBe(24.99);
      // Merged from the previous current row, not just the schema defaults --
      // an unrelated field carried over unchanged.
      expect(Number(second.marketplaceFeeRate)).toBe(Number(first.marketplaceFeeRate));

      const reloadedFirst = await prisma.financialAssumption.findUnique({
        where: { id: first.id },
      });
      expect(reloadedFirst?.supersededAt).toBeTruthy();

      const active = await getActiveFinancialAssumption(workspace.id, proposalId);
      expect(active?.id).toBe(second.id);
    });
  });

  describe('Forecast generation + forecast-vs-actual (tasks #77, #80)', () => {
    it('auto-seeds a default assumption when generating a forecast for a fresh venture, and produces exactly 3 scenarios', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'forecast');

      const preExisting = await getActiveFinancialAssumption(workspace.id, proposalId);
      expect(preExisting).toBeNull();

      const { forecast, scenarios } = await generateForecast({
        workspaceId: workspace.id,
        ventureProposalId: proposalId,
        baseUnitsSold: 100,
      });

      expect(scenarios).toHaveLength(3);
      expect(scenarios.map((s) => s.scenario).sort()).toEqual(['BASE', 'HIGH', 'LOW']);
      expect(forecast.breakEvenUnits).not.toBeNull();

      const seeded = await getActiveFinancialAssumption(workspace.id, proposalId);
      expect(seeded).not.toBeNull();
      expect(forecast.financialAssumptionId).toBe(seeded!.id);
    });

    it('returns a zeroed forecast-vs-actual comparison before any revenue is recorded, and a real diff after', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'forecast-vs-actual');
      await generateForecast({
        workspaceId: workspace.id,
        ventureProposalId: proposalId,
        baseUnitsSold: 10,
      });

      const beforeAny = await compareForecastToActual(workspace.id, proposalId);
      expect(beforeAny?.actualUnitsSold).toBe(0);
      expect(beforeAny?.actualNetRevenueEur).toBe(0);

      await prisma.revenueEntry.create({
        data: {
          workspaceId: workspace.id,
          ventureProposalId: proposalId,
          unitsSold: 3,
          grossRevenueEur: 45,
          netRevenueEur: 38,
          occurredAt: new Date(),
        },
      });

      const afterEntry = await compareForecastToActual(workspace.id, proposalId);
      expect(afterEntry?.actualUnitsSold).toBe(3);
      expect(afterEntry?.actualNetRevenueEur).toBe(38);
      expect(afterEntry?.forecastErrorEur).toBeCloseTo(38 - afterEntry!.forecastNetRevenueEur, 6);
    });
  });

  describe('Budget hard-stop enforcement (task #79)', () => {
    it('fails closed with BudgetNotFoundError when the allocation does not exist', async () => {
      await expect(assertWithinBudget(randomUUID(), 10)).rejects.toThrow(BudgetNotFoundError);
    });

    it('allows charges within the limit and blocks a charge that would exceed it, with no partial side effect', async () => {
      const budget = await prisma.budget.create({
        data: {
          workspaceId: workspace.id,
          name: 'Test Budget',
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          totalLimitEur: 100,
          allocations: { create: [{ category: 'AI_MODEL_USAGE', limitEur: 10 }] },
        },
        include: { allocations: true },
      });
      const allocation = budget.allocations[0];

      await assertWithinBudget(allocation.id, 4);
      await chargeToBudget({
        workspaceId: workspace.id,
        budgetAllocationId: allocation.id,
        category: 'AI_MODEL_USAGE',
        amountEur: 4,
        source: 'test:charge',
      });

      const reloaded = await prisma.budgetAllocation.findUnique({ where: { id: allocation.id } });
      expect(Number(reloaded?.spentEur)).toBe(4);

      // 4 already spent + 7 more would be 11, over the 10 limit -- fail closed.
      await expect(assertWithinBudget(allocation.id, 7)).rejects.toThrow(BudgetLimitExceededError);
      await expect(
        chargeToBudget({
          workspaceId: workspace.id,
          budgetAllocationId: allocation.id,
          category: 'AI_MODEL_USAGE',
          amountEur: 7,
          source: 'test:charge-over-limit',
        }),
      ).rejects.toThrow(BudgetLimitExceededError);

      // The blocked charge must never have been recorded nor incremented
      // spentEur -- fail closed means no partial side effect.
      const stillReloaded = await prisma.budgetAllocation.findUnique({
        where: { id: allocation.id },
      });
      expect(Number(stillReloaded?.spentEur)).toBe(4);
    });

    it('prefers a venture-scoped ACTIVE budget allocation over the workspace-wide one', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'budget-scoping');
      await prisma.budget.create({
        data: {
          workspaceId: workspace.id,
          ventureProposalId: proposalId,
          name: 'Venture Budget',
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          totalLimitEur: 50,
          allocations: { create: [{ category: 'RESEARCH', limitEur: 5 }] },
        },
      });
      const resolved = await resolveBudgetAllocation(workspace.id, 'RESEARCH', proposalId);
      const ventureAllocation = await prisma.budgetAllocation.findFirst({
        where: { budget: { ventureProposalId: proposalId }, category: 'RESEARCH' },
      });
      expect(resolved?.id).toBe(ventureAllocation!.id);
    });

    it('recordModelUsage records a real ModelUsage row for a zero-cost mock invocation without charging any budget', async () => {
      const usage = await recordModelUsage({
        workspaceId: workspace.id,
        provider: 'mock',
        model: 'mock-v1',
      });
      expect(Number(usage.costEur)).toBe(0);
      expect(usage.provider).toBe('mock');

      const ledgerEntries = await prisma.costLedgerEntry.findMany({
        where: { referenceType: 'ModelUsage', referenceId: usage.id },
      });
      expect(ledgerEntries).toHaveLength(0);
    });

    it('recordModelUsage charges a real ledger entry and increments spend when costEur > 0 and a budget allocation exists', async () => {
      // Venture-scoped (not workspace-wide) so resolveBudgetAllocation's
      // venture-scoped-wins preference deterministically picks THIS
      // allocation, never the unrelated workspace-wide "Test Budget"
      // AI_MODEL_USAGE allocation created earlier in this describe block.
      const { proposalId } = await buildVentureProposal(workspace.id, 'model-usage-budget');
      const budget = await prisma.budget.create({
        data: {
          workspaceId: workspace.id,
          ventureProposalId: proposalId,
          name: 'Model Usage Budget',
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          totalLimitEur: 100,
          allocations: { create: [{ category: 'AI_MODEL_USAGE', limitEur: 1 }] },
        },
        include: { allocations: true },
      });
      const allocation = budget.allocations[0];

      const usage = await recordModelUsage({
        workspaceId: workspace.id,
        ventureProposalId: proposalId,
        provider: 'anthropic',
        model: 'claude-test',
        costEur: 0.5,
      });
      expect(Number(usage.costEur)).toBe(0.5);

      const reloaded = await prisma.budgetAllocation.findUnique({ where: { id: allocation.id } });
      expect(Number(reloaded?.spentEur)).toBe(0.5);

      const ledgerEntries = await prisma.costLedgerEntry.findMany({
        where: { referenceType: 'ModelUsage', referenceId: usage.id },
      });
      expect(ledgerEntries).toHaveLength(1);
      expect(Number(ledgerEntries[0].amountEur)).toBe(0.5);
    });
  });

  describe('Expenses and revenue via FinanceService (task #77)', () => {
    it('records an expense scoped to a venture and lists it back', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'expense');
      const expense = await financeService.createExpense(
        workspace.id,
        proposalId,
        {
          category: 'ADVERTISING',
          amountEur: 12.5,
          description: 'Test ad spend',
          incurredAt: new Date().toISOString(),
        },
        actor.id,
      );
      expect(Number(expense.amountEur)).toBe(12.5);

      const list = await financeService.listExpenses(workspace.id, proposalId);
      expect(list.some((e) => e.id === expense.id)).toBe(true);
    });

    it('computes netRevenueEur server-side from gross minus every fee/vat/refund component', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'revenue');
      const entry = await financeService.createRevenueEntry(
        workspace.id,
        proposalId,
        {
          unitsSold: 2,
          grossRevenueEur: 30,
          marketplaceFeeEur: 2,
          paymentProcessingFeeEur: 1,
          listingFeeEur: 0.4,
          vatEur: 0,
          refundsEur: 0,
          occurredAt: new Date().toISOString(),
        },
        actor.id,
      );
      expect(Number(entry.netRevenueEur)).toBeCloseTo(26.6, 2);
    });

    it('refuses to fetch assumptions/revenue for a venture through the wrong workspace', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'scoping');
      await expect(financeService.getAssumption(otherWorkspace.id, proposalId)).rejects.toThrow();
      await expect(
        financeService.listRevenueEntries(otherWorkspace.id, proposalId),
      ).rejects.toThrow();
    });
  });

  describe('Experiment lifecycle (task #81)', () => {
    it('creates a DRAFT experiment with its variants and metrics, then transitions DRAFT -> RUNNING', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'experiment-lifecycle');
      const experiment = await createExperiment({
        workspaceId: workspace.id,
        ventureProposalId: proposalId,
        name: 'Price test',
        hypothesis: 'A higher price will not reduce conversion',
        variants: [{ name: 'Control', isControl: true }, { name: 'Variant B' }],
        metrics: [{ name: 'REVENUE_EUR', unit: 'EUR' }],
      });
      expect(experiment.status).toBe('DRAFT');
      expect(experiment.variants).toHaveLength(2);
      expect(experiment.metrics).toHaveLength(1);

      const started = await startExperiment(workspace.id, experiment.id);
      expect(started.status).toBe('RUNNING');
      expect(started.startedAt).toBeTruthy();

      await expect(startExperiment(workspace.id, experiment.id)).rejects.toThrow(
        ExperimentInvalidStateError,
      );
    });

    it('records real measurements per variant/metric pair and rejects access to a variant from another workspace', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'experiment-results');
      const experiment = await createExperiment({
        workspaceId: workspace.id,
        ventureProposalId: proposalId,
        name: 'CTR test',
        hypothesis: 'New thumbnail increases CTR',
        variants: [{ name: 'Control', isControl: true }, { name: 'Variant B' }],
        metrics: [{ name: 'CTR', unit: '%' }],
      });
      await startExperiment(workspace.id, experiment.id);
      const [control, variantB] = experiment.variants;
      const [ctrMetric] = experiment.metrics;

      const result = await recordExperimentResult({
        workspaceId: workspace.id,
        experimentId: experiment.id,
        experimentVariantId: control.id,
        experimentMetricId: ctrMetric.id,
        value: 2.5,
      });
      expect(Number(result.value)).toBe(2.5);

      await expect(
        recordExperimentResult({
          workspaceId: otherWorkspace.id,
          experimentId: experiment.id,
          experimentVariantId: variantB.id,
          experimentMetricId: ctrMetric.id,
          value: 3.1,
        }),
      ).rejects.toThrow(ExperimentNotFoundError);
    });
  });

  describe('Gate 6: Scale Decision approval gate (task #83)', () => {
    it('refuses to request a scale-decision approval before the experiment is RUNNING or COMPLETED', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'gate6-draft');
      const experiment = await createExperiment({
        workspaceId: workspace.id,
        ventureProposalId: proposalId,
        name: 'Still draft',
        hypothesis: 'n/a',
        variants: [{ name: 'Control', isControl: true }],
        metrics: [{ name: 'REVENUE_EUR' }],
      });
      await expect(
        requestScaleDecisionApproval({
          workspaceId: workspace.id,
          experimentId: experiment.id,
          requestedBy: actor.id,
        }),
      ).rejects.toThrow(ExperimentInvalidStateError);
    });

    it('a SCALE decision is blocked without an approvalRequestId, and again with one that is not yet APPROVED', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'gate6-unapproved');
      const experiment = await createExperiment({
        workspaceId: workspace.id,
        ventureProposalId: proposalId,
        name: 'Scale me',
        hypothesis: 'Scaling ad spend increases revenue proportionally',
        variants: [{ name: 'Control', isControl: true }],
        metrics: [{ name: 'REVENUE_EUR' }],
      });
      await startExperiment(workspace.id, experiment.id);

      await expect(
        recordExperimentDecision({
          workspaceId: workspace.id,
          experimentId: experiment.id,
          decision: 'SCALE',
          rationale: 'Looks good',
          decidedBy: actor.id,
        }),
      ).rejects.toThrow(ExperimentInvalidStateError);

      const { approvalRequestId } = await requestScaleDecisionApproval({
        workspaceId: workspace.id,
        experimentId: experiment.id,
        requestedBy: actor.id,
      });
      const pending = await prisma.approvalRequest.findUnique({ where: { id: approvalRequestId } });
      expect(pending?.kind).toBe('SCALE_DECISION');
      expect(pending?.state).toBe('PENDING');
      expect(pending?.experimentId).toBe(experiment.id);

      // Requesting again while still PENDING returns the same request --
      // idempotent, same pattern as marketplace's PUBLICATION approval.
      const second = await requestScaleDecisionApproval({
        workspaceId: workspace.id,
        experimentId: experiment.id,
        requestedBy: actor.id,
      });
      expect(second.approvalRequestId).toBe(approvalRequestId);

      await expect(
        recordExperimentDecision({
          workspaceId: workspace.id,
          experimentId: experiment.id,
          decision: 'SCALE',
          rationale: 'Trying to scale before approval is granted',
          decidedBy: actor.id,
          approvalRequestId,
        }),
      ).rejects.toThrow(ExperimentInvalidStateError);
    });

    it('KILL never requires an approval, but SCALE succeeds once the approval is granted, and re-deciding fails', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'gate6-approved');
      const experiment = await createExperiment({
        workspaceId: workspace.id,
        ventureProposalId: proposalId,
        name: 'Scale me for real',
        hypothesis: 'Scaling ad spend increases revenue proportionally',
        variants: [{ name: 'Control', isControl: true }],
        metrics: [{ name: 'REVENUE_EUR' }],
      });
      await startExperiment(workspace.id, experiment.id);

      // A parallel experiment proves KILL needs no approval at all.
      const killExperiment = await createExperiment({
        workspaceId: workspace.id,
        ventureProposalId: proposalId,
        name: 'Kill me',
        hypothesis: 'n/a',
        variants: [{ name: 'Control', isControl: true }],
        metrics: [{ name: 'REVENUE_EUR' }],
      });
      await startExperiment(workspace.id, killExperiment.id);
      const killDecision = await recordExperimentDecision({
        workspaceId: workspace.id,
        experimentId: killExperiment.id,
        decision: 'KILL',
        rationale: 'Not working',
        decidedBy: actor.id,
      });
      expect(killDecision.decision).toBe('KILL');
      const reloadedKillExperiment = await prisma.experiment.findUnique({
        where: { id: killExperiment.id },
      });
      expect(reloadedKillExperiment?.status).toBe('DECIDED');

      const { approvalRequestId } = await requestScaleDecisionApproval({
        workspaceId: workspace.id,
        experimentId: experiment.id,
        requestedBy: actor.id,
      });
      await decideApprovalRequest({
        workspaceId: workspace.id,
        approvalRequestId,
        founderIdentity: actor.id,
        decision: 'APPROVE',
      });

      const decision = await recordExperimentDecision({
        workspaceId: workspace.id,
        experimentId: experiment.id,
        decision: 'SCALE',
        rationale: 'Results are strong, approved to scale ad spend',
        decidedBy: actor.id,
        approvalRequestId,
      });
      expect(decision.decision).toBe('SCALE');
      expect(decision.approvalRequestId).toBe(approvalRequestId);

      const reloadedExperiment = await prisma.experiment.findUnique({
        where: { id: experiment.id },
      });
      expect(reloadedExperiment?.status).toBe('DECIDED');
      expect(reloadedExperiment?.endedAt).toBeTruthy();

      // Deciding an already-DECIDED experiment again must fail.
      await expect(
        recordExperimentDecision({
          workspaceId: workspace.id,
          experimentId: experiment.id,
          decision: 'HOLD',
          rationale: 'Trying to re-decide',
          decidedBy: actor.id,
        }),
      ).rejects.toThrow(ExperimentInvalidStateError);
    });
  });

  describe('Audit trail (task #86 prep: every Phase 7 mutating action is queryable)', () => {
    it('records a distinct, queryable audit event for assumption updates, forecast generation, and experiment creation/start', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'audit-flow');

      await financeService.upsertAssumption(
        workspace.id,
        proposalId,
        { productPriceEur: 19.99 },
        actor.id,
      );
      const assumptionEvents = await prisma.auditEvent.findMany({
        where: {
          workspaceId: workspace.id,
          entityId: proposalId,
          action: 'FINANCIAL_ASSUMPTION_UPDATED',
        },
      });
      expect(assumptionEvents).toHaveLength(1);
      expect(assumptionEvents[0].actorId).toBe(actor.id);
      expect(assumptionEvents[0].integrityHash).toBeTruthy();

      await financeService.createForecast(workspace.id, proposalId, 50, undefined, actor.id);
      const forecastEvents = await prisma.auditEvent.findMany({
        where: {
          workspaceId: workspace.id,
          entityId: proposalId,
          action: 'FINANCIAL_FORECAST_GENERATED',
        },
      });
      expect(forecastEvents).toHaveLength(1);

      const experiment = await financeService.createExperimentForVenture(
        workspace.id,
        proposalId,
        {
          name: 'Audit test experiment',
          hypothesis: 'n/a',
          variants: [{ name: 'Control', isControl: true }],
          metrics: [{ name: 'REVENUE_EUR' }],
        },
        actor.id,
      );
      const createdEvents = await prisma.auditEvent.findMany({
        where: { workspaceId: workspace.id, entityId: experiment.id, action: 'EXPERIMENT_CREATED' },
      });
      expect(createdEvents).toHaveLength(1);

      await financeService.startExperimentRun(workspace.id, experiment.id, actor.id);
      const startedEvents = await prisma.auditEvent.findMany({
        where: { workspaceId: workspace.id, entityId: experiment.id, action: 'EXPERIMENT_STARTED' },
      });
      expect(startedEvents).toHaveLength(1);
    });

    it('records SCALE_DECISION_APPROVAL_REQUESTED and EXPERIMENT_DECIDED with the approvalReference set', async () => {
      const { proposalId } = await buildVentureProposal(workspace.id, 'audit-gate6');
      const experiment = await financeService.createExperimentForVenture(
        workspace.id,
        proposalId,
        {
          name: 'Audit gate 6 experiment',
          hypothesis: 'n/a',
          variants: [{ name: 'Control', isControl: true }],
          metrics: [{ name: 'REVENUE_EUR' }],
        },
        actor.id,
      );
      await financeService.startExperimentRun(workspace.id, experiment.id, actor.id);
      const { approvalRequestId } = await financeService.requestScaleApproval(
        workspace.id,
        experiment.id,
        actor.id,
      );
      const requestEvents = await prisma.auditEvent.findMany({
        where: {
          workspaceId: workspace.id,
          entityId: experiment.id,
          action: 'SCALE_DECISION_APPROVAL_REQUESTED',
        },
      });
      expect(requestEvents).toHaveLength(1);
      expect(requestEvents[0].approvalReference).toBe(approvalRequestId);

      await decideApprovalRequest({
        workspaceId: workspace.id,
        approvalRequestId,
        founderIdentity: actor.id,
        decision: 'APPROVE',
      });
      await financeService.decideExperimentOutcome(
        workspace.id,
        experiment.id,
        { decision: 'SCALE', rationale: 'Strong results', approvalRequestId },
        actor.id,
      );
      const decidedEvents = await prisma.auditEvent.findMany({
        where: { workspaceId: workspace.id, entityId: experiment.id, action: 'EXPERIMENT_DECIDED' },
      });
      expect(decidedEvents).toHaveLength(1);
      expect(decidedEvents[0].approvalReference).toBe(approvalRequestId);
    });
  });
});
