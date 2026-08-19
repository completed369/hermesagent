import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { prisma } from '@ventureos/database';
import { hashSessionToken } from '@ventureos/auth';
import { loadEnv } from '@ventureos/config';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { WorkspacesService } from '../src/modules/workspaces/workspaces.service';
import { entitleTestWorkspace } from './helpers/entitled-workspace';

describe('collaborative workspace invitations (integration)', () => {
  const env = loadEnv();
  const service = new WorkspacesService(new AuditService());
  const workspaceIds: string[] = [];
  const userIds: string[] = [];
  let workspaceId: string;
  let founderId: string;
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule);
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const founderRole = await prisma.role.upsert({
      where: { key: 'FOUNDER' },
      update: {},
      create: { key: 'FOUNDER', name: 'Founder' },
    });
    await prisma.role.upsert({
      where: { key: 'OPERATOR' },
      update: {},
      create: { key: 'OPERATOR', name: 'Operator' },
    });
    await prisma.role.upsert({
      where: { key: 'VIEWER' },
      update: {},
      create: { key: 'VIEWER', name: 'Viewer' },
    });
    const memberManagePermission = await prisma.permission.upsert({
      where: { key: 'workspace:members:manage' },
      update: {},
      create: {
        key: 'workspace:members:manage',
        description: 'Manage workspace membership',
      },
    });
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: founderRole.id,
          permissionId: memberManagePermission.id,
        },
      },
      update: {},
      create: { roleId: founderRole.id, permissionId: memberManagePermission.id },
    });
    await prisma.rolePermission.deleteMany({
      where: {
        permissionId: memberManagePermission.id,
        role: { key: { in: ['OPERATOR', 'VIEWER'] } },
      },
    });
    const workspace = await prisma.workspace.create({
      data: { name: 'Collaboration test', slug: `collab-${randomUUID()}` },
    });
    const founder = await prisma.user.create({
      data: {
        email: `founder-${randomUUID()}@example.test`,
        displayName: 'Founder',
        isFounder: true,
      },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: founder.id, roleId: founderRole.id },
    });
    workspaceId = workspace.id;
    founderId = founder.id;
    workspaceIds.push(workspaceId);
    userIds.push(founderId);
    await entitleTestWorkspace(workspaceId, { maxWorkspaceMembers: 5 });
  });

  async function sessionCookie(userId: string): Promise<string> {
    const token = randomUUID();
    await prisma.session.create({
      data: {
        userId,
        tokenDigest: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `${env.AUTH_COOKIE_NAME}=${token}`;
  }

  async function createMember(roleKey: 'OPERATOR' | 'VIEWER') {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    const user = await prisma.user.create({
      data: {
        email: `${roleKey.toLowerCase()}-${randomUUID()}@example.test`,
        displayName: roleKey,
      },
    });
    userIds.push(user.id);
    const member = await prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, roleId: role.id },
    });
    return { user, member, cookie: await sessionCookie(user.id) };
  }

  afterEach(async () => {
    const acceptedUsers = await prisma.workspaceInvitation.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { acceptedById: true },
    });
    userIds.push(
      ...acceptedUsers.flatMap((invitation) =>
        invitation.acceptedById ? [invitation.acceptedById] : [],
      ),
    );
    await prisma.workspaceInvitation.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.plan.deleteMany({
      where: { key: { in: workspaceIds.map((id) => `INTEGRATION_TEST_${id}`) } },
    });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    workspaceIds.length = 0;
    userIds.length = 0;
  });

  it('stores only a digest, expires links, and rejects replay', async () => {
    const invitation = await service.createInvitation(workspaceId, founderId, 'OPERATOR', 24);
    const stored = await prisma.workspaceInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(stored.tokenDigest).not.toContain(invitation.token);
    expect(stored.tokenDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await prisma.auditEvent.findFirst({
        where: {
          workspaceId,
          action: 'WORKSPACE_INVITATION_CREATED',
          entityId: invitation.id,
        },
      }),
    ).not.toBeNull();

    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(service.getInvitation(invitation.token)).rejects.toThrow('expired');

    const active = await service.createInvitation(workspaceId, founderId, 'VIEWER', 24);
    await service.acceptInvitation(active.token, {
      email: `viewer-${randomUUID()}@example.test`,
      password: 'correct-horse-battery',
      displayName: 'Viewer',
    });
    expect(
      await prisma.auditEvent.findFirst({
        where: { workspaceId, action: 'WORKSPACE_INVITATION_ACCEPTED' },
      }),
    ).not.toBeNull();
    await expect(
      service.acceptInvitation(active.token, {
        email: `replay-${randomUUID()}@example.test`,
        password: 'correct-horse-battery',
        displayName: 'Replay',
      }),
    ).rejects.toThrow('already been used');
  });

  it('enforces tenant isolation for founder member mutations', async () => {
    const otherWorkspace = await prisma.workspace.create({
      data: { name: 'Other tenant', slug: `other-${randomUUID()}` },
    });
    workspaceIds.push(otherWorkspace.id);
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'VIEWER' } });
    const outsider = await prisma.user.create({
      data: { email: `outside-${randomUUID()}@example.test`, displayName: 'Outside' },
    });
    userIds.push(outsider.id);
    const outsideMember = await prisma.workspaceMember.create({
      data: { workspaceId: otherWorkspace.id, userId: outsider.id, roleId: viewerRole.id },
    });

    await expect(
      service.changeMemberRole(workspaceId, founderId, outsideMember.id, 'OPERATOR'),
    ).rejects.toThrow('not found');
    await expect(service.removeMember(workspaceId, founderId, outsideMember.id)).rejects.toThrow(
      'not found',
    );
    expect(
      await prisma.workspaceMember.findUnique({ where: { id: outsideMember.id } }),
    ).not.toBeNull();
  });

  it('serializes concurrent accepts so plan quota cannot be exceeded', async () => {
    const planKey = `INTEGRATION_TEST_${workspaceId}`;
    await prisma.plan.update({ where: { key: planKey }, data: { maxWorkspaceMembers: 2 } });
    const first = await service.createInvitation(workspaceId, founderId, 'OPERATOR', 24);
    const second = await service.createInvitation(workspaceId, founderId, 'VIEWER', 24);

    const results = await Promise.allSettled([
      service.acceptInvitation(first.token, {
        email: `one-${randomUUID()}@example.test`,
        password: 'correct-horse-battery',
        displayName: 'One',
      }),
      service.acceptInvitation(second.token, {
        email: `two-${randomUUID()}@example.test`,
        password: 'correct-horse-battery',
        displayName: 'Two',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.workspaceMember.count({ where: { workspaceId } })).toBe(2);
  });

  it('rejects invite creation when the workspace is already at quota', async () => {
    await prisma.plan.update({
      where: { key: `INTEGRATION_TEST_${workspaceId}` },
      data: { maxWorkspaceMembers: 1 },
    });
    await expect(service.createInvitation(workspaceId, founderId, 'VIEWER', 24)).rejects.toThrow(
      'member limit reached',
    );
  });

  it('enforces founder-only HTTP access, tenant scope, audits, and session revocation', async () => {
    const founderCookie = await sessionCookie(founderId);
    const operator = await createMember('OPERATOR');
    const viewer = await createMember('VIEWER');

    const founderList = await request(app.getHttpServer())
      .get('/api/workspaces/members')
      .set('Cookie', founderCookie);
    expect(founderList.status).toBe(200);
    expect(founderList.body).toHaveLength(3);

    for (const cookie of [operator.cookie, viewer.cookie]) {
      const forbidden = await request(app.getHttpServer())
        .get('/api/workspaces/members')
        .set('Cookie', cookie);
      expect(forbidden.status).toBe(403);
    }

    const otherWorkspace = await prisma.workspace.create({
      data: { name: 'HTTP other tenant', slug: `http-other-${randomUUID()}` },
    });
    workspaceIds.push(otherWorkspace.id);
    const otherUser = await prisma.user.create({
      data: { email: `http-other-${randomUUID()}@example.test`, displayName: 'Other' },
    });
    userIds.push(otherUser.id);
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'VIEWER' } });
    const otherMember = await prisma.workspaceMember.create({
      data: { workspaceId: otherWorkspace.id, userId: otherUser.id, roleId: viewerRole.id },
    });
    const crossTenant = await request(app.getHttpServer())
      .patch(`/api/workspaces/members/${otherMember.id}/role`)
      .set('Cookie', founderCookie)
      .set('Origin', env.API_CORS_ORIGIN)
      .send({ roleKey: 'OPERATOR' });
    expect(crossTenant.status).toBe(404);

    const roleChange = await request(app.getHttpServer())
      .patch(`/api/workspaces/members/${operator.member.id}/role`)
      .set('Cookie', founderCookie)
      .set('Origin', env.API_CORS_ORIGIN)
      .send({ roleKey: 'VIEWER' });
    expect(roleChange.status).toBe(200);
    expect(
      await prisma.auditEvent.findFirst({
        where: {
          workspaceId,
          action: 'WORKSPACE_MEMBER_ROLE_CHANGED',
          entityId: operator.member.id,
        },
      }),
    ).not.toBeNull();

    const removal = await request(app.getHttpServer())
      .delete(`/api/workspaces/members/${viewer.member.id}`)
      .set('Cookie', founderCookie)
      .set('Origin', env.API_CORS_ORIGIN);
    expect(removal.status).toBe(200);
    expect(await prisma.session.count({ where: { userId: viewer.user.id, revokedAt: null } })).toBe(
      0,
    );
    expect(
      await prisma.auditEvent.findFirst({
        where: { workspaceId, action: 'WORKSPACE_MEMBER_REMOVED', entityId: viewer.member.id },
      }),
    ).not.toBeNull();
  });

  it('returns HTTP 400 for malformed member IDs and invitation tokens', async () => {
    const founderCookie = await sessionCookie(founderId);
    const malformedMember = await request(app.getHttpServer())
      .delete('/api/workspaces/members/not-a-uuid')
      .set('Cookie', founderCookie)
      .set('Origin', env.API_CORS_ORIGIN);
    expect(malformedMember.status).toBe(400);

    const malformedPreview = await request(app.getHttpServer()).get(
      '/api/workspace-invitations/not-a-token',
    );
    expect(malformedPreview.status).toBe(400);

    const malformedAccept = await request(app.getHttpServer())
      .post(`/api/workspace-invitations/${'a'.repeat(44)}/accept`)
      .send({ email: 'bad@example.test', password: 'password123', displayName: 'Bad' });
    expect(malformedAccept.status).toBe(400);
  });

  it('rate-limits repeated unauthenticated invite acceptance attempts', async () => {
    const validUnknownToken = 'a'.repeat(43);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post(`/api/workspace-invitations/${validUnknownToken}/accept`)
        .send({
          email: `abuse-${attempt}@example.test`,
          password: 'password123',
          displayName: 'Abuse',
        });
      statuses.push(response.status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});
