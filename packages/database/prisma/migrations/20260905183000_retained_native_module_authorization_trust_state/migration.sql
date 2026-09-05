CREATE OR REPLACE FUNCTION ventureos_canonical_retained_native_module_json(value JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  result TEXT;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{' || COALESCE(string_agg(to_jsonb(entry.key)::TEXT || ':' ||
        ventureos_canonical_retained_native_module_json(entry.value), ',' ORDER BY entry.key), '') || '}'
      INTO result FROM jsonb_each(value) AS entry;
    WHEN 'array' THEN
      SELECT '[' || COALESCE(string_agg(
        ventureos_canonical_retained_native_module_json(entry.value), ',' ORDER BY entry.ordinality), '') || ']'
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(value, ordinality);
    ELSE result := value::TEXT;
  END CASE;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION ventureos_valid_retained_native_module_authorizations(
  value JSONB, snapshot_issued_at TIMESTAMPTZ, snapshot_valid_until TIMESTAMPTZ
)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  authorization JSONB;
  position INTEGER := 0;
  prior_kind TEXT := NULL;
BEGIN
  IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 2 THEN RETURN FALSE; END IF;
  FOR authorization IN SELECT item FROM jsonb_array_elements(value) AS item LOOP
    position := position + 1;
    IF jsonb_typeof(authorization) <> 'object' OR NOT (authorization ?& ARRAY[
      'schemaVersion', 'platform', 'architecture', 'moduleKind', 'canonicalModulePath',
      'socketPath', 'runtimeConnection', 'authorizationId', 'authorizationVersion',
      'requestHash', 'validFrom', 'validUntil', 'moduleSha256', 'moduleIdentityReference',
      'moduleOwnerUid', 'moduleOwnerGid', 'moduleMode', 'moduleSizeBytes', 'socketDirectory',
      'socketDirectoryIdentityReference', 'socketDirectoryOwnerUid', 'socketDirectoryOwnerGid',
      'socketDirectoryMode'
    ]) OR (authorization - ARRAY[
      'schemaVersion', 'platform', 'architecture', 'moduleKind', 'canonicalModulePath',
      'socketPath', 'runtimeConnection', 'authorizationId', 'authorizationVersion',
      'requestHash', 'validFrom', 'validUntil', 'moduleSha256', 'moduleIdentityReference',
      'moduleOwnerUid', 'moduleOwnerGid', 'moduleMode', 'moduleSizeBytes', 'socketDirectory',
      'socketDirectoryIdentityReference', 'socketDirectoryOwnerUid', 'socketDirectoryOwnerGid',
      'socketDirectoryMode'
    ]) <> '{}'::JSONB OR
      jsonb_typeof(authorization->'schemaVersion') IS DISTINCT FROM 'number' OR
      jsonb_typeof(authorization->'authorizationVersion') IS DISTINCT FROM 'number' OR
      jsonb_typeof(authorization->'moduleOwnerUid') IS DISTINCT FROM 'number' OR
      jsonb_typeof(authorization->'moduleOwnerGid') IS DISTINCT FROM 'number' OR
      jsonb_typeof(authorization->'moduleMode') IS DISTINCT FROM 'number' OR
      jsonb_typeof(authorization->'moduleSizeBytes') IS DISTINCT FROM 'number' OR
      jsonb_typeof(authorization->'socketDirectoryOwnerUid') IS DISTINCT FROM 'number' OR
      jsonb_typeof(authorization->'socketDirectoryOwnerGid') IS DISTINCT FROM 'number' OR
      jsonb_typeof(authorization->'socketDirectoryMode') IS DISTINCT FROM 'number' OR
      EXISTS (
        SELECT 1 FROM unnest(ARRAY[
          'platform', 'architecture', 'moduleKind', 'canonicalModulePath', 'socketPath',
          'runtimeConnection', 'authorizationId', 'requestHash', 'validFrom', 'validUntil',
          'moduleSha256', 'moduleIdentityReference', 'socketDirectory',
          'socketDirectoryIdentityReference'
        ]) AS field_name
        WHERE jsonb_typeof(authorization->field_name) IS DISTINCT FROM 'string'
      ) OR
      authorization->>'schemaVersion' <> '1' OR authorization->>'platform' <> 'LINUX' OR
      authorization->>'architecture' <> 'X64' OR
      authorization->>'moduleKind' NOT IN ('CLIENT', 'LISTENER') OR
      authorization->>'runtimeConnection' <> 'NOT_CONFIGURED' OR
      authorization->>'authorizationId' !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' OR
      authorization->>'requestHash' !~ '^[a-f0-9]{64}$' OR
      authorization->>'moduleSha256' !~ '^[a-f0-9]{64}$' OR
      authorization->>'canonicalModulePath' !~ '^/[A-Za-z0-9._/-]+[.]node$' OR
      authorization->>'socketPath' !~ '^/[A-Za-z0-9._/-]+[.]sock$' OR
      authorization->>'socketDirectory' !~ '^/[A-Za-z0-9._/-]+$' OR
      authorization->>'moduleIdentityReference' !~ '^linux:dev-[a-f0-9]+:ino-[a-f0-9]+$' OR
      authorization->>'socketDirectoryIdentityReference' !~ '^linux:dev-[a-f0-9]+:ino-[a-f0-9]+$' OR
      (authorization->>'authorizationVersion')::INTEGER NOT BETWEEN 1 AND 1000000 OR
      (authorization->>'moduleOwnerUid')::INTEGER < 0 OR
      (authorization->>'moduleOwnerGid')::INTEGER < 0 OR
      (authorization->>'socketDirectoryOwnerUid')::INTEGER < 0 OR
      (authorization->>'socketDirectoryOwnerGid')::INTEGER < 0 OR
      (authorization->>'moduleMode')::INTEGER < 0 OR
      (authorization->>'moduleSizeBytes')::INTEGER NOT BETWEEN 1 AND 8388608 OR
      (authorization->>'socketDirectoryMode')::INTEGER <> 448 OR
      (authorization->>'validUntil')::TIMESTAMPTZ <= (authorization->>'validFrom')::TIMESTAMPTZ OR
      (authorization->>'validUntil')::TIMESTAMPTZ >
        (authorization->>'validFrom')::TIMESTAMPTZ + INTERVAL '5 minutes' OR
      (authorization->>'validFrom')::TIMESTAMPTZ < snapshot_issued_at OR
      (authorization->>'validUntil')::TIMESTAMPTZ > snapshot_valid_until OR
      prior_kind = authorization->>'moduleKind' OR
      (prior_kind = 'LISTENER' AND authorization->>'moduleKind' = 'CLIENT') THEN
      RETURN FALSE;
    END IF;
    prior_kind := authorization->>'moduleKind';
  END LOOP;
  RETURN position = jsonb_array_length(value);
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

