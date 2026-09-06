CREATE TABLE "acp_topology_carrier_signature_root_scopes" (
  "carrierId" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "supervisorInstanceId" TEXT NOT NULL,
  "bindingHash" TEXT NOT NULL,
  "coordinatorPrincipalReference" TEXT NOT NULL,
  "workerPrincipalReference" TEXT NOT NULL,
  "provisioningAttemptId" TEXT NOT NULL,
  "provisioningPlanHash" TEXT NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_topology_carrier_signature_root_scopes_pkey" PRIMARY KEY ("carrierId"),
  CONSTRAINT "acp_topology_carrier_root_scope_hash_check" CHECK (
    "bindingHash" ~ '^[a-f0-9]{64}$' AND "provisioningPlanHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "acp_topology_carrier_root_scope_window_check" CHECK (
    "expiresAt" > "issuedAt" AND "expiresAt" <= "issuedAt" + INTERVAL '5 seconds'
  ),
  CONSTRAINT "acp_topology_carrier_root_scope_principal_check" CHECK (
    "coordinatorPrincipalReference" <> "workerPrincipalReference"
  ),
  CONSTRAINT "acp_topology_carrier_root_scope_reference_check" CHECK (
    "carrierId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "supervisorInstanceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "coordinatorPrincipalReference" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "workerPrincipalReference" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "provisioningAttemptId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$'
  )
);

CREATE UNIQUE INDEX "acp_topology_carrier_root_scopes_binding_key"
  ON "acp_topology_carrier_signature_root_scopes"(
    "carrierId", "workspaceId", "supervisorInstanceId", "bindingHash"
  );
CREATE INDEX "acp_topology_carrier_root_scopes_scope_idx"
  ON "acp_topology_carrier_signature_root_scopes"(
    "workspaceId", "supervisorInstanceId", "createdAt" DESC
  );

