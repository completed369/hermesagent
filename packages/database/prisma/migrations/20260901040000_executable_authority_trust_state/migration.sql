CREATE TABLE "acp_executable_authority_trust_snapshots" (
  "signerKeyId" TEXT NOT NULL,
  "snapshotVersion" INTEGER NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "previousSnapshotHash" TEXT,
  "snapshot" JSONB NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL,
  "validUntil" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_executable_authority_trust_snapshots_pkey"
    PRIMARY KEY ("signerKeyId", "snapshotVersion"),
  CONSTRAINT "acp_executable_authority_trust_snapshot_version_check"
    CHECK ("snapshotVersion" BETWEEN 1 AND 1000000),
  CONSTRAINT "acp_executable_authority_trust_snapshot_reference_check"
    CHECK (
      "signerKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
      "snapshotId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$'
    ),
  CONSTRAINT "acp_executable_authority_trust_snapshot_hash_check"
    CHECK (
      "snapshotHash" ~ '^[a-f0-9]{64}$' AND
      ("previousSnapshotHash" IS NULL OR "previousSnapshotHash" ~ '^[a-f0-9]{64}$')
    ),
  CONSTRAINT "acp_executable_authority_trust_snapshot_window_check"
    CHECK (
      "validUntil" > "issuedAt" AND
      "validUntil" <= "issuedAt" + INTERVAL '15 minutes'
    ),
  CONSTRAINT "acp_executable_authority_trust_snapshot_shape_check"
    CHECK (
      jsonb_typeof("snapshot") = 'object' AND
      "snapshot" ?& ARRAY[
        'schemaVersion', 'snapshotId', 'snapshotVersion', 'signerKeyId', 'algorithm',
        'issuedAt', 'validUntil', 'previousSnapshotHash', 'records', 'signature'
      ] AND
      ("snapshot" - ARRAY[
        'schemaVersion', 'snapshotId', 'snapshotVersion', 'signerKeyId', 'algorithm',
        'issuedAt', 'validUntil', 'previousSnapshotHash', 'records', 'signature'
      ]) = '{}'::JSONB AND
      "snapshot"->>'schemaVersion' = '1' AND
      "snapshot"->>'snapshotId' = "snapshotId" AND
      ("snapshot"->>'snapshotVersion')::INTEGER = "snapshotVersion" AND
      "snapshot"->>'signerKeyId' = "signerKeyId" AND
      "snapshot"->>'algorithm' = 'ED25519' AND
      ("snapshot"->>'issuedAt')::TIMESTAMPTZ = "issuedAt" AND
      ("snapshot"->>'validUntil')::TIMESTAMPTZ = "validUntil" AND
      CASE
        WHEN "previousSnapshotHash" IS NULL
          THEN jsonb_typeof("snapshot"->'previousSnapshotHash') = 'null'
        ELSE "snapshot"->>'previousSnapshotHash' = "previousSnapshotHash"
      END AND
      jsonb_typeof("snapshot"->'records') = 'array' AND
      jsonb_array_length("snapshot"->'records') BETWEEN 1 AND 32 AND
      "snapshot"->>'signature' ~ '^[A-Za-z0-9+/]{86}==$'
    )
);

CREATE UNIQUE INDEX "acp_executable_authority_trust_snapshots_hash_key"
  ON "acp_executable_authority_trust_snapshots"("snapshotHash");
CREATE UNIQUE INDEX "acp_executable_authority_trust_snapshots_signer_id_key"
  ON "acp_executable_authority_trust_snapshots"("signerKeyId", "snapshotId");
CREATE INDEX "acp_executable_authority_trust_snapshot_latest_idx"
  ON "acp_executable_authority_trust_snapshots"("signerKeyId", "snapshotVersion" DESC);
CREATE UNIQUE INDEX "acp_executable_authority_trust_snapshot_checkpoint_binding_key"
  ON "acp_executable_authority_trust_snapshots"(
    "signerKeyId", "snapshotVersion", "snapshotId", "snapshotHash"
  );

