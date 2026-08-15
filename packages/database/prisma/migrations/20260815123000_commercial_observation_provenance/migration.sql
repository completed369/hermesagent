CREATE TABLE "commercial_observation_provenance" (
  "experimentResultId" UUID NOT NULL,
  "evidenceMode" TEXT NOT NULL DEFAULT 'MOCK',
  "sourceType" TEXT NOT NULL DEFAULT 'SYNTHETIC',
  "sourceRef" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "commercial_observation_provenance_pkey" PRIMARY KEY ("experimentResultId"),
  CONSTRAINT "commercial_observation_provenance_evidence_mode_check"
    CHECK ("evidenceMode" IN ('REAL', 'MOCK')),
  CONSTRAINT "commercial_observation_provenance_source_type_check"
    CHECK (
      "sourceType" IN (
        'MARKETPLACE_EXPORT',
        'CUSTOMER_SUPPORT',
        'FOUNDER_OBSERVED',
        'MANUAL_IMPORT',
        'SYNTHETIC'
      )
    ),
  CONSTRAINT "commercial_observation_provenance_real_requires_source_check"
    CHECK (
      "evidenceMode" = 'MOCK'
      OR (
        "sourceType" <> 'SYNTHETIC'
        AND "sourceRef" IS NOT NULL
        AND btrim("sourceRef") <> ''
      )
    )
);

ALTER TABLE "commercial_observation_provenance"
  ADD CONSTRAINT "commercial_observation_provenance_experiment_result_fkey"
  FOREIGN KEY ("experimentResultId") REFERENCES "experiment_results"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "commercial_observation_provenance"
  ADD CONSTRAINT "commercial_observation_provenance_recorded_by_fkey"
  FOREIGN KEY ("recordedBy") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "commercial_observation_provenance_evidence_mode_idx"
  ON "commercial_observation_provenance"("evidenceMode");
CREATE INDEX "commercial_observation_provenance_recorded_by_idx"
  ON "commercial_observation_provenance"("recordedBy");

INSERT INTO "commercial_observation_provenance" (
  "experimentResultId",
  "evidenceMode",
  "sourceType",
  "sourceRef",
  "observedAt",
  "recordedBy",
  "createdAt"
)
SELECT
  "id",
  'MOCK',
  'SYNTHETIC',
  NULL,
  "measuredAt",
  NULL,
  "createdAt"
FROM "experiment_results";
