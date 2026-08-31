CREATE TABLE "acp_codex_validation_egress_handoff_attempts" (
  "workspaceId" UUID NOT NULL,
  "id" TEXT NOT NULL,
  "validationDispatchCandidateHash" TEXT NOT NULL,
  "heartbeatCandidateHash" TEXT NOT NULL,
  "ownerReference" TEXT NOT NULL,
  "ownerActorKind" TEXT NOT NULL,
  "claimIdempotencyKey" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "authorityLevel" INTEGER NOT NULL,
  "taskPolicyHash" TEXT NOT NULL,
  "maximumComputeUnits" INTEGER NOT NULL,
  "maximumCostMinorUnits" INTEGER NOT NULL,
  "maximumDurationMs" INTEGER NOT NULL,
  "outboundSequence" INTEGER NOT NULL,
  "messageId" TEXT NOT NULL,
  "challengeCode" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "unsignedEnvelopeDigest" TEXT NOT NULL,
  "signedEnvelopeDigest" TEXT NOT NULL,
  "authenticationTagDigest" TEXT NOT NULL,
  "validationIssuedAt" TIMESTAMP(3) NOT NULL,
  "validationExpiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_codex_validation_egress_handoff_attempts_pkey"
    PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_codex_validation_egress_handoff_kind_check"
    CHECK (
      "ownerActorKind" IN ('HUMAN', 'AGENT', 'SYSTEM') AND
      "generation" = 1 AND "state" = 'CLAIMED' AND
      "authorityLevel" BETWEEN 0 AND 3 AND
      "maximumCostMinorUnits" = 0 AND
      "maximumComputeUnits" BETWEEN 1 AND 100 AND
      "maximumDurationMs" BETWEEN 1 AND 60000 AND
      "outboundSequence" = 1 AND "messageId" = "dispatchId" AND
      "challengeCode" = 'codex.runtime.round-trip.v1'
    ),
  CONSTRAINT "acp_codex_validation_egress_handoff_digest_check"
    CHECK (
      "validationDispatchCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "heartbeatCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "taskPolicyHash" ~ '^[a-f0-9]{64}$' AND
      "payloadDigest" ~ '^[a-f0-9]{64}$' AND
      "unsignedEnvelopeDigest" ~ '^[a-f0-9]{64}$' AND
      "signedEnvelopeDigest" ~ '^[a-f0-9]{64}$' AND
      "authenticationTagDigest" ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT "acp_codex_validation_egress_handoff_reference_check"
    CHECK (
      "ownerReference" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "claimIdempotencyKey" ~ '^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$' AND
      "ownerReference" !~* '(chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret|token)' AND
      "claimIdempotencyKey" !~* '(chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret|token)'
    ),
  CONSTRAINT "acp_codex_validation_egress_handoff_window_check"
    CHECK (
      "validationExpiresAt" > "validationIssuedAt" AND
      "claimedAt" >= "validationIssuedAt" AND
      "expiresAt" > "claimedAt" AND
      "expiresAt" <= "claimedAt" + INTERVAL '15 seconds' AND
      "expiresAt" <= "validationExpiresAt"
    )
);

CREATE UNIQUE INDEX "acp_codex_validation_egress_handoff_candidate_key"
  ON "acp_codex_validation_egress_handoff_attempts"(
    "workspaceId", "validationDispatchCandidateHash"
  );
CREATE UNIQUE INDEX "acp_codex_validation_egress_handoff_idempotency_key"
  ON "acp_codex_validation_egress_handoff_attempts"("workspaceId", "claimIdempotencyKey");

ALTER TABLE "acp_codex_validation_egress_handoff_attempts"
  ADD CONSTRAINT "acp_codex_validation_egress_handoff_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_codex_validation_egress_handoff_dispatch_fkey"
    FOREIGN KEY ("workspaceId", "validationDispatchCandidateHash")
    REFERENCES "acp_codex_validation_dispatch_evidence"(
      "workspaceId", "validationDispatchCandidateHash"
    ) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_reject_codex_validation_egress_handoff_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Codex validation egress handoff evidence is immutable';
END;
$$;

CREATE TRIGGER acp_codex_validation_egress_handoff_immutable
  BEFORE UPDATE OR DELETE ON "acp_codex_validation_egress_handoff_attempts"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_codex_validation_egress_handoff_change();
