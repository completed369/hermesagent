-- ADR-0168: immutable aggregate cost-overlap reconciliation.
-- Each record binds the exact append-only expense and recognized-runtime
-- evidence sets. Later links change a set hash and invalidate the projection.

CREATE TABLE "revenue_run_cost_reconciliations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "revenueRunId" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "expenseEvidenceSetHash" TEXT NOT NULL,
    "usageEvidenceSetHash" TEXT NOT NULL,
    "expenseTotalMinorUnits" BIGINT NOT NULL,
    "runtimeChargeMinorUnits" BIGINT NOT NULL,
    "overlapMinorUnits" BIGINT NOT NULL,
    "basisReference" TEXT NOT NULL,
    "reconciliationHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reconciledBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_run_cost_reconciliations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "revenue_run_cost_reconciliations_currency_check"
        CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "revenue_run_cost_reconciliations_expense_hash_check"
        CHECK ("expenseEvidenceSetHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "revenue_run_cost_reconciliations_usage_hash_check"
        CHECK ("usageEvidenceSetHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "revenue_run_cost_reconciliations_hash_check"
        CHECK ("reconciliationHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "revenue_run_cost_reconciliations_amounts_check" CHECK (
        "expenseTotalMinorUnits" >= 0
        AND "runtimeChargeMinorUnits" >= 0
        AND "overlapMinorUnits" >= 0
        AND "overlapMinorUnits" <= "expenseTotalMinorUnits"
        AND "overlapMinorUnits" <= "runtimeChargeMinorUnits"
    ),
    CONSTRAINT "revenue_run_cost_reconciliations_basis_check" CHECK (
        char_length("basisReference") BETWEEN 1 AND 500
        AND "basisReference" = btrim("basisReference")
    ),
    CONSTRAINT "revenue_run_cost_reconciliations_idempotency_check" CHECK (
        char_length("idempotencyKey") BETWEEN 1 AND 200
        AND "idempotencyKey" = btrim("idempotencyKey")
    ),
    CONSTRAINT "revenue_run_cost_reconciliations_actor_check" CHECK (
        char_length("reconciledBy") BETWEEN 1 AND 200
        AND "reconciledBy" = btrim("reconciledBy")
    )
);

CREATE UNIQUE INDEX "revenue_run_cost_reconciliations_workspace_idempotency_key"
    ON "revenue_run_cost_reconciliations"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "revenue_run_cost_reconciliations_evidence_set_key"
    ON "revenue_run_cost_reconciliations"(
        "workspaceId", "revenueRunId", "expenseEvidenceSetHash", "usageEvidenceSetHash"
    );
CREATE INDEX "revenue_run_cost_reconciliations_run_created_idx"
    ON "revenue_run_cost_reconciliations"("workspaceId", "revenueRunId", "createdAt" DESC);

ALTER TABLE "revenue_run_cost_reconciliations"
    ADD CONSTRAINT "revenue_run_cost_reconciliations_revenue_run_fkey"
    FOREIGN KEY ("revenueRunId") REFERENCES "revenue_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_require_revenue_cost_reconciliation_scope()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM "revenue_runs" r
         WHERE r."id" = NEW."revenueRunId"
           AND r."workspaceId" = NEW."workspaceId"
           AND r."currency" = NEW."currency"
    ) THEN
        RAISE EXCEPTION 'Revenue cost reconciliation crossed run, currency, or workspace scope';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_run_cost_reconciliations_scope_guard
BEFORE INSERT ON "revenue_run_cost_reconciliations"
FOR EACH ROW EXECUTE FUNCTION ventureos_require_revenue_cost_reconciliation_scope();

CREATE OR REPLACE FUNCTION ventureos_reject_revenue_cost_reconciliation_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF EXISTS (
            SELECT 1 FROM "revenue_runs" r WHERE r."id" = OLD."revenueRunId"
        ) THEN
            RAISE EXCEPTION 'Revenue cost reconciliations are append-only';
        END IF;
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'Revenue cost reconciliations are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_run_cost_reconciliations_update_guard
BEFORE UPDATE ON "revenue_run_cost_reconciliations"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_cost_reconciliation_change();

CREATE TRIGGER revenue_run_cost_reconciliations_delete_guard
BEFORE DELETE ON "revenue_run_cost_reconciliations"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_cost_reconciliation_change();