CREATE TABLE "acp_topology_carrier_signature_roots" (
  "workspaceId" UUID NOT NULL,
  "supervisorInstanceId" TEXT NOT NULL,
  "carrierId" TEXT NOT NULL,
  "bindingHash" TEXT NOT NULL,
  "rootRecordId" TEXT NOT NULL,
  "rootRecordVersion" INTEGER NOT NULL,
  "signerKeyId" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "principalRole" TEXT NOT NULL,
  "principalReference" TEXT NOT NULL,
  "publicKeySpkiBase64" TEXT NOT NULL,
  "publicKeySpkiSha256" TEXT NOT NULL,
  "validFrom" TIMESTAMPTZ(3) NOT NULL,
  "validUntil" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "testOnly" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_topology_carrier_signature_roots_pkey"
    PRIMARY KEY ("workspaceId", "supervisorInstanceId", "carrierId", "principalRole"),
  CONSTRAINT "acp_topology_carrier_roots_kind_check" CHECK (
    "algorithm" = 'ED25519' AND
    "purpose" = 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY' AND
    "principalRole" IN ('API_COORDINATOR', 'WORKER_CLIENT') AND
    "rootRecordVersion" = 1 AND "revokedAt" IS NULL AND "testOnly" = false
  ),
  CONSTRAINT "acp_topology_carrier_roots_hash_check" CHECK (
    "bindingHash" ~ '^[a-f0-9]{64}$' AND "publicKeySpkiSha256" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "acp_topology_carrier_roots_window_check" CHECK (
    "validUntil" > "validFrom" AND
    "validUntil" <= "validFrom" + INTERVAL '1830 days'
  ),
  CONSTRAINT "acp_topology_carrier_roots_reference_check" CHECK (
    "supervisorInstanceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "carrierId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "rootRecordId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "signerKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "principalReference" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$'
  ),
  CONSTRAINT "acp_topology_carrier_roots_scope_fkey"
    FOREIGN KEY ("carrierId", "workspaceId", "supervisorInstanceId", "bindingHash")
    REFERENCES "acp_topology_carrier_signature_root_scopes"(
      "carrierId", "workspaceId", "supervisorInstanceId", "bindingHash"
    ) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "acp_topology_carrier_roots_record_key"
  ON "acp_topology_carrier_signature_roots"(
    "workspaceId", "supervisorInstanceId", "rootRecordId", "rootRecordVersion"
  );
CREATE INDEX "acp_topology_carrier_roots_binding_idx"
  ON "acp_topology_carrier_signature_roots"(
    "workspaceId", "supervisorInstanceId", "bindingHash"
  );

CREATE TABLE "acp_topology_carrier_signature_root_evidence" (
  "workspaceId" UUID NOT NULL,
  "supervisorInstanceId" TEXT NOT NULL,
  "carrierId" TEXT NOT NULL,
  "bindingHash" TEXT NOT NULL,
  "principalRole" TEXT NOT NULL,
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
  CONSTRAINT "acp_topology_carrier_signature_root_evidence_pkey"
    PRIMARY KEY ("workspaceId", "supervisorInstanceId", "carrierId", "principalRole"),
  CONSTRAINT "acp_topology_carrier_root_evidence_level_check" CHECK ("authorityLevel" = 3),
  CONSTRAINT "acp_topology_carrier_root_evidence_window_check" CHECK (
    "authorizedUntil" > "authorizedFrom" AND
    "authorizedUntil" <= "authorizedFrom" + INTERVAL '5 minutes'
  ),
  CONSTRAINT "acp_topology_carrier_root_evidence_hash_check" CHECK (
    "bindingHash" ~ '^[a-f0-9]{64}$' AND
    "publicKeySpkiSha256" ~ '^[a-f0-9]{64}$' AND
    "provisioningRequestHash" ~ '^[a-f0-9]{64}$' AND
    "approvalEvidenceHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "acp_topology_carrier_root_evidence_reference_check" CHECK (
    "supervisorInstanceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "carrierId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "rootRecordId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "signerKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "provisioningAuthorizationId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "approvalId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "authorizedByReference" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$'
  ),
  CONSTRAINT "acp_topology_carrier_root_evidence_private_text_check" CHECK (
    lower("provisioningAuthorizationId") !~ '(password|credential|api[-_. ]?key|access[-_. ]?token|auth(orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)' AND
    lower("approvalId") !~ '(password|credential|api[-_. ]?key|access[-_. ]?token|auth(orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)' AND
    lower("authorizedByReference") !~ '(password|credential|api[-_. ]?key|access[-_. ]?token|auth(orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)'
  ),
  CONSTRAINT "acp_topology_carrier_root_evidence_root_fkey"
    FOREIGN KEY ("workspaceId", "supervisorInstanceId", "carrierId", "principalRole")
    REFERENCES "acp_topology_carrier_signature_roots"(
      "workspaceId", "supervisorInstanceId", "carrierId", "principalRole"
    ) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "acp_topology_carrier_root_evidence_request_hash_key"
  ON "acp_topology_carrier_signature_root_evidence"("provisioningRequestHash");
CREATE UNIQUE INDEX "acp_topology_carrier_root_evidence_workspace_auth_key"
  ON "acp_topology_carrier_signature_root_evidence"(
    "workspaceId", "provisioningAuthorizationId"
  );
CREATE INDEX "acp_topology_carrier_root_evidence_scope_idx"
  ON "acp_topology_carrier_signature_root_evidence"(
    "workspaceId", "supervisorInstanceId", "createdAt" DESC
  );

CREATE OR REPLACE FUNCTION ventureos_guard_topology_carrier_root_scope_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE database_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."carrierId", 90504));
  IF NEW."issuedAt" > database_now OR NEW."expiresAt" <= database_now THEN
    RAISE EXCEPTION 'Topology carrier public root binding is not currently authorized';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_topology_carrier_root_scope_insert_guard
  BEFORE INSERT ON "acp_topology_carrier_signature_root_scopes"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_topology_carrier_root_scope_insert();

CREATE OR REPLACE FUNCTION ventureos_guard_topology_carrier_root_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  carrier_scope "acp_topology_carrier_signature_root_scopes"%ROWTYPE;
  existing_role "acp_topology_carrier_signature_roots"%ROWTYPE;
  root_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."carrierId", 90504));
  SELECT * INTO STRICT carrier_scope
  FROM "acp_topology_carrier_signature_root_scopes"
  WHERE "carrierId" = NEW."carrierId";

  IF NEW."workspaceId" IS DISTINCT FROM carrier_scope."workspaceId" OR
     NEW."supervisorInstanceId" IS DISTINCT FROM carrier_scope."supervisorInstanceId" OR
     NEW."bindingHash" IS DISTINCT FROM carrier_scope."bindingHash" OR
     NEW."validFrom" > carrier_scope."issuedAt" OR
     NEW."validUntil" < carrier_scope."expiresAt" OR
     NEW."principalReference" IS DISTINCT FROM CASE NEW."principalRole"
       WHEN 'API_COORDINATOR' THEN carrier_scope."coordinatorPrincipalReference"
       WHEN 'WORKER_CLIENT' THEN carrier_scope."workerPrincipalReference"
       ELSE NULL
     END THEN
    RAISE EXCEPTION 'Topology carrier public root exact binding denied';
  END IF;

  SELECT * INTO existing_role
  FROM "acp_topology_carrier_signature_roots"
  WHERE "workspaceId" = NEW."workspaceId"
    AND "supervisorInstanceId" = NEW."supervisorInstanceId"
    AND "carrierId" = NEW."carrierId"
    AND "principalRole" = NEW."principalRole";
  IF FOUND THEN
    IF NEW."bindingHash" IS DISTINCT FROM existing_role."bindingHash" OR
       NEW."rootRecordId" IS DISTINCT FROM existing_role."rootRecordId" OR
       NEW."rootRecordVersion" IS DISTINCT FROM existing_role."rootRecordVersion" OR
       NEW."signerKeyId" IS DISTINCT FROM existing_role."signerKeyId" OR
       NEW."algorithm" IS DISTINCT FROM existing_role."algorithm" OR
       NEW."purpose" IS DISTINCT FROM existing_role."purpose" OR
       NEW."principalReference" IS DISTINCT FROM existing_role."principalReference" OR
       NEW."publicKeySpkiBase64" IS DISTINCT FROM existing_role."publicKeySpkiBase64" OR
       NEW."publicKeySpkiSha256" IS DISTINCT FROM existing_role."publicKeySpkiSha256" OR
       NEW."validFrom" IS DISTINCT FROM existing_role."validFrom" OR
       NEW."validUntil" IS DISTINCT FROM existing_role."validUntil" OR
       NEW."revokedAt" IS DISTINCT FROM existing_role."revokedAt" OR
       NEW."testOnly" IS DISTINCT FROM existing_role."testOnly" THEN
      RAISE EXCEPTION 'Topology carrier public root equivocation denied';
    END IF;
    RETURN NEW;
  END IF;

  SELECT count(*) INTO root_count
  FROM "acp_topology_carrier_signature_roots"
  WHERE "workspaceId" = NEW."workspaceId"
    AND "supervisorInstanceId" = NEW."supervisorInstanceId"
    AND "carrierId" = NEW."carrierId";
  IF root_count >= 2 THEN
    RAISE EXCEPTION 'Topology carrier public root role bound exceeded';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "acp_topology_carrier_signature_roots" existing
    WHERE existing."workspaceId" = NEW."workspaceId"
      AND existing."supervisorInstanceId" = NEW."supervisorInstanceId"
      AND existing."carrierId" = NEW."carrierId"
      AND (existing."signerKeyId" = NEW."signerKeyId" OR
           existing."publicKeySpkiSha256" = NEW."publicKeySpkiSha256")
  ) THEN
    RAISE EXCEPTION 'Topology carrier public root role identity reuse denied';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_topology_carrier_root_insert_guard
  BEFORE INSERT ON "acp_topology_carrier_signature_roots"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_topology_carrier_root_insert();

