import { Prisma, prisma } from '@ventureos/database';
import type { CostLedgerEntry } from '@ventureos/database';
import { BudgetLimitExceededError, BudgetNotFoundError } from './errors.js';
import { enforceFinanceMutation, enforceFinanceRead } from './capability-guard.js';

function assertPositiveFiniteAmount(amountEur: number): void {
  if (!Number.isFinite(amountEur) || amountEur <= 0) {
    throw new BudgetLimitExceededError(
      'Budget charges must be a positive finite amount.',
      'invalid-amount',
      0,
      0,
    );
  }
}

function assertAllocationCapacity(
  allocation: { id: string; category: string; spentEur: unknown; limitEur: unknown },
  additionalAmountEur: number,
): void {
  const spentEur = Number(allocation.spentEur);
  const limitEur = Number(allocation.limitEur);
  const projectedSpend = spentEur + additionalAmountEur;
  if (projectedSpend > limitEur) {
    throw new BudgetLimitExceededError(
      `Charging EUR ${additionalAmountEur.toFixed(4)} to budget allocation "${allocation.category}" would bring spend to EUR ${projectedSpend.toFixed(2)}, exceeding its EUR ${limitEur.toFixed(2)} limit.`,
      allocation.id,
      limitEur,
      spentEur,
    );
  }
}

/** Non-authoritative preflight check. chargeToBudget repeats this check under a row lock. */
export async function assertWithinBudget(
  workspaceId: string,
  budgetAllocationId: string,
  additionalAmountEur: number,
): Promise<void> {
  assertPositiveFiniteAmount(additionalAmountEur);
  await enforceFinanceRead(workspaceId, `finance:budget-capacity-read:${budgetAllocationId}`);
  const allocation = await prisma.budgetAllocation.findFirst({
    where: { id: budgetAllocationId, budget: { workspaceId } },
  });
  if (!allocation) {
    throw new BudgetNotFoundError(`BudgetAllocation ${budgetAllocationId} not found`);
  }
  assertAllocationCapacity(allocation, additionalAmountEur);
}

export interface ChargeToBudgetParams {
  workspaceId: string;
  budgetAllocationId?: string;
  ventureProposalId?: string;
  category: string;
  amountEur: number;
  source: string;
  referenceType?: string;
  referenceId?: string;
  description?: string;
}

async function validateVentureOwnership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  ventureProposalId: string | undefined,
): Promise<void> {
  if (!ventureProposalId) return;
  const proposal = await tx.ventureProposal.findFirst({
    where: { id: ventureProposalId, workspaceId },
    select: { id: true },
  });
  if (!proposal) throw new BudgetNotFoundError('Venture proposal not found');
}

/** Authoritative charge path. Call only from an existing transaction. */
export async function chargeToBudgetInTransaction(
  tx: Prisma.TransactionClient,
  params: ChargeToBudgetParams,
): Promise<CostLedgerEntry> {
  assertPositiveFiniteAmount(params.amountEur);
  await validateVentureOwnership(tx, params.workspaceId, params.ventureProposalId);

  if (params.budgetAllocationId) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "budget_allocations" WHERE "id" = ${params.budgetAllocationId}::uuid FOR UPDATE`,
    );
    const allocation = await tx.budgetAllocation.findFirst({
      where: {
        id: params.budgetAllocationId,
        category: params.category,
        budget: { workspaceId: params.workspaceId },
      },
    });
    if (!allocation) {
      throw new BudgetNotFoundError(`BudgetAllocation ${params.budgetAllocationId} not found`);
    }
    assertAllocationCapacity(allocation, params.amountEur);
  }

  await enforceFinanceMutation(
    params.workspaceId,
    `finance:budget-charge:${params.referenceType ?? 'untyped'}:${params.referenceId ?? 'none'}`,
    tx,
  );

  const entry = await tx.costLedgerEntry.create({
    data: {
      workspaceId: params.workspaceId,
      budgetAllocationId: params.budgetAllocationId,
      ventureProposalId: params.ventureProposalId,
      category: params.category,
      amountEur: params.amountEur,
      source: params.source,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      description: params.description,
    },
  });

  if (params.budgetAllocationId) {
    await tx.budgetAllocation.update({
      where: { id: params.budgetAllocationId },
      data: { spentEur: { increment: params.amountEur } },
    });
  }
  return entry;
}

/** Locks, rechecks, records, and increments atomically. */
export async function chargeToBudget(params: ChargeToBudgetParams): Promise<CostLedgerEntry> {
  return prisma.$transaction((tx) => chargeToBudgetInTransaction(tx, params));
}

/** Resolves the active allocation, preferring a venture-scoped budget. */
export async function resolveBudgetAllocation(
  workspaceId: string,
  category: string,
  ventureProposalId?: string,
): Promise<{ id: string } | null> {
  await enforceFinanceRead(
    workspaceId,
    `finance:budget-resolution:${ventureProposalId ?? 'workspace'}:${category}`,
  );
  if (ventureProposalId) {
    const proposal = await prisma.ventureProposal.findFirst({
      where: { id: ventureProposalId, workspaceId },
      select: { id: true },
    });
    if (!proposal) throw new BudgetNotFoundError('Venture proposal not found');

    const ventureBudget = await prisma.budget.findFirst({
      where: { workspaceId, ventureProposalId, status: 'ACTIVE' },
      include: { allocations: { where: { category } } },
    });
    const ventureAllocation = ventureBudget?.allocations[0];
    if (ventureAllocation) return { id: ventureAllocation.id };
  }

  const workspaceBudget = await prisma.budget.findFirst({
    where: { workspaceId, ventureProposalId: null, status: 'ACTIVE' },
    include: { allocations: { where: { category } } },
  });
  const workspaceAllocation = workspaceBudget?.allocations[0];
  return workspaceAllocation ? { id: workspaceAllocation.id } : null;
}
