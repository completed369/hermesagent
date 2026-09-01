CREATE UNIQUE INDEX "acp_codex_validation_egress_handoff_process_binding_key"
  ON "acp_codex_validation_egress_handoff_attempts"(
    "workspaceId", "id", "validationDispatchCandidateHash", "runtimeId",
    "connectionId", "sessionId", "dispatchId"
  );

CREATE TABLE "acp_codex_validation_process_session_claims" (
  "workspaceId" UUID NOT NULL,
  "id" TEXT NOT NULL,
  "handoffAttemptId" TEXT NOT NULL,
  "validationDispatchCandidateHash" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "ownerReference" TEXT NOT NULL,
  "ownerActorKind" TEXT NOT NULL,
  "supervisionId" TEXT NOT NULL,
  "launchNonce" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "admissionEvidenceHash" TEXT NOT NULL,
  "admissionBindingHash" TEXT NOT NULL,
  "testOnly" BOOLEAN NOT NULL,
  "state" TEXT NOT NULL,
  "runtimeConnection" TEXT NOT NULL,
  "claimIdempotencyKey" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_codex_validation_process_session_claims_pkey"
    PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_codex_validation_process_session_claim_kind_check"
    CHECK (
      "ownerActorKind" IN ('HUMAN', 'AGENT', 'SYSTEM') AND
      "platform" IN ('LINUX', 'WIN32') AND
      "state" = 'CLAIMED' AND
      "runtimeConnection" = 'NOT_CONFIGURED'
    ),
  CONSTRAINT "acp_codex_validation_process_session_claim_digest_check"
    CHECK (
      "validationDispatchCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "manifestHash" ~ '^[a-f0-9]{64}$' AND
      "admissionEvidenceHash" ~ '^[a-f0-9]{64}$' AND
      "admissionBindingHash" ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT "acp_codex_validation_process_session_claim_reference_check"
    CHECK (
      "id" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "handoffAttemptId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "runtimeId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "connectionId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "sessionId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "dispatchId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "ownerReference" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "supervisionId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "launchNonce" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "claimIdempotencyKey" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$'
    ),
  CONSTRAINT "acp_codex_validation_process_session_claim_window_check"
    CHECK ("expiresAt" > "claimedAt")
);

CREATE UNIQUE INDEX "acp_codex_validation_process_session_claim_handoff_key"
  ON "acp_codex_validation_process_session_claims"("workspaceId", "handoffAttemptId");
CREATE UNIQUE INDEX "acp_codex_validation_process_session_claim_idempotency_key"
  ON "acp_codex_validation_process_session_claims"("workspaceId", "claimIdempotencyKey");
CREATE UNIQUE INDEX "acp_codex_validation_process_session_claim_supervision_key"
  ON "acp_codex_validation_process_session_claims"("workspaceId", "supervisionId");
CREATE UNIQUE INDEX "acp_codex_validation_process_claim_completion_binding_key"
  ON "acp_codex_validation_process_session_claims"(
    "workspaceId", "id", "handoffAttemptId", "validationDispatchCandidateHash",
    "runtimeId", "connectionId", "sessionId", "dispatchId"
  );

ALTER TABLE "acp_codex_validation_process_session_claims"
  ADD CONSTRAINT "acp_codex_validation_process_session_claim_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_codex_validation_process_session_claim_handoff_fkey"
    FOREIGN KEY (
      "workspaceId", "handoffAttemptId", "validationDispatchCandidateHash",
      "runtimeId", "connectionId", "sessionId", "dispatchId"
    ) REFERENCES "acp_codex_validation_egress_handoff_attempts"(
      "workspaceId", "id", "validationDispatchCandidateHash",
      "runtimeId", "connectionId", "sessionId", "dispatchId"
    ) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "acp_codex_validation_process_session_completions" (
  "workspaceId" UUID NOT NULL,
  "cleanupEvidenceHash" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "handoffAttemptId" TEXT NOT NULL,
  "validationDispatchCandidateHash" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "processState" TEXT NOT NULL,
  "exitCode" INTEGER,
  "signal" TEXT,
  "closedAt" TIMESTAMP(3) NOT NULL,
  "runtimeConnection" TEXT NOT NULL,
  "completionIdempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_codex_validation_process_session_completions_pkey"
    PRIMARY KEY ("workspaceId", "cleanupEvidenceHash"),
  CONSTRAINT "acp_codex_validation_process_session_completion_kind_check"
    CHECK (
      "cleanupEvidenceHash" ~ '^[a-f0-9]{64}$' AND
      "validationDispatchCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "reason" IN ('COMPLETED', 'CANCELLED') AND
      "processState" = 'EXITED' AND
      "runtimeConnection" = 'NOT_CONFIGURED' AND
      (("exitCode" IS NULL) <> ("signal" IS NULL)) AND
      ("exitCode" IS NULL OR "exitCode" BETWEEN 0 AND 255) AND
      ("signal" IS NULL OR "signal" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$')
    ),
  CONSTRAINT "acp_codex_validation_process_session_completion_reference_check"
    CHECK (
      "claimId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "handoffAttemptId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "runtimeId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "connectionId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "sessionId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "dispatchId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "completionIdempotencyKey" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$'
    )
);

CREATE UNIQUE INDEX "acp_codex_validation_process_session_completion_claim_key"
  ON "acp_codex_validation_process_session_completions"("workspaceId", "claimId");
CREATE UNIQUE INDEX "acp_codex_validation_process_session_completion_handoff_key"
  ON "acp_codex_validation_process_session_completions"("workspaceId", "handoffAttemptId");
CREATE UNIQUE INDEX "acp_codex_validation_process_session_completion_idempotency_key"
  ON "acp_codex_validation_process_session_completions"(
    "workspaceId", "completionIdempotencyKey"
  );

ALTER TABLE "acp_codex_validation_process_session_completions"
  ADD CONSTRAINT "acp_codex_validation_process_session_completion_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_codex_validation_process_session_completion_claim_fkey"
    FOREIGN KEY (
      "workspaceId", "claimId", "handoffAttemptId", "validationDispatchCandidateHash",
      "runtimeId", "connectionId", "sessionId", "dispatchId"
    ) REFERENCES "acp_codex_validation_process_session_claims"(
      "workspaceId", "id", "handoffAttemptId", "validationDispatchCandidateHash",
      "runtimeId", "connectionId", "sessionId", "dispatchId"
    ) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_require_codex_validation_process_cleanup()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_reason TEXT;
BEGIN
  expected_reason := CASE
    WHEN TG_TABLE_NAME = 'acp_codex_validation_round_trip_evidence' THEN 'COMPLETED'
    ELSE 'CANCELLED'
  END;
  IF NOT EXISTS (
    SELECT 1 FROM "acp_codex_validation_process_session_completions"
    WHERE "workspaceId" = NEW."workspaceId"
      AND "handoffAttemptId" = NEW."handoffAttemptId"
      AND "validationDispatchCandidateHash" = NEW."validationDispatchCandidateHash"
      AND "runtimeId" = NEW."runtimeId"
      AND "connectionId" = NEW."connectionId"
      AND "sessionId" = NEW."sessionId"
      AND "dispatchId" = NEW."dispatchId"
      AND "reason" = expected_reason
  ) THEN
    RAISE EXCEPTION 'Codex validation terminal evidence requires process cleanup evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_codex_validation_round_trip_requires_process_cleanup
  BEFORE INSERT ON "acp_codex_validation_round_trip_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_require_codex_validation_process_cleanup();

CREATE TRIGGER acp_codex_validation_cancellation_requires_process_cleanup
  BEFORE INSERT ON "acp_codex_validation_cancellation_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_require_codex_validation_process_cleanup();

CREATE OR REPLACE FUNCTION ventureos_reject_codex_validation_process_session_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM "workspaces" WHERE "id" = OLD."workspaceId"
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Codex validation process-session evidence is immutable';
END;
$$;

CREATE TRIGGER acp_codex_validation_process_session_claims_immutable
  BEFORE UPDATE OR DELETE ON "acp_codex_validation_process_session_claims"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_codex_validation_process_session_change();

CREATE TRIGGER acp_codex_validation_process_session_completions_immutable
  BEFORE UPDATE OR DELETE ON "acp_codex_validation_process_session_completions"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_codex_validation_process_session_change();
