-- ADR-0165: planning-only revenue-run correlation spine.
-- Forecasts live here. Realized revenue, expense, and runtime-usage amounts
-- remain authoritative in their existing tables and are linked append-only.

CREATE TABLE "revenue_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "ventureProposalId" UUID NOT NULL,
    "approvalRequestId" UUID,
    "experimentId" UUID,
    "taskId" TEXT,
    "runId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "currency" TEXT NOT NULL,
    "expectedRevenueMinorUnits" BIGINT NOT NULL,
    "expectedCostMinorUnits" BIGINT NOT NULL,
    "downsideMinorUnits" BIGINT NOT NULL,
    "confidenceBps" INTEGER NOT NULL,
    "timeToCashDays" INTEGER NOT NULL,
    "forecastEvidenceHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "revenue_runs_planning_only" CHECK ("status" = 'PLANNED'),
    CONSTRAINT "revenue_runs_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "revenue_runs_expected_revenue_check" CHECK ("expectedRevenueMinorUnits" >= 0),
    CONSTRAINT "revenue_runs_expected_cost_check" CHECK ("expectedCostMinorUnits" >= 0),
    CONSTRAINT "revenue_runs_downside_check" CHECK ("downsideMinorUnits" >= 0),
    CONSTRAINT "revenue_runs_confidence_check" CHECK ("confidenceBps" BETWEEN 0 AND 10000),
    CONSTRAINT "revenue_runs_time_to_cash_check" CHECK ("timeToCashDays" BETWEEN 0 AND 36500),
    CONSTRAINT "revenue_runs_forecast_hash_check" CHECK ("forecastEvidenceHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "revenue_runs_idempotency_key_check" CHECK (
        char_length("idempotencyKey") BETWEEN 1 AND 200
        AND "idempotencyKey" = btrim("idempotencyKey")
    ),
    CONSTRAINT "revenue_runs_created_by_check" CHECK (
        char_length("createdBy") BETWEEN 1 AND 200
        AND "createdBy" = btrim("createdBy")
    ),
    CONSTRAINT "revenue_runs_run_requires_task" CHECK ("runId" IS NULL OR "taskId" IS NOT NULL)
);

CREATE UNIQUE INDEX "revenue_runs_workspaceId_idempotencyKey_key"
    ON "revenue_runs"("workspaceId", "idempotencyKey");
CREATE INDEX "revenue_runs_workspaceId_status_createdAt_idx"
    ON "revenue_runs"("workspaceId", "status", "createdAt" DESC);
CREATE INDEX "revenue_runs_workspaceId_opportunityId_idx"
    ON "revenue_runs"("workspaceId", "opportunityId");
CREATE INDEX "revenue_runs_workspaceId_ventureProposalId_idx"
    ON "revenue_runs"("workspaceId", "ventureProposalId");

ALTER TABLE "revenue_runs" ADD CONSTRAINT "revenue_runs_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "revenue_runs" ADD CONSTRAINT "revenue_runs_opportunityId_fkey"
    FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revenue_runs" ADD CONSTRAINT "revenue_runs_ventureProposalId_fkey"
    FOREIGN KEY ("ventureProposalId") REFERENCES "venture_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revenue_runs" ADD CONSTRAINT "revenue_runs_approvalRequestId_fkey"
    FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revenue_runs" ADD CONSTRAINT "revenue_runs_experimentId_fkey"
    FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revenue_runs" ADD CONSTRAINT "revenue_runs_workspaceId_taskId_fkey"
    FOREIGN KEY ("workspaceId", "taskId") REFERENCES "acp_tasks"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revenue_runs" ADD CONSTRAINT "revenue_runs_workspaceId_runId_fkey"
    FOREIGN KEY ("workspaceId", "runId") REFERENCES "acp_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "revenue_run_revenue_entries" (
    "revenueRunId" UUID NOT NULL,
    "revenueEntryId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "linkedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_run_revenue_entries_pkey"
        PRIMARY KEY ("workspaceId", "revenueRunId", "revenueEntryId"),
    CONSTRAINT "revenue_run_revenue_entries_hash_check"
        CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "revenue_run_revenue_entries_actor_check"
        CHECK (char_length("linkedBy") BETWEEN 1 AND 200 AND "linkedBy" = btrim("linkedBy"))
);

CREATE UNIQUE INDEX "revenue_run_revenue_entries_revenueEntryId_key"
    ON "revenue_run_revenue_entries"("revenueEntryId");
