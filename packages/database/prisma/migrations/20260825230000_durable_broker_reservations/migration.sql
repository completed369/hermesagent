CREATE TABLE "acp_broker_reservations" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "agentEvidenceId" TEXT NOT NULL,
  "agentEvidenceHash" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "candidateEvidenceId" TEXT NOT NULL,
  "candidateEvidenceHash" TEXT NOT NULL,
  "taskPolicyHash" TEXT NOT NULL,
  "taskPolicyVersion" TEXT NOT NULL,
  "expectedRunVersion" INTEGER NOT NULL,
  "selectedScoreBps" INTEGER NOT NULL,
  "estimatedCostMinorUnits" BIGINT NOT NULL,
  "reservedComputeUnits" BIGINT NOT NULL,
  "maxConcurrentRuns" INTEGER NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'RESERVED',
  "testOnly" BOOLEAN NOT NULL DEFAULT false,
  "idempotencyKey" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "claimedDispatchId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_broker_reservations_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_broker_reservations_hash_check" CHECK (
    "requestHash" ~ '^[a-f0-9]{64}$' AND "agentEvidenceHash" ~ '^[a-f0-9]{64}$' AND "candidateEvidenceHash" ~ '^[a-f0-9]{64}$' AND
    "taskPolicyHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "acp_broker_reservations_values_check" CHECK (
    "selectedScoreBps" BETWEEN 0 AND 10000 AND "estimatedCostMinorUnits" >= 0 AND
    "reservedComputeUnits" >= 0 AND "maxConcurrentRuns" > 0 AND "expectedRunVersion" > 0
  ),
  CONSTRAINT "acp_broker_reservations_state_check" CHECK ("state" IN ('RESERVED','CLAIMED','RELEASED','EXPIRED')),
  CONSTRAINT "acp_broker_reservations_lifecycle_check" CHECK (
    ("state" = 'RESERVED' AND "claimedDispatchId" IS NULL AND "claimedAt" IS NULL AND "releasedAt" IS NULL) OR
    ("state" = 'CLAIMED' AND "claimedDispatchId" IS NOT NULL AND "claimedAt" IS NOT NULL AND "releasedAt" IS NULL) OR
    ("state" = 'RELEASED' AND "claimedDispatchId" IS NOT NULL AND "claimedAt" IS NOT NULL AND "releasedAt" IS NOT NULL) OR
    ("state" = 'EXPIRED' AND "claimedDispatchId" IS NULL AND "claimedAt" IS NULL AND "releasedAt" IS NOT NULL)
  )
);

