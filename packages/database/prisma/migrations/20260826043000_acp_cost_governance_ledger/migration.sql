CREATE TABLE "acp_cost_budget_policies" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "taskId" TEXT,
  "scope" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "limitMinorUnits" BIGINT NOT NULL,
  "periodStart" TIMESTAMPTZ(3) NOT NULL,
  "periodEnd" TIMESTAMPTZ(3) NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_cost_budget_policies_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_cost_budget_policy_values_check" CHECK (
    "scope" IN ('WORKSPACE', 'TASK') AND
    (("scope" = 'WORKSPACE' AND "taskId" IS NULL) OR ("scope" = 'TASK' AND "taskId" IS NOT NULL)) AND
    "currency" ~ '^[A-Z]{3}$' AND "limitMinorUnits" BETWEEN 0 AND 9007199254740991 AND
    "periodStart" < "periodEnd" AND
    "id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$' AND
    "policyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$' AND
    "policyHash" ~ '^[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX "acp_cost_budget_policies_workspaceId_scope_taskId_currency_periodStart_periodEnd_key" ON "acp_cost_budget_policies"("workspaceId", "scope", "taskId", "currency", "periodStart", "periodEnd");
CREATE INDEX "acp_cost_budget_policy_lookup_idx" ON "acp_cost_budget_policies"("workspaceId", "scope", "currency", "periodStart", "periodEnd");

LOCK TABLE "acp_run_usages" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "acp_bridge_receipts" IN SHARE ROW EXCLUSIVE MODE;

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM "acp_run_usages") THEN
    RAISE EXCEPTION 'existing recognized usage requires an explicit governed-ledger remediation before this migration';
  END IF;
  IF EXISTS (SELECT 1 FROM "acp_bridge_receipts" WHERE "messageType" = 'USAGE') THEN
    RAISE EXCEPTION 'existing usage receipts require explicit database-clock remediation before this migration';
  END IF;
END;
$migration$;

ALTER TABLE "acp_bridge_receipts" ALTER COLUMN "receivedAt" TYPE TIMESTAMPTZ(3) USING "receivedAt" AT TIME ZONE 'UTC';
ALTER TABLE "acp_run_usages" ALTER COLUMN "recordedAt" TYPE TIMESTAMPTZ(3) USING "recordedAt" AT TIME ZONE 'UTC';

CREATE UNIQUE INDEX "acp_bridge_receipts_cost_binding_key" ON "acp_bridge_receipts"("workspaceId", "id", "sessionId", "dispatchId", "runId", "taskId", "runtimeId", "connectionId", "sequence");
CREATE UNIQUE INDEX "acp_bridge_dispatches_cost_binding_key" ON "acp_bridge_dispatches"("workspaceId", "id", "runId", "taskId", "runtimeId", "connectionId", "sessionId");
CREATE UNIQUE INDEX "acp_run_usages_cost_binding_key" ON "acp_run_usages"("workspaceId", "id", "receiptId", "sessionId", "dispatchId", "runId", "sequence");

CREATE TABLE "acp_cost_ledger_entries" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "usageId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "costMinorUnits" BIGINT NOT NULL,
  "computeUnits" BIGINT NOT NULL,
  "workspacePolicyId" TEXT NOT NULL,
  "workspacePolicyHash" TEXT NOT NULL,
  "taskPolicyId" TEXT NOT NULL,
  "taskPolicyHash" TEXT NOT NULL,
  "periodStart" TIMESTAMPTZ(3) NOT NULL,
  "periodEnd" TIMESTAMPTZ(3) NOT NULL,
  "workspaceSpendMinorUnits" BIGINT NOT NULL,
  "taskSpendMinorUnits" BIGINT NOT NULL,
  "checksum" TEXT NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_cost_ledger_entries_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_cost_ledger_values_check" CHECK (
    "sequence" > 0 AND "currency" ~ '^[A-Z]{3}$' AND
    "costMinorUnits" BETWEEN 0 AND 9007199254740991 AND "computeUnits" BETWEEN 0 AND 9007199254740991 AND
    "workspaceSpendMinorUnits" >= "costMinorUnits" AND
    "taskSpendMinorUnits" >= "costMinorUnits" AND
    "workspaceSpendMinorUnits" <= 9007199254740991 AND "taskSpendMinorUnits" <= 9007199254740991 AND
    "periodStart" < "periodEnd" AND
    "workspacePolicyHash" ~ '^[a-f0-9]{64}$' AND
    "taskPolicyHash" ~ '^[a-f0-9]{64}$' AND
    "checksum" ~ '^[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX "acp_cost_ledger_entries_workspaceId_usageId_key" ON "acp_cost_ledger_entries"("workspaceId", "usageId");
