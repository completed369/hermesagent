-- CreateTable
CREATE TABLE "workspace_invitations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "acceptedById" UUID,
    "tokenDigest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_invitations_tokenDigest_key" ON "workspace_invitations"("tokenDigest");
CREATE INDEX "workspace_invitations_workspaceId_createdAt_idx" ON "workspace_invitations"("workspaceId", "createdAt" DESC);
CREATE INDEX "workspace_invitations_expiresAt_idx" ON "workspace_invitations"("expiresAt");

ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Deterministic collaboration roles and permission maps. Membership mutation
-- remains founder-only; operators can perform normal workspace work and
-- viewers receive read-only capabilities.
INSERT INTO "permissions" ("id", "key", "description", "createdAt") VALUES
  ('7b0db987-35b7-4f65-9ab7-0bdefbc8f002', 'workspace:members:manage', 'Invite, change roles, and remove workspace members', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "roles" ("id", "key", "name", "description", "createdAt") VALUES
  ('7b0db987-35b7-4f65-9ab7-0bdefbc8f003', 'OPERATOR', 'Operator', 'Operate workspace workflows without founder-only authority', CURRENT_TIMESTAMP),
  ('7b0db987-35b7-4f65-9ab7-0bdefbc8f004', 'VIEWER', 'Viewer', 'Read-only workspace access', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'FOUNDER'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'OPERATOR'
  AND p."key" IN ('approval:view', 'workflow:view', 'opportunity:view', 'board:view', 'product:view', 'research:view', 'marketplace:view', 'finance:view', 'opportunity:manage', 'board:manage', 'product:manage', 'research:manage', 'marketplace:manage', 'finance:manage')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'VIEWER'
  AND p."key" IN ('approval:view', 'workflow:view', 'opportunity:view', 'board:view', 'product:view', 'research:view', 'marketplace:view', 'finance:view')
ON CONFLICT DO NOTHING;
