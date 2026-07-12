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

| Assumption | Default |
|---|---|
| Product price | €14.99 |
| Marketplace fee | 6.5% |
| Payment processing fee | 4% |
| Listing fee | €0.20 |
| Refund rate | 3% |
| AI/generation cost | €5 |
| Monthly overhead allocation | €20 |
| Forecast period | 90 days |
| Target contribution margin | 60% |
| Minimum profit confidence | 70% |

Verified example: at these defaults, unit contribution margin ≈ €12.77 and
break-even ≈ 2 units (see `packages/finance-engine/src/__tests__/calculations.test.ts`
for the exact assertions).

## Not yet implemented

`FinancialAssumption`/`FinancialForecast`/`FinancialScenario`/`Expense`/
`RevenueEntry`/`Budget` Prisma models and the Finance Centre UI — Phase 7.
