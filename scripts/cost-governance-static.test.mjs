import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const files = [
  'packages/agent-control-plane/src/cost-governance.ts',
  'apps/api/src/modules/agent-control-plane/acp-cost-governance.service.ts',
];

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
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260826043000_acp_cost_governance_ledger/migration.sql',
    'utf8',
  );
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(migration, /recognized usage requires exactly one governed cost ledger entry/u);
  assert.match(migration, /cost governance evidence is immutable/u);
  assert.match(migration, /usage ledger correlation mismatch/u);
  assert.match(migration, /cost ledger exceeds or misstates governed budget/u);
  assert.match(migration, /overlapping cost budget policies are forbidden/u);
  assert.match(
    migration,
    /existing recognized usage requires an explicit governed-ledger remediation/u,
  );
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