CREATE UNIQUE INDEX "acp_cost_ledger_entries_workspaceId_receiptId_key" ON "acp_cost_ledger_entries"("workspaceId", "receiptId");
CREATE UNIQUE INDEX "acp_cost_ledger_receipt_binding_key" ON "acp_cost_ledger_entries"("workspaceId", "receiptId", "sessionId", "dispatchId", "runId", "taskId", "runtimeId", "connectionId", "sequence");
CREATE UNIQUE INDEX "acp_cost_ledger_usage_binding_key" ON "acp_cost_ledger_entries"("workspaceId", "usageId", "receiptId", "sessionId", "dispatchId", "runId", "sequence");
CREATE INDEX "acp_cost_ledger_workspace_period_idx" ON "acp_cost_ledger_entries"("workspaceId", "periodStart", "periodEnd", "recordedAt" DESC);
CREATE INDEX "acp_cost_ledger_task_period_idx" ON "acp_cost_ledger_entries"("workspaceId", "taskId", "periodStart", "periodEnd", "recordedAt" DESC);

ALTER TABLE "acp_cost_budget_policies" ADD CONSTRAINT "acp_cost_budget_policies_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_cost_budget_policies" ADD CONSTRAINT "acp_cost_budget_policies_task_fkey" FOREIGN KEY ("workspaceId", "taskId") REFERENCES "acp_tasks"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_cost_ledger_entries" ADD CONSTRAINT "acp_cost_ledger_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_cost_ledger_entries" ADD CONSTRAINT "acp_cost_ledger_task_fkey" FOREIGN KEY ("workspaceId", "taskId") REFERENCES "acp_tasks"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_cost_ledger_entries" ADD CONSTRAINT "acp_cost_ledger_run_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "acp_runs"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_cost_ledger_entries" ADD CONSTRAINT "acp_cost_ledger_connection_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "acp_runtime_connections"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_cost_ledger_entries" ADD CONSTRAINT "acp_cost_ledger_session_fkey" FOREIGN KEY ("workspaceId", "sessionId") REFERENCES "acp_bridge_sessions"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_cost_ledger_entries" ADD CONSTRAINT "acp_cost_ledger_dispatch_fkey" FOREIGN KEY ("workspaceId", "dispatchId", "runId", "taskId", "runtimeId", "connectionId", "sessionId") REFERENCES "acp_bridge_dispatches"("workspaceId", "id", "runId", "taskId", "runtimeId", "connectionId", "sessionId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_cost_ledger_entries" ADD CONSTRAINT "acp_cost_ledger_receipt_fkey" FOREIGN KEY ("workspaceId", "receiptId", "sessionId", "dispatchId", "runId", "taskId", "runtimeId", "connectionId", "sequence") REFERENCES "acp_bridge_receipts"("workspaceId", "id", "sessionId", "dispatchId", "runId", "taskId", "runtimeId", "connectionId", "sequence") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_cost_ledger_entries" ADD CONSTRAINT "acp_cost_ledger_usage_fkey" FOREIGN KEY ("workspaceId", "usageId", "receiptId", "sessionId", "dispatchId", "runId", "sequence") REFERENCES "acp_run_usages"("workspaceId", "id", "receiptId", "sessionId", "dispatchId", "runId", "sequence") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_cost_ledger_entries" ADD CONSTRAINT "acp_cost_ledger_workspace_policy_fkey" FOREIGN KEY ("workspaceId", "workspacePolicyId") REFERENCES "acp_cost_budget_policies"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_cost_ledger_entries" ADD CONSTRAINT "acp_cost_ledger_task_policy_fkey" FOREIGN KEY ("workspaceId", "taskPolicyId") REFERENCES "acp_cost_budget_policies"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_reject_cost_governance_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cost governance evidence is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_cost_budget_policy_immutable BEFORE UPDATE ON "acp_cost_budget_policies" FOR EACH ROW EXECUTE FUNCTION ventureos_reject_cost_governance_update();
CREATE TRIGGER acp_cost_ledger_immutable BEFORE UPDATE ON "acp_cost_ledger_entries" FOR EACH ROW EXECUTE FUNCTION ventureos_reject_cost_governance_update();

