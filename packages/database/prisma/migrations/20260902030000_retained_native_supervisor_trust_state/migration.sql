CREATE TABLE "acp_retained_native_supervisor_trust_snapshots" (
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
  CONSTRAINT "acp_retained_native_supervisor_trust_snapshots_pkey"
    PRIMARY KEY ("supervisorInstanceId", "snapshotVersion"),
  CONSTRAINT "acp_retained_native_supervisor_trust_snapshot_version_check"
    CHECK ("snapshotVersion" BETWEEN 1 AND 1000000),
  CONSTRAINT "acp_retained_native_supervisor_trust_snapshot_reference_check"
    CHECK (
      "supervisorInstanceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
      "snapshotId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
      "signerKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$'
    ),
  CONSTRAINT "acp_retained_native_supervisor_trust_snapshot_hash_check"
    CHECK (
      "snapshotHash" ~ '^[a-f0-9]{64}$' AND
      ("previousSnapshotHash" IS NULL OR "previousSnapshotHash" ~ '^[a-f0-9]{64}$')
    ),
  CONSTRAINT "acp_retained_native_supervisor_trust_snapshot_window_check"
    CHECK (
      "validUntil" > "issuedAt" AND
      "validUntil" <= "issuedAt" + INTERVAL '15 minutes'
    ),
  CONSTRAINT "acp_retained_native_supervisor_trust_snapshot_shape_check"
    CHECK (
      jsonb_typeof("snapshot") = 'object' AND
      "snapshot" ?& ARRAY[
        'schemaVersion', 'snapshotId', 'snapshotVersion', 'signerKeyId', 'algorithm',
        'supervisorInstanceId', 'issuedAt', 'validUntil', 'previousSnapshotHash',
        'record', 'signature'
      ] AND
      ("snapshot" - ARRAY[
        'schemaVersion', 'snapshotId', 'snapshotVersion', 'signerKeyId', 'algorithm',
        'supervisorInstanceId', 'issuedAt', 'validUntil', 'previousSnapshotHash',
        'record', 'signature'
      ]) = '{}'::JSONB AND
      "snapshot"->>'schemaVersion' = '1' AND
      "snapshot"->>'snapshotId' = "snapshotId" AND
      ("snapshot"->>'snapshotVersion')::INTEGER = "snapshotVersion" AND
      "snapshot"->>'signerKeyId' = "signerKeyId" AND
      "snapshot"->>'supervisorInstanceId' = "supervisorInstanceId" AND
      "snapshot"->>'algorithm' = 'ED25519' AND
      ("snapshot"->>'issuedAt')::TIMESTAMPTZ = "issuedAt" AND
      ("snapshot"->>'validUntil')::TIMESTAMPTZ = "validUntil" AND
      CASE WHEN "previousSnapshotHash" IS NULL
        THEN jsonb_typeof("snapshot"->'previousSnapshotHash') = 'null'
        ELSE "snapshot"->>'previousSnapshotHash' = "previousSnapshotHash"
      END AND
      "snapshot"->>'signature' ~ '^[A-Za-z0-9+/]{86}==$' AND
      CASE WHEN jsonb_typeof("snapshot"->'record') = 'null' THEN TRUE
      ELSE
        jsonb_typeof("snapshot"->'record') = 'object' AND
        ("snapshot"->'record') ?& ARRAY[
          'schemaVersion', 'trustRecordId', 'trustRecordVersion', 'supervisorInstanceId',
          'supervisorKeyId', 'algorithm', 'purpose', 'publicKeySpkiBase64',
          'publicKeySpkiSha256', 'validFrom', 'validUntil', 'revokedAt', 'testOnly'
        ] AND
        (("snapshot"->'record') - ARRAY[
          'schemaVersion', 'trustRecordId', 'trustRecordVersion', 'supervisorInstanceId',
          'supervisorKeyId', 'algorithm', 'purpose', 'publicKeySpkiBase64',
          'publicKeySpkiSha256', 'validFrom', 'validUntil', 'revokedAt', 'testOnly'
        ]) = '{}'::JSONB AND
        "snapshot"->'record'->>'schemaVersion' = '1' AND
        "snapshot"->'record'->>'supervisorInstanceId' = "supervisorInstanceId" AND
        "snapshot"->'record'->>'algorithm' = 'ED25519' AND
        "snapshot"->'record'->>'purpose' = 'RETAINED_NATIVE_RECOVERY_OBSERVATION' AND
        "snapshot"->'record'->>'publicKeySpkiSha256' ~ '^[a-f0-9]{64}$' AND
        "snapshot"->'record'->'testOnly' = 'false'::JSONB
      END
    )
);

