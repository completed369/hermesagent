import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { AuditService } from '../src/modules/audit/audit.service';
import { WorkspacesService } from '../src/modules/workspaces/workspaces.service';
import { entitleTestWorkspace } from './helpers/entitled-workspace';

describe('collaborative workspace invitations (integration)', () => {
  const service = new WorkspacesService(new AuditService());
  const workspaceIds: string[] = [];
  const userIds: string[] = [];
  let workspaceId: string;
  let founderId: string;

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
});
