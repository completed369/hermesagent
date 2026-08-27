CREATE UNIQUE INDEX "acp_bridge_sessions_outbox_binding_key"
  ON "acp_bridge_sessions"("workspaceId", "id", "runtimeId", "connectionId");

CREATE UNIQUE INDEX "acp_bridge_dispatches_outbox_binding_key"
  ON "acp_bridge_dispatches"(
    "workspaceId", "id", "runId", "taskId", "runtimeId", "connectionId", "sessionId",
    "agentId", "authorityLevel", "brokerEvidenceId", "brokerEvidenceHash",
    "assignmentEvidenceId", "assignmentEvidenceHash", "dispatchEnvelopeHash"
  );

CREATE TABLE "acp_bridge_dispatch_outbox" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "authorityLevel" INTEGER NOT NULL,
  "outboundSequence" INTEGER NOT NULL,
  "messageId" TEXT NOT NULL,
  "messageType" TEXT NOT NULL DEFAULT 'DISPATCH',
  "protocolVersion" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PREPARED',
  "brokerEvidenceId" TEXT NOT NULL,
  "brokerEvidenceHash" TEXT NOT NULL,
  "assignmentEvidenceId" TEXT NOT NULL,
  "assignmentEvidenceHash" TEXT NOT NULL,
  "dispatchEnvelopeHash" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "capabilityPolicyHash" TEXT NOT NULL,
  "capabilityDigest" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "unsignedEnvelopeDigest" TEXT NOT NULL,
  "signedEnvelopeDigest" TEXT NOT NULL,
  "authenticationTagDigest" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "preparedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "acp_bridge_dispatch_outbox_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_bridge_dispatch_outbox_authority_check" CHECK ("authorityLevel" BETWEEN 0 AND 3),
  CONSTRAINT "acp_bridge_dispatch_outbox_sequence_check" CHECK ("outboundSequence" > 0),
  CONSTRAINT "acp_bridge_dispatch_outbox_kind_check" CHECK (
    "messageType" = 'DISPATCH' AND
    "protocolVersion" = 'ventureos.bridge.v1' AND
    "state" = 'PREPARED'
  ),
  CONSTRAINT "acp_bridge_dispatch_outbox_time_check" CHECK (
    "preparedAt" = "issuedAt" AND "expiresAt" > "issuedAt" AND
    "expiresAt" <= "issuedAt" + INTERVAL '60 seconds'
  ),
  CONSTRAINT "acp_bridge_dispatch_outbox_digest_check" CHECK (
    "brokerEvidenceHash" ~ '^[a-f0-9]{64}$' AND
    "assignmentEvidenceHash" ~ '^[a-f0-9]{64}$' AND
    "dispatchEnvelopeHash" ~ '^[a-f0-9]{64}$' AND
    "policyHash" ~ '^[a-f0-9]{64}$' AND
    "capabilityPolicyHash" ~ '^[a-f0-9]{64}$' AND
    "capabilityDigest" ~ '^[a-f0-9]{64}$' AND
    "payloadDigest" ~ '^[a-f0-9]{64}$' AND
    "unsignedEnvelopeDigest" ~ '^[a-f0-9]{64}$' AND
    "signedEnvelopeDigest" ~ '^[a-f0-9]{64}$' AND
    "authenticationTagDigest" ~ '^[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX "acp_bridge_dispatch_outbox_workspaceId_dispatchId_key"
  ON "acp_bridge_dispatch_outbox"("workspaceId", "dispatchId");
CREATE UNIQUE INDEX "acp_bridge_dispatch_outbox_workspaceId_idempotencyKey_key"
  ON "acp_bridge_dispatch_outbox"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "acp_bridge_dispatch_outbox_workspaceId_sessionId_outboundSequence_key"
  ON "acp_bridge_dispatch_outbox"("workspaceId", "sessionId", "outboundSequence");
CREATE UNIQUE INDEX "acp_bridge_dispatch_outbox_workspaceId_sessionId_messageId_key"
  ON "acp_bridge_dispatch_outbox"("workspaceId", "sessionId", "messageId");
CREATE INDEX "acp_bridge_dispatch_outbox_connection_idx"
  ON "acp_bridge_dispatch_outbox"("workspaceId", "connectionId", "state");

ALTER TABLE "acp_bridge_dispatch_outbox"
  ADD CONSTRAINT "acp_bridge_dispatch_outbox_workspace_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_dispatch_outbox"
  ADD CONSTRAINT "acp_bridge_dispatch_outbox_session_fkey"
  FOREIGN KEY ("workspaceId", "sessionId", "runtimeId", "connectionId")
  REFERENCES "acp_bridge_sessions"("workspaceId", "id", "runtimeId", "connectionId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_dispatch_outbox"
  ADD CONSTRAINT "acp_bridge_dispatch_outbox_connection_fkey"
  FOREIGN KEY ("workspaceId", "connectionId", "runtimeId")
  REFERENCES "acp_runtime_connections"("workspaceId", "id", "runtimeId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_dispatch_outbox"
  ADD CONSTRAINT "acp_bridge_dispatch_outbox_dispatch_fkey"
  FOREIGN KEY (
    "workspaceId", "dispatchId", "runId", "taskId", "runtimeId", "connectionId", "sessionId",
    "agentId", "authorityLevel", "brokerEvidenceId", "brokerEvidenceHash",
    "assignmentEvidenceId", "assignmentEvidenceHash", "dispatchEnvelopeHash"
  ) REFERENCES "acp_bridge_dispatches"(
    "workspaceId", "id", "runId", "taskId", "runtimeId", "connectionId", "sessionId",
    "agentId", "authorityLevel", "brokerEvidenceId", "brokerEvidenceHash",
    "assignmentEvidenceId", "assignmentEvidenceHash", "dispatchEnvelopeHash"
  ) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_validate_dispatch_outbox_insert() RETURNS trigger AS $$
DECLARE
  db_now TIMESTAMPTZ;
  db_utc TIMESTAMP;
  expected_sequence INTEGER;
  session_state TEXT;
  session_expires TIMESTAMP;
  connection_state TEXT;
  heartbeat_health TEXT;
  heartbeat_at TIMESTAMP;
  runtime_capability_policy TEXT;
  connection_capability_digest TEXT;
  dispatch_state TEXT;
  run_state TEXT;
  run_policy TEXT;
  run_authority INTEGER;
  task_state TEXT;
  reservation_state TEXT;
  reservation_dispatch TEXT;
BEGIN
  PERFORM 1 FROM "acp_bridge_sessions"
    WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."sessionId" FOR UPDATE;
  PERFORM 1 FROM "acp_runtime_connections"
    WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."connectionId" FOR UPDATE;
  PERFORM 1 FROM "acp_bridge_dispatches"
    WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."dispatchId" FOR UPDATE;
  PERFORM 1 FROM "acp_runs"
    WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."runId" FOR UPDATE;
  PERFORM 1 FROM "acp_tasks"
    WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."taskId" FOR UPDATE;
  PERFORM 1 FROM "acp_runtimes"
    WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."runtimeId" FOR UPDATE;
  PERFORM 1 FROM "acp_broker_reservations"
    WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."brokerEvidenceId" FOR UPDATE;

  db_now := clock_timestamp();
  db_utc := db_now AT TIME ZONE 'UTC';
  IF NEW."issuedAt" > db_now OR NEW."issuedAt" < db_now - INTERVAL '5 seconds' OR NEW."expiresAt" <= db_now THEN
    RAISE EXCEPTION 'dispatch authorization requires a fresh database clock';
  END IF;

  SELECT s."state", s."expiresAt",
         c."status", c."lastHeartbeatHealth", c."lastHeartbeatAt", c."capabilityDigest",
         r."capabilityPolicyHash"
    INTO session_state, session_expires,
         connection_state, heartbeat_health, heartbeat_at, connection_capability_digest,
         runtime_capability_policy
  FROM "acp_bridge_sessions" s
  JOIN "acp_runtime_connections" c
    ON c."workspaceId" = s."workspaceId" AND c."id" = s."connectionId"
  JOIN "acp_runtimes" r
    ON r."workspaceId" = c."workspaceId" AND r."id" = c."runtimeId"
  WHERE s."workspaceId" = NEW."workspaceId" AND s."id" = NEW."sessionId";

  SELECT d."state", r."status", r."policyHash", r."requiredAuthority", t."status"
    INTO dispatch_state, run_state, run_policy, run_authority, task_state
  FROM "acp_bridge_dispatches" d
  JOIN "acp_runs" r ON r."workspaceId" = d."workspaceId" AND r."id" = d."runId"
  JOIN "acp_tasks" t ON t."workspaceId" = r."workspaceId" AND t."id" = r."taskId"
  WHERE d."workspaceId" = NEW."workspaceId" AND d."id" = NEW."dispatchId";

  SELECT "state", "claimedDispatchId"
    INTO reservation_state, reservation_dispatch
  FROM "acp_broker_reservations"
  WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."brokerEvidenceId";

  IF session_state IS DISTINCT FROM 'PARTIAL' OR session_expires <= db_utc OR
     connection_state IS DISTINCT FROM 'PARTIAL' OR heartbeat_health IS DISTINCT FROM 'HEALTHY' OR
     heartbeat_at IS NULL OR heartbeat_at < db_utc - INTERVAL '60 seconds' THEN
    RAISE EXCEPTION 'dispatch authorization requires fresh partial bridge evidence';
  END IF;
  IF runtime_capability_policy IS DISTINCT FROM NEW."capabilityPolicyHash" OR
     connection_capability_digest IS DISTINCT FROM NEW."capabilityDigest" THEN
    RAISE EXCEPTION 'dispatch authorization capability policy snapshot mismatch';
  END IF;
  IF dispatch_state IS DISTINCT FROM 'PREPARED' OR run_state IS DISTINCT FROM 'PREPARED' OR
     task_state IS DISTINCT FROM 'READY' OR run_authority IS DISTINCT FROM NEW."authorityLevel" OR
     run_authority >= 4 OR run_policy IS DISTINCT FROM NEW."policyHash" THEN
    RAISE EXCEPTION 'dispatch authorization durable state mismatch';
  END IF;
  IF reservation_state IS DISTINCT FROM 'CLAIMED' OR
     reservation_dispatch IS DISTINCT FROM NEW."dispatchId" THEN
    RAISE EXCEPTION 'dispatch authorization requires an active claimed reservation';
  END IF;
  IF NEW."expiresAt" > (session_expires AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'dispatch authorization exceeds session expiry';
  END IF;

  SELECT COALESCE(MAX("outboundSequence"), 0) + 1 INTO expected_sequence
  FROM "acp_bridge_dispatch_outbox"
  WHERE "workspaceId" = NEW."workspaceId" AND "sessionId" = NEW."sessionId";
  IF NEW."outboundSequence" <> expected_sequence THEN
    RAISE EXCEPTION 'dispatch authorization outbound sequence mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acp_bridge_dispatch_outbox_insert_guard
  BEFORE INSERT ON "acp_bridge_dispatch_outbox"
  FOR EACH ROW EXECUTE FUNCTION ventureos_validate_dispatch_outbox_insert();

CREATE OR REPLACE FUNCTION ventureos_reject_dispatch_outbox_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM "workspaces" WHERE "id" = OLD."workspaceId"
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'dispatch authorization metadata is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acp_bridge_dispatch_outbox_immutable
  BEFORE UPDATE OR DELETE ON "acp_bridge_dispatch_outbox"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_dispatch_outbox_mutation();
