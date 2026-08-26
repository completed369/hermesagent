import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { prisma } from '@ventureos/database';
import { generateSessionToken, hashSessionToken } from '@ventureos/auth';
import { loadEnv } from '@ventureos/config';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { WorkspacesService } from '../src/modules/workspaces/workspaces.service';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service';
import { entitleTestWorkspace } from './helpers/entitled-workspace';

describe('collaborative workspace invitations (integration)', () => {
  const env = loadEnv();
  const service = new WorkspacesService(new AuditService());
  const workspaceIds: string[] = [];
  const userIds: string[] = [];
  let workspaceId: string;
  let founderId: string;
  let app: INestApplication;

  async function createTestApplication(): Promise<INestApplication> {
    const testApp = await NestFactory.create(AppModule);
    testApp.use(cookieParser());
    testApp.setGlobalPrefix('api');
    await testApp.init();
    return testApp;
  }

  beforeAll(async () => {
    app = await createTestApplication();
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
    const workspaceManagePermission = await prisma.permission.upsert({
      where: { key: 'workspace:manage' },
      update: {},
      create: { key: 'workspace:manage', description: 'Manage workspace settings' },
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
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: founderRole.id,
          permissionId: workspaceManagePermission.id,
        },
      },
      update: {},
      create: { roleId: founderRole.id, permissionId: workspaceManagePermission.id },
    });
    await prisma.rolePermission.deleteMany({
      where: {
        permissionId: { in: [memberManagePermission.id, workspaceManagePermission.id] },
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

  async function sessionCookie(userId: string, activeWorkspaceId = workspaceId): Promise<string> {
    const token = generateSessionToken();
    await prisma.session.create({
      data: {
        userId,
        activeWorkspaceId,
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

  it('stores only a digest and rejects expired, revoked, and replayed links', async () => {
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

    const revoked = await service.createInvitation(workspaceId, founderId, 'OPERATOR', 24);
    await prisma.workspaceInvitation.update({
      where: { id: revoked.id },
      data: { revokedAt: new Date() },
    });
    await expect(service.getInvitation(revoked.token)).rejects.toThrow('no longer available');
    await expect(
      service.acceptInvitation(revoked.token, {
        email: `revoked-${randomUUID()}@example.test`,
        password: 'correct-horse-battery',
        displayName: 'Revoked invitation',
      }),
    ).rejects.toThrow('no longer available');

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

    const existingUser = await prisma.user.create({
      data: {
        email: `existing-${randomUUID()}@example.test`,
        displayName: 'Existing account',
      },
    });
    userIds.push(existingUser.id);
    const sourceWorkspace = await prisma.workspace.create({
      data: { name: 'Existing account home', slug: `existing-home-${randomUUID()}` },
    });
    workspaceIds.push(sourceWorkspace.id);
    await entitleTestWorkspace(sourceWorkspace.id, { maxWorkspaceMembers: 5 });
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'VIEWER' } });
    await prisma.workspaceMember.create({
      data: { workspaceId: sourceWorkspace.id, userId: existingUser.id, roleId: viewerRole.id },
    });
    const existingCookie = await sessionCookie(existingUser.id, sourceWorkspace.id);
    const existingAccountInvite = await service.createInvitation(
      workspaceId,
      founderId,
      'VIEWER',
      24,
    );
    const genericResult = await request(app.getHttpServer())
      .post('/api/workspace-invitations/accept')
      .send({
        token: existingAccountInvite.token,
        email: existingUser.email,
        password: 'existing-account-password',
        displayName: 'Existing account',
      });
    expect(genericResult.status).toBe(202);
    expect(genericResult.headers['cache-control']).toBe('no-store');
    expect(genericResult.body).toEqual({ received: true, workspaceName: 'Collaboration test' });
    expect(
      await prisma.workspaceInvitation.findUniqueOrThrow({
        where: { id: existingAccountInvite.id },
        select: { acceptedAt: true, acceptedById: true, claimPending: true },
      }),
    ).toMatchObject({
      acceptedAt: expect.any(Date),
      acceptedById: existingUser.id,
      claimPending: true,
    });
    expect(
      await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
      }),
    ).toBeNull();
    await expect(service.getInvitation(existingAccountInvite.token)).rejects.toThrow(
      'already been used',
    );
    const authenticatedPreview = await request(app.getHttpServer())
      .post('/api/workspace-invitations/preview-authenticated')
      .set('Cookie', existingCookie)
      .set('Origin', env.API_CORS_ORIGIN)
      .send({ token: existingAccountInvite.token });
    expect(authenticatedPreview.status).toBe(200);
    expect(authenticatedPreview.headers['cache-control']).toBe('no-store');
    expect(authenticatedPreview.body).toMatchObject({
      workspaceName: 'Collaboration test',
      roleKey: 'VIEWER',
      currentRoleKey: null,
    });
    const neutralReplay = await request(app.getHttpServer())
      .post('/api/workspace-invitations/accept')
      .send({
        token: existingAccountInvite.token,
        email: existingUser.email,
        password: 'existing-account-password',
        displayName: 'Existing account',
      });
    expect(neutralReplay.status).toBe(409);

    const authenticatedResult = await request(app.getHttpServer())
      .post('/api/workspace-invitations/accept-authenticated')
      .set('Cookie', existingCookie)
      .set('Origin', env.API_CORS_ORIGIN)
      .send({ token: existingAccountInvite.token });
    expect(authenticatedResult.status).toBe(200);
    expect(authenticatedResult.headers['cache-control']).toBe('no-store');
    expect(authenticatedResult.body).toMatchObject({
      joined: true,
      roleKey: 'VIEWER',
      workspaceId,
    });
    expect(
      await prisma.workspaceInvitation.findUniqueOrThrow({
        where: { id: existingAccountInvite.id },
        select: { acceptedAt: true, acceptedById: true, claimPending: true },
      }),
    ).toMatchObject({
      acceptedAt: expect.any(Date),
      acceptedById: existingUser.id,
      claimPending: false,
    });
    expect(
      await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
      }),
    ).not.toBeNull();
    expect(
      await prisma.session.findFirstOrThrow({
        where: { userId: existingUser.id, revokedAt: null },
        select: { activeWorkspaceId: true },
      }),
    ).toEqual({ activeWorkspaceId: workspaceId });
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId,
          actorId: existingUser.id,
          action: { in: ['WORKSPACE_INVITATION_ACCEPTED', 'WORKSPACE_SESSION_SWITCHED'] },
        },
      }),
    ).toBe(2);
    expect(
      await prisma.auditEvent.findFirst({
        where: {
          workspaceId,
          actorId: null,
          action: 'WORKSPACE_INVITATION_CLAIM_DEFERRED',
          entityId: existingAccountInvite.id,
        },
      }),
    ).not.toBeNull();
    const authenticatedReplay = await request(app.getHttpServer())
      .post('/api/workspace-invitations/accept-authenticated')
      .set('Cookie', existingCookie)
      .set('Origin', env.API_CORS_ORIGIN)
      .send({ token: existingAccountInvite.token });
    expect(authenticatedReplay.status).toBe(409);
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

  it('protects founders by their tenant-local role rather than a global founder flag', async () => {
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'VIEWER' } });
    const founderElsewhere = await prisma.user.create({
      data: {
        email: `founder-elsewhere-${randomUUID()}@example.test`,
        displayName: 'Founder elsewhere',
        isFounder: true,
      },
    });
    userIds.push(founderElsewhere.id);
    const localViewer = await prisma.workspaceMember.create({
      data: { workspaceId, userId: founderElsewhere.id, roleId: viewerRole.id },
    });

    await expect(
      service.changeMemberRole(workspaceId, founderId, localViewer.id, 'OPERATOR'),
    ).resolves.toMatchObject({ role: { key: 'OPERATOR' } });
    await expect(service.removeMember(workspaceId, founderId, localViewer.id)).resolves.toEqual({
      removed: true,
    });
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

  it('serializes the same new email across workspaces without an enumeration failure', async () => {
    const otherWorkspace = await prisma.workspace.create({
      data: { name: 'Concurrent account tenant', slug: `account-race-${randomUUID()}` },
    });
    workspaceIds.push(otherWorkspace.id);
    const otherFounder = await prisma.user.create({
      data: {
        email: `account-race-founder-${randomUUID()}@example.test`,
        displayName: 'Other founder',
        isFounder: true,
      },
    });
    userIds.push(otherFounder.id);
    const founderRole = await prisma.role.findUniqueOrThrow({ where: { key: 'FOUNDER' } });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: otherWorkspace.id,
        userId: otherFounder.id,
        roleId: founderRole.id,
      },
    });
    await entitleTestWorkspace(otherWorkspace.id, { maxWorkspaceMembers: 5 });

    const [first, second] = await Promise.all([
      service.createInvitation(workspaceId, founderId, 'VIEWER', 24),
      service.createInvitation(otherWorkspace.id, otherFounder.id, 'VIEWER', 24),
    ]);
    const sharedEmail = `cross-workspace-${randomUUID()}@example.test`;
    const responses = await Promise.all([
      request(app.getHttpServer()).post('/api/workspace-invitations/accept').send({
        token: first.token,
        email: sharedEmail,
        password: 'correct-horse-battery',
        displayName: 'Shared account',
      }),
      request(app.getHttpServer()).post('/api/workspace-invitations/accept').send({
        token: second.token,
        email: sharedEmail,
        password: 'correct-horse-battery',
        displayName: 'Shared account',
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(responses.every((response) => response.body.received === true)).toBe(true);
    expect(await prisma.user.count({ where: { email: sharedEmail } })).toBe(1);
    const sharedUser = await prisma.user.findUniqueOrThrow({ where: { email: sharedEmail } });
    userIds.push(sharedUser.id);
    const invitationStates = await prisma.workspaceInvitation.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { id: true, acceptedAt: true, claimPending: true, workspaceId: true },
    });
    expect(invitationStates.every((invitation) => invitation.acceptedAt !== null)).toBe(true);
    const pendingState = invitationStates.find((invitation) => invitation.claimPending);
    expect(pendingState).toBeDefined();
    if (!pendingState) throw new Error('Concurrent neutral acceptance did not reserve a claim');
    expect(
      await prisma.workspaceMember.count({
        where: { userId: sharedUser.id, workspaceId: { in: [workspaceId, otherWorkspace.id] } },
      }),
    ).toBe(1);

    const initialMembership = await prisma.workspaceMember.findFirstOrThrow({
      where: { userId: sharedUser.id },
      select: { workspaceId: true },
    });
    const sharedCookie = await sessionCookie(sharedUser.id, initialMembership.workspaceId);
    const pendingInvitation = pendingState.id === first.id ? first : second;
    const claim = await request(app.getHttpServer())
      .post('/api/workspace-invitations/accept-authenticated')
      .set('Cookie', sharedCookie)
      .set('Origin', env.API_CORS_ORIGIN)
      .send({ token: pendingInvitation.token });
    expect(claim.status).toBe(200);
    expect(claim.body).toMatchObject({ joined: true, workspaceId: pendingState.workspaceId });
    expect(
      await prisma.workspaceInvitation.count({
        where: { id: { in: [first.id, second.id] }, claimPending: false },
      }),
    ).toBe(2);
    expect(
      await prisma.workspaceMember.count({
        where: { userId: sharedUser.id, workspaceId: { in: [workspaceId, otherWorkspace.id] } },
      }),
    ).toBe(2);
  });

  it('keeps an existing membership role when an invitation proposes either higher or lower access', async () => {
    const founderCookie = await sessionCookie(founderId);
    const cases = [
      { memberRole: 'VIEWER' as const, invitationRole: 'OPERATOR' as const },
      { memberRole: 'OPERATOR' as const, invitationRole: 'VIEWER' as const },
    ];

    for (const testCase of cases) {
      const existing = await createMember(testCase.memberRole);
      const invitationResponse = await request(app.getHttpServer())
        .post('/api/workspaces/invitations')
        .set('Cookie', founderCookie)
        .set('Origin', env.API_CORS_ORIGIN)
        .send({ roleKey: testCase.invitationRole, expiresInHours: 24 });
      expect(invitationResponse.status).toBe(201);

      const preview = await request(app.getHttpServer())
        .post('/api/workspace-invitations/preview-authenticated')
        .set('Cookie', existing.cookie)
        .set('Origin', env.API_CORS_ORIGIN)
        .send({ token: invitationResponse.body.token });
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({
        roleKey: testCase.invitationRole,
        currentRoleKey: testCase.memberRole,
      });

      const claim = await request(app.getHttpServer())
        .post('/api/workspace-invitations/accept-authenticated')
        .set('Cookie', existing.cookie)
        .set('Origin', env.API_CORS_ORIGIN)
        .send({ token: invitationResponse.body.token });
      expect(claim.status).toBe(200);
      expect(claim.body.roleKey).toBe(testCase.memberRole);
      expect(
        await prisma.workspaceMember.findUniqueOrThrow({
          where: {
            workspaceId_userId: { workspaceId, userId: existing.user.id },
          },
          select: { role: { select: { key: true } } },
        }),
      ).toEqual({ role: { key: testCase.memberRole } });
    }
  });

  it('switches only to a real membership and resolves authorization from the active workspace', async () => {
    const operator = await createMember('OPERATOR');
    const secondWorkspace = await prisma.workspace.create({
      data: { name: 'Second tenant', slug: `second-tenant-${randomUUID()}` },
    });
    workspaceIds.push(secondWorkspace.id);
    await entitleTestWorkspace(secondWorkspace.id, { maxWorkspaceMembers: 5 });
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'VIEWER' } });
    await prisma.workspaceMember.create({
      data: { workspaceId: secondWorkspace.id, userId: operator.user.id, roleId: viewerRole.id },
    });

    const outsiderWorkspace = await prisma.workspace.create({
      data: { name: 'Outsider tenant', slug: `outsider-tenant-${randomUUID()}` },
    });
    workspaceIds.push(outsiderWorkspace.id);
    await entitleTestWorkspace(outsiderWorkspace.id, { maxWorkspaceMembers: 5 });

    const available = await request(app.getHttpServer())
      .get('/api/workspaces/available')
      .set('Cookie', operator.cookie);
    expect(available.status).toBe(200);
    expect(
      available.body.map((entry: { workspace: { id: string } }) => entry.workspace.id),
    ).toEqual(expect.arrayContaining([workspaceId, secondWorkspace.id]));

    const forbidden = await request(app.getHttpServer())
      .post('/api/workspaces/switch')
      .set('Cookie', operator.cookie)
      .set('Origin', env.API_CORS_ORIGIN)
      .send({ workspaceId: outsiderWorkspace.id });
    expect(forbidden.status).toBe(403);

    const switched = await request(app.getHttpServer())
      .post('/api/workspaces/switch')
      .set('Cookie', operator.cookie)
      .set('Origin', env.API_CORS_ORIGIN)
      .send({ workspaceId: secondWorkspace.id });
    expect(switched.status).toBe(200);
    expect(switched.body.workspace.id).toBe(secondWorkspace.id);
    expect(switched.body.role.key).toBe('VIEWER');

    const current = await request(app.getHttpServer())
      .get('/api/workspaces/current')
      .set('Cookie', operator.cookie);
    expect(current.status).toBe(200);
    expect(current.body.workspace.id).toBe(secondWorkspace.id);

    const viewerCannotManageMembers = await request(app.getHttpServer())
      .get('/api/workspaces/members')
      .set('Cookie', operator.cookie);
    expect(viewerCannotManageMembers.status).toBe(403);
    const switchAudit = await prisma.auditEvent.findFirst({
      where: {
        workspaceId: secondWorkspace.id,
        actorId: operator.user.id,
        action: 'WORKSPACE_SESSION_SWITCHED',
      },
    });
    expect(switchAudit).not.toBeNull();
    expect(switchAudit?.before).toMatchObject({ activeWorkspaceSelected: true });
    expect(JSON.stringify(switchAudit)).not.toContain(workspaceId);
  });

  it('serializes workspace switching against removal without leaving an active orphan session', async () => {
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'VIEWER' } });
    const user = await prisma.user.create({
      data: { email: `switch-race-${randomUUID()}@example.test`, displayName: 'Switch race' },
    });
    userIds.push(user.id);
    const targetMembership = await prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, roleId: viewerRole.id },
    });
    const sourceWorkspace = await prisma.workspace.create({
      data: { name: 'Switch race source', slug: `switch-race-source-${randomUUID()}` },
    });
    workspaceIds.push(sourceWorkspace.id);
    await entitleTestWorkspace(sourceWorkspace.id, { maxWorkspaceMembers: 5 });
    await prisma.workspaceMember.create({
      data: { workspaceId: sourceWorkspace.id, userId: user.id, roleId: viewerRole.id },
    });
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        activeWorkspaceId: sourceWorkspace.id,
        tokenDigest: hashSessionToken(generateSessionToken()),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await Promise.allSettled([
      service.switchWorkspace(session.id, user.id, workspaceId),
      service.removeMember(workspaceId, founderId, targetMembership.id),
    ]);

    expect(
      await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: user.id } },
      }),
    ).toBeNull();
    const finalSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(finalSession.activeWorkspaceId === workspaceId && finalSession.revokedAt === null).toBe(
      false,
    );
  });

  it('upgrades legacy one, multiple, and orphan memberships and fails closed after workspace deletion', async () => {
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'VIEWER' } });
    const fixtureWorkspaces = await Promise.all(
      ['single', 'older', 'newer'].map((label) =>
        prisma.workspace.create({
          data: { name: `Migration ${label}`, slug: `migration-${label}-${randomUUID()}` },
        }),
      ),
    );
    workspaceIds.push(...fixtureWorkspaces.map((workspace) => workspace.id));
    const [singleUser, multipleUser, orphanUser] = await Promise.all(
      ['single', 'multiple', 'orphan'].map((label) =>
        prisma.user.create({
          data: { email: `migration-${label}-${randomUUID()}@example.test`, displayName: label },
        }),
      ),
    );
    userIds.push(singleUser.id, multipleUser.id, orphanUser.id);
    await prisma.workspaceMember.create({
      data: {
        workspaceId: fixtureWorkspaces[0]!.id,
        userId: singleUser.id,
        roleId: viewerRole.id,
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: fixtureWorkspaces[1]!.id,
        userId: multipleUser.id,
        roleId: viewerRole.id,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: fixtureWorkspaces[2]!.id,
        userId: multipleUser.id,
        roleId: viewerRole.id,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    });

    const singleToken = generateSessionToken();
    const sessions = await Promise.all(
      [
        { userId: singleUser.id, token: singleToken },
        { userId: multipleUser.id, token: generateSessionToken() },
        { userId: orphanUser.id, token: generateSessionToken() },
      ].map(({ userId, token }) =>
        prisma.session.create({
          data: {
            userId,
            activeWorkspaceId: null,
            tokenDigest: hashSessionToken(token),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        }),
      ),
    );

    const migration = readFileSync(
      resolve(
        import.meta.dirname,
        '../../../packages/database/prisma/migrations/20260820013000_workspace_scoped_sessions/migration.sql',
      ),
      'utf8',
    );
    const backfill = migration.match(
      /UPDATE "sessions" AS s[\s\S]*?WHERE s\."activeWorkspaceId" IS NULL;/,
    )?.[0];
    if (!backfill) throw new Error('Workspace session migration backfill is missing');
    await prisma.$executeRawUnsafe(backfill);

    expect(
      await prisma.session.findUniqueOrThrow({ where: { id: sessions[0]!.id } }),
    ).toMatchObject({ activeWorkspaceId: fixtureWorkspaces[0]!.id });
    expect(
      await prisma.session.findUniqueOrThrow({ where: { id: sessions[1]!.id } }),
    ).toMatchObject({ activeWorkspaceId: fixtureWorkspaces[1]!.id });
    expect(
      await prisma.session.findUniqueOrThrow({ where: { id: sessions[2]!.id } }),
    ).toMatchObject({ activeWorkspaceId: null });

    await prisma.workspace.delete({ where: { id: fixtureWorkspaces[0]!.id } });
    expect(
      await prisma.session.findUniqueOrThrow({ where: { id: sessions[0]!.id } }),
    ).toMatchObject({ activeWorkspaceId: null });
    const denied = await request(app.getHttpServer())
      .get('/api/workspaces/current')
      .set('Cookie', `${env.AUTH_COOKIE_NAME}=${singleToken}`);
    expect(denied.status).toBe(401);
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
    const onboardingService = new OnboardingService(new AuditService());
    const retainedWorkspace = await prisma.workspace.create({
      data: { name: 'Retained tenant', slug: `retained-${randomUUID()}` },
    });
    workspaceIds.push(retainedWorkspace.id);
    await entitleTestWorkspace(retainedWorkspace.id, { maxWorkspaceMembers: 5 });
    const viewerRoleForRetained = await prisma.role.findUniqueOrThrow({ where: { key: 'VIEWER' } });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: retainedWorkspace.id,
        userId: viewer.user.id,
        roleId: viewerRoleForRetained.id,
      },
    });
    await sessionCookie(viewer.user.id, retainedWorkspace.id);

    const founderList = await request(app.getHttpServer())
      .get('/api/workspaces/members')
      .set('Cookie', founderCookie);
    expect(founderList.status).toBe(200);
    expect(founderList.body).toHaveLength(3);

    const founderOnboarding = await request(app.getHttpServer())
      .get('/api/onboarding')
      .set('Cookie', founderCookie);
    expect(founderOnboarding.status).toBe(200);

    for (const cookie of [operator.cookie, viewer.cookie]) {
      const forbiddenRead = await request(app.getHttpServer())
        .get('/api/onboarding')
        .set('Cookie', cookie);
      expect(forbiddenRead.status).toBe(403);
      const forbiddenWrite = await request(app.getHttpServer())
        .put('/api/onboarding')
        .set('Cookie', cookie)
        .set('Origin', env.API_CORS_ORIGIN)
        .send({ businessObjectives: 'Must not be saved' });
      expect(forbiddenWrite.status).toBe(403);
    }
    await expect(onboardingService.get(workspaceId, operator.user.id)).rejects.toThrow(
      'Founder authority is required',
    );

    const invitation = await request(app.getHttpServer())
      .post('/api/workspaces/invitations')
      .set('Cookie', founderCookie)
      .set('Origin', env.API_CORS_ORIGIN)
      .send({ roleKey: 'VIEWER', expiresInHours: 24 });
    expect(invitation.status).toBe(201);
    expect(invitation.headers['cache-control']).toBe('no-store');
    expect(invitation.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    for (const cookie of [operator.cookie, viewer.cookie]) {
      const forbidden = await request(app.getHttpServer())
        .get('/api/workspaces/members')
        .set('Cookie', cookie);
      expect(forbidden.status).toBe(403);
      const forbiddenInvitation = await request(app.getHttpServer())
        .post('/api/workspaces/invitations')
        .set('Cookie', cookie)
        .set('Origin', env.API_CORS_ORIGIN)
        .send({ roleKey: 'VIEWER', expiresInHours: 24 });
      expect(forbiddenInvitation.status).toBe(403);
      const forbiddenRoleChange = await request(app.getHttpServer())
        .patch(`/api/workspaces/members/${operator.member.id}/role`)
        .set('Cookie', cookie)
        .set('Origin', env.API_CORS_ORIGIN)
        .send({ roleKey: 'VIEWER' });
      expect(forbiddenRoleChange.status).toBe(403);
      const forbiddenRemoval = await request(app.getHttpServer())
        .delete(`/api/workspaces/members/${viewer.member.id}`)
        .set('Cookie', cookie)
        .set('Origin', env.API_CORS_ORIGIN);
      expect(forbiddenRemoval.status).toBe(403);
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
      1,
    );
    expect(
      await prisma.session.count({
        where: { userId: viewer.user.id, activeWorkspaceId: workspaceId, revokedAt: { not: null } },
      }),
    ).toBe(1);
    expect(
      await prisma.session.count({
        where: {
          userId: viewer.user.id,
          activeWorkspaceId: retainedWorkspace.id,
          revokedAt: null,
        },
      }),
    ).toBe(1);
    const removalAudit = await prisma.auditEvent.findFirst({
      where: { workspaceId, action: 'WORKSPACE_MEMBER_REMOVED', entityId: viewer.member.id },
    });
    expect(removalAudit).not.toBeNull();
    expect(removalAudit?.after).toMatchObject({ revokedSessionCount: 1 });
  });

  it('returns HTTP 400 for malformed member IDs and invitation tokens', async () => {
    const founderCookie = await sessionCookie(founderId);
    // This assertion targets validation, not the cumulative suite-level abuse
    // budget. A fresh application gives every throttler bucket an isolated
    // in-memory store while preserving the production limits and guards.
    const validationApp = await createTestApplication();
    try {
      const malformedMember = await request(validationApp.getHttpServer())
        .delete('/api/workspaces/members/not-a-uuid')
        .set('Cookie', founderCookie)
        .set('Origin', env.API_CORS_ORIGIN);
      expect(malformedMember.status).toBe(400);

      const malformedInviteBody = await request(validationApp.getHttpServer())
        .post('/api/workspaces/invitations')
        .set('Cookie', founderCookie)
        .set('Origin', env.API_CORS_ORIGIN)
        .send({ roleKey: 'ADMIN', expiresInHours: 24 });
      expect(malformedInviteBody.status).toBe(400);

      const malformedRoleBody = await request(validationApp.getHttpServer())
        .patch(`/api/workspaces/members/${randomUUID()}/role`)
        .set('Cookie', founderCookie)
        .set('Origin', env.API_CORS_ORIGIN)
        .send({ roleKey: 'ADMIN' });
      expect(malformedRoleBody.status).toBe(400);

      const malformedSwitch = await request(validationApp.getHttpServer())
        .post('/api/workspaces/switch')
        .set('Cookie', founderCookie)
        .set('Origin', env.API_CORS_ORIGIN)
        .send({ workspaceId: 'not-a-uuid' });
      expect(malformedSwitch.status).toBe(400);

      const malformedPreview = await request(validationApp.getHttpServer())
        .post('/api/workspace-invitations/preview')
        .send({ token: 'not-a-token' });
      expect(malformedPreview.status).toBe(400);
      expect(malformedPreview.headers['cache-control']).toBe('no-store');

      const malformedAccept = await request(validationApp.getHttpServer())
        .post('/api/workspace-invitations/accept')
        .send({
          token: 'a'.repeat(44),
          email: 'bad@example.test',
          password: 'password123',
          displayName: 'Bad',
        });
      expect(malformedAccept.status).toBe(400);
      expect(malformedAccept.headers['cache-control']).toBe('no-store');

      const malformedAuthenticatedAccept = await request(validationApp.getHttpServer())
        .post('/api/workspace-invitations/accept-authenticated')
        .set('Cookie', founderCookie)
        .set('Origin', env.API_CORS_ORIGIN)
        .send({ token: 'short' });
      expect(malformedAuthenticatedAccept.status).toBe(400);
      expect(malformedAuthenticatedAccept.headers['cache-control']).toBe('no-store');
    } finally {
      await validationApp.close();
    }
  });

  it('rate-limits repeated unauthenticated invite acceptance attempts', async () => {
    const validUnknownToken = 'a'.repeat(43);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/workspace-invitations/accept')
        .send({
          token: validUnknownToken,
          email: `abuse-${attempt}@example.test`,
          password: 'password123',
          displayName: 'Abuse',
        });
      statuses.push(response.status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});
