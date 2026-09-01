CREATE TABLE "acp_codex_validation_cancellation_evidence" (
  "workspaceId" UUID NOT NULL,
  "cancellationCandidateHash" TEXT NOT NULL,
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
  "cancellationSequence" INTEGER NOT NULL,
  "cancellationMessageId" TEXT NOT NULL,
  "interruptRequestId" INTEGER NOT NULL,
  "interruptResponseHash" TEXT NOT NULL,
  "terminalThreadId" TEXT NOT NULL,
  "terminalTurnId" TEXT NOT NULL,
  "terminalMessageHash" TEXT NOT NULL,
  "cancellationPayloadDigest" TEXT NOT NULL,
  "cancellationEnvelopeDigest" TEXT NOT NULL,
  "cancellationAuthenticationTagDigest" TEXT NOT NULL,
  "cancellationIssuedAt" TIMESTAMP(3) NOT NULL,
  "cancellationExpiresAt" TIMESTAMP(3) NOT NULL,
  "resultCode" TEXT NOT NULL,
  "terminalState" TEXT NOT NULL,
  "providerAccess" TEXT NOT NULL,
  "runtimeConnection" TEXT NOT NULL,
  "connectionTransition" TEXT NOT NULL,
  "cancellationIdempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_codex_validation_cancellation_evidence_pkey"
    PRIMARY KEY ("workspaceId", "cancellationCandidateHash"),
  CONSTRAINT "acp_codex_validation_cancellation_kind_check"
    CHECK (
      "adapterKind" = 'CODEX_APP_SERVER_STDIO_V1' AND
      "authGeneration" = 1 AND
      "authorityLevel" BETWEEN 0 AND 3 AND
      "maximumCostMinorUnits" = 0 AND
      "cancellationSequence" = 2 AND
      "interruptRequestId" > 0 AND
      "resultCode" = 'VALIDATION_CANCELLED' AND
      "terminalState" = 'INTERRUPTED' AND
      "providerAccess" = 'NOT_CONFIGURED' AND
      "runtimeConnection" = 'NOT_CONFIGURED' AND
      "connectionTransition" = 'NOT_APPLIED'
    ),
  CONSTRAINT "acp_codex_validation_cancellation_digest_check"
    CHECK (
      "cancellationCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "validationDispatchCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "heartbeatCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "taskPolicyHash" ~ '^[a-f0-9]{64}$' AND
      "interruptResponseHash" ~ '^[a-f0-9]{64}$' AND
      "terminalMessageHash" ~ '^[a-f0-9]{64}$' AND
      "cancellationPayloadDigest" ~ '^[a-f0-9]{64}$' AND
      "cancellationEnvelopeDigest" ~ '^[a-f0-9]{64}$' AND
      "cancellationAuthenticationTagDigest" ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT "acp_codex_validation_cancellation_window_check"
    CHECK ("cancellationExpiresAt" > "cancellationIssuedAt")
);

CREATE UNIQUE INDEX "acp_codex_validation_cancellation_idempotency_key"
  ON "acp_codex_validation_cancellation_evidence"("workspaceId", "cancellationIdempotencyKey");
CREATE UNIQUE INDEX "acp_codex_validation_cancellation_handoff_key"
  ON "acp_codex_validation_cancellation_evidence"("workspaceId", "handoffAttemptId");
CREATE UNIQUE INDEX "acp_codex_validation_cancellation_message_key"
  ON "acp_codex_validation_cancellation_evidence"(
    "workspaceId", "sessionId", "cancellationMessageId"
  );

ALTER TABLE "acp_codex_validation_cancellation_evidence"
  ADD CONSTRAINT "acp_codex_validation_cancellation_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_codex_validation_cancellation_handoff_fkey"
    FOREIGN KEY (
      "workspaceId", "handoffAttemptId", "validationDispatchCandidateHash",
      "heartbeatCandidateHash", "runtimeId", "connectionId", "sessionId", "dispatchId",
      "taskId", "runId", "agentId", "authorityLevel", "taskPolicyHash", "maximumCostMinorUnits"
    ) REFERENCES "acp_codex_validation_egress_handoff_attempts"(
      "workspaceId", "id", "validationDispatchCandidateHash", "heartbeatCandidateHash",
      "runtimeId", "connectionId", "sessionId", "dispatchId", "taskId", "runId",
      "agentId", "authorityLevel", "taskPolicyHash", "maximumCostMinorUnits"
    ) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_enforce_codex_validation_terminal_exclusivity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize every terminal outcome on the immutable parent handoff. This
  -- prevents a concurrent direct insert from persisting both completion and
  -- cancellation evidence even when it bypasses the admission service.
  PERFORM 1
  FROM "acp_codex_validation_egress_handoff_attempts"
  WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."handoffAttemptId"
  FOR UPDATE;

  IF TG_TABLE_NAME = 'acp_codex_validation_cancellation_evidence' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        NEW."workspaceId"::text || ':' || NEW."sessionId" || ':' || NEW."cancellationMessageId",
        0
      )
    );
    IF EXISTS (
      SELECT 1 FROM "acp_codex_validation_round_trip_evidence"
      WHERE "workspaceId" = NEW."workspaceId"
        AND (
          "handoffAttemptId" = NEW."handoffAttemptId" OR
          (
            "sessionId" = NEW."sessionId" AND
            NEW."cancellationMessageId" IN ("statusMessageId", "terminalMessageId")
          )
        )
    ) THEN
      RAISE EXCEPTION 'Codex validation handoff or message already has completed evidence'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        NEW."workspaceId"::text || ':' || NEW."sessionId" || ':' ||
          LEAST(NEW."statusMessageId", NEW."terminalMessageId"),
        0
      )
    );
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        NEW."workspaceId"::text || ':' || NEW."sessionId" || ':' ||
          GREATEST(NEW."statusMessageId", NEW."terminalMessageId"),
        0
      )
    );
    IF EXISTS (
      SELECT 1 FROM "acp_codex_validation_cancellation_evidence"
      WHERE "workspaceId" = NEW."workspaceId"
        AND (
          "handoffAttemptId" = NEW."handoffAttemptId" OR
          (
            "sessionId" = NEW."sessionId" AND
            "cancellationMessageId" IN (NEW."statusMessageId", NEW."terminalMessageId")
          )
        )
    ) THEN
      RAISE EXCEPTION 'Codex validation handoff or message already has cancellation evidence'
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_codex_validation_cancellation_terminal_exclusive
  BEFORE INSERT ON "acp_codex_validation_cancellation_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_enforce_codex_validation_terminal_exclusivity();

CREATE TRIGGER acp_codex_validation_round_trip_terminal_exclusive
  BEFORE INSERT ON "acp_codex_validation_round_trip_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_enforce_codex_validation_terminal_exclusivity();

CREATE OR REPLACE FUNCTION ventureos_reject_codex_validation_cancellation_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM "workspaces" WHERE "id" = OLD."workspaceId"
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Codex validation cancellation evidence is immutable';
END;
$$;

CREATE TRIGGER acp_codex_validation_cancellation_evidence_immutable
  BEFORE UPDATE OR DELETE ON "acp_codex_validation_cancellation_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_codex_validation_cancellation_change();
