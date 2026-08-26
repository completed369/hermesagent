import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { generateSessionToken, hashSessionToken } from '@ventureos/auth';
import type { Env } from '@ventureos/config';
import { prisma } from '@ventureos/database';
import { SessionAuthGuard } from '../src/common/guards/session-auth.guard';

function executionContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('database-bound session authority projection (PostgreSQL integration)', () => {
  const suffix = randomUUID();
  const short = suffix.replaceAll('-', '').slice(0, 10);
  const token = generateSessionToken();
  const guard = new SessionAuthGuard({ AUTH_COOKIE_NAME: 'ventureos_session' } as Env);
  const workspaceIds: string[] = [];
  const roleIds: string[] = [];
  const oversizedPermissionIds: string[] = [];
  let userId: string;
  let workspaceId: string;
  let exactRoleId: string;
  let oversizedRoleId: string;
  let sessionId: string;

  function requestWithToken() {
    return { cookies: { ventureos_session: token } };
  }

  beforeAll(async () => {
    const [exactWorkspace, foreignWorkspace] = await Promise.all([
      prisma.workspace.create({
        data: { name: 'Session authority exact', slug: `session-authority-${suffix}` },
      }),
      prisma.workspace.create({
        data: { name: 'Session authority foreign', slug: `session-authority-foreign-${suffix}` },
      }),
    ]);
    workspaceId = exactWorkspace.id;
    workspaceIds.push(exactWorkspace.id, foreignWorkspace.id);

    const [exactRole, foreignRole, oversizedRole] = await Promise.all([
      prisma.role.create({
        data: { key: `SESSION_EXACT_${short}`.toUpperCase(), name: 'Session exact role' },
      }),
      prisma.role.create({
        data: { key: `SESSION_FOREIGN_${short}`.toUpperCase(), name: 'Session foreign role' },
      }),
      prisma.role.create({
        data: { key: `SESSION_OVERSIZED_${short}`.toUpperCase(), name: 'Session oversized role' },
      }),
    ]);
    exactRoleId = exactRole.id;
    oversizedRoleId = oversizedRole.id;
    roleIds.push(exactRole.id, foreignRole.id, oversizedRole.id);

    const [workflowPermission, opportunityPermission] = await Promise.all([
      prisma.permission.upsert({
        where: { key: 'workflow:view' },
        update: {},
        create: { key: 'workflow:view', description: 'View workflow runs' },
      }),
      prisma.permission.upsert({
        where: { key: 'opportunity:view' },
        update: {},
        create: { key: 'opportunity:view', description: 'View opportunities' },
      }),
    ]);
    await prisma.rolePermission.createMany({
      data: [workflowPermission.id, opportunityPermission.id].map((permissionId) => ({
        roleId: exactRole.id,
        permissionId,
      })),
    });

    const oversizedPermissionKeys = Array.from(
      { length: 129 },
      (_, index) => `sessiontest:${short}-${String(index).padStart(3, '0')}`,
    );
    await prisma.permission.createMany({
      data: oversizedPermissionKeys.map((key) => ({
        key,
        description: 'Synthetic session authority bound',
      })),
    });
    const oversizedPermissions = await prisma.permission.findMany({
      where: { key: { in: oversizedPermissionKeys } },
      select: { id: true },
    });
    expect(oversizedPermissions).toHaveLength(129);
    oversizedPermissionIds.push(...oversizedPermissions.map(({ id }) => id));
    await prisma.rolePermission.createMany({
      data: oversizedPermissions.map(({ id: permissionId }) => ({
        roleId: oversizedRole.id,
        permissionId,
      })),
    });

    const user = await prisma.user.create({
      data: {
        email: `session-authority-${suffix}@example.test`,
        displayName: 'Session authority test user',
      },
    });
    userId = user.id;
    await prisma.workspaceMember.createMany({
      data: [
        { userId, workspaceId, roleId: exactRole.id },
        { userId, workspaceId: foreignWorkspace.id, roleId: foreignRole.id },
      ],
    });

    const extraWorkspaces = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        prisma.workspace.create({
          data: {
            name: `Session foreign ${index}`,
            slug: `session-authority-foreign-${index}-${suffix}`,
          },
        }),
      ),
    );
    workspaceIds.push(...extraWorkspaces.map(({ id }) => id));
    await prisma.workspaceMember.createMany({
      data: extraWorkspaces.map(({ id: foreignWorkspaceId }) => ({
        userId,
        workspaceId: foreignWorkspaceId,
        roleId: foreignRole.id,
      })),
    });

    const session = await prisma.session.create({
      data: {
        userId,
        activeWorkspaceId: workspaceId,
        tokenDigest: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    });
    sessionId = session.id;
  });

  beforeEach(async () => {
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: null } });
    await prisma.workspace.update({ where: { id: workspaceId }, data: { deletedAt: null } });
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, roleId: exactRoleId },
      update: { roleId: exactRoleId },
    });
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        activeWorkspaceId: workspaceId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    });
  });

  afterAll(async () => {
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (workspaceIds.length > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (roleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    if (oversizedPermissionIds.length > 0) {
      await prisma.permission.deleteMany({ where: { id: { in: oversizedPermissionIds } } });
    }
  });

  it('projects only the exact active membership despite many foreign memberships', async () => {
    const request = requestWithToken();
    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(request).toMatchObject({
      user: {
        userId,
        workspaceId,
        workspaceName: 'Session authority exact',
        roleKey: `SESSION_EXACT_${short}`.toUpperCase(),
        permissions: ['opportunity:view', 'workflow:view'],
      },
    });
  });

  it('uses the database clock and denies expired or revoked sessions', async () => {
    await prisma.$executeRaw`
      UPDATE "sessions"
      SET "expiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 second'
      WHERE "id" = ${sessionId}::uuid
    `;
    await expect(guard.canActivate(executionContext(requestWithToken()))).rejects.toThrow(
      UnauthorizedException,
    );

    await prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() },
    });
    await expect(guard.canActivate(executionContext(requestWithToken()))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('denies a deleted active workspace or removed exact membership', async () => {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { deletedAt: new Date() } });
    await expect(guard.canActivate(executionContext(requestWithToken()))).rejects.toThrow(
      UnauthorizedException,
    );

    await prisma.workspace.update({ where: { id: workspaceId }, data: { deletedAt: null } });
    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    await expect(guard.canActivate(executionContext(requestWithToken()))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('denies a soft-deleted session user', async () => {
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    await expect(guard.canActivate(executionContext(requestWithToken()))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('fails closed instead of truncating an oversized permission set', async () => {
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { roleId: oversizedRoleId },
    });
    await expect(guard.canActivate(executionContext(requestWithToken()))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
