-- Durable, provider-neutral Level-4 approval bindings for ACP task/run work.
-- These tables prepare and consume authorization evidence only; they do not
-- dispatch a runtime or execute an external action.
CREATE TABLE "acp_approval_requests" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "actionCode" TEXT NOT NULL,
  "exactTarget" TEXT NOT NULL,
  "artifactVersionId" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "bindingHash" TEXT NOT NULL,
  "requesterReference" TEXT NOT NULL,
  "requesterActorKind" TEXT NOT NULL,
  "requesterAuthorityLevel" INTEGER NOT NULL,
  "requiredAuthorityLevel" INTEGER NOT NULL DEFAULT 4,
  "idempotencyKey" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "acp_approval_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "acp_approval_requests_hashes_check" CHECK (
    "evidenceHash" ~ '^[0-9a-f]{64}$' AND
    "policyHash" ~ '^[0-9a-f]{64}$' AND
    "bindingHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "acp_approval_requests_actor_kind_check" CHECK (
    "requesterActorKind" IN ('HUMAN', 'AGENT')
  ),
  CONSTRAINT "acp_approval_requests_authority_check" CHECK (
    "requesterAuthorityLevel" BETWEEN 1 AND 4 AND "requiredAuthorityLevel" = 4
  ),
  CONSTRAINT "acp_approval_requests_state_check" CHECK (
    "state" IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'PERMIT_ISSUED', 'PERMIT_CLAIMED')
  ),
  CONSTRAINT "acp_approval_requests_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "acp_approval_decisions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "approvalRequestId" UUID NOT NULL,
  "decision" TEXT NOT NULL,
  "approverId" UUID,
  "approverReference" TEXT NOT NULL,
  "approverAuthorityLevel" INTEGER NOT NULL DEFAULT 4,
  "bindingHash" TEXT NOT NULL,
  "artifactVersionId" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "decisionHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "acp_approval_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "acp_approval_decisions_decision_check" CHECK (
    "decision" IN ('APPROVE', 'REJECT', 'REVOKE')
  ),
  CONSTRAINT "acp_approval_decisions_authority_check" CHECK ("approverAuthorityLevel" = 4),
  CONSTRAINT "acp_approval_decisions_hashes_check" CHECK (
    "bindingHash" ~ '^[0-9a-f]{64}$' AND
    "evidenceHash" ~ '^[0-9a-f]{64}$' AND
    "policyHash" ~ '^[0-9a-f]{64}$' AND
    "decisionHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "acp_approval_decisions_expiry_check" CHECK (
    "decision" = 'REVOKE' OR "expiresAt" > "decidedAt"
  )
);

