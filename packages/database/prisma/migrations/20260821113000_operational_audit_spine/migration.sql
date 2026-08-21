-- Add durable operational-event provenance and replay protection without
-- changing the meaning of existing audit rows.
ALTER TABLE "audit_events"
  ADD COLUMN "workspaceReference" TEXT,
  ADD COLUMN "actorReference" TEXT,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'APPLICATION',
  ADD COLUMN "sourceEventId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "integrityVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "occurredAt" TIMESTAMP(3);

-- Preserve the provenance that is currently represented by nullable foreign
-- keys before future user/workspace erasure can clear those relationships.
-- Existing checksums remain integrityVersion 1 and are not rewritten.
UPDATE "audit_events"
SET
  "workspaceReference" = "workspaceId"::text,
  "actorReference" = "actorId"::text,
  "sourceEventId" = "id"::text,
  "occurredAt" = "createdAt";

-- Use the immutable workspace reference rather than the nullable relation so
-- ON DELETE SET NULL cannot silently remove replay protection from retained
-- audit rows.
CREATE UNIQUE INDEX "audit_events_workspaceReference_source_sourceEventId_key"
  ON "audit_events"("workspaceReference", "source", "sourceEventId");

CREATE UNIQUE INDEX "audit_events_workspaceReference_source_idempotencyKey_key"
  ON "audit_events"("workspaceReference", "source", "idempotencyKey");

-- Application audit content is immutable after insert. The nullable relational
-- actor/workspace columns may only transition to NULL so user or tenant erasure
-- can satisfy the existing ON DELETE SET NULL foreign keys. Immutable textual
-- references preserve provenance without preventing those erasure operations.
-- Row deletion remains an explicit retention/erasure operation and is not
-- described as cryptographic tamper-proofing.
CREATE OR REPLACE FUNCTION "guard_audit_event_immutable_content"()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW."id",
    NEW."workspaceReference",
    NEW."actorReference",
    NEW."source",
    NEW."sourceEventId",
    NEW."idempotencyKey",
    NEW."action",
    NEW."entityType",
    NEW."entityId",
    NEW."before",
    NEW."after",
    NEW."correlationId",
    NEW."workflowId",
    NEW."policyResult",
    NEW."approvalReference",
    NEW."ipOrSessionId",
    NEW."integrityHash",
    NEW."integrityVersion",
    NEW."occurredAt",
    NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."workspaceReference",
    OLD."actorReference",
    OLD."source",
    OLD."sourceEventId",
    OLD."idempotencyKey",
    OLD."action",
    OLD."entityType",
    OLD."entityId",
    OLD."before",
    OLD."after",
    OLD."correlationId",
    OLD."workflowId",
    OLD."policyResult",
    OLD."approvalReference",
    OLD."ipOrSessionId",
    OLD."integrityHash",
    OLD."integrityVersion",
    OLD."occurredAt",
    OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'audit event content is immutable';
  END IF;

  IF NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
     AND NOT (OLD."workspaceId" IS NOT NULL AND NEW."workspaceId" IS NULL) THEN
    RAISE EXCEPTION 'audit event workspace relation may only be cleared for erasure';
  END IF;

  IF NEW."actorId" IS DISTINCT FROM OLD."actorId"
     AND NOT (OLD."actorId" IS NOT NULL AND NEW."actorId" IS NULL) THEN
    RAISE EXCEPTION 'audit event actor relation may only be cleared for erasure';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_immutable_content_guard"
BEFORE UPDATE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "guard_audit_event_immutable_content"();
