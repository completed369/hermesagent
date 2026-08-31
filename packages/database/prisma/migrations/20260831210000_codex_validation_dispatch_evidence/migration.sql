CREATE TABLE "acp_codex_validation_dispatch_evidence" (
  "workspaceId" UUID NOT NULL,
  "validationDispatchCandidateHash" TEXT NOT NULL,
  "heartbeatCandidateHash" TEXT NOT NULL,
  "registrationCandidateHash" TEXT NOT NULL,
  "capabilityCandidateHash" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "principalReference" TEXT NOT NULL,
  "adapterKind" TEXT NOT NULL,
  "authGeneration" INTEGER NOT NULL,
  "bridgeIdentityHash" TEXT NOT NULL,
  "secretBindingHash" TEXT NOT NULL,
  "capabilityDigest" TEXT NOT NULL,
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
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "authorizationRequestHash" TEXT NOT NULL,
  "authorizedByReference" TEXT NOT NULL,
  "authorizationIssuedAt" TIMESTAMP(3) NOT NULL,
  "authorizationExpiresAt" TIMESTAMP(3) NOT NULL,
  "dispatchIdempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_codex_validation_dispatch_evidence_pkey"
    PRIMARY KEY ("workspaceId", "validationDispatchCandidateHash"),
  CONSTRAINT "acp_codex_validation_dispatch_adapter_check"
    CHECK ("adapterKind" = 'CODEX_APP_SERVER_STDIO_V1'),
  CONSTRAINT "acp_codex_validation_dispatch_generation_check"
    CHECK ("authGeneration" = 1),
  CONSTRAINT "acp_codex_validation_dispatch_authority_check"
    CHECK ("authorityLevel" BETWEEN 0 AND 3),
  CONSTRAINT "acp_codex_validation_dispatch_limits_check"
    CHECK (
      "maximumComputeUnits" BETWEEN 1 AND 100 AND
      "maximumCostMinorUnits" = 0 AND
      "maximumDurationMs" BETWEEN 1 AND 60000 AND
      "outboundSequence" = 1 AND
      "messageId" = "dispatchId" AND
      "challengeCode" = 'codex.runtime.round-trip.v1'
    ),
  CONSTRAINT "acp_codex_validation_dispatch_digest_check"
    CHECK (
      "validationDispatchCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "heartbeatCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "registrationCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "capabilityCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "bridgeIdentityHash" ~ '^[a-f0-9]{64}$' AND
      "secretBindingHash" ~ '^[a-f0-9]{64}$' AND
      "capabilityDigest" ~ '^[a-f0-9]{64}$' AND
      "taskPolicyHash" ~ '^[a-f0-9]{64}$' AND
      "payloadDigest" ~ '^[a-f0-9]{64}$' AND
      "unsignedEnvelopeDigest" ~ '^[a-f0-9]{64}$' AND
      "signedEnvelopeDigest" ~ '^[a-f0-9]{64}$' AND
      "authenticationTagDigest" ~ '^[a-f0-9]{64}$' AND
      "authorizationRequestHash" ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT "acp_codex_validation_dispatch_window_check"
    CHECK (
      "expiresAt" > "issuedAt" AND
      "expiresAt" <= "issuedAt" + INTERVAL '60 seconds' AND
      "authorizationExpiresAt" > "authorizationIssuedAt" AND
      "authorizationExpiresAt" <= "authorizationIssuedAt" + INTERVAL '5 minutes'
    )
);

CREATE UNIQUE INDEX "acp_codex_validation_dispatch_workspace_idempotency_key"
  ON "acp_codex_validation_dispatch_evidence"("workspaceId", "dispatchIdempotencyKey");
CREATE UNIQUE INDEX "acp_codex_validation_dispatch_workspace_authorization_key"
  ON "acp_codex_validation_dispatch_evidence"("workspaceId", "authorizationId");
CREATE UNIQUE INDEX "acp_codex_validation_dispatch_workspace_dispatch_key"
  ON "acp_codex_validation_dispatch_evidence"("workspaceId", "dispatchId");
CREATE UNIQUE INDEX "acp_codex_validation_dispatch_workspace_message_key"
  ON "acp_codex_validation_dispatch_evidence"("workspaceId", "sessionId", "messageId");
CREATE UNIQUE INDEX "acp_codex_validation_dispatch_workspace_heartbeat_key"
  ON "acp_codex_validation_dispatch_evidence"("workspaceId", "heartbeatCandidateHash");
CREATE UNIQUE INDEX "acp_codex_validation_dispatch_workspace_run_key"
  ON "acp_codex_validation_dispatch_evidence"("workspaceId", "runId");
CREATE INDEX "acp_codex_validation_dispatch_workspace_run_idx"
  ON "acp_codex_validation_dispatch_evidence"("workspaceId", "runId", "createdAt");

CREATE UNIQUE INDEX "acp_runtime_heartbeat_evidence_dispatch_binding_key"
  ON "acp_runtime_heartbeat_evidence"(
    "workspaceId", "heartbeatCandidateHash", "registrationCandidateHash",
    "capabilityCandidateHash", "runtimeId", "connectionId", "sessionId",
    "principalReference", "authGeneration", "bridgeIdentityHash", "secretBindingHash",
    "capabilityDigest"
  );

ALTER TABLE "acp_codex_validation_dispatch_evidence"
  ADD CONSTRAINT "acp_codex_validation_dispatch_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_codex_validation_dispatch_connection_fkey"
    FOREIGN KEY ("workspaceId", "connectionId", "runtimeId")
    REFERENCES "acp_runtime_connections"("workspaceId", "id", "runtimeId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_codex_validation_dispatch_task_fkey"
    FOREIGN KEY ("workspaceId", "taskId") REFERENCES "acp_tasks"("workspaceId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_codex_validation_dispatch_run_fkey"
    FOREIGN KEY ("workspaceId", "runId") REFERENCES "acp_runs"("workspaceId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_codex_validation_dispatch_heartbeat_fkey"
    FOREIGN KEY (
      "workspaceId", "heartbeatCandidateHash", "registrationCandidateHash",
      "capabilityCandidateHash", "runtimeId", "connectionId", "sessionId",
      "principalReference", "authGeneration", "bridgeIdentityHash", "secretBindingHash",
      "capabilityDigest"
    ) REFERENCES "acp_runtime_heartbeat_evidence"(
      "workspaceId", "heartbeatCandidateHash", "registrationCandidateHash",
      "capabilityCandidateHash", "runtimeId", "connectionId", "sessionId",
      "principalReference", "authGeneration", "bridgeIdentityHash", "secretBindingHash",
      "capabilityDigest"
    ) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_reject_codex_validation_dispatch_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Codex validation dispatch evidence is immutable';
END;
$$;

CREATE TRIGGER acp_codex_validation_dispatch_evidence_immutable
  BEFORE UPDATE ON "acp_codex_validation_dispatch_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_codex_validation_dispatch_update();