CREATE TABLE "acp_broker_evaluations" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "reservationId" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "eligible" BOOLEAN NOT NULL,
  "rejectionReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "scoreBps" INTEGER,
  "qualityBps" INTEGER,
  "reliabilityBps" INTEGER,
  "securityBps" INTEGER,
  "latencyBps" INTEGER,
  "costBps" INTEGER,
  "workloadBps" INTEGER,
  "ordinal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_broker_evaluations_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_broker_evaluations_values_check" CHECK (
    "ordinal" >= 0 AND ("scoreBps" IS NULL OR "scoreBps" BETWEEN 0 AND 10000) AND
    ("qualityBps" IS NULL OR "qualityBps" BETWEEN 0 AND 10000) AND
    ("reliabilityBps" IS NULL OR "reliabilityBps" BETWEEN 0 AND 10000) AND
    ("securityBps" IS NULL OR "securityBps" BETWEEN 0 AND 10000) AND
    ("latencyBps" IS NULL OR "latencyBps" BETWEEN 0 AND 10000) AND
    ("costBps" IS NULL OR "costBps" BETWEEN 0 AND 10000) AND
    ("workloadBps" IS NULL OR "workloadBps" BETWEEN 0 AND 10000)
  ),
  CONSTRAINT "acp_broker_evaluations_reasons_check" CHECK (
    "rejectionReasons" <@ ARRAY['CROSS_WORKSPACE','NOT_CONNECTED','UNAUTHENTICATED','UNCORRELATED_TRUST_EVIDENCE','STALE_HEARTBEAT','MISSING_CAPABILITY','MISSING_TOOL_SCOPE','DATA_SENSITIVITY_DENIED','SECURITY_TIER_TOO_LOW','RELIABILITY_TOO_LOW','LATENCY_TOO_HIGH','TASK_COST_LIMIT_EXCEEDED','RUNTIME_BUDGET_EXHAUSTED','COMPUTE_BUDGET_EXHAUSTED','RUNTIME_AT_CAPACITY','INVALID_EVIDENCE']::TEXT[]
  ),
  CONSTRAINT "acp_broker_evaluations_outcome_check" CHECK (
    ("eligible" AND cardinality("rejectionReasons")=0 AND "scoreBps" IS NOT NULL AND "qualityBps" IS NOT NULL AND "reliabilityBps" IS NOT NULL AND "securityBps" IS NOT NULL AND "latencyBps" IS NOT NULL AND "costBps" IS NOT NULL AND "workloadBps" IS NOT NULL) OR
    (NOT "eligible" AND cardinality("rejectionReasons")>0 AND "scoreBps" IS NULL AND "qualityBps" IS NULL AND "reliabilityBps" IS NULL AND "securityBps" IS NULL AND "latencyBps" IS NULL AND "costBps" IS NULL AND "workloadBps" IS NULL)
  )
);

CREATE UNIQUE INDEX "acp_broker_reservations_workspaceId_idempotencyKey_key" ON "acp_broker_reservations"("workspaceId","idempotencyKey");
CREATE UNIQUE INDEX "acp_broker_reservations_active_run_key" ON "acp_broker_reservations"("workspaceId","runId") WHERE "state" IN ('RESERVED','CLAIMED');
CREATE UNIQUE INDEX "acp_broker_reservations_workspaceId_claimedDispatchId_key" ON "acp_broker_reservations"("workspaceId","claimedDispatchId");
CREATE UNIQUE INDEX "acp_broker_reservations_dispatch_binding_key" ON "acp_broker_reservations"("workspaceId","id","evidenceHash","taskId","runId","agentId","runtimeId","connectionId");
CREATE UNIQUE INDEX "acp_runs_broker_binding_key" ON "acp_runs"("workspaceId","id","objectiveId","taskId");
CREATE UNIQUE INDEX "acp_runtime_connections_broker_binding_key" ON "acp_runtime_connections"("workspaceId","id","runtimeId");
CREATE INDEX "acp_broker_reservations_connection_active_idx" ON "acp_broker_reservations"("workspaceId","connectionId","state","expiresAt");
CREATE UNIQUE INDEX "acp_broker_evaluations_candidate_key" ON "acp_broker_evaluations"("workspaceId","reservationId","runtimeId","connectionId");
CREATE UNIQUE INDEX "acp_broker_evaluations_ordinal_key" ON "acp_broker_evaluations"("workspaceId","reservationId","ordinal");

