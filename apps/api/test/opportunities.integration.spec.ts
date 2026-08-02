import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { NotFoundException } from '@nestjs/common';
import { OpportunitiesService } from '../src/modules/opportunities/opportunities.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { cleanupEntitledTestWorkspace, entitleTestWorkspace } from './helpers/entitled-workspace';

/**
 * Hits a real (dockerized) Postgres via the real prisma client -- run with
 * `pnpm --filter @ventureos/api test:integration`, which loads DATABASE_URL
 * from the repo-root .env via dotenv-cli. Requires the Phase 2 migration to
 * already be applied.
 */
describe('OpportunitiesService (integration)', () => {
  const service = new OpportunitiesService(new AuditService());

  let workspaceA: { id: string };
  let workspaceB: { id: string };
  let opportunityA: { id: string };
  let actor: { id: string };

  beforeAll(async () => {
    workspaceA = await prisma.workspace.create({
      data: { name: `Test Workspace A ${randomUUID()}`, slug: `test-a-${randomUUID()}` },
    });
    workspaceB = await prisma.workspace.create({
      data: { name: `Test Workspace B ${randomUUID()}`, slug: `test-b-${randomUUID()}` },
    });
    await entitleTestWorkspace(workspaceA.id);
    // AuditEvent.actorId is a real foreign key to User -- a random UUID that
    // doesn't correspond to a real user violates audit_events_actorId_fkey
    // (confirmed live: the first run of this suite failed exactly this way).
    actor = await prisma.user.create({
      data: {
        email: `integration-test-actor-${randomUUID()}@ventureos.local`,
        displayName: 'Integration Test Actor',
      },
    });
    opportunityA = await prisma.opportunity.create({
      data: {
        workspaceId: workspaceA.id,
        title: `Integration Test Opportunity ${randomUUID()}`,
        description: 'Created by opportunities.integration.spec.ts',
      },
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({
      where: { workspaceId: { in: [workspaceA.id, workspaceB.id] } },
    });
    await prisma.ventureProposalVersion.deleteMany({ where: { opportunityId: opportunityA.id } });
    await prisma.ventureProposal.deleteMany({ where: { opportunityId: opportunityA.id } });
    await prisma.opportunity.deleteMany({
      where: { workspaceId: { in: [workspaceA.id, workspaceB.id] } },
    });
    await cleanupEntitledTestWorkspace(workspaceA.id);
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceA.id, workspaceB.id] } } });
    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.$disconnect();
  });

  it('lists opportunities scoped to the requesting workspace only', async () => {
    const listA = await service.list(workspaceA.id);
    const listB = await service.list(workspaceB.id);
    expect(listA.map((o) => o.id)).toContain(opportunityA.id);
    expect(listB.map((o) => o.id)).not.toContain(opportunityA.id);
  });

  it('refuses to fetch an opportunity through the wrong workspace', async () => {
    await expect(service.getById(workspaceB.id, opportunityA.id)).rejects.toThrow(
      NotFoundException,
    );
    const fetched = await service.getById(workspaceA.id, opportunityA.id);
    expect(fetched.id).toBe(opportunityA.id);
  });

  it('rejects an opportunity and writes a real, queryable audit event', async () => {
    const updated = await service.reject(
      workspaceA.id,
      opportunityA.id,
      'Not a fit for this workspace',
      actor.id,
    );
    expect(updated.status).toBe('REJECTED');
    expect(updated.rejectionReason).toBe('Not a fit for this workspace');

    const events = await prisma.auditEvent.findMany({
      where: {
        workspaceId: workspaceA.id,
        entityId: opportunityA.id,
        action: 'OPPORTUNITY_REJECTED',
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(actor.id);
    expect(events[0].integrityHash).toBeTruthy();
  });

  it('promoting creates a VentureProposal and a first VentureProposalVersion', async () => {
    const fresh = await prisma.opportunity.create({
      data: {
        workspaceId: workspaceA.id,
        title: `Integration Test Opportunity (promote) ${randomUUID()}`,
        description: 'Created by opportunities.integration.spec.ts',
      },
    });

    const { opportunity, proposal } = await service.promote(workspaceA.id, fresh.id, actor.id);
    expect(opportunity.status).toBe('PROMOTED');

    const versions = await prisma.ventureProposalVersion.findMany({
      where: { ventureProposalId: proposal.id },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);

    // Promoting again should be rejected, not create a second proposal.
    await expect(service.promote(workspaceA.id, fresh.id, actor.id)).rejects.toThrow();

    await prisma.ventureProposalVersion.deleteMany({ where: { opportunityId: fresh.id } });
    await prisma.ventureProposal.deleteMany({ where: { opportunityId: fresh.id } });
    await prisma.auditEvent.deleteMany({ where: { entityId: fresh.id } });
    await prisma.opportunity.deleteMany({ where: { id: fresh.id } });
  });

  it('serializes concurrent promotions so a one-venture quota cannot be exceeded', async () => {
    const quotaWorkspace = await prisma.workspace.create({
      data: { name: `Quota Workspace ${randomUUID()}`, slug: `quota-${randomUUID()}` },
    });
    await entitleTestWorkspace(quotaWorkspace.id, { maxVentures: 1 });
    const opportunities = await Promise.all(
      [0, 1].map((index) =>
        prisma.opportunity.create({
          data: {
            workspaceId: quotaWorkspace.id,
            title: `Concurrent promotion ${index} ${randomUUID()}`,
            description: 'Synthetic quota concurrency proof',
          },
        }),
      ),
    );

    const results = await Promise.allSettled(
      opportunities.map((opportunity) =>
        service.promote(quotaWorkspace.id, opportunity.id, actor.id),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.ventureProposal.count({ where: { workspaceId: quotaWorkspace.id } })).toBe(
      1,
    );

    await prisma.auditEvent.deleteMany({ where: { workspaceId: quotaWorkspace.id } });
    await prisma.securityEvent.deleteMany({ where: { workspaceId: quotaWorkspace.id } });
    await prisma.ventureProposalVersion.deleteMany({
      where: { opportunityId: { in: opportunities.map((opportunity) => opportunity.id) } },
    });
    await prisma.ventureProposal.deleteMany({ where: { workspaceId: quotaWorkspace.id } });
    await prisma.opportunity.deleteMany({ where: { workspaceId: quotaWorkspace.id } });
    await cleanupEntitledTestWorkspace(quotaWorkspace.id);
    await prisma.workspace.delete({ where: { id: quotaWorkspace.id } });
  });
});
