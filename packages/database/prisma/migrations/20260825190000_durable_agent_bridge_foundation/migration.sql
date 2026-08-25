CREATE TABLE "acp_runtimes" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "adapterKind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  "principalReference" TEXT NOT NULL,
  "secretReference" TEXT NOT NULL,
  "secretDigest" TEXT NOT NULL,
  "capabilityPolicyHash" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "acp_runtimes_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_runtimes_status_check" CHECK ("status" = 'NOT_CONFIGURED'),
  CONSTRAINT "acp_runtimes_adapter_check" CHECK ("adapterKind" IN ('PROTOCOL_NEUTRAL', 'DETERMINISTIC_FAKE')),
  CONSTRAINT "acp_runtimes_digest_check" CHECK ("secretDigest" ~ '^[a-f0-9]{64}$' AND "capabilityPolicyHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "acp_runtimes_version_check" CHECK ("version" > 0)
);

CREATE TABLE "acp_runtime_connections" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  "authGeneration" INTEGER NOT NULL DEFAULT 1,
  "capabilityCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "capabilityDigest" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastHeartbeatHealth" TEXT,
  "lastHeartbeatSequence" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "acp_runtime_connections_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_runtime_connections_status_check" CHECK ("status" IN ('NOT_CONFIGURED', 'PARTIAL', 'DEGRADED', 'DISCONNECTED')),
  CONSTRAINT "acp_runtime_connections_generation_check" CHECK ("authGeneration" > 0 AND "version" > 0),
  CONSTRAINT "acp_runtime_connections_capability_digest_check" CHECK ("capabilityDigest" IS NULL OR "capabilityDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "acp_runtime_connections_heartbeat_check" CHECK (("lastHeartbeatAt" IS NULL) = ("lastHeartbeatHealth" IS NULL) AND ("lastHeartbeatAt" IS NULL) = ("lastHeartbeatSequence" IS NULL))
);

CREATE TABLE "acp_bridge_sessions" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "principalReference" TEXT NOT NULL,
  "protocolVersion" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'CHALLENGED',
  "parentNonce" TEXT NOT NULL,
  "runtimeNonce" TEXT,
  "keyDigest" TEXT,
  "expectedSequence" INTEGER NOT NULL DEFAULT 1,
  "authenticatedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "acp_bridge_sessions_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_bridge_sessions_protocol_check" CHECK ("protocolVersion" = 'ventureos.bridge.v1'),
  CONSTRAINT "acp_bridge_sessions_state_check" CHECK ("state" IN ('CHALLENGED', 'AUTHENTICATED', 'CAPABILITIES_VERIFIED', 'PARTIAL', 'CLOSED')),
  CONSTRAINT "acp_bridge_sessions_nonce_check" CHECK ("parentNonce" ~ '^[A-Za-z0-9_-]{16,128}$' AND ("runtimeNonce" IS NULL OR "runtimeNonce" ~ '^[A-Za-z0-9_-]{16,128}$') AND ("keyDigest" IS NULL OR "keyDigest" ~ '^[a-f0-9]{64}$')),
  CONSTRAINT "acp_bridge_sessions_sequence_check" CHECK ("expectedSequence" > 0),
  CONSTRAINT "acp_bridge_sessions_auth_check" CHECK (("state" = 'CHALLENGED' AND "authenticatedAt" IS NULL) OR ("state" <> 'CHALLENGED' AND "authenticatedAt" IS NOT NULL)),
  CONSTRAINT "acp_bridge_sessions_close_check" CHECK (("state" = 'CLOSED') = ("closedAt" IS NOT NULL))
);