CREATE OR REPLACE FUNCTION ventureos_validate_cost_budget_policy_insert() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM "workspaces" WHERE "id" = NEW."workspaceId" FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "acp_cost_budget_policies" p
    WHERE p."workspaceId" = NEW."workspaceId"
      AND p."scope" = NEW."scope"
      AND p."taskId" IS NOT DISTINCT FROM NEW."taskId"
      AND p."currency" = NEW."currency"
      AND p."periodStart" < NEW."periodEnd"
      AND p."periodEnd" > NEW."periodStart"
  ) THEN RAISE EXCEPTION 'overlapping cost budget policies are forbidden'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_cost_budget_policy_insert_guard BEFORE INSERT ON "acp_cost_budget_policies" FOR EACH ROW EXECUTE FUNCTION ventureos_validate_cost_budget_policy_insert();

CREATE OR REPLACE FUNCTION ventureos_bind_usage_receipt_clock() RETURNS trigger AS $$
BEGIN
  IF NEW."messageType" = 'USAGE' THEN
    NEW."receivedAt" := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_bridge_usage_receipt_clock BEFORE INSERT ON "acp_bridge_receipts" FOR EACH ROW EXECUTE FUNCTION ventureos_bind_usage_receipt_clock();

CREATE OR REPLACE FUNCTION ventureos_validate_cost_ledger_insert() RETURNS trigger AS $$
DECLARE
  workspace_policy "acp_cost_budget_policies"%ROWTYPE;
  task_policy "acp_cost_budget_policies"%ROWTYPE;
  usage_row "acp_run_usages"%ROWTYPE;
  receipt_type TEXT;
  receipt_received_at TIMESTAMPTZ(3);
  ledger_clock TIMESTAMPTZ(3);
  task_currency TEXT;
  task_limit BIGINT;
  task_compute_limit BIGINT;
  durable_task_policy_version TEXT;
  prior_workspace BIGINT;
  prior_task BIGINT;
  prior_task_lifetime_cost BIGINT;
  prior_task_lifetime_compute BIGINT;
