ALTER TABLE "acp_runtimes"
  DROP CONSTRAINT "acp_runtimes_adapter_check",
  ADD CONSTRAINT "acp_runtimes_adapter_check"
    CHECK ("adapterKind" IN ('PROTOCOL_NEUTRAL', 'DETERMINISTIC_FAKE', 'CODEX_APP_SERVER_STDIO_V1'));

CREATE TABLE "acp_runtime_registration_evidence" (
  "workspaceId" UUID NOT NULL,
  "registrationCandidateHash" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "principalReference" TEXT NOT NULL,
  "adapterKind" TEXT NOT NULL,
  "authGeneration" INTEGER NOT NULL,
  "accountAuthMode" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "adapterPolicyHash" TEXT NOT NULL,
  "bridgeIdentityHash" TEXT NOT NULL,
  "secretBindingHash" TEXT NOT NULL,
  "accountEvidenceHash" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "authorizationRequestHash" TEXT NOT NULL,
  "authorizedByReference" TEXT NOT NULL,
  "authorizationIssuedAt" TIMESTAMP(3) NOT NULL,
  "authorizationExpiresAt" TIMESTAMP(3) NOT NULL,
  "registrationIdempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_runtime_registration_evidence_pkey"
    PRIMARY KEY ("workspaceId", "registrationCandidateHash"),
  CONSTRAINT "acp_runtime_registration_evidence_adapter_check"
    CHECK ("adapterKind" = 'CODEX_APP_SERVER_STDIO_V1'),
  CONSTRAINT "acp_runtime_registration_evidence_generation_check"
    CHECK ("authGeneration" > 0),
  CONSTRAINT "acp_runtime_registration_evidence_account_check"
    CHECK ("accountAuthMode" IN ('KEY', 'CHATGPT')),
  CONSTRAINT "acp_runtime_registration_evidence_digest_check"
    CHECK (
      "registrationCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "manifestHash" ~ '^[a-f0-9]{64}$' AND
      "adapterPolicyHash" ~ '^[a-f0-9]{64}$' AND
      "bridgeIdentityHash" ~ '^[a-f0-9]{64}$' AND
      "secretBindingHash" ~ '^[a-f0-9]{64}$' AND
      "accountEvidenceHash" ~ '^[a-f0-9]{64}$' AND
      "authorizationRequestHash" ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT "acp_runtime_registration_evidence_authorization_window_check"
    CHECK (
      "authorizationExpiresAt" > "authorizationIssuedAt" AND
      "authorizationExpiresAt" <= "authorizationIssuedAt" + INTERVAL '5 minutes'
    )
);

CREATE UNIQUE INDEX "acp_runtime_registration_evidence_workspace_idempotency_key"
  ON "acp_runtime_registration_evidence"("workspaceId", "registrationIdempotencyKey");
CREATE UNIQUE INDEX "acp_runtime_registration_evidence_workspace_authorization_key"
  ON "acp_runtime_registration_evidence"("workspaceId", "authorizationId");
CREATE INDEX "acp_runtime_registration_evidence_workspace_runtime_connection_idx"
  ON "acp_runtime_registration_evidence"("workspaceId", "runtimeId", "connectionId");

ALTER TABLE "acp_runtime_registration_evidence"
  ADD CONSTRAINT "acp_runtime_registration_evidence_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_runtime_registration_evidence_connection_fkey"
    FOREIGN KEY ("workspaceId", "connectionId", "runtimeId")
    REFERENCES "acp_runtime_connections"("workspaceId", "id", "runtimeId")
    ON DELETE CASCADE ON UPDATE CASCADE;