ALTER TABLE "acp_broker_reservations" ADD CONSTRAINT "acp_broker_reservations_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "acp_broker_reservations" ADD CONSTRAINT "acp_broker_reservations_task_fkey" FOREIGN KEY ("workspaceId","taskId") REFERENCES "acp_tasks"("workspaceId","id") ON DELETE CASCADE;
ALTER TABLE "acp_broker_reservations" ADD CONSTRAINT "acp_broker_reservations_run_fkey" FOREIGN KEY ("workspaceId","runId","objectiveId","taskId") REFERENCES "acp_runs"("workspaceId","id","objectiveId","taskId") ON DELETE CASCADE;
ALTER TABLE "acp_broker_reservations" ADD CONSTRAINT "acp_broker_reservations_connection_fkey" FOREIGN KEY ("workspaceId","connectionId","runtimeId") REFERENCES "acp_runtime_connections"("workspaceId","id","runtimeId") ON DELETE CASCADE;
ALTER TABLE "acp_broker_evaluations" ADD CONSTRAINT "acp_broker_evaluations_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "acp_broker_evaluations" ADD CONSTRAINT "acp_broker_evaluations_reservation_fkey" FOREIGN KEY ("workspaceId","reservationId") REFERENCES "acp_broker_reservations"("workspaceId","id") ON DELETE CASCADE;
ALTER TABLE "acp_bridge_dispatches" ADD CONSTRAINT "acp_bridge_dispatches_broker_reservation_fkey" FOREIGN KEY ("workspaceId","brokerEvidenceId","brokerEvidenceHash","taskId","runId","agentId","runtimeId","connectionId") REFERENCES "acp_broker_reservations"("workspaceId","id","evidenceHash","taskId","runId","agentId","runtimeId","connectionId") ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_reject_broker_evidence_update() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'acp_broker_evaluations' THEN
    RAISE EXCEPTION 'broker evaluation evidence is immutable';
  END IF;
  IF ROW(NEW."workspaceId",NEW."id",NEW."objectiveId",NEW."taskId",NEW."runId",NEW."agentId",NEW."agentEvidenceId",NEW."agentEvidenceHash",NEW."runtimeId",NEW."connectionId",NEW."requestHash",NEW."candidateEvidenceId",NEW."candidateEvidenceHash",NEW."taskPolicyHash",NEW."taskPolicyVersion",NEW."expectedRunVersion",NEW."selectedScoreBps",NEW."estimatedCostMinorUnits",NEW."reservedComputeUnits",NEW."maxConcurrentRuns",NEW."evidenceHash",NEW."testOnly",NEW."idempotencyKey",NEW."expiresAt",NEW."createdAt") IS DISTINCT FROM ROW(OLD."workspaceId",OLD."id",OLD."objectiveId",OLD."taskId",OLD."runId",OLD."agentId",OLD."agentEvidenceId",OLD."agentEvidenceHash",OLD."runtimeId",OLD."connectionId",OLD."requestHash",OLD."candidateEvidenceId",OLD."candidateEvidenceHash",OLD."taskPolicyHash",OLD."taskPolicyVersion",OLD."expectedRunVersion",OLD."selectedScoreBps",OLD."estimatedCostMinorUnits",OLD."reservedComputeUnits",OLD."maxConcurrentRuns",OLD."evidenceHash",OLD."testOnly",OLD."idempotencyKey",OLD."expiresAt",OLD."createdAt") THEN
    RAISE EXCEPTION 'broker reservation binding is immutable';
  END IF;
  IF NEW."state" = OLD."state" THEN
    IF ROW(NEW."claimedDispatchId",NEW."claimedAt",NEW."releasedAt") IS DISTINCT FROM ROW(OLD."claimedDispatchId",OLD."claimedAt",OLD."releasedAt") THEN
      RAISE EXCEPTION 'broker reservation lifecycle fields are immutable without a transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."state"='RESERVED' AND NEW."state"='CLAIMED' THEN
    IF OLD."expiresAt" <= clock_timestamp() OR NOT EXISTS (
      SELECT 1 FROM "acp_bridge_dispatches" d WHERE d."workspaceId"=NEW."workspaceId" AND d."id"=NEW."claimedDispatchId"
        AND d."brokerEvidenceId"=NEW."id" AND d."brokerEvidenceHash"=NEW."evidenceHash"
        AND d."taskId"=NEW."taskId" AND d."runId"=NEW."runId" AND d."agentId"=NEW."agentId"
        AND d."runtimeId"=NEW."runtimeId" AND d."connectionId"=NEW."connectionId" AND d."state"='PREPARED'
    ) THEN RAISE EXCEPTION 'trusted exact dispatch required to claim reservation'; END IF;
  ELSIF OLD."state"='RESERVED' AND NEW."state"='EXPIRED' THEN
    IF OLD."expiresAt" > clock_timestamp() THEN RAISE EXCEPTION 'active reservation cannot expire early'; END IF;
  ELSIF OLD."state"='CLAIMED' AND NEW."state"='RELEASED' THEN
    IF ROW(NEW."claimedDispatchId",NEW."claimedAt") IS DISTINCT FROM ROW(OLD."claimedDispatchId",OLD."claimedAt") THEN
      RAISE EXCEPTION 'broker reservation claim metadata is immutable';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "acp_bridge_dispatches" d WHERE d."workspaceId"=NEW."workspaceId" AND d."id"=OLD."claimedDispatchId"
        AND d."state" IN ('COMPLETED','FAILED','CANCELLED')
    ) THEN RAISE EXCEPTION 'terminal exact dispatch required to release reservation'; END IF;
  ELSE
    RAISE EXCEPTION 'broker reservation transition denied';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acp_broker_reservations_immutable BEFORE UPDATE ON "acp_broker_reservations" FOR EACH ROW EXECUTE FUNCTION ventureos_reject_broker_evidence_update();