BEGIN
  SELECT "currency", "maximumCostMinorUnits", "maximumComputeUnits", "policyVersion" INTO task_currency, task_limit, task_compute_limit, durable_task_policy_version FROM "acp_tasks" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."taskId" FOR UPDATE;
  SELECT * INTO workspace_policy FROM "acp_cost_budget_policies" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."workspacePolicyId" FOR UPDATE;
  SELECT * INTO task_policy FROM "acp_cost_budget_policies" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."taskPolicyId" FOR UPDATE;
  SELECT * INTO usage_row FROM "acp_run_usages" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."usageId" FOR UPDATE;
  SELECT "messageType", "receivedAt" INTO receipt_type, receipt_received_at FROM "acp_bridge_receipts" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."receiptId";
  ledger_clock := clock_timestamp();
  IF receipt_type IS DISTINCT FROM 'USAGE' OR usage_row."receiptId" IS DISTINCT FROM NEW."receiptId" OR usage_row."dispatchId" IS DISTINCT FROM NEW."dispatchId" OR usage_row."sessionId" IS DISTINCT FROM NEW."sessionId" OR usage_row."runId" IS DISTINCT FROM NEW."runId" OR usage_row."sequence" IS DISTINCT FROM NEW."sequence" OR usage_row."currency" IS DISTINCT FROM NEW."currency" OR usage_row."costMinorUnits" IS DISTINCT FROM NEW."costMinorUnits" OR usage_row."computeUnits" IS DISTINCT FROM NEW."computeUnits" OR usage_row."recordedAt" IS DISTINCT FROM NEW."recordedAt" THEN RAISE EXCEPTION 'usage ledger correlation mismatch'; END IF;
  IF receipt_received_at IS DISTINCT FROM usage_row."recordedAt" OR receipt_received_at IS DISTINCT FROM NEW."recordedAt" THEN RAISE EXCEPTION 'usage receipt database clock correlation mismatch'; END IF;
  IF NOT (ledger_clock >= workspace_policy."periodStart" AND ledger_clock < workspace_policy."periodEnd" AND ledger_clock >= task_policy."periodStart" AND ledger_clock < task_policy."periodEnd") THEN RAISE EXCEPTION 'cost budget policy expired before ledger commit'; END IF;
  IF workspace_policy."scope" IS DISTINCT FROM 'WORKSPACE' OR workspace_policy."taskId" IS NOT NULL OR workspace_policy."currency" IS DISTINCT FROM NEW."currency" OR workspace_policy."policyHash" IS DISTINCT FROM NEW."workspacePolicyHash" OR workspace_policy."periodStart" IS DISTINCT FROM NEW."periodStart" OR workspace_policy."periodEnd" IS DISTINCT FROM NEW."periodEnd" OR NOT (NEW."recordedAt" >= workspace_policy."periodStart" AND NEW."recordedAt" < workspace_policy."periodEnd") THEN RAISE EXCEPTION 'workspace budget policy correlation mismatch'; END IF;
  IF task_policy."scope" IS DISTINCT FROM 'TASK' OR task_policy."taskId" IS DISTINCT FROM NEW."taskId" OR task_policy."currency" IS DISTINCT FROM NEW."currency" OR task_policy."policyHash" IS DISTINCT FROM NEW."taskPolicyHash" OR task_policy."periodStart" IS DISTINCT FROM workspace_policy."periodStart" OR task_policy."periodEnd" IS DISTINCT FROM workspace_policy."periodEnd" OR NOT (NEW."recordedAt" >= task_policy."periodStart" AND NEW."recordedAt" < task_policy."periodEnd") THEN RAISE EXCEPTION 'task budget policy correlation mismatch'; END IF;
  SELECT COALESCE(SUM("costMinorUnits"), 0), COALESCE(SUM("computeUnits"), 0) INTO prior_task_lifetime_cost, prior_task_lifetime_compute FROM "acp_cost_ledger_entries" WHERE "workspaceId" = NEW."workspaceId" AND "taskId" = NEW."taskId";
  IF task_currency IS DISTINCT FROM NEW."currency" OR task_limit < task_policy."limitMinorUnits" OR durable_task_policy_version IS DISTINCT FROM task_policy."policyVersion" OR usage_row."cumulativeCostMinorUnits" > task_limit OR usage_row."cumulativeComputeUnits" > task_compute_limit OR prior_task_lifetime_cost + NEW."costMinorUnits" > task_limit OR prior_task_lifetime_compute + NEW."computeUnits" > task_compute_limit THEN RAISE EXCEPTION 'task durable budget correlation mismatch'; END IF;
  SELECT COALESCE(SUM("costMinorUnits"), 0) INTO prior_workspace FROM "acp_cost_ledger_entries" WHERE "workspaceId" = NEW."workspaceId" AND "currency" = NEW."currency" AND "recordedAt" >= workspace_policy."periodStart" AND "recordedAt" < workspace_policy."periodEnd";
  SELECT COALESCE(SUM("costMinorUnits"), 0) INTO prior_task FROM "acp_cost_ledger_entries" WHERE "workspaceId" = NEW."workspaceId" AND "taskId" = NEW."taskId" AND "currency" = NEW."currency" AND "recordedAt" >= task_policy."periodStart" AND "recordedAt" < task_policy."periodEnd";
  IF NEW."workspaceSpendMinorUnits" <> prior_workspace + NEW."costMinorUnits" OR NEW."taskSpendMinorUnits" <> prior_task + NEW."costMinorUnits" OR NEW."workspaceSpendMinorUnits" > workspace_policy."limitMinorUnits" OR NEW."taskSpendMinorUnits" > task_policy."limitMinorUnits" THEN RAISE EXCEPTION 'cost ledger exceeds or misstates governed budget'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_cost_ledger_insert_guard BEFORE INSERT ON "acp_cost_ledger_entries" FOR EACH ROW EXECUTE FUNCTION ventureos_validate_cost_ledger_insert();

CREATE OR REPLACE FUNCTION ventureos_require_usage_cost_ledger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM "acp_cost_ledger_entries" l
    WHERE l."workspaceId" = NEW."workspaceId" AND l."usageId" = NEW."id" AND l."receiptId" = NEW."receiptId"
  ) THEN RAISE EXCEPTION 'recognized usage requires exactly one governed cost ledger entry'; END IF;
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM "workspaces" w WHERE w."id" = OLD."workspaceId"
  ) THEN RAISE EXCEPTION 'governed cost ledger can only be removed during workspace erasure'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER acp_run_usage_requires_cost_ledger AFTER INSERT ON "acp_run_usages" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ventureos_require_usage_cost_ledger();
CREATE CONSTRAINT TRIGGER acp_cost_ledger_delete_guard AFTER DELETE ON "acp_cost_ledger_entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ventureos_require_usage_cost_ledger();
