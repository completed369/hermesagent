import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { chargeToBudget } from '@ventureos/finance-engine';
import { runDataAcquisition } from '@ventureos/research-connectors';
import { cleanupEntitledTestWorkspace, entitleTestWorkspace } from './helpers/entitled-workspace';

describe('Stage 5 concurrency protections (integration)', () => {
  let workspace: { id: string };

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: `Stage 5 Concurrency ${randomUUID()}`,
        slug: `stage5-concurrency-${randomUUID()}`,
      },
    });
    await entitleTestWorkspace(workspace.id);
  });

  afterAll(async () => {
    await prisma.evidenceArtifact.deleteMany({ where: { workspaceId: workspace.id } });
    await prisma.dataSource.deleteMany({
      where: { dataAcquisitionContract: { workspaceId: workspace.id } },
    });
    await prisma.dataAcquisitionRun.deleteMany({ where: { workspaceId: workspace.id } });
    await prisma.dataAcquisitionContract.deleteMany({ where: { workspaceId: workspace.id } });
    await prisma.integration.deleteMany({ where: { workspaceId: workspace.id } });
    await cleanupEntitledTestWorkspace(workspace.id);
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  });

  it('serializes 20 simultaneous budget charges so the hard limit cannot be overspent', async () => {
    const budget = await prisma.budget.create({
      data: {
        workspaceId: workspace.id,
        name: `Stage 5 concurrent budget ${randomUUID()}`,
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
        totalLimitEur: 10,
        allocations: { create: [{ category: 'OTHER', limitEur: 10 }] },
      },
      include: { allocations: true },
    });
    const allocation = budget.allocations[0];

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        chargeToBudget({
          workspaceId: workspace.id,
          budgetAllocationId: allocation.id,
          category: 'OTHER',
          amountEur: 1,
          source: `stage5:concurrent-budget:${index}`,
        }),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(10);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(10);

    const reloaded = await prisma.budgetAllocation.findUnique({ where: { id: allocation.id } });
    expect(Number(reloaded?.spentEur)).toBe(10);
    expect(
      await prisma.costLedgerEntry.count({
        where: { workspaceId: workspace.id, source: { startsWith: 'stage5:concurrent-budget:' } },
      }),
    ).toBe(10);
  });

  it('serializes concurrent research reservations so the daily cost cap cannot be overspent', async () => {
    const contract = await prisma.dataAcquisitionContract.create({
      data: {
        workspaceId: workspace.id,
        name: `Stage 5 Cost Race ${randomUUID()}`,
        purpose: 'Stage 5 concurrent research cost-cap proof',
        sourceType: 'PERMITTED_BROWSER_RESEARCH',
        accessMethod: 'MANUAL_IMPORT',
        allowedOperations: ['READ_PUBLIC_LISTING_TITLE'],
        freshnessRequirementHours: 24,
        costPerRunEurEstimate: 0.6,
      },
    });

    const results = await Promise.all([
      runDataAcquisition({
        workspaceId: workspace.id,
        contractId: contract.id,
        costCapConfig: { perRunLimitEur: 1, perWorkspaceDayLimitEur: 1 },
      }),
      runDataAcquisition({
        workspaceId: workspace.id,
        contractId: contract.id,
        costCapConfig: { perRunLimitEur: 1, perWorkspaceDayLimitEur: 1 },
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'BLOCKED_COST_CAP',
      'SUCCEEDED',
    ]);

    const chargedRuns = await prisma.dataAcquisitionRun.findMany({
      where: {
        workspaceId: workspace.id,
        contractId: contract.id,
        status: { in: ['RESERVED', 'SUCCEEDED'] },
      },
    });
    expect(chargedRuns).toHaveLength(1);
    expect(Number(chargedRuns[0]?.costEur)).toBeCloseTo(0.6, 6);
  });
});