CREATE INDEX "revenue_run_revenue_entries_workspaceId_revenueRunId_idx"
    ON "revenue_run_revenue_entries"("workspaceId", "revenueRunId");
ALTER TABLE "revenue_run_revenue_entries" ADD CONSTRAINT "revenue_run_revenue_entries_revenueRunId_fkey"
    FOREIGN KEY ("revenueRunId") REFERENCES "revenue_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "revenue_run_revenue_entries" ADD CONSTRAINT "revenue_run_revenue_entries_revenueEntryId_fkey"
    FOREIGN KEY ("revenueEntryId") REFERENCES "revenue_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "revenue_run_expenses" (
    "revenueRunId" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "linkedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_run_expenses_pkey"
        PRIMARY KEY ("workspaceId", "revenueRunId", "expenseId"),
    CONSTRAINT "revenue_run_expenses_hash_check"
        CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "revenue_run_expenses_actor_check"
        CHECK (char_length("linkedBy") BETWEEN 1 AND 200 AND "linkedBy" = btrim("linkedBy"))
);

CREATE UNIQUE INDEX "revenue_run_expenses_expenseId_key"
    ON "revenue_run_expenses"("expenseId");
CREATE INDEX "revenue_run_expenses_workspaceId_revenueRunId_idx"
    ON "revenue_run_expenses"("workspaceId", "revenueRunId");
ALTER TABLE "revenue_run_expenses" ADD CONSTRAINT "revenue_run_expenses_revenueRunId_fkey"
    FOREIGN KEY ("revenueRunId") REFERENCES "revenue_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "revenue_run_expenses" ADD CONSTRAINT "revenue_run_expenses_expenseId_fkey"
    FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "revenue_run_usages" (
    "revenueRunId" UUID NOT NULL,
    "usageId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "linkedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_run_usages_pkey"
        PRIMARY KEY ("workspaceId", "revenueRunId", "usageId"),
    CONSTRAINT "revenue_run_usages_hash_check"
        CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "revenue_run_usages_actor_check"
        CHECK (char_length("linkedBy") BETWEEN 1 AND 200 AND "linkedBy" = btrim("linkedBy"))
);

CREATE UNIQUE INDEX "revenue_run_usages_workspaceId_usageId_key"
    ON "revenue_run_usages"("workspaceId", "usageId");
CREATE INDEX "revenue_run_usages_workspaceId_revenueRunId_idx"
    ON "revenue_run_usages"("workspaceId", "revenueRunId");
ALTER TABLE "revenue_run_usages" ADD CONSTRAINT "revenue_run_usages_revenueRunId_fkey"
    FOREIGN KEY ("revenueRunId") REFERENCES "revenue_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "revenue_run_usages" ADD CONSTRAINT "revenue_run_usages_workspaceId_usageId_fkey"
    FOREIGN KEY ("workspaceId", "usageId") REFERENCES "acp_run_usages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_require_revenue_run_scope()
RETURNS TRIGGER AS $$
DECLARE
    approving_decision_count INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM "opportunities" o
         WHERE o."id" = NEW."opportunityId"
           AND o."workspaceId" = NEW."workspaceId"
    ) THEN
        RAISE EXCEPTION 'Revenue run opportunity crossed workspace scope';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM "venture_proposals" p
         WHERE p."id" = NEW."ventureProposalId"
           AND p."workspaceId" = NEW."workspaceId"
           AND p."opportunityId" = NEW."opportunityId"
    ) THEN
        RAISE EXCEPTION 'Revenue run proposal crossed opportunity or workspace scope';
    END IF;

    IF NEW."approvalRequestId" IS NOT NULL THEN
        SELECT count(*)
          INTO approving_decision_count
          FROM "approval_requests" a
          JOIN "approval_decisions" d ON d."approvalRequestId" = a."id"
         WHERE a."id" = NEW."approvalRequestId"
           AND a."workspaceId" = NEW."workspaceId"
           AND a."ventureProposalId" = NEW."ventureProposalId"
           AND a."state" IN ('APPROVED', 'APPROVED_WITH_CONDITIONS')
           AND a."revokedAt" IS NULL
           AND a."expiresAt" > CURRENT_TIMESTAMP
           AND d."decision" IN ('APPROVE', 'APPROVE_WITH_CONDITIONS')
           AND d."expiresAt" > CURRENT_TIMESTAMP;
        IF approving_decision_count = 0 THEN
            RAISE EXCEPTION 'Revenue run approval is absent, expired, revoked, unapproved, or out of scope';
        END IF;
    END IF;

    IF NEW."experimentId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM "experiments" e
         WHERE e."id" = NEW."experimentId"
           AND e."workspaceId" = NEW."workspaceId"
           AND e."ventureProposalId" = NEW."ventureProposalId"
    ) THEN
        RAISE EXCEPTION 'Revenue run experiment crossed venture or workspace scope';
    END IF;

    IF NEW."runId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM "acp_runs" r
         WHERE r."workspaceId" = NEW."workspaceId"
           AND r."id" = NEW."runId"
           AND r."taskId" = NEW."taskId"
    ) THEN
        RAISE EXCEPTION 'Revenue run ACP run crossed task or workspace scope';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_runs_scope_guard
