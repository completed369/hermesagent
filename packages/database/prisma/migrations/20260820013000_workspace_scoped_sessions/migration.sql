-- Sessions carry an explicit active workspace. The column remains nullable so
-- legacy/orphaned sessions fail closed in SessionAuthGuard instead of making
-- the migration destructive. Every newly-created session sets it.
ALTER TABLE "sessions" ADD COLUMN "activeWorkspaceId" UUID;

-- Existing installations currently have one membership per account. Choose a
-- deterministic membership for each session so the migration is safe even if
-- a test or early adopter already created multiple memberships.
UPDATE "sessions" AS s
SET "activeWorkspaceId" = (
  SELECT wm."workspaceId"
  FROM "workspace_members" AS wm
  WHERE wm."userId" = s."userId"
  ORDER BY wm."createdAt" ASC, wm."id" ASC
  LIMIT 1
)
WHERE s."activeWorkspaceId" IS NULL;

CREATE INDEX "sessions_userId_activeWorkspaceId_idx"
  ON "sessions"("userId", "activeWorkspaceId");

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_activeWorkspaceId_fkey"
  FOREIGN KEY ("activeWorkspaceId") REFERENCES "workspaces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
