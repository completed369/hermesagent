CREATE TABLE "acp_retained_native_module_authorization_root_scopes" (
  "supervisorInstanceId" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_retained_native_module_authorization_root_scopes_pkey"
    PRIMARY KEY ("supervisorInstanceId"),
  CONSTRAINT "acp_rn_module_auth_root_scopes_reference_check"
    CHECK ("supervisorInstanceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$')
);

CREATE UNIQUE INDEX "acp_rn_module_auth_root_scopes_binding_key"
  ON "acp_retained_native_module_authorization_root_scopes"(
    "supervisorInstanceId", "workspaceId"
  );

CREATE TABLE "acp_retained_native_module_authorization_roots" (
  "workspaceId" UUID NOT NULL,
  "supervisorInstanceId" TEXT NOT NULL,
  "rootRecordId" TEXT NOT NULL,
  "rootRecordVersion" INTEGER NOT NULL,
  "signerKeyId" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "publicKeySpkiBase64" TEXT NOT NULL,
  "publicKeySpkiSha256" TEXT NOT NULL,
  "minimumSnapshotVersion" INTEGER NOT NULL,
  "validFrom" TIMESTAMPTZ(3) NOT NULL,
  "validUntil" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "testOnly" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_retained_native_module_authorization_roots_pkey"
    PRIMARY KEY ("workspaceId", "supervisorInstanceId", "rootRecordId", "rootRecordVersion"),
  CONSTRAINT "acp_rn_module_auth_root_kind_check" CHECK (
    "algorithm" = 'ED25519' AND
    "purpose" = 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT' AND
    "testOnly" = false
  ),
  CONSTRAINT "acp_rn_module_auth_root_version_check" CHECK (
    "rootRecordVersion" BETWEEN 1 AND 1000000 AND
    "minimumSnapshotVersion" BETWEEN 1 AND 1000000
  ),
  CONSTRAINT "acp_rn_module_auth_root_window_check" CHECK (
    "validUntil" > "validFrom" AND
    "validUntil" <= "validFrom" + INTERVAL '1830 days' AND
    ("revokedAt" IS NULL OR "revokedAt" BETWEEN "validFrom" AND "validUntil")
  ),
  CONSTRAINT "acp_rn_module_auth_root_fingerprint_check"
    CHECK ("publicKeySpkiSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "acp_rn_module_auth_root_reference_check" CHECK (
    "supervisorInstanceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "rootRecordId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "signerKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$'
  ),
  CONSTRAINT "acp_rn_module_auth_roots_scope_fkey"
    FOREIGN KEY ("supervisorInstanceId", "workspaceId")
    REFERENCES "acp_retained_native_module_authorization_root_scopes"(
      "supervisorInstanceId", "workspaceId"
    ) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "acp_rn_module_auth_roots_scope_idx"
  ON "acp_retained_native_module_authorization_roots"(
    "workspaceId", "supervisorInstanceId", "createdAt" DESC
  );

CREATE TABLE "acp_retained_native_module_authorization_root_evidence" (
  "workspaceId" UUID NOT NULL,
  "supervisorInstanceId" TEXT NOT NULL,
  "rootRecordId" TEXT NOT NULL,
  "rootRecordVersion" INTEGER NOT NULL,
  "signerKeyId" TEXT NOT NULL,
  "publicKeySpkiSha256" TEXT NOT NULL,
  "provisioningRequestHash" TEXT NOT NULL,
  "provisioningAuthorizationId" TEXT NOT NULL,
  "approvalId" TEXT NOT NULL,
  "approvalEvidenceHash" TEXT NOT NULL,
  "authorizedByReference" TEXT NOT NULL,
  "authorityLevel" INTEGER NOT NULL,
  "authorizedFrom" TIMESTAMPTZ(3) NOT NULL,
  "authorizedUntil" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_retained_native_module_authorization_root_evidence_pkey"
    PRIMARY KEY ("workspaceId", "supervisorInstanceId", "rootRecordId", "rootRecordVersion"),
  CONSTRAINT "acp_rn_module_auth_root_evidence_level_check" CHECK ("authorityLevel" = 3),
  CONSTRAINT "acp_rn_module_auth_root_evidence_window_check" CHECK (
    "authorizedUntil" > "authorizedFrom" AND
    "authorizedUntil" <= "authorizedFrom" + INTERVAL '5 minutes'
  ),
  CONSTRAINT "acp_rn_module_auth_root_evidence_hash_check" CHECK (
    "publicKeySpkiSha256" ~ '^[a-f0-9]{64}$' AND
    "provisioningRequestHash" ~ '^[a-f0-9]{64}$' AND
    "approvalEvidenceHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "acp_rn_module_auth_root_evidence_reference_check" CHECK (
    "supervisorInstanceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "rootRecordId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "signerKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "provisioningAuthorizationId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "approvalId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "authorizedByReference" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$'
  ),
  CONSTRAINT "acp_rn_module_auth_root_evidence_private_text_check" CHECK (
    lower("provisioningAuthorizationId") !~ '(password|credential|api[-_. ]?key|access[-_. ]?token|auth(orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)' AND
    lower("approvalId") !~ '(password|credential|api[-_. ]?key|access[-_. ]?token|auth(orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)' AND
    lower("authorizedByReference") !~ '(password|credential|api[-_. ]?key|access[-_. ]?token|auth(orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)'
  ),
  CONSTRAINT "acp_rn_module_auth_root_evidence_root_fkey"
    FOREIGN KEY ("workspaceId", "supervisorInstanceId", "rootRecordId", "rootRecordVersion")
    REFERENCES "acp_retained_native_module_authorization_roots"(
      "workspaceId", "supervisorInstanceId", "rootRecordId", "rootRecordVersion"
    ) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "acp_rn_module_auth_root_evidence_request_hash_key"
  ON "acp_retained_native_module_authorization_root_evidence"("provisioningRequestHash");
CREATE UNIQUE INDEX "acp_rn_module_auth_root_evidence_workspace_auth_key"
  ON "acp_retained_native_module_authorization_root_evidence"(
    "workspaceId", "provisioningAuthorizationId"
  );
CREATE INDEX "acp_rn_module_auth_root_evidence_scope_idx"
  ON "acp_retained_native_module_authorization_root_evidence"(
    "workspaceId", "supervisorInstanceId", "createdAt" DESC
  );

CREATE OR REPLACE FUNCTION ventureos_guard_native_module_public_root_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  latest "acp_retained_native_module_authorization_roots"%ROWTYPE;
  active_root_count INTEGER;
BEGIN
  -- Lock globally by supervisor so concurrent first inserts from two tenants
  -- cannot both observe an unbound instance.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."supervisorInstanceId", 90503));

  IF EXISTS (
    SELECT 1 FROM "acp_retained_native_module_authorization_roots" existing
    WHERE existing."supervisorInstanceId" = NEW."supervisorInstanceId"
      AND existing."workspaceId" <> NEW."workspaceId"
  ) THEN
    RAISE EXCEPTION 'Native-module public-root cross-workspace supervisor binding denied';
  END IF;

  SELECT * INTO latest
  FROM "acp_retained_native_module_authorization_roots"
  WHERE "workspaceId" = NEW."workspaceId"
    AND "supervisorInstanceId" = NEW."supervisorInstanceId"
    AND "rootRecordId" = NEW."rootRecordId"
  ORDER BY "rootRecordVersion" DESC
  LIMIT 1;

  IF NOT FOUND THEN
    IF NEW."rootRecordVersion" <> 1 THEN
      RAISE EXCEPTION 'Native-module public-root bootstrap version denied';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "acp_retained_native_module_authorization_roots" existing
      WHERE existing."workspaceId" = NEW."workspaceId"
        AND existing."supervisorInstanceId" = NEW."supervisorInstanceId"
        AND (existing."signerKeyId" = NEW."signerKeyId"
          OR existing."publicKeySpkiSha256" = NEW."publicKeySpkiSha256")
    ) THEN
      RAISE EXCEPTION 'Native-module public-root signer identity reuse denied';
    END IF;
    SELECT count(*) INTO active_root_count
    FROM (
      SELECT DISTINCT ON ("rootRecordId") "validUntil", "revokedAt"
      FROM "acp_retained_native_module_authorization_roots"
      WHERE "workspaceId" = NEW."workspaceId"
        AND "supervisorInstanceId" = NEW."supervisorInstanceId"
      ORDER BY "rootRecordId", "rootRecordVersion" DESC
    ) current_roots
    WHERE current_roots."validUntil" > clock_timestamp()
      AND (current_roots."revokedAt" IS NULL OR current_roots."revokedAt" > clock_timestamp());
    IF active_root_count >= 8 AND NEW."validUntil" > clock_timestamp()
      AND (NEW."revokedAt" IS NULL OR NEW."revokedAt" > clock_timestamp()) THEN
      RAISE EXCEPTION 'Native-module active public-root bound exceeded';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."rootRecordVersion" = latest."rootRecordVersion" THEN
    IF NEW."signerKeyId" IS DISTINCT FROM latest."signerKeyId" OR
       NEW."algorithm" IS DISTINCT FROM latest."algorithm" OR
       NEW."purpose" IS DISTINCT FROM latest."purpose" OR
       NEW."publicKeySpkiBase64" IS DISTINCT FROM latest."publicKeySpkiBase64" OR
       NEW."publicKeySpkiSha256" IS DISTINCT FROM latest."publicKeySpkiSha256" OR
       NEW."minimumSnapshotVersion" IS DISTINCT FROM latest."minimumSnapshotVersion" OR
       NEW."validFrom" IS DISTINCT FROM latest."validFrom" OR
       NEW."validUntil" IS DISTINCT FROM latest."validUntil" OR
       NEW."revokedAt" IS DISTINCT FROM latest."revokedAt" OR
       NEW."testOnly" IS DISTINCT FROM latest."testOnly" THEN
      RAISE EXCEPTION 'Native-module public-root equivocation denied';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."rootRecordVersion" <> latest."rootRecordVersion" + 1 OR
     NEW."signerKeyId" IS DISTINCT FROM latest."signerKeyId" OR
     NEW."algorithm" IS DISTINCT FROM latest."algorithm" OR
     NEW."purpose" IS DISTINCT FROM latest."purpose" OR
     NEW."publicKeySpkiBase64" IS DISTINCT FROM latest."publicKeySpkiBase64" OR
     NEW."publicKeySpkiSha256" IS DISTINCT FROM latest."publicKeySpkiSha256" OR
     NEW."validFrom" IS DISTINCT FROM latest."validFrom" OR
     NEW."validUntil" IS DISTINCT FROM latest."validUntil" OR
     NEW."testOnly" IS DISTINCT FROM latest."testOnly" OR
     NEW."minimumSnapshotVersion" < latest."minimumSnapshotVersion" OR
     (latest."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM latest."revokedAt") THEN
    RAISE EXCEPTION 'Native-module public-root version transition denied';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_rn_module_auth_root_insert_guard
  BEFORE INSERT ON "acp_retained_native_module_authorization_roots"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_native_module_public_root_insert();

CREATE OR REPLACE FUNCTION ventureos_require_native_module_public_root_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "acp_retained_native_module_authorization_root_evidence" evidence
    WHERE evidence."workspaceId" = NEW."workspaceId"
      AND evidence."supervisorInstanceId" = NEW."supervisorInstanceId"
      AND evidence."rootRecordId" = NEW."rootRecordId"
      AND evidence."rootRecordVersion" = NEW."rootRecordVersion"
      AND evidence."signerKeyId" = NEW."signerKeyId"
      AND evidence."publicKeySpkiSha256" = NEW."publicKeySpkiSha256"
  ) THEN
    RAISE EXCEPTION 'Native-module public-root Level-3 evidence is required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER acp_rn_module_auth_root_evidence_required
  AFTER INSERT ON "acp_retained_native_module_authorization_roots"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ventureos_require_native_module_public_root_evidence();