CREATE TRIGGER acp_broker_evaluations_immutable BEFORE UPDATE ON "acp_broker_evaluations" FOR EACH ROW EXECUTE FUNCTION ventureos_reject_broker_evidence_update();

CREATE OR REPLACE FUNCTION ventureos_claim_broker_reservation() RETURNS trigger AS $$
DECLARE reservation_state TEXT; reservation_expires TIMESTAMP(3); reservation_test_only BOOLEAN; connection_environment TEXT;
BEGIN
  SELECT r."state",r."expiresAt",r."testOnly",c."environment"
  INTO reservation_state,reservation_expires,reservation_test_only,connection_environment
  FROM "acp_broker_reservations" r
  JOIN "acp_runtime_connections" c ON c."workspaceId"=r."workspaceId" AND c."id"=r."connectionId"
  WHERE r."workspaceId"=NEW."workspaceId" AND r."id"=NEW."brokerEvidenceId" AND r."evidenceHash"=NEW."brokerEvidenceHash"
    AND r."taskId"=NEW."taskId" AND r."runId"=NEW."runId" AND r."agentId"=NEW."agentId"
    AND r."runtimeId"=NEW."runtimeId" AND r."connectionId"=NEW."connectionId"
  FOR UPDATE OF r;
  IF reservation_state IS NULL OR reservation_state <> 'RESERVED' THEN RAISE EXCEPTION 'active exact broker reservation required'; END IF;
  IF reservation_expires <= clock_timestamp() THEN RAISE EXCEPTION 'broker reservation expired'; END IF;
  IF reservation_test_only AND connection_environment <> 'TEST_ONLY' THEN RAISE EXCEPTION 'test-only broker evidence escaped fixture isolation'; END IF;
  UPDATE "acp_broker_reservations" SET "state"='CLAIMED',"claimedDispatchId"=NEW."id", "claimedAt"=clock_timestamp()
  WHERE "workspaceId"=NEW."workspaceId" AND "id"=NEW."brokerEvidenceId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acp_bridge_dispatch_claims_broker AFTER INSERT ON "acp_bridge_dispatches" FOR EACH ROW EXECUTE FUNCTION ventureos_claim_broker_reservation();

CREATE OR REPLACE FUNCTION ventureos_release_broker_reservation() RETURNS trigger AS $$
BEGIN
  IF NEW."state" IN ('COMPLETED','FAILED','CANCELLED') AND OLD."state" <> NEW."state" THEN
    UPDATE "acp_broker_reservations" SET "state"='RELEASED',"releasedAt"=clock_timestamp()
    WHERE "workspaceId"=NEW."workspaceId" AND "id"=NEW."brokerEvidenceId" AND "state"='CLAIMED' AND "claimedDispatchId"=NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acp_bridge_dispatch_releases_broker AFTER UPDATE ON "acp_bridge_dispatches" FOR EACH ROW EXECUTE FUNCTION ventureos_release_broker_reservation();
