CREATE TABLE "acp_runtime_heartbeat_evidence" (
  "workspaceId" UUID NOT NULL,
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
  "sequence" INTEGER NOT NULL,
  "messageId" TEXT NOT NULL,
  "health" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "envelopeDigest" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "heartbeatIdempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_runtime_heartbeat_evidence_pkey"
    PRIMARY KEY ("workspaceId", "heartbeatCandidateHash"),
  CONSTRAINT "acp_runtime_heartbeat_evidence_adapter_check"
    CHECK ("adapterKind" = 'CODEX_APP_SERVER_STDIO_V1'),
  CONSTRAINT "acp_runtime_heartbeat_evidence_generation_check"
    CHECK ("authGeneration" = 1),
  CONSTRAINT "acp_runtime_heartbeat_evidence_sequence_check"
    CHECK ("sequence" = 1),
  CONSTRAINT "acp_runtime_heartbeat_evidence_health_check"
    CHECK ("health" IN ('HEALTHY', 'DEGRADED')),
  CONSTRAINT "acp_runtime_heartbeat_evidence_digest_check"
    CHECK (
      "heartbeatCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "registrationCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "capabilityCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "bridgeIdentityHash" ~ '^[a-f0-9]{64}$' AND
      "secretBindingHash" ~ '^[a-f0-9]{64}$' AND
      "capabilityDigest" ~ '^[a-f0-9]{64}$' AND
      "payloadDigest" ~ '^[a-f0-9]{64}$' AND
      "envelopeDigest" ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT "acp_runtime_heartbeat_evidence_window_check"
    CHECK (
      "expiresAt" > "issuedAt" AND
      "expiresAt" <= "issuedAt" + INTERVAL '5 minutes'
    )
);

CREATE UNIQUE INDEX "acp_runtime_heartbeat_evidence_workspace_idempotency_key"
  ON "acp_runtime_heartbeat_evidence"("workspaceId", "heartbeatIdempotencyKey");
CREATE UNIQUE INDEX "acp_runtime_heartbeat_evidence_workspace_message_key"
  ON "acp_runtime_heartbeat_evidence"("workspaceId", "messageId");
CREATE UNIQUE INDEX "acp_runtime_heartbeat_evidence_workspace_connection_sequence_key"
  ON "acp_runtime_heartbeat_evidence"("workspaceId", "connectionId", "sequence");
CREATE INDEX "acp_runtime_heartbeat_evidence_workspace_runtime_connection_idx"
  ON "acp_runtime_heartbeat_evidence"("workspaceId", "runtimeId", "connectionId");

CREATE UNIQUE INDEX "acp_runtime_registration_evidence_heartbeat_binding_key"
  ON "acp_runtime_registration_evidence"(
    "workspaceId", "registrationCandidateHash", "runtimeId", "connectionId", "sessionId",
    "principalReference", "authGeneration", "bridgeIdentityHash", "secretBindingHash"
  );
CREATE UNIQUE INDEX "acp_runtime_capability_evidence_heartbeat_binding_key"
  ON "acp_runtime_capability_evidence"(
    "workspaceId", "capabilityCandidateHash", "registrationCandidateHash", "runtimeId",
    "connectionId", "sessionId", "principalReference", "authGeneration", "bridgeIdentityHash",
    "capabilityDigest"
  );

ALTER TABLE "acp_runtime_heartbeat_evidence"
  ADD CONSTRAINT "acp_runtime_heartbeat_evidence_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_runtime_heartbeat_evidence_connection_fkey"
    FOREIGN KEY ("workspaceId", "connectionId", "runtimeId")
    REFERENCES "acp_runtime_connections"("workspaceId", "id", "runtimeId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_runtime_heartbeat_evidence_registration_fkey"
    FOREIGN KEY (
      "workspaceId", "registrationCandidateHash", "runtimeId", "connectionId", "sessionId",
      "principalReference", "authGeneration", "bridgeIdentityHash", "secretBindingHash"
    ) REFERENCES "acp_runtime_registration_evidence"(
      "workspaceId", "registrationCandidateHash", "runtimeId", "connectionId", "sessionId",
      "principalReference", "authGeneration", "bridgeIdentityHash", "secretBindingHash"
    )
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_runtime_heartbeat_evidence_capability_fkey"
    FOREIGN KEY (
      "workspaceId", "capabilityCandidateHash", "registrationCandidateHash", "runtimeId",
      "connectionId", "sessionId", "principalReference", "authGeneration", "bridgeIdentityHash",
      "capabilityDigest"
    ) REFERENCES "acp_runtime_capability_evidence"(
      "workspaceId", "capabilityCandidateHash", "registrationCandidateHash", "runtimeId",
      "connectionId", "sessionId", "principalReference", "authGeneration", "bridgeIdentityHash",
      "capabilityDigest"
    )
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_reject_heartbeat_evidence_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'runtime heartbeat evidence is immutable';
END;
$$;

CREATE TRIGGER acp_runtime_heartbeat_evidence_immutable
  BEFORE UPDATE ON "acp_runtime_heartbeat_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_heartbeat_evidence_update();
