CREATE TABLE "acp_retained_native_module_authorization_issuance_evidence" (
  "workspaceId" UUID NOT NULL,
  "supervisorInstanceId" TEXT NOT NULL,
  "snapshotVersion" INTEGER NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "signerKeyId" TEXT NOT NULL,
  "issuanceRequestHash" TEXT NOT NULL,
  "issuanceAuthorizationId" TEXT NOT NULL,
  "authorityRequestHash" TEXT NOT NULL,
  "approvalId" TEXT NOT NULL,
  "approvalEvidenceHash" TEXT NOT NULL,
  "authorizedByReference" TEXT NOT NULL,
  "authorityLevel" INTEGER NOT NULL,
  "authorizedFrom" TIMESTAMPTZ(3) NOT NULL,
  "authorizedUntil" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_rn_module_auth_issuance_evidence_pkey"
    PRIMARY KEY ("supervisorInstanceId", "snapshotVersion"),
  CONSTRAINT "acp_rn_module_auth_issuance_level_check" CHECK ("authorityLevel" = 3),
  CONSTRAINT "acp_rn_module_auth_issuance_version_check"
    CHECK ("snapshotVersion" BETWEEN 1 AND 1000000),
  CONSTRAINT "acp_rn_module_auth_issuance_window_check" CHECK (
    "authorizedUntil" > "authorizedFrom" AND
    "authorizedUntil" <= "authorizedFrom" + INTERVAL '5 minutes'
  ),
  CONSTRAINT "acp_rn_module_auth_issuance_hash_check" CHECK (
    "snapshotHash" ~ '^[a-f0-9]{64}$' AND
    "issuanceRequestHash" ~ '^[a-f0-9]{64}$' AND
    "authorityRequestHash" ~ '^[a-f0-9]{64}$' AND
    "approvalEvidenceHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "acp_rn_module_auth_issuance_reference_check" CHECK (
    "supervisorInstanceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "snapshotId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "signerKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "issuanceAuthorizationId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "approvalId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "authorizedByReference" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$'
  ),
  CONSTRAINT "acp_rn_module_auth_issuance_private_text_check" CHECK (
    lower("issuanceAuthorizationId") !~ '(password|credential|api[-_. ]?key|access[-_. ]?token|auth(orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)' AND
    lower("approvalId") !~ '(password|credential|api[-_. ]?key|access[-_. ]?token|auth(orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)' AND
    lower("authorizedByReference") !~ '(password|credential|api[-_. ]?key|access[-_. ]?token|auth(orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)'
  ),
  CONSTRAINT "acp_rn_module_auth_issuance_snapshot_fkey"
    FOREIGN KEY ("supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId")
    REFERENCES "acp_retained_native_module_authorization_snapshots"(
      "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId"
    ) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "acp_rn_module_auth_issuance_request_hash_key"
  ON "acp_retained_native_module_authorization_issuance_evidence"("issuanceRequestHash");
CREATE UNIQUE INDEX "acp_rn_module_auth_issuance_snapshot_binding_key"
  ON "acp_retained_native_module_authorization_issuance_evidence"(
    "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId"
  );
CREATE UNIQUE INDEX "acp_rn_module_auth_issuance_workspace_auth_key"
  ON "acp_retained_native_module_authorization_issuance_evidence"(
    "workspaceId", "issuanceAuthorizationId"
  );
CREATE INDEX "acp_rn_module_auth_issuance_workspace_idx"
  ON "acp_retained_native_module_authorization_issuance_evidence"(
    "workspaceId", "createdAt" DESC
  );

CREATE OR REPLACE FUNCTION ventureos_require_fresh_native_module_issuance_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  database_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- The snapshot insert guard already holds this same transaction-scoped supervisor lock.
  -- Reacquiring it is safe and also protects direct evidence inserts.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."supervisorInstanceId", 90497));

  IF NEW."authorizedFrom" > database_now OR NEW."authorizedUntil" <= database_now THEN
    RAISE EXCEPTION 'Native-module authorization issuance evidence is not currently authorized';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "acp_retained_native_module_authorization_issuance_evidence" existing
    WHERE existing."supervisorInstanceId" = NEW."supervisorInstanceId"
      AND existing."workspaceId" <> NEW."workspaceId"
  ) THEN
    RAISE EXCEPTION 'Native-module authorization supervisor workspace binding denied';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_rn_module_auth_issuance_evidence_freshness
  BEFORE INSERT ON "acp_retained_native_module_authorization_issuance_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_require_fresh_native_module_issuance_evidence();

CREATE OR REPLACE FUNCTION ventureos_deny_native_module_issuance_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Native-module authorization issuance evidence is immutable';
END;
$$;

CREATE TRIGGER acp_rn_module_auth_issuance_evidence_update_deny
  BEFORE UPDATE ON "acp_retained_native_module_authorization_issuance_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_native_module_issuance_evidence_mutation();
CREATE TRIGGER acp_rn_module_auth_issuance_evidence_delete_deny
  BEFORE DELETE ON "acp_retained_native_module_authorization_issuance_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_native_module_issuance_evidence_mutation();
