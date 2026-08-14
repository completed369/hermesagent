-- Governed long-term memory for VentureOS agents.
-- The table is intentionally accessed through the narrow agent-runtime memory
-- repository rather than exposed for ad-hoc application writes. Corrections
-- create a superseding record; durable memory is never silently rewritten.
CREATE TABLE "memory_entries" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sensitivity" TEXT NOT NULL DEFAULT 'INTERNAL',
    "createdByAgent" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "importance" INTEGER NOT NULL DEFAULT 50,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "supersedesId" UUID,
    "supersededAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "memory_entries_type_check" CHECK ("type" IN ('FACT', 'DECISION', 'EPISODE', 'PROCEDURE')),
    CONSTRAINT "memory_entries_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
    CONSTRAINT "memory_entries_sensitivity_check" CHECK ("sensitivity" IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
    CONSTRAINT "memory_entries_importance_check" CHECK ("importance" >= 0 AND "importance" <= 100),
    CONSTRAINT "memory_entries_status_check" CHECK ("status" IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED')),
    CONSTRAINT "memory_entries_no_self_supersede_check" CHECK ("supersedesId" IS NULL OR "supersedesId" <> "id")
);

ALTER TABLE "memory_entries"
    ADD CONSTRAINT "memory_entries_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "memory_entries"
    ADD CONSTRAINT "memory_entries_supersedesId_fkey"
    FOREIGN KEY ("supersedesId") REFERENCES "memory_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "memory_entries_workspace_status_created_idx"
    ON "memory_entries"("workspaceId", "status", "createdAt" DESC);
CREATE INDEX "memory_entries_workspace_type_importance_idx"
    ON "memory_entries"("workspaceId", "type", "importance" DESC);
CREATE INDEX "memory_entries_expiresAt_idx" ON "memory_entries"("expiresAt");
CREATE INDEX "memory_entries_tags_gin_idx" ON "memory_entries" USING GIN ("tags");
