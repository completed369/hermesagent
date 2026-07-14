import { prisma } from '@ventureos/database';
import type { CostLedgerEntry } from '@ventureos/database';
import { BudgetLimitExceededError, BudgetNotFoundError } from './errors.js';

/**
 * Fail-closed pre-check: throws BudgetLimitExceededError if charging
 * `additionalAmountEur` to this allocation would push spend past its limit.
 * Callers should check this BEFORE doing the costed work (same principle as
 * Phase 5's `assertWithinResearchCostCaps`, checked before the acquisition
 * runs, not after). A missing allocation is a real error, not silently
 * ignored -- fail closed, never fail open.
 */
export async function assertWithinBudget(
  budgetAllocationId: string,
  additionalAmountEur: number,
): Promise<void> {
  const allocation = await prisma.budgetAllocation.findUnique({
    where: { id: budgetAllocationId },
  });
  if (!allocation) {
    throw new BudgetNotFoundError(`BudgetAllocation ${budgetAllocationId} not found`);
  }
  const projectedSpend = Number(allocation.spentEur) + additionalAmountEur;
  if (projectedSpend > Number(allocation.limitEur)) {
    throw new BudgetLimitExceededError(
      `Charging EUR ${additionalAmountEur.toFixed(4)} to budget allocation "${allocation.category}" would bring spend to EUR ${projectedSpend.toFixed(2)}, exceeding its EUR ${Number(allocation.limitEur).toFixed(2)} limit.`,
      allocation.id,
      Number(allocation.limitEur),
      Number(allocation.spentEur),
    );
  }
}

export interface ChargeToBudgetParams {
  workspaceId: string;
  /** Omitted when there is no budget wired up yet for this category --
   * the cost is still recorded in the append-only ledger (real, always),
   * it is simply not checked against a hard limit. Mirrors Phase 5's mock
   * providers costing EUR0 by default: the recording mechanism is real from
   * day one so enforcement is correct the moment a real budget is set. */
  budgetAllocationId?: string;
  ventureProposalId?: string;
  category: string;
  amountEur: number;
  source: string;
  referenceType?: string;
  referenceId?: string;
  description?: string;
}

/**
 * Re-checks the budget limit (fail closed) and, if it still fits, writes the
 * CostLedgerEntry + increments the allocation's denormalized `spentEur` in a
 * single transaction. Always call `assertWithinBudget` (or accept the risk
 * of a race between two concurrent costed actions) before doing the actual
 * costed work; call `chargeToBudget` once the work has actually happened, so
 * the ledger only ever reflects real incurred cost, never a merely-attempted
 * one.
 */
export async function chargeToBudget(params: ChargeToBudgetParams): Promise<CostLedgerEntry> {
  if (params.budgetAllocationId) {
    await assertWithinBudget(params.budgetAllocationId, params.amountEur);
  }

  const [entry] = await prisma.$transaction([
    prisma.costLedgerEntry.create({
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
    }),
    ...(params.budgetAllocationId
      ? [
          prisma.budgetAllocation.update({
            where: { id: params.budgetAllocationId },
            data: { spentEur: { increment: params.amountEur } },
          }),
        ]
      : []),
  ]);
  return entry;
}

/** Resolves the active BudgetAllocation for a category, preferring a
 * venture-scoped Budget over the workspace-wide one when both exist, so a
 * per-venture spending envelope (if the founder set one) always wins. */
export async function resolveBudgetAllocation(
  workspaceId: string,
  category: string,
  ventureProposalId?: string,
): Promise<{ id: string } | null> {
  if (ventureProposalId) {
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
