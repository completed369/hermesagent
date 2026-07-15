import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { ProductsService } from '../src/modules/products/products.service';
import { AuditService } from '../src/modules/audit/audit.service';

/**
 * Integration test for the Product Studio index (ProductsService.
 * listForWorkspace). Mirrors the repo's existing integration-spec pattern
 * (e.g. finance.integration.spec.ts): it exercises the real service against
 * a real (dockerized) Postgres database and asserts workspace scoping
 * directly, rather than booting the full HTTP stack. Authentication and
 * `product:view` permission are enforced by the SessionAuthGuard +
 * PermissionGuard pair registered on the controller (covered by
 * common/guards/__tests__/permission.guard.test.ts), so the service test
 * focuses on the deterministic, workspace-isolated data behaviour.
 *
 * Requires a real, migrated, seeded PostgreSQL database reachable via
 * DATABASE_URL. Run with: pnpm --filter @ventureos/api test:integration
 */
describe('ProductsService.listForWorkspace (Product Studio index)', () => {
  const auditService = new AuditService();
  const productsService = new ProductsService(auditService);

  let workspace: { id: string };
  let otherWorkspace: { id: string };

  async function createProduct(workspaceId: string, title: string) {
    const opp = await prisma.opportunity.create({
      data: {
        workspaceId,
        title: `Product IT Opportunity ${title} ${randomUUID()}`,
        description: 'Created by products.integration.spec.ts',
        status: 'PROMOTED',
      },
    });
    const proposal = await prisma.ventureProposal.create({
      data: { workspaceId, opportunityId: opp.id, status: 'DRAFT' },
    });
    return prisma.product.create({
      data: { workspaceId, ventureProposalId: proposal.id, title, status: 'DRAFT' },
    });
  }

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: { name: `Products IT WS ${randomUUID()}`, slug: `products-it-${randomUUID()}` },
    });
    otherWorkspace = await prisma.workspace.create({
      data: { name: `Products IT Other WS ${randomUUID()}`, slug: `products-it-o-${randomUUID()}` },
    });
  });

  afterAll(async () => {
    await prisma.product.deleteMany({
      where: { workspaceId: { in: [workspace.id, otherWorkspace.id] } },
    });
    await prisma.ventureProposal.deleteMany({
      where: { workspaceId: { in: [workspace.id, otherWorkspace.id] } },
    });
    await prisma.opportunity.deleteMany({
      where: { workspaceId: { in: [workspace.id, otherWorkspace.id] } },
    });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspace.id, otherWorkspace.id] } } });
    await prisma.$disconnect();
  });

  it('returns an empty list for a workspace with no products', async () => {
    const result = await productsService.listForWorkspace(workspace.id);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('returns only the calling workspace products (no cross-workspace exposure)', async () => {
    const own = await createProduct(workspace.id, 'Own Product');
    await createProduct(otherWorkspace.id, 'Other Workspace Product');

    const result = await productsService.listForWorkspace(workspace.id);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(own.id);
    expect(result[0].title).toBe('Own Product');
    expect(result[0].status).toBe('DRAFT');
    expect(result[0].ventureProposalId).toBeTruthy();
    // Opportunity title surfaced via ventureProposal relation.
    expect(result[0].ventureProposal?.opportunity?.title).toBeTruthy();

    const otherResult = await productsService.listForWorkspace(otherWorkspace.id);
    expect(otherResult).toHaveLength(1);
    expect(otherResult[0].title).toBe('Other Workspace Product');
  });

  it('returns products ordered by createdAt descending', async () => {
    const first = await createProduct(workspace.id, 'Earlier Product');
    const second = await createProduct(workspace.id, 'Later Product');
    const result = await productsService.listForWorkspace(workspace.id);
    const titles = result.map((p) => p.title);
    expect(titles).toContain('Earlier Product');
    expect(titles).toContain('Later Product');
    // newest first
    expect(result[0].id).toBe(second.id);
    expect(result[1].id).toBe(first.id);
  });
});
