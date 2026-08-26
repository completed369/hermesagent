import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const files = [
  'packages/agent-control-plane/src/cost-governance.ts',
  'apps/api/src/modules/agent-control-plane/acp-cost-governance.service.ts',
];
const costService = readFileSync(
  'apps/api/src/modules/agent-control-plane/acp-cost-governance.service.ts',
  'utf8',
);

test('cost governance foundation has no controller, provider, transport, or process path', () => {
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(
    source,
    /from\s+['"]node:(?:child_process|cluster|net|http|https|tls|dgram|worker_threads|fs|os)['"]/u,
  );
  assert.doesNotMatch(source, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.doesNotMatch(source, /@Controller\s*\(/u);
  assert.doesNotMatch(source, /AcpBrokerReservation|brokerReservation/u);
});

test('recognized usage is transactionally paired with ledger and immutable evidence', () => {
  const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260826043000_acp_cost_governance_ledger/migration.sql',
    'utf8',
  );
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(migration, /recognized usage requires exactly one governed cost ledger entry/u);
  assert.match(migration, /cost governance evidence is immutable/u);
  assert.match(migration, /usage ledger correlation mismatch/u);
  assert.match(migration, /usage_row\."recordedAt" IS DISTINCT FROM NEW\."recordedAt"/u);
  assert.match(migration, /usage_row\."cumulativeCostMinorUnits" > task_limit/u);
  assert.match(migration, /usage_row\."cumulativeComputeUnits" > task_compute_limit/u);
  assert.match(
    migration,
    /SELECT "currency", "maximumCostMinorUnits", "maximumComputeUnits", "policyVersion"[\s\S]*?FOR UPDATE;[\s\S]*?SELECT \* INTO workspace_policy[\s\S]*?FOR UPDATE;[\s\S]*?SELECT \* INTO task_policy[\s\S]*?FOR UPDATE;/u,
  );
  assert.match(
    costService,
    /FROM "acp_tasks"[\s\S]*?FOR UPDATE[\s\S]*?FROM "acp_cost_budget_policies"[\s\S]*?FOR UPDATE/u,
  );
  assert.match(migration, /cost ledger exceeds or misstates governed budget/u);
  assert.match(migration, /overlapping cost budget policies are forbidden/u);
  assert.match(
    migration,
    /existing recognized usage requires an explicit governed-ledger remediation/u,
  );
  for (const [name, prismaFields, sqlFields] of [
    [
      'acp_cost_budget_policy_lookup_idx',
      'workspaceId, scope, currency, periodStart, periodEnd',
      '"workspaceId", "scope", "currency", "periodStart", "periodEnd"',
    ],
    [
      'acp_cost_ledger_workspace_period_idx',
      'workspaceId, periodStart, periodEnd, recordedAt\\(sort: Desc\\)',
      '"workspaceId", "periodStart", "periodEnd", "recordedAt" DESC',
    ],
    [
      'acp_cost_ledger_task_period_idx',
      'workspaceId, taskId, periodStart, periodEnd, recordedAt\\(sort: Desc\\)',
      '"workspaceId", "taskId", "periodStart", "periodEnd", "recordedAt" DESC',
    ],
  ]) {
    assert.match(schema, new RegExp(`@@index\\(\\[${prismaFields}\\], map: "${name}"\\)`, 'u'));
    assert.match(migration, new RegExp(`CREATE INDEX "${name}"[^;]+\\(${sqlFields}\\);`, 'u'));
  }
  assert.match(migration, /governed cost ledger can only be removed during workspace erasure/u);
});

test('composition root exports only the read-only cost query surface', () => {
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const exportsBlock = module.match(/exports:\s*\[([\s\S]*?)\]/u)?.[1] ?? '';
  assert.match(exportsBlock, /AcpCostLedgerQueryService/u);
  assert.doesNotMatch(exportsBlock, /AcpCostGovernanceService/u);
});
