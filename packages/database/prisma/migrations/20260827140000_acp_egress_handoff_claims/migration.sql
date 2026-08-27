CREATE OR REPLACE FUNCTION ventureos_egress_safe_reference(value TEXT) RETURNS BOOLEAN AS $$
  SELECT value ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
    lower(value) !~ '(chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret|token)' AND
    value !~ '(^|[^A-Za-z0-9_])(sk|gh[opusr]|github_pat|npm|glpat|xox[baprs]|hf)[-_][A-Za-z0-9_-]{12,}' AND
    value !~ '(^|[^A-Za-z0-9_])AKIA[0-9A-Z]{16}($|[^A-Za-z0-9_])' AND
    value !~ '(^|[^A-Za-z0-9_])AIza[A-Za-z0-9_-]{20,}' AND
    value !~ '(^|[^A-Za-z0-9_])eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}($|[^A-Za-z0-9_])' AND
    value !~ '^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$';
$$ LANGUAGE sql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION ventureos_egress_safe_owner_reference(value TEXT) RETURNS BOOLEAN AS $$
  SELECT ventureos_egress_safe_reference(value) AND
    value ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$';
$$ LANGUAGE sql IMMUTABLE STRICT;

CREATE TABLE "acp_bridge_egress_handoff_attempts" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "outboxId" TEXT NOT NULL,
  "ownerReference" TEXT NOT NULL,
  "ownerActorKind" TEXT NOT NULL,
  "claimIdempotencyKey" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
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
  "messageType" TEXT NOT NULL,
  "protocolVersion" TEXT NOT NULL,
  "outboxState" TEXT NOT NULL,
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
  "outboxIdempotencyKey" TEXT NOT NULL,
  "outboxIssuedAt" TIMESTAMPTZ(3) NOT NULL,
  "outboxExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "outboxPreparedAt" TIMESTAMPTZ(3) NOT NULL,
  "claimedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "acp_bridge_egress_handoff_attempts_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_bridge_egress_handoff_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "acp_bridge_egress_handoff_owner_kind_check" CHECK ("ownerActorKind" IN ('HUMAN', 'AGENT', 'SYSTEM')),
  CONSTRAINT "acp_bridge_egress_handoff_kind_check" CHECK (
    "messageType" = 'DISPATCH' AND "protocolVersion" = 'ventureos.bridge.v1' AND
    "outboxState" = 'PREPARED' AND "authorityLevel" BETWEEN 0 AND 3 AND
    "outboundSequence" > 0
  ),
  CONSTRAINT "acp_bridge_egress_handoff_time_check" CHECK (
    "expiresAt" > "claimedAt" AND "expiresAt" <= "claimedAt" + INTERVAL '15 seconds' AND
    "expiresAt" <= "outboxExpiresAt"
  ),
  CONSTRAINT "acp_bridge_egress_handoff_reference_check" CHECK (
    ventureos_egress_safe_owner_reference("id") AND ventureos_egress_safe_reference("outboxId") AND
    ventureos_egress_safe_owner_reference("ownerReference") AND ventureos_egress_safe_reference("claimIdempotencyKey") AND
    ventureos_egress_safe_reference("runtimeId") AND ventureos_egress_safe_reference("connectionId") AND
    ventureos_egress_safe_reference("sessionId") AND ventureos_egress_safe_reference("dispatchId") AND
    ventureos_egress_safe_reference("taskId") AND ventureos_egress_safe_reference("runId") AND
    ventureos_egress_safe_reference("agentId") AND ventureos_egress_safe_reference("messageId") AND
    ventureos_egress_safe_reference("brokerEvidenceId") AND ventureos_egress_safe_reference("assignmentEvidenceId") AND
    ventureos_egress_safe_reference("outboxIdempotencyKey")
  ),
  CONSTRAINT "acp_bridge_egress_handoff_digest_check" CHECK (
    "brokerEvidenceHash" ~ '^[a-f0-9]{64}$' AND "assignmentEvidenceHash" ~ '^[a-f0-9]{64}$' AND
    "dispatchEnvelopeHash" ~ '^[a-f0-9]{64}$' AND "policyHash" ~ '^[a-f0-9]{64}$' AND
    "capabilityPolicyHash" ~ '^[a-f0-9]{64}$' AND "capabilityDigest" ~ '^[a-f0-9]{64}$' AND
    "payloadDigest" ~ '^[a-f0-9]{64}$' AND "unsignedEnvelopeDigest" ~ '^[a-f0-9]{64}$' AND
    "signedEnvelopeDigest" ~ '^[a-f0-9]{64}$' AND "authenticationTagDigest" ~ '^[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX "acp_egress_handoff_claim_key"
  ON "acp_bridge_egress_handoff_attempts"("workspaceId", "claimIdempotencyKey");
CREATE UNIQUE INDEX "acp_egress_handoff_generation_key"
  ON "acp_bridge_egress_handoff_attempts"("workspaceId", "outboxId", "generation");
CREATE INDEX "acp_bridge_egress_handoff_active_idx"
  ON "acp_bridge_egress_handoff_attempts"("workspaceId", "outboxId", "expiresAt");

ALTER TABLE "acp_bridge_egress_handoff_attempts"
  ADD CONSTRAINT "acp_bridge_egress_handoff_workspace_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_egress_handoff_attempts"
  ADD CONSTRAINT "acp_bridge_egress_handoff_outbox_fkey"
  FOREIGN KEY ("workspaceId", "outboxId")
  REFERENCES "acp_bridge_dispatch_outbox"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "acp_bridge_egress_handoff_releases" (
  "id" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "attemptId" TEXT NOT NULL,
  "outboxId" TEXT NOT NULL,
  "ownerReference" TEXT NOT NULL,
  "ownerActorKind" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "releaseIdempotencyKey" TEXT NOT NULL,
  "releasedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "acp_bridge_egress_handoff_releases_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_bridge_egress_handoff_release_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "acp_bridge_egress_handoff_release_owner_kind_check" CHECK ("ownerActorKind" IN ('HUMAN', 'AGENT', 'SYSTEM')),
  CONSTRAINT "acp_bridge_egress_handoff_release_reference_check" CHECK (
    ventureos_egress_safe_owner_reference("id") AND ventureos_egress_safe_owner_reference("attemptId") AND
    ventureos_egress_safe_reference("outboxId") AND ventureos_egress_safe_owner_reference("ownerReference") AND
    ventureos_egress_safe_reference("releaseIdempotencyKey")
  )
);
CREATE UNIQUE INDEX "acp_egress_release_attempt_key"
  ON "acp_bridge_egress_handoff_releases"("workspaceId", "attemptId");
CREATE UNIQUE INDEX "acp_egress_release_idempotency_key"
  ON "acp_bridge_egress_handoff_releases"("workspaceId", "releaseIdempotencyKey");
ALTER TABLE "acp_bridge_egress_handoff_releases"
  ADD CONSTRAINT "acp_bridge_egress_handoff_release_workspace_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_bridge_egress_handoff_releases"
  ADD CONSTRAINT "acp_bridge_egress_handoff_release_attempt_fkey"
  FOREIGN KEY ("workspaceId", "attemptId")
  REFERENCES "acp_bridge_egress_handoff_attempts"("workspaceId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_validate_egress_handoff_insert() RETURNS trigger AS $$
DECLARE
  db_now TIMESTAMPTZ;
  db_utc TIMESTAMP;
  expected_generation INTEGER;
  source_row "acp_bridge_dispatch_outbox"%ROWTYPE;
  session_state TEXT;
  session_expires TIMESTAMP;
  connection_state TEXT;
  heartbeat_health TEXT;
  heartbeat_at TIMESTAMP;
  connection_capability_digest TEXT;
  runtime_capability_policy TEXT;
  dispatch_state TEXT;
  run_state TEXT;
  run_authority INTEGER;
  run_policy TEXT;
  task_state TEXT;
  reservation_state TEXT;
  reservation_dispatch TEXT;
BEGIN
  -- This order is shared with the service and inbound/outbox paths.
  PERFORM 1 FROM "acp_bridge_sessions" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."sessionId" FOR UPDATE;
  PERFORM 1 FROM "acp_runtime_connections" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."connectionId" FOR UPDATE;
  PERFORM 1 FROM "acp_bridge_dispatches" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."dispatchId" FOR UPDATE;
  PERFORM 1 FROM "acp_runs" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."runId" FOR UPDATE;
  PERFORM 1 FROM "acp_tasks" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."taskId" FOR UPDATE;
  PERFORM 1 FROM "acp_runtimes" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."runtimeId" FOR UPDATE;
  PERFORM 1 FROM "acp_broker_reservations" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."brokerEvidenceId" FOR UPDATE;
  SELECT * INTO source_row FROM "acp_bridge_dispatch_outbox"
    WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."outboxId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'egress handoff outbox is unavailable'; END IF;

  db_now := clock_timestamp();
  db_utc := db_now AT TIME ZONE 'UTC';
  IF NEW."claimedAt" > db_now OR NEW."claimedAt" < db_now - INTERVAL '5 seconds' OR NEW."expiresAt" <= db_now THEN
    RAISE EXCEPTION 'egress handoff requires a fresh database clock';
  END IF;
  IF NEW."expiresAt" > source_row."expiresAt" OR NEW."expiresAt" > NEW."claimedAt" + INTERVAL '15 seconds' THEN
    RAISE EXCEPTION 'egress handoff expiry exceeds its durable authorization';
  END IF;

  IF ROW(
    NEW."workspaceId", NEW."runtimeId", NEW."connectionId", NEW."sessionId", NEW."dispatchId",
    NEW."taskId", NEW."runId", NEW."agentId", NEW."authorityLevel", NEW."outboundSequence",
    NEW."messageId", NEW."messageType", NEW."protocolVersion", NEW."outboxState",
    NEW."brokerEvidenceId", NEW."brokerEvidenceHash", NEW."assignmentEvidenceId",
    NEW."assignmentEvidenceHash", NEW."dispatchEnvelopeHash", NEW."policyHash",
    NEW."capabilityPolicyHash", NEW."capabilityDigest", NEW."payloadDigest",
    NEW."unsignedEnvelopeDigest", NEW."signedEnvelopeDigest", NEW."authenticationTagDigest",
    NEW."outboxIdempotencyKey", NEW."outboxIssuedAt", NEW."outboxExpiresAt", NEW."outboxPreparedAt"
  ) IS DISTINCT FROM ROW(
    source_row."workspaceId", source_row."runtimeId", source_row."connectionId", source_row."sessionId", source_row."dispatchId",
    source_row."taskId", source_row."runId", source_row."agentId", source_row."authorityLevel", source_row."outboundSequence",
    source_row."messageId", source_row."messageType", source_row."protocolVersion", source_row."state",
    source_row."brokerEvidenceId", source_row."brokerEvidenceHash", source_row."assignmentEvidenceId",
    source_row."assignmentEvidenceHash", source_row."dispatchEnvelopeHash", source_row."policyHash",
    source_row."capabilityPolicyHash", source_row."capabilityDigest", source_row."payloadDigest",
    source_row."unsignedEnvelopeDigest", source_row."signedEnvelopeDigest", source_row."authenticationTagDigest",
    source_row."idempotencyKey", source_row."issuedAt", source_row."expiresAt", source_row."preparedAt"
  ) THEN
    RAISE EXCEPTION 'egress handoff durable binding mismatch';
  END IF;

  SELECT s."state", s."expiresAt", c."status", c."lastHeartbeatHealth", c."lastHeartbeatAt",
         c."capabilityDigest", rt."capabilityPolicyHash"
    INTO session_state, session_expires, connection_state, heartbeat_health, heartbeat_at,
         connection_capability_digest, runtime_capability_policy
  FROM "acp_bridge_sessions" s JOIN "acp_runtime_connections" c
    ON c."workspaceId" = s."workspaceId" AND c."id" = s."connectionId"
  JOIN "acp_runtimes" rt ON rt."workspaceId" = c."workspaceId" AND rt."id" = c."runtimeId"
  WHERE s."workspaceId" = NEW."workspaceId" AND s."id" = NEW."sessionId";
  SELECT d."state", r."status", r."requiredAuthority", r."policyHash", t."status"
    INTO dispatch_state, run_state, run_authority, run_policy, task_state
  FROM "acp_bridge_dispatches" d JOIN "acp_runs" r ON r."workspaceId" = d."workspaceId" AND r."id" = d."runId"
  JOIN "acp_tasks" t ON t."workspaceId" = r."workspaceId" AND t."id" = r."taskId"
  WHERE d."workspaceId" = NEW."workspaceId" AND d."id" = NEW."dispatchId";
  SELECT "state", "claimedDispatchId" INTO reservation_state, reservation_dispatch
  FROM "acp_broker_reservations" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."brokerEvidenceId";

  IF session_state IS DISTINCT FROM 'PARTIAL' OR session_expires <= db_utc OR
     connection_state IS DISTINCT FROM 'PARTIAL' OR heartbeat_health IS DISTINCT FROM 'HEALTHY' OR
     heartbeat_at IS NULL OR heartbeat_at < db_utc - INTERVAL '60 seconds' OR
     dispatch_state IS DISTINCT FROM 'PREPARED' OR run_state IS DISTINCT FROM 'PREPARED' OR
     task_state IS DISTINCT FROM 'READY' OR run_authority IS DISTINCT FROM NEW."authorityLevel" OR
     run_policy IS DISTINCT FROM NEW."policyHash" OR
     runtime_capability_policy IS DISTINCT FROM NEW."capabilityPolicyHash" OR
     connection_capability_digest IS DISTINCT FROM NEW."capabilityDigest" OR
     run_authority >= 4 OR reservation_state IS DISTINCT FROM 'CLAIMED' OR
     reservation_dispatch IS DISTINCT FROM NEW."dispatchId" OR source_row."state" <> 'PREPARED' OR
     source_row."expiresAt" <= db_now THEN
    RAISE EXCEPTION 'egress handoff requires live prepared durable authority';
  END IF;
  IF NEW."expiresAt" > (session_expires AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'egress handoff exceeds session expiry';
  END IF;
  IF EXISTS (SELECT 1 FROM "acp_bridge_egress_handoff_attempts" a
    WHERE a."workspaceId" = NEW."workspaceId" AND a."outboxId" = NEW."outboxId" AND a."expiresAt" > db_now
      AND NOT EXISTS (SELECT 1 FROM "acp_bridge_egress_handoff_releases" r
        WHERE r."workspaceId" = a."workspaceId" AND r."attemptId" = a."id")) THEN
    RAISE EXCEPTION 'egress handoff is already exclusively claimed';
  END IF;
  SELECT COALESCE(MAX("generation"), 0) + 1 INTO expected_generation
  FROM "acp_bridge_egress_handoff_attempts" WHERE "workspaceId" = NEW."workspaceId" AND "outboxId" = NEW."outboxId";
  IF NEW."generation" <> expected_generation THEN RAISE EXCEPTION 'egress handoff generation mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acp_bridge_egress_handoff_insert_guard
  BEFORE INSERT ON "acp_bridge_egress_handoff_attempts"
  FOR EACH ROW EXECUTE FUNCTION ventureos_validate_egress_handoff_insert();

CREATE OR REPLACE FUNCTION ventureos_reject_egress_handoff_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = OLD."workspaceId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'egress handoff attempt metadata is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acp_bridge_egress_handoff_immutable
  BEFORE UPDATE OR DELETE ON "acp_bridge_egress_handoff_attempts"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_egress_handoff_mutation();

CREATE OR REPLACE FUNCTION ventureos_validate_egress_handoff_release_insert() RETURNS trigger AS $$
DECLARE
  attempt_row "acp_bridge_egress_handoff_attempts"%ROWTYPE;
  db_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO attempt_row FROM "acp_bridge_egress_handoff_attempts"
    WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."attemptId";
  IF NOT FOUND THEN RAISE EXCEPTION 'egress handoff release attempt is unavailable'; END IF;

  PERFORM 1 FROM "acp_bridge_sessions" WHERE "workspaceId" = NEW."workspaceId" AND "id" = attempt_row."sessionId" FOR UPDATE;
  PERFORM 1 FROM "acp_runtime_connections" WHERE "workspaceId" = NEW."workspaceId" AND "id" = attempt_row."connectionId" FOR UPDATE;
  PERFORM 1 FROM "acp_bridge_dispatches" WHERE "workspaceId" = NEW."workspaceId" AND "id" = attempt_row."dispatchId" FOR UPDATE;
  PERFORM 1 FROM "acp_runs" WHERE "workspaceId" = NEW."workspaceId" AND "id" = attempt_row."runId" FOR UPDATE;
  PERFORM 1 FROM "acp_tasks" WHERE "workspaceId" = NEW."workspaceId" AND "id" = attempt_row."taskId" FOR UPDATE;
  PERFORM 1 FROM "acp_runtimes" WHERE "workspaceId" = NEW."workspaceId" AND "id" = attempt_row."runtimeId" FOR UPDATE;
  PERFORM 1 FROM "acp_broker_reservations" WHERE "workspaceId" = NEW."workspaceId" AND "id" = attempt_row."brokerEvidenceId" FOR UPDATE;
  PERFORM 1 FROM "acp_bridge_dispatch_outbox" WHERE "workspaceId" = NEW."workspaceId" AND "id" = attempt_row."outboxId" FOR UPDATE;
  SELECT * INTO attempt_row FROM "acp_bridge_egress_handoff_attempts"
    WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."attemptId" FOR UPDATE;

  db_now := clock_timestamp();
  IF ROW(NEW."workspaceId", NEW."outboxId", NEW."ownerReference", NEW."ownerActorKind", NEW."generation") IS DISTINCT FROM
     ROW(attempt_row."workspaceId", attempt_row."outboxId", attempt_row."ownerReference", attempt_row."ownerActorKind", attempt_row."generation") THEN
    RAISE EXCEPTION 'egress handoff release binding mismatch';
  END IF;
  IF NEW."releasedAt" > db_now OR NEW."releasedAt" < db_now - INTERVAL '5 seconds' OR
     NEW."releasedAt" >= attempt_row."expiresAt" THEN
    RAISE EXCEPTION 'egress handoff release requires a live database clock';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acp_bridge_egress_handoff_release_insert_guard
  BEFORE INSERT ON "acp_bridge_egress_handoff_releases"
  FOR EACH ROW EXECUTE FUNCTION ventureos_validate_egress_handoff_release_insert();

CREATE TRIGGER acp_bridge_egress_handoff_release_immutable
  BEFORE UPDATE OR DELETE ON "acp_bridge_egress_handoff_releases"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_egress_handoff_mutation();
