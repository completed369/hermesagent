export class BudgetNotFoundError extends Error {}

/** Fail-closed: a costed action is blocked when it would push a
 * BudgetAllocation's spend past its limit. Never silently allowed through
 * "just this once" -- the same principle as Phase 5's
 * ResearchCostCapExceededError and Phase 6's fail-closed publication gating. */
export class BudgetLimitExceededError extends Error {
  constructor(
    message: string,
    public readonly budgetAllocationId: string,
    public readonly limitEur: number,
    public readonly spentEur: number,
  ) {
    super(message);
  }
}

export class ExperimentNotFoundError extends Error {}
export class ExperimentInvalidStateError extends Error {}
