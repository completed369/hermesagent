DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "acp_codex_validation_process_session_completions" completion
    LEFT JOIN "acp_codex_validation_process_session_claims" trusted_claim
      ON trusted_claim."workspaceId" = completion."workspaceId"
      AND trusted_claim."id" = completion."claimId"
    WHERE trusted_claim."id" IS NULL
      OR trusted_claim."handoffAttemptId" IS DISTINCT FROM completion."handoffAttemptId"
      OR trusted_claim."validationDispatchCandidateHash" IS DISTINCT FROM
        completion."validationDispatchCandidateHash"
      OR trusted_claim."runtimeId" IS DISTINCT FROM completion."runtimeId"
      OR trusted_claim."connectionId" IS DISTINCT FROM completion."connectionId"
      OR trusted_claim."sessionId" IS DISTINCT FROM completion."sessionId"
      OR trusted_claim."dispatchId" IS DISTINCT FROM completion."dispatchId"
      OR trusted_claim."state" IS DISTINCT FROM 'CLAIMED'
      OR trusted_claim."runtimeConnection" IS DISTINCT FROM 'NOT_CONFIGURED'
      OR completion."runtimeConnection" IS DISTINCT FROM 'NOT_CONFIGURED'
      OR completion."closedAt" < trusted_claim."claimedAt"
      OR completion."closedAt" > trusted_claim."expiresAt"
      OR completion."closedAt" > completion."createdAt"
      OR completion."createdAt" > LOCALTIMESTAMP(3)
  ) THEN
    RAISE EXCEPTION 'Existing Codex validation process-session completion crossed trusted claim authority';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ventureos_require_codex_validation_process_completion_trust()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE trusted_claim RECORD;
BEGIN
  SELECT
    "handoffAttemptId", "validationDispatchCandidateHash", "runtimeId", "connectionId",
    "sessionId", "dispatchId", "state", "runtimeConnection", "claimedAt", "expiresAt"
  INTO trusted_claim
  FROM "acp_codex_validation_process_session_claims"
  WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."claimId"
  FOR UPDATE;

  IF NOT FOUND OR
     trusted_claim."handoffAttemptId" IS DISTINCT FROM NEW."handoffAttemptId" OR
     trusted_claim."validationDispatchCandidateHash" IS DISTINCT FROM
       NEW."validationDispatchCandidateHash" OR
     trusted_claim."runtimeId" IS DISTINCT FROM NEW."runtimeId" OR
     trusted_claim."connectionId" IS DISTINCT FROM NEW."connectionId" OR
     trusted_claim."sessionId" IS DISTINCT FROM NEW."sessionId" OR
     trusted_claim."dispatchId" IS DISTINCT FROM NEW."dispatchId" OR
     trusted_claim."state" IS DISTINCT FROM 'CLAIMED' OR
     trusted_claim."runtimeConnection" IS DISTINCT FROM 'NOT_CONFIGURED' OR
     NEW."runtimeConnection" IS DISTINCT FROM 'NOT_CONFIGURED' OR
     NEW."closedAt" < trusted_claim."claimedAt" OR
     NEW."closedAt" > trusted_claim."expiresAt" OR
     NEW."closedAt" > NEW."createdAt" OR
     NEW."createdAt" IS DISTINCT FROM LOCALTIMESTAMP(3) THEN
    RAISE EXCEPTION 'Codex validation process-session completion crossed trusted claim authority'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_codex_validation_process_session_completion_requires_trusted_claim
  BEFORE INSERT ON "acp_codex_validation_process_session_completions"
  FOR EACH ROW EXECUTE FUNCTION ventureos_require_codex_validation_process_completion_trust();
