CREATE UNIQUE INDEX "acp_codex_validation_process_session_recovery_lease_full_key"
  ON "acp_codex_validation_process_session_recovery_leases"(
    "workspaceId", "id", "claimId", "generation"
  );

CREATE TABLE "acp_codex_validation_process_session_recovery_exit_evidence" (
  "workspaceId" UUID NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "recoveryLeaseId" TEXT NOT NULL,
  "recoveryGeneration" INTEGER NOT NULL,
  "claimId" TEXT NOT NULL,
  "cleanupEvidenceHash" TEXT NOT NULL,
  "ownerReference" TEXT NOT NULL,
  "ownerActorKind" TEXT NOT NULL,
  "supervisionId" TEXT NOT NULL,
  "launchNonce" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "validationDispatchCandidateHash" TEXT NOT NULL,
  "identityEstablishedAt" TIMESTAMP(3) NOT NULL,
  "exitedAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "processState" TEXT NOT NULL,
  "exitCode" INTEGER,
  "signal" TEXT,
  "identityAuthority" TEXT NOT NULL,
  "runtimeConnection" TEXT NOT NULL,
  "recoveryCompletionIdempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_codex_validation_process_session_recovery_exit_evidence_pkey"
    PRIMARY KEY ("workspaceId", "evidenceHash"),
  CONSTRAINT "acp_codex_validation_process_session_recovery_exit_kind_check"
    CHECK (
      "evidenceHash" ~ '^[a-f0-9]{64}$' AND
      "cleanupEvidenceHash" ~ '^[a-f0-9]{64}$' AND
      "validationDispatchCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "ownerActorKind" IN ('HUMAN', 'AGENT', 'SYSTEM') AND
      "recoveryGeneration" > 0 AND
      "processState" = 'EXITED' AND
      "identityAuthority" = 'RETAINED_NATIVE_IDENTITY' AND
      "runtimeConnection" = 'NOT_CONFIGURED' AND
      (("exitCode" IS NULL) <> ("signal" IS NULL)) AND
      ("exitCode" IS NULL OR "exitCode" BETWEEN 0 AND 255) AND
      ("signal" IS NULL OR "signal" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$')
    ),
  CONSTRAINT "acp_codex_validation_process_session_recovery_exit_reference_check"
    CHECK (
      "evidenceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "recoveryLeaseId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "claimId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "ownerReference" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "supervisionId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "launchNonce" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "sessionId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "dispatchId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "recoveryCompletionIdempotencyKey" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "evidenceId" !~* '(chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret|token)' AND
      "recoveryCompletionIdempotencyKey" !~* '(chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret|token)' AND
      ("signal" IS NULL OR "signal" !~* '(password|credential|api[-_. ]?key|transcript|prompt|secret|token)')
    ),
  CONSTRAINT "acp_codex_validation_process_session_recovery_exit_window_check"
    CHECK (
      "identityEstablishedAt" <= "exitedAt" AND
      "exitedAt" <= "verifiedAt" AND
      "verifiedAt" <= "createdAt"
    )
);

CREATE UNIQUE INDEX "acp_codex_validation_process_session_recovery_exit_evidence_id_key"
  ON "acp_codex_validation_process_session_recovery_exit_evidence"(
    "workspaceId", "evidenceId"
  );
CREATE UNIQUE INDEX "acp_codex_validation_process_session_recovery_exit_lease_key"
  ON "acp_codex_validation_process_session_recovery_exit_evidence"(
    "workspaceId", "recoveryLeaseId", "recoveryGeneration"
  );
CREATE UNIQUE INDEX "acp_codex_validation_process_session_recovery_exit_claim_key"
  ON "acp_codex_validation_process_session_recovery_exit_evidence"(
    "workspaceId", "claimId"
  );
CREATE UNIQUE INDEX "acp_codex_validation_process_session_recovery_exit_cleanup_key"
  ON "acp_codex_validation_process_session_recovery_exit_evidence"(
    "workspaceId", "cleanupEvidenceHash"
  );
CREATE UNIQUE INDEX "acp_codex_validation_process_session_recovery_exit_idempotency_key"
  ON "acp_codex_validation_process_session_recovery_exit_evidence"(
    "workspaceId", "recoveryCompletionIdempotencyKey"
  );

ALTER TABLE "acp_codex_validation_process_session_recovery_exit_evidence"
  ADD CONSTRAINT "acp_codex_validation_process_session_recovery_exit_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_codex_validation_process_session_recovery_exit_lease_fkey"
    FOREIGN KEY ("workspaceId", "recoveryLeaseId", "claimId", "recoveryGeneration")
    REFERENCES "acp_codex_validation_process_session_recovery_leases"(
      "workspaceId", "id", "claimId", "generation"
    ) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_require_codex_validation_process_recovery_exit_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  trusted_lease RECORD;
  trusted_claim RECORD;
BEGIN
  SELECT * INTO trusted_lease
  FROM "acp_codex_validation_process_session_recovery_leases"
  WHERE "workspaceId" = NEW."workspaceId"
    AND "id" = NEW."recoveryLeaseId"
    AND "claimId" = NEW."claimId"
    AND "generation" = NEW."recoveryGeneration"
  FOR UPDATE;

  SELECT * INTO trusted_claim
  FROM "acp_codex_validation_process_session_claims"
  WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."claimId"
  FOR UPDATE;

  IF trusted_lease."id" IS NULL OR trusted_claim."id" IS NULL OR
     trusted_lease."ownerReference" IS DISTINCT FROM NEW."ownerReference" OR
     trusted_lease."ownerActorKind" IS DISTINCT FROM NEW."ownerActorKind" OR
     trusted_lease."runtimeConnection" IS DISTINCT FROM 'NOT_CONFIGURED' OR
     trusted_lease."claimedAt" > clock_timestamp() OR
     trusted_lease."expiresAt" <= clock_timestamp() OR
     trusted_claim."ownerReference" IS DISTINCT FROM NEW."ownerReference" OR
     trusted_claim."ownerActorKind" IS DISTINCT FROM NEW."ownerActorKind" OR
     trusted_claim."supervisionId" IS DISTINCT FROM NEW."supervisionId" OR
     trusted_claim."launchNonce" IS DISTINCT FROM NEW."launchNonce" OR
     trusted_claim."sessionId" IS DISTINCT FROM NEW."sessionId" OR
     trusted_claim."dispatchId" IS DISTINCT FROM NEW."dispatchId" OR
     trusted_claim."validationDispatchCandidateHash" IS DISTINCT FROM
       NEW."validationDispatchCandidateHash" OR
     trusted_claim."state" IS DISTINCT FROM 'CLAIMED' OR
     trusted_claim."runtimeConnection" IS DISTINCT FROM 'NOT_CONFIGURED' OR
     NEW."runtimeConnection" IS DISTINCT FROM 'NOT_CONFIGURED' OR
     NEW."identityEstablishedAt" < trusted_claim."claimedAt" OR
     NEW."exitedAt" > trusted_claim."expiresAt" OR
     NEW."verifiedAt" < trusted_lease."claimedAt" OR
     NEW."verifiedAt" >= trusted_lease."expiresAt" OR
     NEW."createdAt" IS DISTINCT FROM LOCALTIMESTAMP(3) OR
     NEW."verifiedAt" > NEW."createdAt" OR
     EXISTS (
       SELECT 1 FROM "acp_codex_validation_process_session_completions"
       WHERE "workspaceId" = NEW."workspaceId" AND "claimId" = NEW."claimId"
     ) THEN
    RAISE EXCEPTION 'Codex validation recovery exit evidence crossed active lease authority'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_codex_validation_process_session_recovery_exit_requires_authority
  BEFORE INSERT ON "acp_codex_validation_process_session_recovery_exit_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_require_codex_validation_process_recovery_exit_evidence();

CREATE OR REPLACE FUNCTION ventureos_reject_completion_during_codex_process_recovery()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
  FROM "acp_codex_validation_process_session_claims"
  WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."claimId"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Codex validation process-session completion lacks a trusted claim'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "acp_codex_validation_process_session_recovery_leases"
    WHERE "workspaceId" = NEW."workspaceId" AND "claimId" = NEW."claimId"
      AND "expiresAt" > clock_timestamp()
  ) AND NOT EXISTS (
    SELECT 1 FROM "acp_codex_validation_process_session_recovery_exit_evidence" evidence
    JOIN "acp_codex_validation_process_session_recovery_leases" lease
      ON lease."workspaceId" = evidence."workspaceId"
      AND lease."id" = evidence."recoveryLeaseId"
      AND lease."claimId" = evidence."claimId"
      AND lease."generation" = evidence."recoveryGeneration"
    WHERE evidence."workspaceId" = NEW."workspaceId"
      AND evidence."claimId" = NEW."claimId"
      AND evidence."cleanupEvidenceHash" = NEW."cleanupEvidenceHash"
      AND evidence."sessionId" = NEW."sessionId"
      AND evidence."dispatchId" = NEW."dispatchId"
      AND evidence."validationDispatchCandidateHash" = NEW."validationDispatchCandidateHash"
      AND evidence."processState" = NEW."processState"
      AND evidence."exitCode" IS NOT DISTINCT FROM NEW."exitCode"
      AND evidence."signal" IS NOT DISTINCT FROM NEW."signal"
      AND evidence."exitedAt" = NEW."closedAt"
      AND evidence."runtimeConnection" = NEW."runtimeConnection"
      AND NEW."reason" = 'CANCELLED'
      AND lease."expiresAt" > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'Codex validation process-session completion conflicts with active recovery lease'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "acp_codex_validation_process_session_recovery_exit_evidence"
    WHERE "workspaceId" = NEW."workspaceId" AND "claimId" = NEW."claimId"
  ) AND NOT EXISTS (
    SELECT 1 FROM "acp_codex_validation_process_session_recovery_exit_evidence" evidence
    WHERE evidence."workspaceId" = NEW."workspaceId"
      AND evidence."claimId" = NEW."claimId"
      AND evidence."cleanupEvidenceHash" = NEW."cleanupEvidenceHash"
      AND evidence."sessionId" = NEW."sessionId"
      AND evidence."dispatchId" = NEW."dispatchId"
      AND evidence."validationDispatchCandidateHash" = NEW."validationDispatchCandidateHash"
      AND evidence."processState" = NEW."processState"
      AND evidence."exitCode" IS NOT DISTINCT FROM NEW."exitCode"
      AND evidence."signal" IS NOT DISTINCT FROM NEW."signal"
      AND evidence."exitedAt" = NEW."closedAt"
      AND evidence."runtimeConnection" = NEW."runtimeConnection"
      AND NEW."reason" = 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'Codex validation process-session completion drifted from recovery evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_codex_validation_process_session_recovery_exit_evidence_immutable
  BEFORE UPDATE OR DELETE ON "acp_codex_validation_process_session_recovery_exit_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_codex_validation_process_session_change();