CREATE TABLE "acp_bridge_receipts" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "messageId" TEXT NOT NULL,
  "messageType" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "envelopeDigest" TEXT NOT NULL,
  "taskId" TEXT,
  "runId" TEXT,
  "dispatchId" TEXT,
  "evidenceId" TEXT,
  "evidenceHash" TEXT,
  "artifactId" TEXT,
  "criterion" TEXT,
  "artifactKind" TEXT,
  "uriReference" TEXT,
  "contentHash" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_bridge_receipts_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_bridge_receipts_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "acp_bridge_receipts_type_check" CHECK ("messageType" IN ('AUTHENTICATE', 'CAPABILITIES', 'HEARTBEAT', 'DISPATCH_ACCEPTED', 'PROGRESS', 'ARTIFACT', 'USAGE', 'CANCELLED', 'RESULT', 'FAILED')),
  CONSTRAINT "acp_bridge_receipts_digest_check" CHECK ("payloadDigest" ~ '^[a-f0-9]{64}$' AND "envelopeDigest" ~ '^[a-f0-9]{64}$' AND ("evidenceHash" IS NULL OR "evidenceHash" ~ '^[a-f0-9]{64}$') AND ("contentHash" IS NULL OR "contentHash" ~ '^[a-f0-9]{64}$')),
  CONSTRAINT "acp_bridge_receipts_artifact_check" CHECK ("messageType" <> 'ARTIFACT' OR ("taskId" IS NOT NULL AND "runId" IS NOT NULL AND "dispatchId" IS NOT NULL AND "evidenceId" IS NOT NULL AND "evidenceHash" IS NOT NULL AND "artifactId" IS NOT NULL AND "criterion" IS NOT NULL AND "artifactKind" IS NOT NULL AND "uriReference" IS NOT NULL AND "contentHash" IS NOT NULL))
);