CREATE UNIQUE INDEX "acp_retained_native_supervisor_trust_snapshots_hash_key"
  ON "acp_retained_native_supervisor_trust_snapshots"("snapshotHash");
CREATE UNIQUE INDEX "acp_retained_native_supervisor_trust_snapshots_instance_id_key"
  ON "acp_retained_native_supervisor_trust_snapshots"("supervisorInstanceId", "snapshotId");
CREATE INDEX "acp_retained_native_supervisor_trust_snapshot_latest_idx"
  ON "acp_retained_native_supervisor_trust_snapshots"(
    "supervisorInstanceId", "snapshotVersion" DESC
  );
CREATE UNIQUE INDEX "acp_rn_supervisor_trust_snapshot_checkpoint_binding_key"
  ON "acp_retained_native_supervisor_trust_snapshots"(
    "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId"
  );

CREATE TABLE "acp_retained_native_supervisor_trust_checkpoints" (
  "supervisorInstanceId" TEXT NOT NULL,
  "signerKeyId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "snapshotVersion" INTEGER NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "activeSupervisorKeyId" TEXT,
  "activePublicKeySpkiSha256" TEXT,
  "activeTrustRecordId" TEXT,
  "activeTrustRecordVersion" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_retained_native_supervisor_trust_checkpoints_pkey"
    PRIMARY KEY ("supervisorInstanceId"),
  CONSTRAINT "acp_retained_native_supervisor_trust_checkpoint_version_check"
    CHECK (
      "snapshotVersion" BETWEEN 1 AND 1000000 AND
      ("activeTrustRecordVersion" IS NULL OR
       "activeTrustRecordVersion" BETWEEN 1 AND 1000000)
    ),
  CONSTRAINT "acp_retained_native_supervisor_trust_checkpoint_active_check"
    CHECK (
      ("activeSupervisorKeyId" IS NULL) = ("activePublicKeySpkiSha256" IS NULL) AND
      ("activeSupervisorKeyId" IS NULL) = ("activeTrustRecordId" IS NULL) AND
      ("activeSupervisorKeyId" IS NULL) = ("activeTrustRecordVersion" IS NULL)
    ),
  CONSTRAINT "acp_retained_native_supervisor_trust_checkpoint_reference_check"
    CHECK (
      "supervisorInstanceId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
      "signerKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
      "snapshotId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
      ("activeSupervisorKeyId" IS NULL OR
       "activeSupervisorKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$') AND
      ("activeTrustRecordId" IS NULL OR
       "activeTrustRecordId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$')
    ),
  CONSTRAINT "acp_retained_native_supervisor_trust_checkpoint_hash_check"
    CHECK (
      "snapshotHash" ~ '^[a-f0-9]{64}$' AND
      ("activePublicKeySpkiSha256" IS NULL OR
       "activePublicKeySpkiSha256" ~ '^[a-f0-9]{64}$')
    )
);

CREATE UNIQUE INDEX "acp_rn_supervisor_trust_checkpoint_snapshot_binding_key"
  ON "acp_retained_native_supervisor_trust_checkpoints"(
    "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId"
  );

ALTER TABLE "acp_retained_native_supervisor_trust_checkpoints"
  ADD CONSTRAINT "acp_retained_native_supervisor_trust_checkpoints_snapshot_fkey"
  FOREIGN KEY (
    "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId"
  ) REFERENCES "acp_retained_native_supervisor_trust_snapshots"(
    "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId"
  ) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "acp_retained_native_supervisor_trust_checkpoint_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supervisorInstanceId" TEXT NOT NULL,
  "previousSignerKeyId" TEXT,
  "previousSnapshotId" TEXT,
  "previousSnapshotVersion" INTEGER,
  "previousSnapshotHash" TEXT,
  "nextSignerKeyId" TEXT NOT NULL,
  "nextSnapshotId" TEXT NOT NULL,
  "nextSnapshotVersion" INTEGER NOT NULL,
  "nextSnapshotHash" TEXT NOT NULL,
  "nextActiveSupervisorKeyId" TEXT,
  "nextActivePublicKeySpkiSha256" TEXT,
  "nextActiveTrustRecordId" TEXT,
  "nextActiveTrustRecordVersion" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_retained_native_supervisor_trust_checkpoint_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "acp_rn_supervisor_trust_checkpoint_event_transition_check"
    CHECK (
      (
        "previousSignerKeyId" IS NULL AND "previousSnapshotId" IS NULL AND
        "previousSnapshotVersion" IS NULL AND "previousSnapshotHash" IS NULL
      ) OR (
        "previousSignerKeyId" IS NOT NULL AND "previousSnapshotId" IS NOT NULL AND
        "previousSnapshotVersion" IS NOT NULL AND "previousSnapshotHash" IS NOT NULL AND
        "nextSnapshotVersion" = "previousSnapshotVersion" + 1
      )
    ),
  CONSTRAINT "acp_rn_supervisor_trust_checkpoint_event_active_check"
    CHECK (
      ("nextActiveSupervisorKeyId" IS NULL) =
        ("nextActivePublicKeySpkiSha256" IS NULL) AND
      ("nextActiveSupervisorKeyId" IS NULL) = ("nextActiveTrustRecordId" IS NULL) AND
      ("nextActiveSupervisorKeyId" IS NULL) = ("nextActiveTrustRecordVersion" IS NULL)
    ),
  CONSTRAINT "acp_rn_supervisor_trust_checkpoint_event_hash_check"
    CHECK (
      "nextSnapshotHash" ~ '^[a-f0-9]{64}$' AND
      ("previousSnapshotHash" IS NULL OR "previousSnapshotHash" ~ '^[a-f0-9]{64}$') AND
      ("nextActivePublicKeySpkiSha256" IS NULL OR
       "nextActivePublicKeySpkiSha256" ~ '^[a-f0-9]{64}$')
    )
);

CREATE INDEX "acp_rn_supervisor_trust_checkpoint_events_instance_idx"
  ON "acp_retained_native_supervisor_trust_checkpoint_events"(
    "supervisorInstanceId", "createdAt" DESC
  );

CREATE OR REPLACE FUNCTION ventureos_guard_retained_native_supervisor_trust_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Retained-native supervisor trust snapshots are immutable';
END;
$$;

CREATE TRIGGER acp_retained_native_supervisor_trust_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "acp_retained_native_supervisor_trust_snapshots"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_retained_native_supervisor_trust_snapshot();

CREATE OR REPLACE FUNCTION ventureos_guard_retained_native_supervisor_trust_checkpoint()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bound_record JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Retained-native supervisor trust checkpoints cannot be deleted';
  END IF;
  SELECT "snapshot"->'record' INTO bound_record
  FROM "acp_retained_native_supervisor_trust_snapshots"
  WHERE "supervisorInstanceId" = NEW."supervisorInstanceId"
    AND "snapshotVersion" = NEW."snapshotVersion"
    AND "snapshotId" = NEW."snapshotId"
    AND "snapshotHash" = NEW."snapshotHash"
    AND "signerKeyId" = NEW."signerKeyId";
  IF NOT FOUND OR
     (jsonb_typeof(bound_record) = 'null' AND
      NEW."activeSupervisorKeyId" IS NOT NULL) OR
     (jsonb_typeof(bound_record) = 'object' AND (
       NEW."activeSupervisorKeyId" IS DISTINCT FROM bound_record->>'supervisorKeyId' OR
       NEW."activePublicKeySpkiSha256" IS DISTINCT FROM
         bound_record->>'publicKeySpkiSha256' OR
       NEW."activeTrustRecordId" IS DISTINCT FROM bound_record->>'trustRecordId' OR
       NEW."activeTrustRecordVersion" IS DISTINCT FROM
         (bound_record->>'trustRecordVersion')::INTEGER
     )) THEN
    RAISE EXCEPTION 'Retained-native supervisor trust checkpoint snapshot binding denied';
  END IF;
  IF TG_OP = 'UPDATE' AND (
     NEW."supervisorInstanceId" <> OLD."supervisorInstanceId" OR
     NEW."snapshotVersion" <> OLD."snapshotVersion" + 1 OR
     NEW."snapshotId" = OLD."snapshotId" OR
     NEW."snapshotHash" = OLD."snapshotHash" OR
     NEW."createdAt" <> OLD."createdAt" OR
     (OLD."activeSupervisorKeyId" IS NOT NULL AND
      OLD."activeSupervisorKeyId" = NEW."activeSupervisorKeyId" AND
      OLD."activePublicKeySpkiSha256" <> NEW."activePublicKeySpkiSha256") OR
     (OLD."activeTrustRecordId" IS NOT NULL AND
      OLD."activeTrustRecordId" = NEW."activeTrustRecordId" AND
      NEW."activeTrustRecordVersion" < OLD."activeTrustRecordVersion")) THEN
    RAISE EXCEPTION 'Retained-native supervisor trust checkpoint transition denied';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_retained_native_supervisor_trust_checkpoint_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "acp_retained_native_supervisor_trust_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_retained_native_supervisor_trust_checkpoint();

CREATE OR REPLACE FUNCTION ventureos_audit_retained_native_supervisor_trust_checkpoint()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "acp_retained_native_supervisor_trust_checkpoint_events" (
    "supervisorInstanceId", "previousSignerKeyId", "previousSnapshotId",
    "previousSnapshotVersion", "previousSnapshotHash", "nextSignerKeyId",
    "nextSnapshotId", "nextSnapshotVersion", "nextSnapshotHash",
    "nextActiveSupervisorKeyId", "nextActivePublicKeySpkiSha256",
    "nextActiveTrustRecordId", "nextActiveTrustRecordVersion"
  ) VALUES (
    NEW."supervisorInstanceId",
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."signerKeyId" ELSE NULL END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."snapshotId" ELSE NULL END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."snapshotVersion" ELSE NULL END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."snapshotHash" ELSE NULL END,
    NEW."signerKeyId", NEW."snapshotId", NEW."snapshotVersion", NEW."snapshotHash",
    NEW."activeSupervisorKeyId", NEW."activePublicKeySpkiSha256",
    NEW."activeTrustRecordId", NEW."activeTrustRecordVersion"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_retained_native_supervisor_trust_checkpoint_audit
  AFTER INSERT OR UPDATE ON "acp_retained_native_supervisor_trust_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION ventureos_audit_retained_native_supervisor_trust_checkpoint();

CREATE OR REPLACE FUNCTION ventureos_reject_retained_native_supervisor_trust_event_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Retained-native supervisor trust checkpoint audit evidence is immutable';
END;
$$;

CREATE TRIGGER acp_rn_supervisor_trust_checkpoint_events_immutable
  BEFORE UPDATE OR DELETE ON "acp_retained_native_supervisor_trust_checkpoint_events"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_retained_native_supervisor_trust_event_change();
