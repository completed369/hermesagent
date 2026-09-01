DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "acp_codex_validation_process_session_claims" claim
    LEFT JOIN "acp_codex_validation_egress_handoff_attempts" handoff
      ON handoff."workspaceId" = claim."workspaceId"
      AND handoff."id" = claim."handoffAttemptId"
    WHERE handoff."id" IS NULL
      OR handoff."ownerReference" IS DISTINCT FROM claim."ownerReference"
      OR handoff."ownerActorKind" IS DISTINCT FROM claim."ownerActorKind"
      OR handoff."state" IS DISTINCT FROM 'CLAIMED'
      OR handoff."expiresAt" IS DISTINCT FROM claim."expiresAt"
      OR claim."claimedAt" < handoff."claimedAt"
      OR claim."claimedAt" > CURRENT_TIMESTAMP
      OR claim."claimedAt" >= handoff."expiresAt"
  ) THEN
    RAISE EXCEPTION 'Existing Codex validation process-session claim crossed trusted handoff authority';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ventureos_require_codex_validation_process_claim_trust()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE handoff RECORD;
BEGIN
  SELECT
    "ownerReference", "ownerActorKind", "state", "claimedAt", "expiresAt"
  INTO handoff
  FROM "acp_codex_validation_egress_handoff_attempts"
  WHERE "workspaceId" = NEW."workspaceId"
    AND "id" = NEW."handoffAttemptId";

  IF NOT FOUND OR
     handoff."ownerReference" IS DISTINCT FROM NEW."ownerReference" OR
     handoff."ownerActorKind" IS DISTINCT FROM NEW."ownerActorKind" OR
     handoff."state" IS DISTINCT FROM 'CLAIMED' OR
     handoff."expiresAt" IS DISTINCT FROM NEW."expiresAt" OR
     NEW."claimedAt" < handoff."claimedAt" OR
     NEW."claimedAt" > CURRENT_TIMESTAMP OR
     NEW."claimedAt" >= handoff."expiresAt" THEN
    RAISE EXCEPTION 'Codex validation process-session claim crossed trusted handoff authority'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_codex_validation_process_session_claim_requires_trusted_handoff
  BEFORE INSERT ON "acp_codex_validation_process_session_claims"
  FOR EACH ROW EXECUTE FUNCTION ventureos_require_codex_validation_process_claim_trust();
