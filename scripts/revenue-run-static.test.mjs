import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  'packages/database/prisma/migrations/20260908040000_revenue_run_correlation_spine/migration.sql',
  'utf8',
);
const outcomeGuardMigration = readFileSync(
  'packages/database/prisma/migrations/20260908073000_revenue_run_outcome_link_delete_guard/migration.sql',
  'utf8',
);
const reconciliationMigration = readFileSync(
  'packages/database/prisma/migrations/20260908093000_revenue_run_cost_reconciliation/migration.sql',
  'utf8',
);
const commercialEvidenceMigration = readFileSync(
  'packages/database/prisma/migrations/20260908103000_revenue_run_commercial_evidence/migration.sql',
  'utf8',
);
const runner = readFileSync('packages/finance-engine/src/revenue-run.ts', 'utf8');
const outcome = readFileSync('packages/finance-engine/src/revenue-run-outcome.ts', 'utf8');
const apiModule = readFileSync('apps/api/src/app.module.ts', 'utf8');
const worker = readFileSync('apps/worker/src/worker.ts', 'utf8');

test('revenue-run spine separates immutable forecasts from authoritative actual facts', () => {
  assert.match(schema, /model RevenueRun \{/u);
  assert.match(schema, /expectedRevenueMinorUnits\s+BigInt/u);
  assert.match(schema, /expectedCostMinorUnits\s+BigInt/u);
  assert.match(schema, /downsideMinorUnits\s+BigInt/u);
  assert.match(schema, /confidenceBps\s+Int/u);
  assert.match(schema, /timeToCashDays\s+Int/u);
  assert.match(schema, /model RevenueRunRevenueEntry \{/u);
  assert.match(schema, /model RevenueRunExpense \{/u);
  assert.match(schema, /model RevenueRunUsage \{/u);
  assert.match(schema, /model RevenueRunCostReconciliation \{/u);
  assert.match(schema, /model RevenueRunCommercialEvidence \{/u);
  assert.doesNotMatch(
    schema.match(/model RevenueRun \{[\s\S]*?\n\}/u)?.[0] ?? '',
    /actualRevenue|actualCost|realizedRevenue|realizedCost|profitMinorUnits/u,
  );
  assert.match(migration, /"status" = 'PLANNED'/u);
  assert.match(migration, /Revenue run forecasts are immutable/u);
  assert.match(migration, /Revenue outcome evidence links are append-only/u);
  assert.match(outcomeGuardMigration, /TG_OP = 'DELETE'/u);
  assert.match(outcomeGuardMigration, /revenue_runs_delete_guard/u);
  assert.match(outcomeGuardMigration, /Revenue run forecasts are immutable/u);
  assert.match(outcomeGuardMigration, /Revenue outcome evidence links are append-only/u);
  assert.match(outcomeGuardMigration, /revenue_run_revenue_entries_delete_guard/u);
  assert.match(outcomeGuardMigration, /revenue_run_expenses_delete_guard/u);
  assert.match(outcomeGuardMigration, /revenue_run_usages_delete_guard/u);
  assert.match(reconciliationMigration, /Revenue cost reconciliations are append-only/u);
  assert.match(reconciliationMigration, /revenue_run_cost_reconciliations_scope_guard/u);
  assert.match(reconciliationMigration, /"overlapMinorUnits" <= "expenseTotalMinorUnits"/u);
  assert.match(reconciliationMigration, /"overlapMinorUnits" <= "runtimeChargeMinorUnits"/u);
  assert.match(commercialEvidenceMigration, /Revenue commercial evidence is append-only/u);
  assert.match(
    commercialEvidenceMigration,
    /"verificationState" = 'UNVERIFIED_EXTERNAL_ASSERTION'/u,
  );
  assert.match(
    commercialEvidenceMigration,
    /FOREIGN KEY \("workspaceId", "revenueRunId", "revenueEntryId"\)/u,
  );
  assert.doesNotMatch(commercialEvidenceMigration, /VERIFIED_(?:PAYMENT|DELIVERY|REVENUE)/u);
});

test('outcome reporting calculates only from exact-set reconciled costs', () => {
  assert.match(outcome, /function revenueEntryEvidenceHash/u);
  assert.match(outcome, /function expenseEvidenceHash/u);
  assert.match(outcome, /function usageEvidenceHash/u);
  assert.match(outcome, /costLedgerEntry/u);
  assert.match(outcome, /ACP usage and recognized cost-ledger evidence do not match/u);
  assert.match(outcome, /UNVERIFIED_SOURCE_RECORDS/u);
  assert.match(outcome, /POTENTIAL_EXPENSE_RUNTIME_OVERLAP/u);
  assert.match(outcome, /NOT_CALCULATED_POTENTIAL_COST_OVERLAP/u);
  assert.match(outcome, /RECONCILED_EXACT_EVIDENCE_SET/u);
  assert.match(outcome, /CALCULATED_FROM_UNVERIFIED_REVENUE_AND_RECONCILED_COSTS/u);
  assert.match(outcome, /costReconciliationHash/u);
  assert.match(outcome, /UNVERIFIED_EXTERNAL_ASSERTION/u);
  assert.match(outcome, /UNVERIFIED_EXTERNAL_ASSERTIONS/u);
  assert.match(outcome, /FOR UPDATE/u);
  assert.match(outcome, /TransactionIsolationLevel\.RepeatableRead/u);
  assert.doesNotMatch(outcome, /verificationState:\s*'VERIFIED'|state:\s*'VERIFIED_PROFIT'/u);
});

test('database guards every tenant and semantic revenue-run binding', () => {
  assert.match(migration, /Revenue run opportunity crossed workspace scope/u);
  assert.match(migration, /proposal crossed opportunity or workspace scope/u);
  assert.match(migration, /approval is absent, expired, revoked, unapproved, or out of scope/u);
  assert.match(migration, /experiment crossed venture or workspace scope/u);
  assert.match(migration, /ACP run crossed task or workspace scope/u);
  assert.match(
    migration,
    /Revenue entry crossed revenue-run venture, currency, or workspace scope/u,
  );
  assert.match(migration, /Expense crossed revenue-run venture, currency, or workspace scope/u);
  assert.match(migration, /Runtime usage crossed revenue-run run, currency, or workspace scope/u);
  assert.match(
    reconciliationMigration,
    /Revenue cost reconciliation crossed run, currency, or workspace scope/u,
  );
});

test('revenue-run writer remains planning-only, capability-gated, and uncomposed', () => {
  assert.match(runner, /await enforceFinanceMutation\(/u);
  assert.match(runner, /status: 'PLANNED'/u);
  assert.match(runner, /workspaceId_idempotencyKey/u);
  assert.doesNotMatch(
    runner,
    /status:\s*'ACTIVE'|dispatchTask\(|publishListing\(|activateProvider\(|process\.env|fetch\(|from 'node:(?:net|tls|child_process)'/u,
  );
  assert.doesNotMatch(apiModule, /RevenueRun|createRevenueRunPlan/u);
  assert.doesNotMatch(worker, /RevenueRun|createRevenueRunPlan/u);
});