CREATE TABLE "acp_bridge_dispatches" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "authorityLevel" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PREPARED',
  "brokerEvidenceId" TEXT NOT NULL,
  "brokerEvidenceHash" TEXT NOT NULL,
  "assignmentEvidenceHash" TEXT NOT NULL,
  "assignmentEvidenceId" TEXT NOT NULL,
  "dispatchEnvelopeHash" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "terminalAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "acp_bridge_dispatches_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_bridge_dispatches_authority_check" CHECK ("authorityLevel" BETWEEN 0 AND 3),
  CONSTRAINT "acp_bridge_dispatches_state_check" CHECK ("state" IN ('PREPARED', 'ACCEPTED', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', 'FAILED')),
  CONSTRAINT "acp_bridge_dispatches_digest_check" CHECK ("brokerEvidenceHash" ~ '^[a-f0-9]{64}$' AND "assignmentEvidenceHash" ~ '^[a-f0-9]{64}$' AND "dispatchEnvelopeHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "acp_bridge_dispatches_accept_check" CHECK (("state" = 'PREPARED' AND "acceptedAt" IS NULL) OR "state" = 'FAILED' OR ("state" IN ('ACCEPTED', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED') AND "acceptedAt" IS NOT NULL)),
  CONSTRAINT "acp_bridge_dispatches_terminal_check" CHECK (("state" IN ('CANCELLED', 'COMPLETED', 'FAILED')) = ("terminalAt" IS NOT NULL))
);

CREATE TABLE "acp_run_usages" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "computeUnits" BIGINT NOT NULL,
  "costMinorUnits" BIGINT NOT NULL,
  "cumulativeComputeUnits" BIGINT NOT NULL,
  "cumulativeCostMinorUnits" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_run_usages_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_run_usages_values_check" CHECK ("sequence" > 0 AND "computeUnits" >= 0 AND "costMinorUnits" >= 0 AND "cumulativeComputeUnits" >= 0 AND "cumulativeCostMinorUnits" >= 0),
  CONSTRAINT "acp_run_usages_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "acp_run_usages_digest_check" CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "acp_runtimes_workspaceId_principalReference_key" ON "acp_runtimes"("workspaceId", "principalReference");
CREATE UNIQUE INDEX "acp_runtimes_workspaceId_secretReference_key" ON "acp_runtimes"("workspaceId", "secretReference");
CREATE INDEX "acp_runtimes_workspaceId_status_idx" ON "acp_runtimes"("workspaceId", "status");
CREATE UNIQUE INDEX "acp_runtime_connections_workspaceId_runtimeId_environment_key" ON "acp_runtime_connections"("workspaceId", "runtimeId", "environment");
CREATE INDEX "acp_runtime_connections_workspaceId_runtimeId_status_idx" ON "acp_runtime_connections"("workspaceId", "runtimeId", "status");
CREATE INDEX "acp_bridge_sessions_workspaceId_connectionId_state_idx" ON "acp_bridge_sessions"("workspaceId", "connectionId", "state");
CREATE INDEX "acp_bridge_sessions_expiresAt_idx" ON "acp_bridge_sessions"("expiresAt");
CREATE UNIQUE INDEX "acp_bridge_receipts_workspaceId_sessionId_sequence_key" ON "acp_bridge_receipts"("workspaceId", "sessionId", "sequence");
CREATE UNIQUE INDEX "acp_bridge_receipts_workspaceId_sessionId_messageId_key" ON "acp_bridge_receipts"("workspaceId", "sessionId", "messageId");
CREATE UNIQUE INDEX "acp_bridge_receipts_workspaceId_evidenceId_key" ON "acp_bridge_receipts"("workspaceId", "evidenceId");
CREATE INDEX "acp_bridge_receipts_workspaceId_runId_messageType_idx" ON "acp_bridge_receipts"("workspaceId", "runId", "messageType");
CREATE UNIQUE INDEX "acp_bridge_dispatches_workspaceId_idempotencyKey_key" ON "acp_bridge_dispatches"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "acp_bridge_dispatches_workspaceId_runId_key" ON "acp_bridge_dispatches"("workspaceId", "runId");
CREATE INDEX "acp_bridge_dispatches_workspaceId_connectionId_state_idx" ON "acp_bridge_dispatches"("workspaceId", "connectionId", "state");
CREATE UNIQUE INDEX "acp_run_usages_workspaceId_receiptId_key" ON "acp_run_usages"("workspaceId", "receiptId");
CREATE UNIQUE INDEX "acp_run_usages_workspaceId_dispatchId_sequence_key" ON "acp_run_usages"("workspaceId", "dispatchId", "sequence");
CREATE INDEX "acp_run_usages_workspaceId_runId_recordedAt_idx" ON "acp_run_usages"("workspaceId", "runId", "recordedAt" DESC);

ALTER TABLE "acp_runtimes" ADD CONSTRAINT "acp_runtimes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_runtime_connections" ADD CONSTRAINT "acp_runtime_connections_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_runtime_connections" ADD CONSTRAINT "acp_runtime_connections_workspaceId_runtimeId_fkey" FOREIGN KEY ("workspaceId", "runtimeId") REFERENCES "acp_runtimes"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_sessions" ADD CONSTRAINT "acp_bridge_sessions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_sessions" ADD CONSTRAINT "acp_bridge_sessions_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "acp_runtime_connections"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_receipts" ADD CONSTRAINT "acp_bridge_receipts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_receipts" ADD CONSTRAINT "acp_bridge_receipts_workspaceId_sessionId_fkey" FOREIGN KEY ("workspaceId", "sessionId") REFERENCES "acp_bridge_sessions"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_dispatches" ADD CONSTRAINT "acp_bridge_dispatches_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_dispatches" ADD CONSTRAINT "acp_bridge_dispatches_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "acp_runs"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_dispatches" ADD CONSTRAINT "acp_bridge_dispatches_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "acp_runtime_connections"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_dispatches" ADD CONSTRAINT "acp_bridge_dispatches_workspaceId_sessionId_fkey" FOREIGN KEY ("workspaceId", "sessionId") REFERENCES "acp_bridge_sessions"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_run_usages" ADD CONSTRAINT "acp_run_usages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_run_usages" ADD CONSTRAINT "acp_run_usages_workspaceId_dispatchId_fkey" FOREIGN KEY ("workspaceId", "dispatchId") REFERENCES "acp_bridge_dispatches"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_run_usages" ADD CONSTRAINT "acp_run_usages_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "acp_runs"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_run_usages" ADD CONSTRAINT "acp_run_usages_workspaceId_receiptId_fkey" FOREIGN KEY ("workspaceId", "receiptId") REFERENCES "acp_bridge_receipts"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_validate_bridge_scope() RETURNS trigger AS $$
DECLARE connection_runtime TEXT; session_runtime TEXT; session_connection TEXT; run_task TEXT; run_objective TEXT; run_authority INTEGER; dispatch_session TEXT; dispatch_task TEXT; dispatch_run TEXT;
BEGIN
  IF TG_TABLE_NAME = 'acp_bridge_sessions' THEN
    SELECT "runtimeId" INTO connection_runtime FROM "acp_runtime_connections" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."connectionId";
    IF connection_runtime IS DISTINCT FROM NEW."runtimeId" THEN RAISE EXCEPTION 'bridge session runtime/connection scope mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'acp_bridge_receipts' THEN
    SELECT "runtimeId", "connectionId" INTO session_runtime, session_connection FROM "acp_bridge_sessions" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."sessionId";
    IF session_runtime IS DISTINCT FROM NEW."runtimeId" OR session_connection IS DISTINCT FROM NEW."connectionId" THEN RAISE EXCEPTION 'bridge receipt session scope mismatch'; END IF;
    IF NEW."dispatchId" IS NOT NULL THEN
      SELECT "sessionId", "taskId", "runId" INTO dispatch_session, dispatch_task, dispatch_run FROM "acp_bridge_dispatches" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."dispatchId";
      IF dispatch_session IS DISTINCT FROM NEW."sessionId" OR (NEW."taskId" IS NOT NULL AND dispatch_task IS DISTINCT FROM NEW."taskId") OR (NEW."runId" IS NOT NULL AND dispatch_run IS DISTINCT FROM NEW."runId") THEN RAISE EXCEPTION 'bridge receipt dispatch correlation mismatch'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'acp_bridge_dispatches' THEN
    SELECT "runtimeId", "connectionId" INTO session_runtime, session_connection FROM "acp_bridge_sessions" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."sessionId";
    SELECT "taskId", "objectiveId", "requiredAuthority" INTO run_task, run_objective, run_authority FROM "acp_runs" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."runId";
    IF session_runtime IS DISTINCT FROM NEW."runtimeId" OR session_connection IS DISTINCT FROM NEW."connectionId" OR run_task IS DISTINCT FROM NEW."taskId" OR run_objective IS DISTINCT FROM NEW."objectiveId" OR run_authority IS DISTINCT FROM NEW."authorityLevel" THEN RAISE EXCEPTION 'bridge dispatch scope mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acp_bridge_sessions_scope BEFORE INSERT OR UPDATE ON "acp_bridge_sessions" FOR EACH ROW EXECUTE FUNCTION ventureos_validate_bridge_scope();
CREATE TRIGGER acp_bridge_receipts_scope BEFORE INSERT OR UPDATE ON "acp_bridge_receipts" FOR EACH ROW EXECUTE FUNCTION ventureos_validate_bridge_scope();
CREATE TRIGGER acp_bridge_dispatches_scope BEFORE INSERT OR UPDATE ON "acp_bridge_dispatches" FOR EACH ROW EXECUTE FUNCTION ventureos_validate_bridge_scope();

CREATE OR REPLACE FUNCTION ventureos_reject_bridge_receipt_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bridge receipts are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_bridge_receipts_immutable BEFORE UPDATE ON "acp_bridge_receipts" FOR EACH ROW EXECUTE FUNCTION ventureos_reject_bridge_receipt_update();

CREATE OR REPLACE FUNCTION ventureos_validate_bridge_state_update() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'acp_bridge_sessions' THEN
    IF ROW(NEW."workspaceId", NEW."id", NEW."runtimeId", NEW."connectionId", NEW."principalReference", NEW."protocolVersion", NEW."parentNonce", NEW."expiresAt", NEW."createdAt") IS DISTINCT FROM ROW(OLD."workspaceId", OLD."id", OLD."runtimeId", OLD."connectionId", OLD."principalReference", OLD."protocolVersion", OLD."parentNonce", OLD."expiresAt", OLD."createdAt") THEN RAISE EXCEPTION 'bridge session binding is immutable'; END IF;
    IF NEW."expectedSequence" < OLD."expectedSequence" OR NEW."expectedSequence" > OLD."expectedSequence" + 1 THEN RAISE EXCEPTION 'bridge session sequence transition denied'; END IF;
    IF NEW."state" <> OLD."state" AND NOT ((OLD."state" = 'CHALLENGED' AND NEW."state" IN ('AUTHENTICATED', 'CLOSED')) OR (OLD."state" = 'AUTHENTICATED' AND NEW."state" IN ('CAPABILITIES_VERIFIED', 'CLOSED')) OR (OLD."state" = 'CAPABILITIES_VERIFIED' AND NEW."state" IN ('PARTIAL', 'CLOSED')) OR (OLD."state" = 'PARTIAL' AND NEW."state" = 'CLOSED')) THEN RAISE EXCEPTION 'bridge session state transition denied'; END IF;
    IF OLD."runtimeNonce" IS NOT NULL AND NEW."runtimeNonce" IS DISTINCT FROM OLD."runtimeNonce" THEN RAISE EXCEPTION 'bridge runtime nonce is immutable'; END IF;
    IF OLD."keyDigest" IS NOT NULL AND NEW."keyDigest" IS DISTINCT FROM OLD."keyDigest" THEN RAISE EXCEPTION 'bridge key digest is immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'acp_bridge_dispatches' THEN
    IF ROW(NEW."workspaceId", NEW."id", NEW."objectiveId", NEW."taskId", NEW."runId", NEW."runtimeId", NEW."connectionId", NEW."sessionId", NEW."agentId", NEW."authorityLevel", NEW."brokerEvidenceId", NEW."brokerEvidenceHash", NEW."assignmentEvidenceId", NEW."assignmentEvidenceHash", NEW."dispatchEnvelopeHash", NEW."idempotencyKey", NEW."createdAt") IS DISTINCT FROM ROW(OLD."workspaceId", OLD."id", OLD."objectiveId", OLD."taskId", OLD."runId", OLD."runtimeId", OLD."connectionId", OLD."sessionId", OLD."agentId", OLD."authorityLevel", OLD."brokerEvidenceId", OLD."brokerEvidenceHash", OLD."assignmentEvidenceId", OLD."assignmentEvidenceHash", OLD."dispatchEnvelopeHash", OLD."idempotencyKey", OLD."createdAt") THEN RAISE EXCEPTION 'bridge dispatch binding is immutable'; END IF;
    IF NEW."state" <> OLD."state" AND NOT ((OLD."state" = 'PREPARED' AND NEW."state" IN ('ACCEPTED', 'FAILED')) OR (OLD."state" = 'ACCEPTED' AND NEW."state" IN ('CANCEL_REQUESTED', 'COMPLETED', 'FAILED')) OR (OLD."state" = 'CANCEL_REQUESTED' AND NEW."state" IN ('CANCELLED', 'FAILED'))) THEN RAISE EXCEPTION 'bridge dispatch state transition denied'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_bridge_sessions_state BEFORE UPDATE ON "acp_bridge_sessions" FOR EACH ROW EXECUTE FUNCTION ventureos_validate_bridge_state_update();
CREATE TRIGGER acp_bridge_dispatches_state BEFORE UPDATE ON "acp_bridge_dispatches" FOR EACH ROW EXECUTE FUNCTION ventureos_validate_bridge_state_update();

CREATE OR REPLACE FUNCTION ventureos_validate_bridge_usage() RETURNS trigger AS $$
DECLARE prior_compute BIGINT; prior_cost BIGINT; prior_currency TEXT;
BEGIN
  SELECT "cumulativeComputeUnits", "cumulativeCostMinorUnits", "currency"
  INTO prior_compute, prior_cost, prior_currency
  FROM "acp_run_usages"
  WHERE "workspaceId" = NEW."workspaceId" AND "dispatchId" = NEW."dispatchId"
  ORDER BY "sequence" DESC LIMIT 1;
  IF prior_compute IS NULL THEN prior_compute := 0; prior_cost := 0; prior_currency := NEW."currency"; END IF;
  IF NEW."currency" <> prior_currency OR NEW."cumulativeComputeUnits" <> prior_compute + NEW."computeUnits" OR NEW."cumulativeCostMinorUnits" <> prior_cost + NEW."costMinorUnits" THEN
    RAISE EXCEPTION 'bridge usage is not monotonic';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_run_usages_monotonic BEFORE INSERT ON "acp_run_usages" FOR EACH ROW EXECUTE FUNCTION ventureos_validate_bridge_usage();
CREATE TRIGGER acp_run_usages_immutable BEFORE UPDATE ON "acp_run_usages" FOR EACH ROW EXECUTE FUNCTION ventureos_reject_bridge_receipt_update();
