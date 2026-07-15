/**
 * Pure helpers for the Command Centre dashboard cards. Kept free of React /
 * Next.js imports so they are unit-testable without a browser.
 *
 * Every function fails safe: on missing data it returns null (rendered as
 * "—"), never a fabricated number (no fake "0" ventures, no invented "€100"
 * budget limit).
 */

export interface IntegrationLike {
  status: string;
}

export interface ApprovalLike {
  state: string;
}

export interface BudgetAllocationLike {
  spentEur: string | number | null | undefined;
}

export interface BudgetLike {
  status: string;
  periodStart: string | Date | null | undefined;
  periodEnd: string | Date | null | undefined;
  totalLimitEur: string | number | null | undefined;
  allocations?: BudgetAllocationLike[] | null;
}

/** Venture proposals already counted server-side (workspaceSummary.ventureCount). */
export function ventureProposalCount(ventureCount: number | null | undefined): number | null {
  if (typeof ventureCount !== 'number') return null;
  return ventureCount;
}

/** Count only PENDING approvals (exact, case-sensitive match). */
export function pendingApprovalCount(approvals: ApprovalLike[] | null | undefined): number | null {
  if (!Array.isArray(approvals)) return null;
  return approvals.filter((a) => a.state === 'PENDING').length;
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * Sum spent + limit across every budget that is ACTIVE and whose period
 * covers `now`. CLOSED budgets and out-of-period budgets are excluded.
 * Returns null when there is no matching current active budget (caller
 * renders "—"), and never fabricates a limit.
 */
export function currentBudgetUtilisation(
  budgets: BudgetLike[] | null | undefined,
  now: Date = new Date(),
): { totalSpentEur: number; totalLimitEur: number } | null {
  if (!Array.isArray(budgets)) return null;

  const matching = budgets.filter((b) => {
    if (b.status !== 'ACTIVE') return false;
    const start = b.periodStart ? new Date(b.periodStart) : null;
    const end = b.periodEnd ? new Date(b.periodEnd) : null;
    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
  });

  if (matching.length === 0) return null;

  let totalSpentEur = 0;
  let totalLimitEur = 0;
  for (const b of matching) {
    totalSpentEur += (b.allocations ?? []).reduce((sum, a) => sum + toNumber(a.spentEur), 0);
    totalLimitEur += toNumber(b.totalLimitEur);
  }

  return { totalSpentEur, totalLimitEur };
}

/** Count only CONNECTED integrations. */
export function connectedIntegrationCount(
  integrations: IntegrationLike[] | null | undefined,
): number | null {
  if (!Array.isArray(integrations)) return null;
  return integrations.filter((i) => i.status === 'CONNECTED').length;
}