CREATE TABLE "acp_executable_authority_trust_checkpoints" (
  "signerKeyId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "snapshotVersion" INTEGER NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_executable_authority_trust_checkpoints_pkey" PRIMARY KEY ("signerKeyId"),
  CONSTRAINT "acp_executable_authority_trust_checkpoint_version_check"
    CHECK ("snapshotVersion" BETWEEN 1 AND 1000000),
  CONSTRAINT "acp_executable_authority_trust_checkpoint_reference_check"
    CHECK (
      "signerKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$' AND
      "snapshotId" ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$'
    ),
  CONSTRAINT "acp_executable_authority_trust_checkpoint_hash_check"
    CHECK ("snapshotHash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "acp_executable_authority_trust_checkpoint_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "signerKeyId" TEXT NOT NULL,
  "previousSnapshotId" TEXT,
  "previousSnapshotVersion" INTEGER,
  "previousSnapshotHash" TEXT,
  "nextSnapshotId" TEXT NOT NULL,
  "nextSnapshotVersion" INTEGER NOT NULL,
  "nextSnapshotHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_executable_authority_trust_checkpoint_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "acp_executable_authority_trust_checkpoint_event_transition_check"
    CHECK (
      (
        "previousSnapshotId" IS NULL AND
        "previousSnapshotVersion" IS NULL AND
        "previousSnapshotHash" IS NULL
      ) OR (
        "previousSnapshotId" IS NOT NULL AND
        "previousSnapshotVersion" IS NOT NULL AND
        "previousSnapshotHash" IS NOT NULL AND
        "nextSnapshotVersion" = "previousSnapshotVersion" + 1
      )
    ),
  CONSTRAINT "acp_executable_authority_trust_checkpoint_event_hash_check"
    CHECK (
      "nextSnapshotHash" ~ '^[a-f0-9]{64}$' AND
      ("previousSnapshotHash" IS NULL OR "previousSnapshotHash" ~ '^[a-f0-9]{64}$')
    )
);

CREATE UNIQUE INDEX "acp_executable_authority_trust_checkpoint_snapshot_binding_key"
  ON "acp_executable_authority_trust_checkpoints"(
    "signerKeyId", "snapshotVersion", "snapshotId", "snapshotHash"
  );

ALTER TABLE "acp_executable_authority_trust_checkpoints"
  ADD CONSTRAINT "acp_executable_authority_trust_checkpoints_snapshot_fkey"
  FOREIGN KEY ("signerKeyId", "snapshotVersion", "snapshotId", "snapshotHash")
  REFERENCES "acp_executable_authority_trust_snapshots"(
    "signerKeyId", "snapshotVersion", "snapshotId", "snapshotHash"
  ) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "acp_executable_authority_trust_checkpoint_events_signer_idx"
  ON "acp_executable_authority_trust_checkpoint_events"("signerKeyId", "createdAt" DESC);

CREATE OR REPLACE FUNCTION ventureos_guard_executable_authority_trust_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Executable authority trust snapshots are immutable';
END;
$$;

CREATE TRIGGER acp_executable_authority_trust_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "acp_executable_authority_trust_snapshots"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_executable_authority_trust_snapshot();

CREATE OR REPLACE FUNCTION ventureos_guard_executable_authority_trust_checkpoint()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Executable authority trust checkpoints cannot be deleted';
  END IF;
  IF NEW."signerKeyId" <> OLD."signerKeyId" OR
     NEW."snapshotVersion" <> OLD."snapshotVersion" + 1 OR
     NEW."snapshotId" = OLD."snapshotId" OR
     NEW."snapshotHash" = OLD."snapshotHash" OR
     NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Executable authority trust checkpoint transition denied';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_executable_authority_trust_checkpoint_guard
  BEFORE UPDATE OR DELETE ON "acp_executable_authority_trust_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_executable_authority_trust_checkpoint();

CREATE OR REPLACE FUNCTION ventureos_audit_executable_authority_trust_checkpoint()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "acp_executable_authority_trust_checkpoint_events" (
    "signerKeyId",
    "previousSnapshotId", "previousSnapshotVersion", "previousSnapshotHash",
    "nextSnapshotId", "nextSnapshotVersion", "nextSnapshotHash"
  ) VALUES (
    NEW."signerKeyId",
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."snapshotId" ELSE NULL END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."snapshotVersion" ELSE NULL END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."snapshotHash" ELSE NULL END,
    NEW."snapshotId", NEW."snapshotVersion", NEW."snapshotHash"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_executable_authority_trust_checkpoint_audit
  AFTER INSERT OR UPDATE ON "acp_executable_authority_trust_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION ventureos_audit_executable_authority_trust_checkpoint();

CREATE OR REPLACE FUNCTION ventureos_reject_executable_authority_trust_checkpoint_event_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Executable authority trust checkpoint audit evidence is immutable';
END;
$$;

CREATE TRIGGER acp_executable_authority_trust_checkpoint_events_immutable
  BEFORE UPDATE OR DELETE ON "acp_executable_authority_trust_checkpoint_events"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_executable_authority_trust_checkpoint_event_change();
