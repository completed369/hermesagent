CREATE OR REPLACE FUNCTION ventureos_guard_retained_native_module_authorization_snapshot_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  latest "acp_retained_native_module_authorization_snapshots"%ROWTYPE;
BEGIN
  -- Serialize only this supervisor's chain. Hash collisions can reduce concurrency but cannot
  -- weaken the chain rule.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."supervisorInstanceId", 90497));

  SELECT * INTO latest
  FROM "acp_retained_native_module_authorization_snapshots"
  WHERE "supervisorInstanceId" = NEW."supervisorInstanceId"
  ORDER BY "snapshotVersion" DESC
  LIMIT 1;

  IF NOT FOUND THEN
    IF NEW."snapshotVersion" <> 1 OR NEW."previousSnapshotHash" IS NOT NULL THEN
      RAISE EXCEPTION 'Native-module authorization snapshot bootstrap denied';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."snapshotVersion" = latest."snapshotVersion" THEN
    IF NEW."snapshotId" IS DISTINCT FROM latest."snapshotId" OR
       NEW."snapshotHash" IS DISTINCT FROM latest."snapshotHash" OR
       NEW."signerKeyId" IS DISTINCT FROM latest."signerKeyId" OR
       NEW."previousSnapshotHash" IS DISTINCT FROM latest."previousSnapshotHash" OR
       NEW."snapshot" IS DISTINCT FROM latest."snapshot" OR
       NEW."issuedAt" IS DISTINCT FROM latest."issuedAt" OR
       NEW."validUntil" IS DISTINCT FROM latest."validUntil" THEN
      RAISE EXCEPTION 'Native-module authorization snapshot equivocation denied';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."snapshotVersion" <> latest."snapshotVersion" + 1 OR
     NEW."previousSnapshotHash" IS DISTINCT FROM latest."snapshotHash" THEN
    RAISE EXCEPTION 'Native-module authorization snapshot chain transition denied';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_retained_native_module_authorization_snapshot_insert_guard
  BEFORE INSERT ON "acp_retained_native_module_authorization_snapshots"
  FOR EACH ROW EXECUTE FUNCTION ventureos_guard_retained_native_module_authorization_snapshot_insert();
