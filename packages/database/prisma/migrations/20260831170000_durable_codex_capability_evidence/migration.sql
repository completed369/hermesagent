CREATE FUNCTION ventureos_codex_capability_codes_valid(value TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT
    cardinality(value) > 0 AND
    cardinality(value) <= 32 AND
    value = ARRAY(SELECT DISTINCT code FROM unnest(value) code ORDER BY code) AND
    NOT EXISTS (
      SELECT 1 FROM unnest(value) code
      WHERE code !~ '^codex\.catalog\.[a-z0-9._-]{1,111}$'
    );
$$;

CREATE TABLE "acp_runtime_capability_evidence" (
  "workspaceId" UUID NOT NULL,
  "capabilityCandidateHash" TEXT NOT NULL,
  "registrationCandidateHash" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "principalReference" TEXT NOT NULL,
  "adapterKind" TEXT NOT NULL,
  "authGeneration" INTEGER NOT NULL,
  "bridgeIdentityHash" TEXT NOT NULL,
  "accountEvidenceHash" TEXT NOT NULL,
  "modelCatalogHash" TEXT NOT NULL,
  "capabilityCodes" TEXT[] NOT NULL,
  "capabilityDigest" TEXT NOT NULL,
  "modelCount" INTEGER NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "authorizationRequestHash" TEXT NOT NULL,
  "authorizedByReference" TEXT NOT NULL,
  "authorizationIssuedAt" TIMESTAMP(3) NOT NULL,
  "authorizationExpiresAt" TIMESTAMP(3) NOT NULL,
  "capabilityPolicyHash" TEXT NOT NULL,
  "capabilityIdempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_runtime_capability_evidence_pkey"
    PRIMARY KEY ("workspaceId", "capabilityCandidateHash"),
  CONSTRAINT "acp_runtime_capability_evidence_adapter_check"
    CHECK ("adapterKind" = 'CODEX_APP_SERVER_STDIO_V1'),
  CONSTRAINT "acp_runtime_capability_evidence_generation_check"
    CHECK ("authGeneration" = 1),
  CONSTRAINT "acp_runtime_capability_evidence_count_check"
    CHECK ("modelCount" > 0 AND "modelCount" <= 100),
  CONSTRAINT "acp_runtime_capability_evidence_codes_check"
    CHECK (ventureos_codex_capability_codes_valid("capabilityCodes")),
  CONSTRAINT "acp_runtime_capability_evidence_digest_check"
    CHECK (
      "capabilityCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "registrationCandidateHash" ~ '^[a-f0-9]{64}$' AND
      "bridgeIdentityHash" ~ '^[a-f0-9]{64}$' AND
      "accountEvidenceHash" ~ '^[a-f0-9]{64}$' AND
      "modelCatalogHash" ~ '^[a-f0-9]{64}$' AND
      "capabilityDigest" ~ '^[a-f0-9]{64}$' AND
      "authorizationRequestHash" ~ '^[a-f0-9]{64}$' AND
      "capabilityPolicyHash" ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT "acp_runtime_capability_evidence_authorization_window_check"
    CHECK (
      "authorizationExpiresAt" > "authorizationIssuedAt" AND
      "authorizationExpiresAt" <= "authorizationIssuedAt" + INTERVAL '5 minutes'
    )
);

CREATE UNIQUE INDEX "acp_runtime_capability_evidence_workspace_idempotency_key"
  ON "acp_runtime_capability_evidence"("workspaceId", "capabilityIdempotencyKey");
CREATE UNIQUE INDEX "acp_runtime_capability_evidence_workspace_authorization_key"
  ON "acp_runtime_capability_evidence"("workspaceId", "authorizationId");
CREATE INDEX "acp_runtime_capability_evidence_workspace_runtime_connection_idx"
  ON "acp_runtime_capability_evidence"("workspaceId", "runtimeId", "connectionId");
CREATE INDEX "acp_runtime_capability_evidence_workspace_registration_idx"
  ON "acp_runtime_capability_evidence"("workspaceId", "registrationCandidateHash");

ALTER TABLE "acp_runtime_capability_evidence"
  ADD CONSTRAINT "acp_runtime_capability_evidence_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_runtime_capability_evidence_connection_fkey"
    FOREIGN KEY ("workspaceId", "connectionId", "runtimeId")
    REFERENCES "acp_runtime_connections"("workspaceId", "id", "runtimeId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "acp_runtime_capability_evidence_registration_fkey"
    FOREIGN KEY ("workspaceId", "registrationCandidateHash")
    REFERENCES "acp_runtime_registration_evidence"("workspaceId", "registrationCandidateHash")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_reject_capability_evidence_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'runtime capability evidence is immutable';
END;
$$;

CREATE TRIGGER acp_runtime_capability_evidence_immutable
  BEFORE UPDATE ON "acp_runtime_capability_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_capability_evidence_update();