CREATE OR REPLACE FUNCTION ventureos_guard_native_module_public_root_evidence_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  database_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."supervisorInstanceId", 90503));
  IF NEW."authorizedFrom" > database_now OR NEW."authorizedUntil" <= database_now THEN
    RAISE EXCEPTION 'Native-module public-root evidence is not currently authorized';
  END IF;
  -- The deferred root constraint trigger verifies the redundant signer and
  -- fingerprint binding after this data-modifying CTE has completed. The FK
  -- independently binds this evidence to the exact root version.
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_rn_module_auth_root_evidence_insert_guard
  BEFORE INSERT ON "acp_retained_native_module_authorization_root_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_native_module_public_root_evidence_insert();

CREATE OR REPLACE FUNCTION ventureos_deny_native_module_public_root_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Native-module public-root state is immutable';
END;
$$;

CREATE OR REPLACE FUNCTION ventureos_guard_native_module_public_root_scope_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."supervisorInstanceId" IS DISTINCT FROM OLD."supervisorInstanceId" OR
     NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" OR
     NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Native-module public-root scope is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_rn_module_auth_root_scope_update_guard
  BEFORE UPDATE ON "acp_retained_native_module_authorization_root_scopes"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_native_module_public_root_scope_update();
CREATE TRIGGER acp_rn_module_auth_root_scope_delete_deny
  BEFORE DELETE ON "acp_retained_native_module_authorization_root_scopes"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_native_module_public_root_mutation();

CREATE TRIGGER acp_rn_module_auth_root_update_deny
  BEFORE UPDATE ON "acp_retained_native_module_authorization_roots"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_native_module_public_root_mutation();
CREATE TRIGGER acp_rn_module_auth_root_delete_deny
  BEFORE DELETE ON "acp_retained_native_module_authorization_roots"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_native_module_public_root_mutation();
CREATE TRIGGER acp_rn_module_auth_root_evidence_update_deny
  BEFORE UPDATE ON "acp_retained_native_module_authorization_root_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_native_module_public_root_mutation();
CREATE TRIGGER acp_rn_module_auth_root_evidence_delete_deny
  BEFORE DELETE ON "acp_retained_native_module_authorization_root_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_native_module_public_root_mutation();
