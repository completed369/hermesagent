-- ADR-0170: immutable, privacy-minimized commercial evidence assertions.
-- These rows retain hashes and provenance but cannot self-promote a revenue
-- record to verified payment, delivery, or commercial outcome truth.

CREATE TABLE "revenue_run_commercial_evidence" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "revenueRunId" UUID NOT NULL,
    "revenueEntryId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceReferenceHash" TEXT NOT NULL,
    "sourceArtifactSha256" TEXT NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "verificationState" TEXT NOT NULL DEFAULT 'UNVERIFIED_EXTERNAL_ASSERTION',
    "evidenceHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_run_commercial_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "revenue_run_commercial_evidence_kind_check" CHECK (
        "kind" IN ('PAYMENT_SETTLEMENT', 'DELIVERY_CONFIRMATION', 'REFUND_OBSERVATION')
    ),
    CONSTRAINT "revenue_run_commercial_evidence_source_check" CHECK (
        "sourceType" IN (
            'MARKETPLACE_EXPORT',
            'PAYMENT_PROCESSOR_EXPORT',
            'BANK_SETTLEMENT_EXPORT',
            'FULFILLMENT_EXPORT',
            'FOUNDER_OBSERVED'
        )
    ),
    CONSTRAINT "revenue_run_commercial_evidence_unverified_check" CHECK (
        "verificationState" = 'UNVERIFIED_EXTERNAL_ASSERTION'
    ),
    CONSTRAINT "revenue_run_commercial_evidence_reference_hash_check" CHECK (
        "sourceReferenceHash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "revenue_run_commercial_evidence_artifact_hash_check" CHECK (
        "sourceArtifactSha256" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "revenue_run_commercial_evidence_hash_check" CHECK (
        "evidenceHash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "revenue_run_commercial_evidence_time_check" CHECK (
        "observedAt" <= "createdAt"
    ),
    CONSTRAINT "revenue_run_commercial_evidence_idempotency_check" CHECK (
        char_length("idempotencyKey") BETWEEN 1 AND 200
        AND "idempotencyKey" = btrim("idempotencyKey")
    ),
    CONSTRAINT "revenue_run_commercial_evidence_actor_check" CHECK (
        char_length("recordedBy") BETWEEN 1 AND 200
        AND "recordedBy" = btrim("recordedBy")
    )
);

CREATE UNIQUE INDEX "revenue_run_commercial_evidence_workspace_idempotency_key"
    ON "revenue_run_commercial_evidence"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "revenue_run_commercial_evidence_artifact_key"
    ON "revenue_run_commercial_evidence"(
        "workspaceId", "revenueRunId", "revenueEntryId", "kind", "sourceArtifactSha256"
    );
CREATE INDEX "revenue_run_commercial_evidence_link_created_idx"
    ON "revenue_run_commercial_evidence"(
        "workspaceId", "revenueRunId", "revenueEntryId", "createdAt" DESC
    );

ALTER TABLE "revenue_run_commercial_evidence"
    ADD CONSTRAINT "revenue_run_commercial_evidence_revenue_link_fkey"
    FOREIGN KEY ("workspaceId", "revenueRunId", "revenueEntryId")
    REFERENCES "revenue_run_revenue_entries"("workspaceId", "revenueRunId", "revenueEntryId")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ventureos_reject_revenue_commercial_evidence_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF EXISTS (
            SELECT 1
              FROM "revenue_run_revenue_entries" l
             WHERE l."workspaceId" = OLD."workspaceId"
               AND l."revenueRunId" = OLD."revenueRunId"
               AND l."revenueEntryId" = OLD."revenueEntryId"
        ) THEN
            RAISE EXCEPTION 'Revenue commercial evidence is append-only';
        END IF;
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'Revenue commercial evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_run_commercial_evidence_update_guard
BEFORE UPDATE ON "revenue_run_commercial_evidence"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_commercial_evidence_change();

CREATE TRIGGER revenue_run_commercial_evidence_delete_guard
BEFORE DELETE ON "revenue_run_commercial_evidence"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_commercial_evidence_change();
