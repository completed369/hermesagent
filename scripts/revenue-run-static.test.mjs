import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  'packages/database/prisma/migrations/20260908040000_revenue_run_correlation_spine/migration.sql',
  'utf8',
);
const runner = readFileSync('packages/finance-engine/src/revenue-run.ts', 'utf8');
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
  assert.doesNotMatch(
    schema.match(/model RevenueRun \{[\s\S]*?\n\}/u)?.[0] ?? '',
    /actualRevenue|actualCost|realizedRevenue|realizedCost|profitMinorUnits/u,
  );
  assert.match(migration, /"status" = 'PLANNED'/u);
  assert.match(migration, /Revenue run forecasts are immutable/u);
  assert.match(migration, /Revenue outcome evidence links are append-only/u);
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
