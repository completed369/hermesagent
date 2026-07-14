-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "experimentId" UUID;

-- CreateTable
CREATE TABLE "financial_assumptions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ventureProposalId" UUID NOT NULL,
    "productPriceEur" DECIMAL(10,2) NOT NULL,
    "marketplaceFeeRate" DECIMAL(5,4) NOT NULL,
    "paymentProcessingFeeRate" DECIMAL(5,4) NOT NULL,
    "listingFeeEur" DECIMAL(10,2) NOT NULL,
    "refundRate" DECIMAL(5,4) NOT NULL,
    "discountRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "aiGenerationCostEur" DECIMAL(10,2) NOT NULL,
    "monthlyOverheadAllocationEur" DECIMAL(10,2) NOT NULL,
    "forecastPeriodDays" INTEGER NOT NULL,
    "targetContributionMarginRate" DECIMAL(5,4) NOT NULL,
    "minimumProfitConfidence" DECIMAL(5,2) NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_assumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_forecasts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ventureProposalId" UUID NOT NULL,
    "financialAssumptionId" UUID NOT NULL,
    "baseUnitsSold" INTEGER NOT NULL,
    "breakEvenUnits" INTEGER,
    "breakEvenRevenueEur" DECIMAL(12,2),
    "fixedCostsEur" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_scenarios" (
    "id" UUID NOT NULL,
    "financialForecastId" UUID NOT NULL,
    "scenario" TEXT NOT NULL,
    "unitsSold" INTEGER NOT NULL,
    "grossRevenueEur" DECIMAL(12,2) NOT NULL,
    "netRevenueEur" DECIMAL(12,2) NOT NULL,
    "totalVariableCostEur" DECIMAL(12,2) NOT NULL,
    "fixedCostsEur" DECIMAL(10,2) NOT NULL,
    "grossProfitEur" DECIMAL(12,2) NOT NULL,
    "netProfitEur" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ventureProposalId" UUID,
    "category" TEXT NOT NULL,
    "amountEur" DECIMAL(10,2) NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_entries" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ventureProposalId" UUID NOT NULL,
    "listingVersionId" UUID,
    "unitsSold" INTEGER NOT NULL,
    "grossRevenueEur" DECIMAL(12,2) NOT NULL,
    "marketplaceFeeEur" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paymentProcessingFeeEur" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "listingFeeEur" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "vatEur" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refundsEur" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netRevenueEur" DECIMAL(12,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_fees" (
    "id" UUID NOT NULL,
    "revenueEntryId" UUID NOT NULL,
    "feeType" TEXT NOT NULL,
    "amountEur" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_requests" (
    "id" UUID NOT NULL,
    "revenueEntryId" UUID NOT NULL,
    "amountEur" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ventureProposalId" UUID,
    "name" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalLimitEur" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_allocations" (
    "id" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "limitEur" DECIMAL(10,2) NOT NULL,
    "spentEur" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_ledger_entries" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "budgetAllocationId" UUID,
    "ventureProposalId" UUID,
    "category" TEXT NOT NULL,
    "amountEur" DECIMAL(10,4) NOT NULL,
    "source" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_usages" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "agentDefinitionId" UUID,
    "ventureProposalId" UUID,
    "boardReviewId" UUID,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "model" TEXT NOT NULL DEFAULT 'mock-v1',
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costEur" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_costs" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputCostPerMillionTokensEur" DECIMAL(10,4) NOT NULL,
    "outputCostPerMillionTokensEur" DECIMAL(10,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiments" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ventureProposalId" UUID NOT NULL,
    "listingVersionId" UUID,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_variants" (
    "id" UUID NOT NULL,
    "experimentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "trafficAllocationPercent" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_metrics" (
    "id" UUID NOT NULL,
    "experimentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "targetValue" DECIMAL(12,4),
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_results" (
    "id" UUID NOT NULL,
    "experimentVariantId" UUID NOT NULL,
    "experimentMetricId" UUID NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "sampleSize" INTEGER,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_decisions" (
    "id" UUID NOT NULL,
    "experimentId" UUID NOT NULL,
    "approvalRequestId" UUID,
    "decision" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_assumptions_workspaceId_ventureProposalId_idx" ON "financial_assumptions"("workspaceId", "ventureProposalId");

-- CreateIndex
CREATE INDEX "financial_forecasts_workspaceId_ventureProposalId_idx" ON "financial_forecasts"("workspaceId", "ventureProposalId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_scenarios_financialForecastId_scenario_key" ON "financial_scenarios"("financialForecastId", "scenario");

-- CreateIndex
CREATE INDEX "expenses_workspaceId_ventureProposalId_idx" ON "expenses"("workspaceId", "ventureProposalId");

-- CreateIndex
CREATE INDEX "revenue_entries_workspaceId_ventureProposalId_idx" ON "revenue_entries"("workspaceId", "ventureProposalId");

-- CreateIndex
CREATE INDEX "marketplace_fees_revenueEntryId_idx" ON "marketplace_fees"("revenueEntryId");

-- CreateIndex
CREATE INDEX "refund_requests_revenueEntryId_idx" ON "refund_requests"("revenueEntryId");

-- CreateIndex
CREATE INDEX "budgets_workspaceId_idx" ON "budgets"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_allocations_budgetId_category_key" ON "budget_allocations"("budgetId", "category");

-- CreateIndex
CREATE INDEX "cost_ledger_entries_workspaceId_createdAt_idx" ON "cost_ledger_entries"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "cost_ledger_entries_budgetAllocationId_idx" ON "cost_ledger_entries"("budgetAllocationId");

-- CreateIndex
CREATE INDEX "model_usages_workspaceId_createdAt_idx" ON "model_usages"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "model_costs_provider_model_effectiveFrom_key" ON "model_costs"("provider", "model", "effectiveFrom");

-- CreateIndex
CREATE INDEX "experiments_workspaceId_ventureProposalId_idx" ON "experiments"("workspaceId", "ventureProposalId");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_variants_experimentId_name_key" ON "experiment_variants"("experimentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_metrics_experimentId_name_key" ON "experiment_metrics"("experimentId", "name");

-- CreateIndex
CREATE INDEX "experiment_results_experimentVariantId_idx" ON "experiment_results"("experimentVariantId");

-- CreateIndex
CREATE INDEX "experiment_results_experimentMetricId_idx" ON "experiment_results"("experimentMetricId");

-- CreateIndex
CREATE INDEX "experiment_decisions_experimentId_idx" ON "experiment_decisions"("experimentId");

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_assumptions" ADD CONSTRAINT "financial_assumptions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_assumptions" ADD CONSTRAINT "financial_assumptions_ventureProposalId_fkey" FOREIGN KEY ("ventureProposalId") REFERENCES "venture_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_forecasts" ADD CONSTRAINT "financial_forecasts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_forecasts" ADD CONSTRAINT "financial_forecasts_financialAssumptionId_fkey" FOREIGN KEY ("financialAssumptionId") REFERENCES "financial_assumptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_scenarios" ADD CONSTRAINT "financial_scenarios_financialForecastId_fkey" FOREIGN KEY ("financialForecastId") REFERENCES "financial_forecasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_fees" ADD CONSTRAINT "marketplace_fees_revenueEntryId_fkey" FOREIGN KEY ("revenueEntryId") REFERENCES "revenue_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_revenueEntryId_fkey" FOREIGN KEY ("revenueEntryId") REFERENCES "revenue_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_budgetAllocationId_fkey" FOREIGN KEY ("budgetAllocationId") REFERENCES "budget_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_usages" ADD CONSTRAINT "model_usages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_metrics" ADD CONSTRAINT "experiment_metrics_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_results" ADD CONSTRAINT "experiment_results_experimentVariantId_fkey" FOREIGN KEY ("experimentVariantId") REFERENCES "experiment_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_results" ADD CONSTRAINT "experiment_results_experimentMetricId_fkey" FOREIGN KEY ("experimentMetricId") REFERENCES "experiment_metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_decisions" ADD CONSTRAINT "experiment_decisions_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_decisions" ADD CONSTRAINT "experiment_decisions_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
