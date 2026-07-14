# Financial Model

**Implemented and unit-tested**: `packages/finance-engine`. EUR only.
All arithmetic goes through this package — agents (once they exist) may
interpret the numbers in prose but never recompute them.

## Functions

- `calculateUnitEconomics(assumptions)` — price, marketplace fee, payment
  fee, listing fee, VAT, refund allowance, gross/net revenue, contribution
  margin (amount + rate). Pure function, cent-rounded.
- `calculateBreakEven(assumptions)` — fixed costs (AI/generation cost +
  monthly overhead) ÷ contribution margin per unit, ceiling-rounded to whole
  units.
- `calculateScenarios(assumptions, baseUnitsSold, multipliers)` — low/base/
  high (default 0.5x / 1x / 1.75x), each with gross/net revenue, variable
  cost, gross/net profit.

## Default assumptions (development pilot, master spec section 19 — NOT

legal or financial advice)

| Assumption                  | Default |
| --------------------------- | ------- |
| Product price               | €14.99  |
| Marketplace fee             | 6.5%    |
| Payment processing fee      | 4%      |
| Listing fee                 | €0.20   |
| Refund rate                 | 3%      |
| AI/generation cost          | €5      |
| Monthly overhead allocation | €20     |
| Forecast period             | 90 days |
| Target contribution margin  | 60%     |
| Minimum profit confidence   | 70%     |

Verified example: at these defaults, unit contribution margin ≈ €12.77 and
break-even ≈ 2 units (see `packages/finance-engine/src/__tests__/calculations.test.ts`
for the exact assertions).

## Persistence and the Finance Centre (Phase 7 — implemented)

Every function above is pure and unpersisted; Phase 7 wires them to real
Prisma models and a real UI (`apps/web/src/app/dashboard/finance`), all
implemented in `packages/finance-engine`'s runner modules
(`assumptions-runner.ts`, `forecast-runner.ts`, `budget-guard.ts`,
`experiment-runner.ts`) and exposed via `apps/api`'s `FinanceController`/
`FinanceService`.

**Assumptions and forecasts.** `upsertFinancialAssumption` creates a new
"current" `FinancialAssumption` row per venture, superseding (never
mutating) whatever was previously current, so every `FinancialForecast`
keeps pointing at the exact assumption set that produced it even after the
founder edits an assumption later. `generateForecast` auto-seeds
`DEFAULT_FINANCIAL_ASSUMPTIONS` on first use if none exists yet, then
persists a new `FinancialForecast` + 3 `FinancialScenario` rows (LOW/BASE/
HIGH) via `calculateBreakEven`/`calculateScenarios` — never overwritten in
place, so the founder can see how projections evolved over time.

**Forecast vs. actual.** `compareForecastToActual` diffs the most recent
forecast's BASE scenario against real `RevenueEntry` rows recorded since
that forecast was generated, returning `forecastErrorEur` and
`forecastErrorRate`. Returns a zeroed comparison (not an error) before any
revenue has been recorded yet.

**Expenses and revenue.** `Expense`/`RevenueEntry` rows are recorded
directly via `FinanceService`; `netRevenueEur` is always computed
server-side (gross minus marketplace fee, payment processing fee, listing
fee, VAT, and refunds), never trusted from client input.

**Budgets and cost ledger.** `Budget`/`BudgetAllocation` rows define a
per-category spending limit, either workspace-wide or scoped to a single
venture. `assertWithinBudget` is a fail-closed pre-check (throws
`BudgetLimitExceededError` if a charge would exceed the limit);
`chargeToBudget` re-checks and then atomically writes a `CostLedgerEntry`

- increments the allocation's `spentEur` in one transaction.
  `resolveBudgetAllocation` prefers a venture-scoped ACTIVE budget over the
  workspace-wide one when both exist for the same category. Every model
  invocation is recorded via `recordModelUsage` as a real `ModelUsage` row
  (mock-provider cost = €0 today, but the recording mechanism is real from
  day one); a non-zero cost charges a real ledger entry against the resolved
  budget allocation, a zero cost records usage without charging anything.

**Experiments and Gate 6.** `Experiment`/`ExperimentVariant`/
`ExperimentMetric`/`ExperimentResult`/`ExperimentDecision` models track
controlled tests with named variants and metrics defined up front (master
spec section 30 Gate 5/6) — never invented after the fact to justify a
result. The lifecycle is DRAFT → RUNNING → DECIDED
(`createExperiment`/`startExperiment`/`recordExperimentResult`/
`recordExperimentDecision`), fail-closed on invalid transitions (e.g.
starting an already-RUNNING experiment, deciding an already-DECIDED one).
Increasing ad spend on the strength of results (`decision: 'SCALE'`)
requires an APPROVED `SCALE_DECISION` `ApprovalRequest` bound to the exact
experiment — the same `ApprovalRequest`/`decideApprovalRequest` machinery
every other phase's approval gate uses, `packageHash` computed with the
identical bare-snapshot scheme every other approval kind uses (see
`docs/DECISIONS.md` for a real bug this constraint caught and fixed).
KILL/ITERATE/HOLD never require approval, since they only reduce or hold
spend.

**Audit trail.** Every mutating action above (`FINANCIAL_ASSUMPTION_UPDATED`,
`FINANCIAL_FORECAST_GENERATED`, `EXPENSE_RECORDED`, `REVENUE_RECORDED`,
`BUDGET_CREATED`, `EXPERIMENT_CREATED`, `EXPERIMENT_STARTED`,
`EXPERIMENT_RESULT_RECORDED`, `SCALE_DECISION_APPROVAL_REQUESTED`,
`EXPERIMENT_DECIDED`) is recorded as a real, queryable `AuditEvent` with an
integrity hash, visible in the Audit Centre.