BEFORE INSERT ON "revenue_runs"
FOR EACH ROW EXECUTE FUNCTION ventureos_require_revenue_run_scope();

CREATE OR REPLACE FUNCTION ventureos_reject_revenue_run_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Revenue run forecasts are immutable; create a new forecast version';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_runs_immutable
BEFORE UPDATE ON "revenue_runs"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_run_update();

CREATE OR REPLACE FUNCTION ventureos_require_revenue_fact_scope()
RETURNS TRIGGER AS $$
DECLARE
    bound_run "revenue_runs"%ROWTYPE;
BEGIN
    SELECT * INTO bound_run
      FROM "revenue_runs"
     WHERE "id" = NEW."revenueRunId"
     FOR KEY SHARE;

    IF NOT FOUND OR bound_run."workspaceId" IS DISTINCT FROM NEW."workspaceId" THEN
        RAISE EXCEPTION 'Revenue outcome evidence crossed revenue-run workspace scope';
    END IF;

    IF TG_TABLE_NAME = 'revenue_run_revenue_entries' THEN
        IF bound_run."currency" <> 'EUR' OR NOT EXISTS (
            SELECT 1 FROM "revenue_entries" f
             WHERE f."id" = NEW."revenueEntryId"
               AND f."workspaceId" = NEW."workspaceId"
               AND f."ventureProposalId" = bound_run."ventureProposalId"
        ) THEN
            RAISE EXCEPTION 'Revenue entry crossed revenue-run venture, currency, or workspace scope';
        END IF;
    ELSIF TG_TABLE_NAME = 'revenue_run_expenses' THEN
        IF bound_run."currency" <> 'EUR' OR NOT EXISTS (
            SELECT 1 FROM "expenses" f
             WHERE f."id" = NEW."expenseId"
               AND f."workspaceId" = NEW."workspaceId"
               AND f."ventureProposalId" = bound_run."ventureProposalId"
        ) THEN
            RAISE EXCEPTION 'Expense crossed revenue-run venture, currency, or workspace scope';
        END IF;
    ELSIF TG_TABLE_NAME = 'revenue_run_usages' THEN
        IF bound_run."runId" IS NULL OR NOT EXISTS (
            SELECT 1 FROM "acp_run_usages" f
             WHERE f."workspaceId" = NEW."workspaceId"
               AND f."id" = NEW."usageId"
               AND f."runId" = bound_run."runId"
               AND f."currency" = bound_run."currency"
        ) THEN
            RAISE EXCEPTION 'Runtime usage crossed revenue-run run, currency, or workspace scope';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_run_revenue_entries_scope_guard
BEFORE INSERT ON "revenue_run_revenue_entries"
FOR EACH ROW EXECUTE FUNCTION ventureos_require_revenue_fact_scope();
CREATE TRIGGER revenue_run_expenses_scope_guard
BEFORE INSERT ON "revenue_run_expenses"
FOR EACH ROW EXECUTE FUNCTION ventureos_require_revenue_fact_scope();
CREATE TRIGGER revenue_run_usages_scope_guard
BEFORE INSERT ON "revenue_run_usages"
FOR EACH ROW EXECUTE FUNCTION ventureos_require_revenue_fact_scope();

CREATE OR REPLACE FUNCTION ventureos_reject_revenue_fact_link_change()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Revenue outcome evidence links are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_run_revenue_entries_immutable
BEFORE UPDATE ON "revenue_run_revenue_entries"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_fact_link_change();
CREATE TRIGGER revenue_run_expenses_immutable
BEFORE UPDATE ON "revenue_run_expenses"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_fact_link_change();
CREATE TRIGGER revenue_run_usages_immutable
BEFORE UPDATE ON "revenue_run_usages"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_fact_link_change();
