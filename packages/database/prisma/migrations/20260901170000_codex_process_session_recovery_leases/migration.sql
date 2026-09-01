CREATE TABLE "acp_codex_validation_process_session_recovery_leases" (
  "workspaceId" UUID NOT NULL,
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "ownerReference" TEXT NOT NULL,
  "ownerActorKind" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "runtimeConnection" TEXT NOT NULL,
  "recoveryIdempotencyKey" TEXT NOT NULL,
  "claimExpiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 seconds'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_codex_validation_process_session_recovery_leases_pkey"
    PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_codex_validation_process_session_recovery_lease_kind_check"
    CHECK (
      "ownerActorKind" IN ('HUMAN', 'AGENT', 'SYSTEM') AND
      "generation" > 0 AND "state" = 'CLAIMED' AND
      "runtimeConnection" = 'NOT_CONFIGURED'
    ),
  CONSTRAINT "acp_codex_validation_process_session_recovery_lease_reference_check"
    CHECK (
      "id" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "claimId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "ownerReference" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "recoveryIdempotencyKey" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "id" !~* '(chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret|token)' AND
      "ownerReference" !~* '(chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret|token)' AND
      "recoveryIdempotencyKey" !~* '(chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret|token)'
    ),
  CONSTRAINT "acp_codex_validation_process_session_recovery_lease_window_check"
    CHECK (
      "claimedAt" >= "claimExpiresAt" AND
      "expiresAt" = "claimedAt" + INTERVAL '15 seconds'
    )
);

CREATE UNIQUE INDEX "acp_codex_validation_process_session_recovery_lease_idempotency_key"
  ON "acp_codex_validation_process_session_recovery_leases"(
    "workspaceId", "recoveryIdempotencyKey"
  );
CREATE UNIQUE INDEX "acp_codex_validation_process_session_recovery_lease_generation_key"
  ON "acp_codex_validation_process_session_recovery_leases"(
    "workspaceId", "claimId", "generation"
  );

ALTER TABLE "acp_codex_validation_process_session_recovery_leases"
  ADD CONSTRAINT "acp_codex_validation_process_session_recovery_lease_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_codex_validation_process_session_recovery_lease_claim_fkey"
    FOREIGN KEY ("workspaceId", "claimId")
    REFERENCES "acp_codex_validation_process_session_claims"("workspaceId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_require_codex_validation_process_recovery_lease()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  trusted_claim RECORD;
  expected_generation INTEGER;
BEGIN
  SELECT "ownerReference", "ownerActorKind", "state", "runtimeConnection", "expiresAt"
  INTO trusted_claim
  FROM "acp_codex_validation_process_session_claims"
  WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."claimId"
  FOR UPDATE;

  IF NOT FOUND OR
     trusted_claim."ownerReference" IS DISTINCT FROM NEW."ownerReference" OR
     trusted_claim."ownerActorKind" IS DISTINCT FROM NEW."ownerActorKind" OR
     trusted_claim."state" IS DISTINCT FROM 'CLAIMED' OR
     trusted_claim."runtimeConnection" IS DISTINCT FROM 'NOT_CONFIGURED' OR
     trusted_claim."expiresAt" IS DISTINCT FROM NEW."claimExpiresAt" OR
     trusted_claim."expiresAt" > LOCALTIMESTAMP(3) OR
     NEW."claimedAt" IS DISTINCT FROM LOCALTIMESTAMP(3) OR
     EXISTS (
       SELECT 1 FROM "acp_codex_validation_process_session_completions"
       WHERE "workspaceId" = NEW."workspaceId" AND "claimId" = NEW."claimId"
     ) OR
     EXISTS (
       SELECT 1 FROM "acp_codex_validation_process_session_recovery_leases"
       WHERE "workspaceId" = NEW."workspaceId" AND "claimId" = NEW."claimId"
         AND "expiresAt" > LOCALTIMESTAMP(3)
     ) THEN
    RAISE EXCEPTION 'Codex validation process-session recovery lease lacks expired exclusive authority'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(MAX("generation"), 0) + 1
  INTO expected_generation
  FROM "acp_codex_validation_process_session_recovery_leases"
  WHERE "workspaceId" = NEW."workspaceId" AND "claimId" = NEW."claimId";

  IF NEW."generation" IS DISTINCT FROM expected_generation THEN
    RAISE EXCEPTION 'Codex validation process-session recovery lease generation drifted'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_codex_validation_process_session_recovery_lease_requires_authority
  BEFORE INSERT ON "acp_codex_validation_process_session_recovery_leases"
  FOR EACH ROW EXECUTE FUNCTION ventureos_require_codex_validation_process_recovery_lease();

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
      AND "expiresAt" > LOCALTIMESTAMP(3)
  ) THEN
    RAISE EXCEPTION 'Codex validation process-session completion conflicts with active recovery lease'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_codex_validation_process_session_completion_excludes_active_recovery
  BEFORE INSERT ON "acp_codex_validation_process_session_completions"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_completion_during_codex_process_recovery();

CREATE TRIGGER acp_codex_validation_process_session_recovery_leases_immutable
  BEFORE UPDATE OR DELETE ON "acp_codex_validation_process_session_recovery_leases"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_codex_validation_process_session_change();
