-- Governed long-term memory for VentureOS agents.
-- Public access remains behind @ventureos/agent-runtime's MemoryStore contract.
-- Corrections use supersession and revocation; rows are never silently rewritten.
CREATE TABLE "memory_entries" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sensitivity" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "supersededById" UUID,
    "supersededByActor" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "memory_entries_kind_check" CHECK ("kind" IN ('FACT', 'DECISION', 'EPISODE', 'PROCEDURE')),
    CONSTRAINT "memory_entries_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
    CONSTRAINT "memory_entries_sensitivity_check" CHECK ("sensitivity" IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
    CONSTRAINT "memory_entries_no_self_supersede_check" CHECK ("supersededById" IS NULL OR "supersededById" <> "id"),
    CONSTRAINT "memory_entries_revocation_actor_check" CHECK (("revokedAt" IS NULL AND "revokedBy" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedBy" IS NOT NULL)),
    CONSTRAINT "memory_entries_supersession_actor_check" CHECK (("supersededById" IS NULL AND "supersededByActor" IS NULL) OR ("supersededById" IS NOT NULL AND "supersededByActor" IS NOT NULL))
);

ALTER TABLE "memory_entries"
    ADD CONSTRAINT "memory_entries_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "memory_entries"
    ADD CONSTRAINT "memory_entries_supersededById_fkey"
    FOREIGN KEY ("supersededById") REFERENCES "memory_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "memory_entries_workspace_active_lookup_idx"
    ON "memory_entries"("workspaceId", "subject", "key", "createdAt" DESC)
    WHERE "revokedAt" IS NULL AND "supersededById" IS NULL;
CREATE INDEX "memory_entries_workspace_kind_created_idx"
    ON "memory_entries"("workspaceId", "kind", "createdAt" DESC);
CREATE INDEX "memory_entries_workspace_sensitivity_idx"
    ON "memory_entries"("workspaceId", "sensitivity");
CREATE INDEX "memory_entries_expiresAt_idx" ON "memory_entries"("expiresAt");
