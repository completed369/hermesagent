CREATE UNIQUE INDEX "acp_codex_validation_egress_handoff_round_trip_binding_key"
  ON "acp_codex_validation_egress_handoff_attempts"(
    "workspaceId", "id", "validationDispatchCandidateHash", "heartbeatCandidateHash",
    "runtimeId", "connectionId", "sessionId", "dispatchId", "taskId", "runId",
    "agentId", "authorityLevel", "taskPolicyHash", "maximumCostMinorUnits"
  );

CREATE TABLE "acp_codex_validation_round_trip_evidence" (
  "workspaceId" UUID NOT NULL,
  "roundTripCandidateHash" TEXT NOT NULL,
  "handoffAttemptId" TEXT NOT NULL,
  "validationDispatchCandidateHash" TEXT NOT NULL,
  "heartbeatCandidateHash" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "principalReference" TEXT NOT NULL,
  "adapterKind" TEXT NOT NULL,
  "authGeneration" INTEGER NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "authorityLevel" INTEGER NOT NULL,
  "taskPolicyHash" TEXT NOT NULL,
  "maximumCostMinorUnits" INTEGER NOT NULL,
  "statusSequence" INTEGER NOT NULL,
  "statusMessageId" TEXT NOT NULL,
  "statusPayloadDigest" TEXT NOT NULL,
  "statusEnvelopeDigest" TEXT NOT NULL,
  "statusAuthenticationTagDigest" TEXT NOT NULL,
  "statusIssuedAt" TIMESTAMP(3) NOT NULL,
  "statusExpiresAt" TIMESTAMP(3) NOT NULL,
  "terminalSequence" INTEGER NOT NULL,
  "terminalMessageId" TEXT NOT NULL,
  "terminalThreadId" TEXT NOT NULL,
  "terminalTurnId" TEXT NOT NULL,
  "terminalMessageHash" TEXT NOT NULL,
  "terminalPayloadDigest" TEXT NOT NULL,
  "terminalEnvelopeDigest" TEXT NOT NULL,
  "terminalAuthenticationTagDigest" TEXT NOT NULL,
  "terminalIssuedAt" TIMESTAMP(3) NOT NULL,
  "terminalExpiresAt" TIMESTAMP(3) NOT NULL,
  "resultCode" TEXT NOT NULL,
  "statusState" TEXT NOT NULL,
  "terminalState" TEXT NOT NULL,
  "providerAccess" TEXT NOT NULL,
  "runtimeConnection" TEXT NOT NULL,
  "connectionTransition" TEXT NOT NULL,
  "roundTripIdempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_codex_validation_round_trip_evidence_pkey"
    PRIMARY KEY ("workspaceId", "roundTripCandidateHash"),
  CONSTRAINT "acp_codex_validation_round_trip_kind_check"
    CHECK (
      "adapterKind" = 'CODEX_APP_SERVER_STDIO_V1' AND
      "authGeneration" = 1 AND
      "authorityLevel" BETWEEN 0 AND 3 AND
      "maximumCostMinorUnits" = 0 AND
      "statusSequence" = 2 AND "terminalSequence" = 3 AND
      "resultCode" = 'VALIDATION_COMPLETED' AND
      "statusState" = 'ACCEPTED' AND "terminalState" = 'COMPLETED' AND
      "providerAccess" = 'NOT_CONFIGURED' AND
      "runtimeConnection" = 'NOT_CONFIGURED' AND
      "connectionTransition" = 'NOT_APPLIED' AND
      "statusMessageId" <> "terminalMessageId"
    ),
  CONSTRAINT "acp_codex_validation_round_trip_digest_check"
    CHECK (
      "roundTripCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "validationDispatchCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "heartbeatCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "taskPolicyHash" ~ '^[a-f0-9]{64}$' AND
      "statusPayloadDigest" ~ '^[a-f0-9]{64}$' AND
      "statusEnvelopeDigest" ~ '^[a-f0-9]{64}$' AND
      "statusAuthenticationTagDigest" ~ '^[a-f0-9]{64}$' AND
      "terminalMessageHash" ~ '^[a-f0-9]{64}$' AND
      "terminalPayloadDigest" ~ '^[a-f0-9]{64}$' AND
      "terminalEnvelopeDigest" ~ '^[a-f0-9]{64}$' AND
      "terminalAuthenticationTagDigest" ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT "acp_codex_validation_round_trip_window_check"
    CHECK (
      "statusExpiresAt" > "statusIssuedAt" AND
      "terminalIssuedAt" >= "statusIssuedAt" AND
      "terminalExpiresAt" > "terminalIssuedAt"
    )
);

CREATE UNIQUE INDEX "acp_codex_validation_round_trip_idempotency_key"
  ON "acp_codex_validation_round_trip_evidence"("workspaceId", "roundTripIdempotencyKey");
CREATE UNIQUE INDEX "acp_codex_validation_round_trip_handoff_key"
  ON "acp_codex_validation_round_trip_evidence"("workspaceId", "handoffAttemptId");
CREATE UNIQUE INDEX "acp_codex_validation_round_trip_status_message_key"
  ON "acp_codex_validation_round_trip_evidence"("workspaceId", "sessionId", "statusMessageId");
CREATE UNIQUE INDEX "acp_codex_validation_round_trip_terminal_message_key"
  ON "acp_codex_validation_round_trip_evidence"("workspaceId", "sessionId", "terminalMessageId");

ALTER TABLE "acp_codex_validation_round_trip_evidence"
  ADD CONSTRAINT "acp_codex_validation_round_trip_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_codex_validation_round_trip_handoff_fkey"
    FOREIGN KEY (
      "workspaceId", "handoffAttemptId", "validationDispatchCandidateHash",
      "heartbeatCandidateHash", "runtimeId", "connectionId", "sessionId", "dispatchId",
      "taskId", "runId", "agentId", "authorityLevel", "taskPolicyHash", "maximumCostMinorUnits"
    ) REFERENCES "acp_codex_validation_egress_handoff_attempts"(
      "workspaceId", "id", "validationDispatchCandidateHash", "heartbeatCandidateHash",
      "runtimeId", "connectionId", "sessionId", "dispatchId", "taskId", "runId",
      "agentId", "authorityLevel", "taskPolicyHash", "maximumCostMinorUnits"
    ) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "acp_codex_validation_round_trip_messages" (
  "workspaceId" UUID NOT NULL,
  "sessionId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "roundTripCandidateHash" TEXT NOT NULL,
  "messageRole" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_codex_validation_round_trip_messages_pkey"
    PRIMARY KEY ("workspaceId", "sessionId", "messageId"),
  CONSTRAINT "acp_codex_validation_round_trip_message_role_check"
    CHECK ("messageRole" IN ('STATUS', 'TERMINAL')),
  CONSTRAINT "acp_codex_validation_round_trip_messages_evidence_fkey"
    FOREIGN KEY ("workspaceId", "roundTripCandidateHash")
    REFERENCES "acp_codex_validation_round_trip_evidence"("workspaceId", "roundTripCandidateHash")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "acp_codex_validation_round_trip_message_role_key"
  ON "acp_codex_validation_round_trip_messages"(
    "workspaceId", "roundTripCandidateHash", "messageRole"
  );

CREATE OR REPLACE FUNCTION ventureos_reject_codex_validation_round_trip_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM "workspaces" WHERE "id" = OLD."workspaceId"
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Codex validation round-trip evidence is immutable';
END;
$$;

CREATE TRIGGER acp_codex_validation_round_trip_evidence_immutable
  BEFORE UPDATE OR DELETE ON "acp_codex_validation_round_trip_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_codex_validation_round_trip_change();

CREATE TRIGGER acp_codex_validation_round_trip_messages_immutable
  BEFORE UPDATE OR DELETE ON "acp_codex_validation_round_trip_messages"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_codex_validation_round_trip_change();