CREATE TABLE "acp_retained_native_module_authorization_snapshots" (
  "supervisorInstanceId" TEXT NOT NULL,
  "snapshotVersion" INTEGER NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "signerKeyId" TEXT NOT NULL,
  "previousSnapshotHash" TEXT,
  "snapshot" JSONB NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL,
  "validUntil" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_retained_native_module_authorization_snapshots_pkey"
    PRIMARY KEY ("supervisorInstanceId", "snapshotVersion"),
  CONSTRAINT "acp_rn_module_auth_snapshot_version_check"
    CHECK ("snapshotVersion" BETWEEN 1 AND 1000000),
  CONSTRAINT "acp_rn_module_auth_snapshot_reference_check" CHECK (
    "supervisorInstanceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "snapshotId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "signerKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$'
  ),
  CONSTRAINT "acp_rn_module_auth_snapshot_hash_check" CHECK (
    "snapshotHash" ~ '^[a-f0-9]{64}$' AND
    ("previousSnapshotHash" IS NULL OR "previousSnapshotHash" ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT "acp_rn_module_auth_snapshot_window_check" CHECK (
    "validUntil" > "issuedAt" AND "validUntil" <= "issuedAt" + INTERVAL '5 minutes'
  ),
  CONSTRAINT "acp_rn_module_auth_snapshot_shape_check" CHECK (
    jsonb_typeof("snapshot") = 'object' AND "snapshot" ?& ARRAY[
      'schemaVersion', 'purpose', 'snapshotId', 'snapshotVersion', 'signerKeyId', 'algorithm',
      'supervisorInstanceId', 'issuedAt', 'validUntil', 'previousSnapshotHash',
      'authorizations', 'signature'
    ] AND ("snapshot" - ARRAY[
      'schemaVersion', 'purpose', 'snapshotId', 'snapshotVersion', 'signerKeyId', 'algorithm',
      'supervisorInstanceId', 'issuedAt', 'validUntil', 'previousSnapshotHash',
      'authorizations', 'signature'
    ]) = '{}'::JSONB AND
    jsonb_typeof("snapshot"->'schemaVersion') = 'number' AND
    jsonb_typeof("snapshot"->'purpose') = 'string' AND
    jsonb_typeof("snapshot"->'snapshotId') = 'string' AND
    jsonb_typeof("snapshot"->'snapshotVersion') = 'number' AND
    jsonb_typeof("snapshot"->'signerKeyId') = 'string' AND
    jsonb_typeof("snapshot"->'algorithm') = 'string' AND
    jsonb_typeof("snapshot"->'supervisorInstanceId') = 'string' AND
    jsonb_typeof("snapshot"->'issuedAt') = 'string' AND
    jsonb_typeof("snapshot"->'validUntil') = 'string' AND
    jsonb_typeof("snapshot"->'signature') = 'string' AND
    jsonb_typeof("snapshot"->'authorizations') = 'array' AND
    jsonb_typeof("snapshot"->'previousSnapshotHash') IN ('string', 'null') AND
    "snapshot"->>'schemaVersion' = '1' AND
    "snapshot"->>'purpose' = 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION' AND
    "snapshot"->>'snapshotId' = "snapshotId" AND
    ("snapshot"->>'snapshotVersion')::INTEGER = "snapshotVersion" AND
    "snapshot"->>'signerKeyId' = "signerKeyId" AND
    "snapshot"->>'algorithm' = 'ED25519' AND
    "snapshot"->>'supervisorInstanceId' = "supervisorInstanceId" AND
    ("snapshot"->>'issuedAt')::TIMESTAMPTZ = "issuedAt" AND
    ("snapshot"->>'validUntil')::TIMESTAMPTZ = "validUntil" AND
    CASE WHEN "previousSnapshotHash" IS NULL
      THEN jsonb_typeof("snapshot"->'previousSnapshotHash') = 'null'
      ELSE "snapshot"->>'previousSnapshotHash' = "previousSnapshotHash"
    END AND
    "snapshot"->>'signature' ~ '^[A-Za-z0-9+/]{86}==$' AND
    ventureos_valid_retained_native_module_authorizations(
      "snapshot"->'authorizations', "issuedAt", "validUntil"
    )
  )
);

CREATE UNIQUE INDEX "acp_retained_native_module_authorization_snapshots_hash_key"
  ON "acp_retained_native_module_authorization_snapshots"("snapshotHash");
CREATE UNIQUE INDEX "acp_rn_module_auth_snapshots_instance_id_key"
  ON "acp_retained_native_module_authorization_snapshots"("supervisorInstanceId", "snapshotId");
CREATE INDEX "acp_rn_module_auth_snapshot_latest_idx"
  ON "acp_retained_native_module_authorization_snapshots"("supervisorInstanceId", "snapshotVersion" DESC);
CREATE UNIQUE INDEX "acp_rn_module_auth_snapshot_checkpoint_binding_key"
  ON "acp_retained_native_module_authorization_snapshots"(
    "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId"
  );

CREATE TABLE "acp_retained_native_module_authorization_checkpoints" (
  "supervisorInstanceId" TEXT PRIMARY KEY,
  "signerKeyId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "snapshotVersion" INTEGER NOT NULL CHECK ("snapshotVersion" BETWEEN 1 AND 1000000),
  "snapshotHash" TEXT NOT NULL,
  "clientAuthorizationId" TEXT,
  "clientAuthorizationVersion" INTEGER,
  "clientAuthorizationHash" TEXT,
  "listenerAuthorizationId" TEXT,
  "listenerAuthorizationVersion" INTEGER,
  "listenerAuthorizationHash" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_rn_module_auth_checkpoint_client_check" CHECK (
    ("clientAuthorizationId" IS NULL) = ("clientAuthorizationVersion" IS NULL) AND
    ("clientAuthorizationId" IS NULL) = ("clientAuthorizationHash" IS NULL) AND
    ("clientAuthorizationVersion" IS NULL OR "clientAuthorizationVersion" BETWEEN 1 AND 1000000)
  ),
  CONSTRAINT "acp_rn_module_auth_checkpoint_listener_check" CHECK (
    ("listenerAuthorizationId" IS NULL) = ("listenerAuthorizationVersion" IS NULL) AND
    ("listenerAuthorizationId" IS NULL) = ("listenerAuthorizationHash" IS NULL) AND
    ("listenerAuthorizationVersion" IS NULL OR "listenerAuthorizationVersion" BETWEEN 1 AND 1000000)
  ),
  CONSTRAINT "acp_rn_module_auth_checkpoint_reference_check" CHECK (
    "supervisorInstanceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "signerKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    "snapshotId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
    ("clientAuthorizationId" IS NULL OR "clientAuthorizationId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$') AND
    ("listenerAuthorizationId" IS NULL OR "listenerAuthorizationId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$')
  ),
  CONSTRAINT "acp_rn_module_auth_checkpoint_hash_check" CHECK (
    "snapshotHash" ~ '^[a-f0-9]{64}$' AND
    ("clientAuthorizationHash" IS NULL OR "clientAuthorizationHash" ~ '^[a-f0-9]{64}$') AND
    ("listenerAuthorizationHash" IS NULL OR "listenerAuthorizationHash" ~ '^[a-f0-9]{64}$')
  )
);

CREATE UNIQUE INDEX "acp_rn_module_auth_checkpoint_snapshot_binding_key"
  ON "acp_retained_native_module_authorization_checkpoints"(
    "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId"
  );
ALTER TABLE "acp_retained_native_module_authorization_checkpoints"
  ADD CONSTRAINT "acp_rn_module_auth_checkpoints_snapshot_fkey"
  FOREIGN KEY ("supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId")
  REFERENCES "acp_retained_native_module_authorization_snapshots"(
    "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId"
  ) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "acp_retained_native_module_authorization_checkpoint_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "supervisorInstanceId" TEXT NOT NULL,
  "previousSignerKeyId" TEXT,
  "previousSnapshotId" TEXT,
  "previousSnapshotVersion" INTEGER,
  "previousSnapshotHash" TEXT,
  "nextSignerKeyId" TEXT NOT NULL,
  "nextSnapshotId" TEXT NOT NULL,
  "nextSnapshotVersion" INTEGER NOT NULL,
  "nextSnapshotHash" TEXT NOT NULL,
  "nextClientAuthorizationId" TEXT,
  "nextClientAuthorizationVersion" INTEGER,
  "nextClientAuthorizationHash" TEXT,
  "nextListenerAuthorizationId" TEXT,
  "nextListenerAuthorizationVersion" INTEGER,
  "nextListenerAuthorizationHash" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_rn_module_auth_event_transition_check" CHECK (
    ("previousSignerKeyId" IS NULL AND "previousSnapshotId" IS NULL AND
     "previousSnapshotVersion" IS NULL AND "previousSnapshotHash" IS NULL) OR
    ("previousSignerKeyId" IS NOT NULL AND "previousSnapshotId" IS NOT NULL AND
     "previousSnapshotVersion" IS NOT NULL AND "previousSnapshotHash" IS NOT NULL AND
     "nextSnapshotVersion" = "previousSnapshotVersion" + 1)
  ),
  CONSTRAINT "acp_rn_module_auth_event_grant_check" CHECK (
    ("nextClientAuthorizationId" IS NULL) = ("nextClientAuthorizationVersion" IS NULL) AND
    ("nextClientAuthorizationId" IS NULL) = ("nextClientAuthorizationHash" IS NULL) AND
    ("nextListenerAuthorizationId" IS NULL) = ("nextListenerAuthorizationVersion" IS NULL) AND
    ("nextListenerAuthorizationId" IS NULL) = ("nextListenerAuthorizationHash" IS NULL) AND
    ("nextClientAuthorizationVersion" IS NULL OR
      "nextClientAuthorizationVersion" BETWEEN 1 AND 1000000) AND
    ("nextListenerAuthorizationVersion" IS NULL OR
      "nextListenerAuthorizationVersion" BETWEEN 1 AND 1000000) AND
    "nextSnapshotHash" ~ '^[a-f0-9]{64}$' AND
    ("previousSnapshotHash" IS NULL OR "previousSnapshotHash" ~ '^[a-f0-9]{64}$') AND
    ("nextClientAuthorizationHash" IS NULL OR "nextClientAuthorizationHash" ~ '^[a-f0-9]{64}$') AND
    ("nextListenerAuthorizationHash" IS NULL OR "nextListenerAuthorizationHash" ~ '^[a-f0-9]{64}$')
  )
);
CREATE INDEX "acp_rn_module_auth_checkpoint_events_instance_idx"
  ON "acp_retained_native_module_authorization_checkpoint_events"("supervisorInstanceId", "createdAt" DESC);

CREATE OR REPLACE FUNCTION ventureos_guard_retained_native_module_authorization_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Retained-native module authorization snapshots are immutable';
END; $$;
CREATE TRIGGER acp_retained_native_module_authorization_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "acp_retained_native_module_authorization_snapshots"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_retained_native_module_authorization_snapshot();

CREATE OR REPLACE FUNCTION ventureos_guard_retained_native_module_authorization_checkpoint()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bound_snapshot JSONB;
  bound_client JSONB;
  bound_listener JSONB;
  bound_client_hash TEXT;
  bound_listener_hash TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Native-module authorization checkpoints cannot be deleted'; END IF;
  SELECT "snapshot" INTO bound_snapshot
  FROM "acp_retained_native_module_authorization_snapshots"
  WHERE "supervisorInstanceId" = NEW."supervisorInstanceId" AND
    "snapshotVersion" = NEW."snapshotVersion" AND "snapshotId" = NEW."snapshotId" AND
    "snapshotHash" = NEW."snapshotHash" AND "signerKeyId" = NEW."signerKeyId";
  IF NOT FOUND THEN RAISE EXCEPTION 'Native-module authorization checkpoint snapshot binding denied'; END IF;
  SELECT item INTO bound_client FROM jsonb_array_elements(bound_snapshot->'authorizations') AS item
    WHERE item->>'moduleKind' = 'CLIENT' LIMIT 1;
  SELECT item INTO bound_listener FROM jsonb_array_elements(bound_snapshot->'authorizations') AS item
    WHERE item->>'moduleKind' = 'LISTENER' LIMIT 1;
  IF bound_client IS NOT NULL THEN
    bound_client_hash := encode(sha256(convert_to(
      ventureos_canonical_retained_native_module_json(bound_client), 'UTF8')), 'hex');
  END IF;
  IF bound_listener IS NOT NULL THEN
    bound_listener_hash := encode(sha256(convert_to(
      ventureos_canonical_retained_native_module_json(bound_listener), 'UTF8')), 'hex');
  END IF;
  IF NEW."clientAuthorizationId" IS DISTINCT FROM bound_client->>'authorizationId' OR
     NEW."clientAuthorizationVersion" IS DISTINCT FROM (bound_client->>'authorizationVersion')::INTEGER OR
     NEW."clientAuthorizationHash" IS DISTINCT FROM bound_client_hash OR
     NEW."listenerAuthorizationId" IS DISTINCT FROM bound_listener->>'authorizationId' OR
     NEW."listenerAuthorizationVersion" IS DISTINCT FROM (bound_listener->>'authorizationVersion')::INTEGER OR
     NEW."listenerAuthorizationHash" IS DISTINCT FROM bound_listener_hash THEN
    RAISE EXCEPTION 'Native-module authorization checkpoint grant binding denied';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."supervisorInstanceId" <> OLD."supervisorInstanceId" OR
    NEW."snapshotVersion" <> OLD."snapshotVersion" + 1 OR NEW."snapshotId" = OLD."snapshotId" OR
    NEW."snapshotHash" = OLD."snapshotHash" OR NEW."createdAt" <> OLD."createdAt" OR
    bound_snapshot->>'previousSnapshotHash' <> OLD."snapshotHash" OR
    (OLD."clientAuthorizationId" IS NOT NULL AND OLD."clientAuthorizationId" = NEW."clientAuthorizationId" AND
     (NEW."clientAuthorizationVersion" < OLD."clientAuthorizationVersion" OR
      (NEW."clientAuthorizationVersion" = OLD."clientAuthorizationVersion" AND
       NEW."clientAuthorizationHash" <> OLD."clientAuthorizationHash"))) OR
    (OLD."listenerAuthorizationId" IS NOT NULL AND OLD."listenerAuthorizationId" = NEW."listenerAuthorizationId" AND
     (NEW."listenerAuthorizationVersion" < OLD."listenerAuthorizationVersion" OR
      (NEW."listenerAuthorizationVersion" = OLD."listenerAuthorizationVersion" AND
       NEW."listenerAuthorizationHash" <> OLD."listenerAuthorizationHash")))
  ) THEN RAISE EXCEPTION 'Native-module authorization checkpoint transition denied'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER acp_retained_native_module_authorization_checkpoint_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "acp_retained_native_module_authorization_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_retained_native_module_authorization_checkpoint();

