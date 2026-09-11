import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Prisma, prisma } from '@ventureos/database';
import {
  reserveBusinessExpense,
  reconcileBusinessExpense,
  readBusinessBudget,
} from '@ventureos/finance-engine';
import { cleanupEntitledTestWorkspace, entitleTestWorkspace } from './helpers/entitled-workspace';

describe('business spending database concurrency and reconciliation', () => {
  const workspaces: string[] = [];
  async function account(funding = 10_000n) {
    const workspace = await prisma.workspace.create({
      data: { name: 'Synthetic spend test', slug: randomUUID() },
    });
    workspaces.push(workspace.id);
    await entitleTestWorkspace(workspace.id);
    await prisma.$executeRaw(Prisma.sql`INSERT INTO business_spending_accounts
      (workspace_id, state, funding_cents, funding_valid_until, funding_evidence)
      VALUES (${workspace.id}::uuid, 'RUNNING', ${funding}, clock_timestamp() + interval '1 hour', 'synthetic:test-only')`);
    return workspace.id;
  }
  const reservation = (
    workspaceId: string,
    maximumCents: bigint,
    purchaseGroup = randomUUID(),
  ) => ({
    workspaceId,
    maximumCents,
    purchaseGroup,
    id: randomUUID(),
    costEvidence: 'synthetic:quote',
    costValidUntil: new Date(Date.now() + 60_000),
  });
  afterEach(async () => {
    for (const id of workspaces.splice(0)) {
      await cleanupEntitledTestWorkspace(id);
      await prisma.workspace.delete({ where: { id } });
    }
  });
  it('serializes concurrent reservations against the same available funding', async () => {
    const id = await account(2_500n);
    const results = await Promise.allSettled([
      reserveBusinessExpense(reservation(id, 2_000n)),
      reserveBusinessExpense(reservation(id, 2_000n)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await readBusinessBudget(id)).availableCents).toBe(500n);
  });
  it('rejects purchase splitting, monthly overflow and EUR 25.01', async () => {
    const id = await account(20_000n);
    const group = randomUUID();
    await reserveBusinessExpense(reservation(id, 2_000n, group));
    await expect(reserveBusinessExpense(reservation(id, 501n, group))).rejects.toThrow(/25/);
    await expect(reserveBusinessExpense(reservation(id, 2_501n))).rejects.toThrow(/25/);
    for (let i = 0; i < 5; i++) await reserveBusinessExpense(reservation(id, 2_500n));
    await expect(reserveBusinessExpense(reservation(id, 501n))).rejects.toThrow(/150/);
  });
  it('keeps duplicate reservations and settlements idempotent', async () => {
    const id = await account();
    const input = reservation(id, 2_000n);
    await reserveBusinessExpense(input);
    await reserveBusinessExpense(input);
    await expect(reserveBusinessExpense({ ...input, maximumCents: 1n })).rejects.toThrow(/replay/);
    const settlement = {
      workspaceId: id,
      id: input.id,
      actualCents: 1_200n,
      evidence: 'synthetic:invoice',
    };
    await reconcileBusinessExpense(settlement);
    await reconcileBusinessExpense(settlement);
    expect((await readBusinessBudget(id)).availableCents).toBe(8_800n);
    await expect(reconcileBusinessExpense({ ...settlement, actualCents: 1_201n })).rejects.toThrow(
      /replay/,
    );
  });
  it('records overruns truthfully, then pauses and invalidates funding', async () => {
    const id = await account();
    const input = reservation(id, 100n);
    await reserveBusinessExpense(input);
    await reconcileBusinessExpense({
      workspaceId: id,
      id: input.id,
      actualCents: 150n,
      evidence: 'synthetic:overrun',
    });
    const budget = await readBusinessBudget(id);
    expect(budget.state).toBe('PAUSED');
    expect(budget.availableCents).toBeNull();
    expect(budget.paidAndCommittedCents).toBe(150n);
    await expect(reserveBusinessExpense(reservation(id, 1n))).rejects.toThrow(/paused/);
  });
  it('denies expired funding, expired quotes, and cross-workspace settlement', async () => {
    const id = await account();
    const other = await account();
    const input = reservation(id, 100n);
    await reserveBusinessExpense(input);
    await expect(
      reconcileBusinessExpense({
        workspaceId: other,
        id: input.id,
        actualCents: 100n,
        evidence: 'synthetic:invoice',
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      reserveBusinessExpense({ ...reservation(id, 1n), costValidUntil: new Date(0) }),
    ).rejects.toThrow(/expired/);
    await prisma.$executeRaw(Prisma.sql`UPDATE business_spending_accounts SET funding_valid_until = clock_timestamp() - interval '1 second'
      WHERE workspace_id = ${id}::uuid`);
    await expect(reserveBusinessExpense(reservation(id, 1n))).rejects.toThrow(/verified/);
  });
});