CREATE OR REPLACE FUNCTION ventureos_require_topology_carrier_root_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "acp_topology_carrier_signature_root_evidence" evidence
    WHERE evidence."workspaceId" = NEW."workspaceId"
      AND evidence."supervisorInstanceId" = NEW."supervisorInstanceId"
      AND evidence."carrierId" = NEW."carrierId"
      AND evidence."bindingHash" = NEW."bindingHash"
      AND evidence."principalRole" = NEW."principalRole"
      AND evidence."rootRecordId" = NEW."rootRecordId"
      AND evidence."rootRecordVersion" = NEW."rootRecordVersion"
      AND evidence."signerKeyId" = NEW."signerKeyId"
      AND evidence."publicKeySpkiSha256" = NEW."publicKeySpkiSha256"
  ) THEN
    RAISE EXCEPTION 'Topology carrier public root Level-3 evidence is required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER acp_topology_carrier_root_evidence_required
  AFTER INSERT ON "acp_topology_carrier_signature_roots"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ventureos_require_topology_carrier_root_evidence();

CREATE OR REPLACE FUNCTION ventureos_guard_topology_carrier_root_evidence_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE database_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."carrierId", 90504));
  IF NEW."authorizedFrom" > database_now OR NEW."authorizedUntil" <= database_now THEN
    RAISE EXCEPTION 'Topology carrier public root evidence is not currently authorized';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_topology_carrier_root_evidence_insert_guard
  BEFORE INSERT ON "acp_topology_carrier_signature_root_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_topology_carrier_root_evidence_insert();

CREATE OR REPLACE FUNCTION ventureos_deny_topology_carrier_root_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Topology carrier public-root state is immutable';
END;
$$;

CREATE TRIGGER acp_topology_carrier_root_scope_update_deny
  BEFORE UPDATE ON "acp_topology_carrier_signature_root_scopes"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_topology_carrier_root_mutation();
CREATE TRIGGER acp_topology_carrier_root_scope_delete_deny
  BEFORE DELETE ON "acp_topology_carrier_signature_root_scopes"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_topology_carrier_root_mutation();
CREATE TRIGGER acp_topology_carrier_root_update_deny
  BEFORE UPDATE ON "acp_topology_carrier_signature_roots"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_topology_carrier_root_mutation();
CREATE TRIGGER acp_topology_carrier_root_delete_deny
  BEFORE DELETE ON "acp_topology_carrier_signature_roots"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_topology_carrier_root_mutation();
CREATE TRIGGER acp_topology_carrier_root_evidence_update_deny
  BEFORE UPDATE ON "acp_topology_carrier_signature_root_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_topology_carrier_root_mutation();
CREATE TRIGGER acp_topology_carrier_root_evidence_delete_deny
  BEFORE DELETE ON "acp_topology_carrier_signature_root_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_deny_topology_carrier_root_mutation();
