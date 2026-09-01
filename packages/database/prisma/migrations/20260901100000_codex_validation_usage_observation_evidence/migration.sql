-- Preserve pre-observation terminal evidence explicitly as legacy while making
-- every new completed or cancelled validation bind bounded usage observations.
ALTER TABLE "acp_codex_validation_round_trip_evidence"
  ADD COLUMN "progressEventCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progressEvidenceHash" TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  ADD COLUMN "tokenUsageEventCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tokenUsageEvidenceHash" TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  ADD COLUMN "usageAccountingState" TEXT NOT NULL DEFAULT 'LEGACY_NOT_CAPTURED',
  ADD COLUMN "recognizedCostMinorUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recognizedComputeUnits" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "acp_codex_validation_cancellation_evidence"
  ADD COLUMN "progressEventCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progressEvidenceHash" TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  ADD COLUMN "tokenUsageEventCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tokenUsageEvidenceHash" TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  ADD COLUMN "usageAccountingState" TEXT NOT NULL DEFAULT 'LEGACY_NOT_CAPTURED',
  ADD COLUMN "recognizedCostMinorUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recognizedComputeUnits" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "acp_codex_validation_round_trip_evidence"
  ADD CONSTRAINT "acp_codex_validation_round_trip_usage_observation_check"
    CHECK (
      "progressEventCount" BETWEEN 0 AND 128 AND
      "tokenUsageEventCount" BETWEEN 0 AND "progressEventCount" AND
      "progressEvidenceHash" ~ '^[a-f0-9]{64}$' AND
      "tokenUsageEvidenceHash" ~ '^[a-f0-9]{64}$' AND
      "recognizedCostMinorUnits" = 0 AND
      "recognizedComputeUnits" = 0 AND
      ("usageAccountingState" = 'LEGACY_NOT_CAPTURED' OR
        "progressEventCount" <> 0 OR
        "progressEvidenceHash" = '801adbaf421a4c656b9ec0f28085e952a35d35212487487d5b95a95a7c3b6a64') AND
      ("usageAccountingState" = 'LEGACY_NOT_CAPTURED' OR
        "tokenUsageEventCount" <> 0 OR
        "tokenUsageEvidenceHash" = '95c9cbcf9d54ee66ed622c5c6dc41d45949a816164405da6219991a9b3dde532') AND
      (
        ("usageAccountingState" = 'LEGACY_NOT_CAPTURED' AND
          "progressEventCount" = 0 AND "tokenUsageEventCount" = 0 AND
          "progressEvidenceHash" = repeat('0', 64) AND
          "tokenUsageEvidenceHash" = repeat('0', 64)) OR
        ("usageAccountingState" = 'NOT_OBSERVED' AND "tokenUsageEventCount" = 0) OR
        ("usageAccountingState" = 'OBSERVED_UNMAPPED' AND "tokenUsageEventCount" > 0)
      )
    ),
  ALTER COLUMN "progressEventCount" DROP DEFAULT,
  ALTER COLUMN "progressEvidenceHash" DROP DEFAULT,
  ALTER COLUMN "tokenUsageEventCount" DROP DEFAULT,
  ALTER COLUMN "tokenUsageEvidenceHash" DROP DEFAULT,
  ALTER COLUMN "usageAccountingState" DROP DEFAULT,
  ALTER COLUMN "recognizedCostMinorUnits" DROP DEFAULT,
  ALTER COLUMN "recognizedComputeUnits" DROP DEFAULT;

CREATE FUNCTION ventureos_reject_new_codex_validation_legacy_usage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."usageAccountingState" = 'LEGACY_NOT_CAPTURED' THEN
    RAISE EXCEPTION 'Legacy Codex usage state is reserved for pre-migration evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acp_codex_validation_round_trip_no_new_legacy_usage
  BEFORE INSERT ON "acp_codex_validation_round_trip_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_new_codex_validation_legacy_usage();

CREATE TRIGGER acp_codex_validation_cancellation_no_new_legacy_usage
  BEFORE INSERT ON "acp_codex_validation_cancellation_evidence"
  FOR EACH ROW EXECUTE FUNCTION ventureos_reject_new_codex_validation_legacy_usage();

ALTER TABLE "acp_codex_validation_cancellation_evidence"
  ADD CONSTRAINT "acp_codex_validation_cancellation_usage_observation_check"
    CHECK (
      "progressEventCount" BETWEEN 0 AND 128 AND
      "tokenUsageEventCount" BETWEEN 0 AND "progressEventCount" AND
      "progressEvidenceHash" ~ '^[a-f0-9]{64}$' AND
      "tokenUsageEvidenceHash" ~ '^[a-f0-9]{64}$' AND
      "recognizedCostMinorUnits" = 0 AND
      "recognizedComputeUnits" = 0 AND
      ("usageAccountingState" = 'LEGACY_NOT_CAPTURED' OR
        "progressEventCount" <> 0 OR
        "progressEvidenceHash" = '801adbaf421a4c656b9ec0f28085e952a35d35212487487d5b95a95a7c3b6a64') AND
      ("usageAccountingState" = 'LEGACY_NOT_CAPTURED' OR
        "tokenUsageEventCount" <> 0 OR
        "tokenUsageEvidenceHash" = '95c9cbcf9d54ee66ed622c5c6dc41d45949a816164405da6219991a9b3dde532') AND
      (
        ("usageAccountingState" = 'LEGACY_NOT_CAPTURED' AND
          "progressEventCount" = 0 AND "tokenUsageEventCount" = 0 AND
          "progressEvidenceHash" = repeat('0', 64) AND
          "tokenUsageEvidenceHash" = repeat('0', 64)) OR
        ("usageAccountingState" = 'NOT_OBSERVED' AND "tokenUsageEventCount" = 0) OR
        ("usageAccountingState" = 'OBSERVED_UNMAPPED' AND "tokenUsageEventCount" > 0)
      )
    ),
  ALTER COLUMN "progressEventCount" DROP DEFAULT,
  ALTER COLUMN "progressEvidenceHash" DROP DEFAULT,
  ALTER COLUMN "tokenUsageEventCount" DROP DEFAULT,
  ALTER COLUMN "tokenUsageEvidenceHash" DROP DEFAULT,
  ALTER COLUMN "usageAccountingState" DROP DEFAULT,
  ALTER COLUMN "recognizedCostMinorUnits" DROP DEFAULT,
  ALTER COLUMN "recognizedComputeUnits" DROP DEFAULT;