CREATE TABLE "acp_execution_permits" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "approvalRequestId" UUID NOT NULL,
  "taskId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "actionCode" TEXT NOT NULL,
  "exactTarget" TEXT NOT NULL,
  "artifactVersionId" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "bindingHash" TEXT NOT NULL,
  "executionPrincipalReference" TEXT NOT NULL,
  "issueIdempotencyKey" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "claimedByReference" TEXT,
  "claimIdempotencyKey" TEXT,
  "claimHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "acp_execution_permits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "acp_execution_permits_hashes_check" CHECK (
    "evidenceHash" ~ '^[0-9a-f]{64}$' AND
    "policyHash" ~ '^[0-9a-f]{64}$' AND
    "bindingHash" ~ '^[0-9a-f]{64}$' AND
    ("claimHash" IS NULL OR "claimHash" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "acp_execution_permits_expiry_check" CHECK ("expiresAt" > "issuedAt"),
  CONSTRAINT "acp_execution_permits_claim_tuple_check" CHECK (
    ("claimedAt" IS NULL AND "claimedByReference" IS NULL AND "claimIdempotencyKey" IS NULL AND "claimHash" IS NULL)
    OR
    ("claimedAt" IS NOT NULL AND "claimedByReference" IS NOT NULL AND "claimIdempotencyKey" IS NOT NULL AND "claimHash" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "acp_approval_requests_workspaceId_idempotencyKey_key"
  ON "acp_approval_requests"("workspaceId", "idempotencyKey");
CREATE INDEX "acp_approval_requests_workspaceId_state_createdAt_idx"
  ON "acp_approval_requests"("workspaceId", "state", "createdAt" DESC);
CREATE INDEX "acp_approval_requests_workspaceId_taskId_runId_idx"
  ON "acp_approval_requests"("workspaceId", "taskId", "runId");

CREATE UNIQUE INDEX "acp_approval_decisions_workspaceId_idempotencyKey_key"
  ON "acp_approval_decisions"("workspaceId", "idempotencyKey");
CREATE INDEX "acp_approval_decisions_approvalRequestId_decidedAt_idx"
  ON "acp_approval_decisions"("approvalRequestId", "decidedAt" DESC);

CREATE UNIQUE INDEX "acp_execution_permits_approvalRequestId_key"
  ON "acp_execution_permits"("approvalRequestId");
CREATE UNIQUE INDEX "acp_execution_permits_workspaceId_issueIdempotencyKey_key"
  ON "acp_execution_permits"("workspaceId", "issueIdempotencyKey");
CREATE UNIQUE INDEX "acp_execution_permits_workspaceId_claimIdempotencyKey_key"
  ON "acp_execution_permits"("workspaceId", "claimIdempotencyKey");
CREATE INDEX "acp_execution_permits_workspaceId_taskId_runId_idx"
  ON "acp_execution_permits"("workspaceId", "taskId", "runId");
CREATE INDEX "acp_execution_permits_expiresAt_idx" ON "acp_execution_permits"("expiresAt");

ALTER TABLE "acp_approval_requests" ADD CONSTRAINT "acp_approval_requests_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_approval_decisions" ADD CONSTRAINT "acp_approval_decisions_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_approval_decisions" ADD CONSTRAINT "acp_approval_decisions_approvalRequestId_fkey"
  FOREIGN KEY ("approvalRequestId") REFERENCES "acp_approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_approval_decisions" ADD CONSTRAINT "acp_approval_decisions_approverId_fkey"
  FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "acp_execution_permits" ADD CONSTRAINT "acp_execution_permits_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acp_execution_permits" ADD CONSTRAINT "acp_execution_permits_approvalRequestId_fkey"
  FOREIGN KEY ("approvalRequestId") REFERENCES "acp_approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "guard_acp_approval_request_binding"()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW."id", NEW."workspaceId", NEW."objectiveId", NEW."taskId", NEW."runId",
    NEW."actionCode", NEW."exactTarget", NEW."artifactVersionId", NEW."evidenceHash",
    NEW."policyVersion", NEW."policyHash", NEW."bindingHash", NEW."requesterReference",
    NEW."requesterActorKind", NEW."requesterAuthorityLevel", NEW."requiredAuthorityLevel", NEW."idempotencyKey",
    NEW."expiresAt", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."workspaceId", OLD."objectiveId", OLD."taskId", OLD."runId",
    OLD."actionCode", OLD."exactTarget", OLD."artifactVersionId", OLD."evidenceHash",
    OLD."policyVersion", OLD."policyHash", OLD."bindingHash", OLD."requesterReference",
    OLD."requesterActorKind", OLD."requesterAuthorityLevel", OLD."requiredAuthorityLevel", OLD."idempotencyKey",
    OLD."expiresAt", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'ACP approval binding is immutable';
  END IF;
  IF NOT (
    (OLD."state" = 'PENDING' AND NEW."state" IN ('APPROVED', 'REJECTED')) OR
    (OLD."state" = 'APPROVED' AND NEW."state" IN ('REVOKED', 'PERMIT_ISSUED')) OR
    (OLD."state" = 'PERMIT_ISSUED' AND NEW."state" IN ('REVOKED', 'PERMIT_CLAIMED'))
  ) THEN
    RAISE EXCEPTION 'Invalid ACP approval state transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "acp_approval_requests_binding_guard"
BEFORE UPDATE ON "acp_approval_requests"
FOR EACH ROW EXECUTE FUNCTION "guard_acp_approval_request_binding"();

CREATE OR REPLACE FUNCTION "guard_acp_approval_decision_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW."id", NEW."workspaceId", NEW."approvalRequestId", NEW."decision",
    NEW."approverReference", NEW."approverAuthorityLevel", NEW."bindingHash",
    NEW."artifactVersionId", NEW."evidenceHash", NEW."policyVersion", NEW."policyHash",
    NEW."idempotencyKey", NEW."decidedAt", NEW."expiresAt", NEW."decisionHash", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."workspaceId", OLD."approvalRequestId", OLD."decision",
    OLD."approverReference", OLD."approverAuthorityLevel", OLD."bindingHash",
    OLD."artifactVersionId", OLD."evidenceHash", OLD."policyVersion", OLD."policyHash",
    OLD."idempotencyKey", OLD."decidedAt", OLD."expiresAt", OLD."decisionHash", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'ACP approval decision is immutable';
  END IF;
  IF NEW."approverId" IS DISTINCT FROM OLD."approverId"
     AND NOT (OLD."approverId" IS NOT NULL AND NEW."approverId" IS NULL) THEN
    RAISE EXCEPTION 'ACP approval approver relation may only be cleared for erasure';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "acp_approval_decisions_immutable_guard"
BEFORE UPDATE ON "acp_approval_decisions"
FOR EACH ROW EXECUTE FUNCTION "guard_acp_approval_decision_immutable"();

CREATE OR REPLACE FUNCTION "guard_acp_execution_permit"()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW."id", NEW."workspaceId", NEW."approvalRequestId", NEW."taskId", NEW."runId",
    NEW."actionCode", NEW."exactTarget", NEW."artifactVersionId", NEW."evidenceHash",
    NEW."policyVersion", NEW."policyHash", NEW."bindingHash",
    NEW."executionPrincipalReference", NEW."issueIdempotencyKey", NEW."issuedAt",
    NEW."expiresAt", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."workspaceId", OLD."approvalRequestId", OLD."taskId", OLD."runId",
    OLD."actionCode", OLD."exactTarget", OLD."artifactVersionId", OLD."evidenceHash",
    OLD."policyVersion", OLD."policyHash", OLD."bindingHash",
    OLD."executionPrincipalReference", OLD."issueIdempotencyKey", OLD."issuedAt",
    OLD."expiresAt", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'ACP execution permit binding is immutable';
  END IF;
  IF OLD."claimedAt" IS NOT NULL OR NEW."claimedAt" IS NULL THEN
    RAISE EXCEPTION 'ACP execution permit claim may occur exactly once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "acp_execution_permits_guard"
BEFORE UPDATE ON "acp_execution_permits"
FOR EACH ROW EXECUTE FUNCTION "guard_acp_execution_permit"();