CREATE OR REPLACE FUNCTION ventureos_audit_retained_native_module_authorization_checkpoint()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO "acp_retained_native_module_authorization_checkpoint_events" (
    "supervisorInstanceId", "previousSignerKeyId", "previousSnapshotId", "previousSnapshotVersion",
    "previousSnapshotHash", "nextSignerKeyId", "nextSnapshotId", "nextSnapshotVersion",
    "nextSnapshotHash", "nextClientAuthorizationId", "nextClientAuthorizationVersion",
    "nextClientAuthorizationHash", "nextListenerAuthorizationId", "nextListenerAuthorizationVersion",
    "nextListenerAuthorizationHash"
  ) VALUES (
    NEW."supervisorInstanceId", CASE WHEN TG_OP = 'UPDATE' THEN OLD."signerKeyId" END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."snapshotId" END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."snapshotVersion" END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."snapshotHash" END,
    NEW."signerKeyId", NEW."snapshotId", NEW."snapshotVersion", NEW."snapshotHash",
    NEW."clientAuthorizationId", NEW."clientAuthorizationVersion", NEW."clientAuthorizationHash",
    NEW."listenerAuthorizationId", NEW."listenerAuthorizationVersion", NEW."listenerAuthorizationHash"
  ); RETURN NEW;
END; $$;
CREATE TRIGGER acp_retained_native_module_authorization_checkpoint_audit
  AFTER INSERT OR UPDATE ON "acp_retained_native_module_authorization_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION ventureos_audit_retained_native_module_authorization_checkpoint();

CREATE OR REPLACE FUNCTION ventureos_reject_rn_module_auth_event_change()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Native-module authorization checkpoint audit evidence is immutable';
END; $$;
CREATE TRIGGER acp_rn_module_auth_checkpoint_events_immutable
  BEFORE UPDATE OR DELETE ON "acp_retained_native_module_authorization_checkpoint_events"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_rn_module_auth_event_change();
