CREATE OR REPLACE FUNCTION ventureos_require_current_native_module_snapshot_root()
RETURNS TRIGGER AS $$
DECLARE
  database_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Serialize publication against root rotation/revocation for this supervisor. The root insert
  -- guard uses the same key, so a root cannot become stale between this check and commit.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."supervisorInstanceId", 90503));

  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT ON (roots."rootRecordId")
        roots."signerKeyId", roots."minimumSnapshotVersion", roots."validFrom",
        roots."validUntil", roots."revokedAt"
      FROM "acp_retained_native_module_authorization_roots" roots
      WHERE roots."workspaceId" = NEW."workspaceId"
        AND roots."supervisorInstanceId" = NEW."supervisorInstanceId"
      ORDER BY roots."rootRecordId", roots."rootRecordVersion" DESC
    ) current_roots
    WHERE current_roots."signerKeyId" = NEW."signerKeyId"
      AND current_roots."minimumSnapshotVersion" <= NEW."snapshotVersion"
      AND current_roots."validFrom" <= database_now
      AND current_roots."validUntil" > database_now
      AND (current_roots."revokedAt" IS NULL OR current_roots."revokedAt" > database_now)
  ) THEN
    RAISE EXCEPTION 'Native-module snapshot current public-root binding denied';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The name sorts after the existing evidence-freshness trigger so its stable denial semantics are
-- preserved for stale and cross-workspace direct inserts before the root binding is evaluated.
CREATE TRIGGER acp_rn_module_auth_issuance_root_binding
  BEFORE INSERT ON "acp_retained_native_module_authorization_issuance_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_require_current_native_module_snapshot_root();
