import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('committed API inventory matches every controller route', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-api-inventory.mjs', '--check'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('API inventory is deterministic and contains unique normalized routes', () => {
  const inventory = JSON.parse(readFileSync('docs/api/API_INVENTORY.json', 'utf8'));
  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.routeCount, inventory.routes.length);
  assert.ok(inventory.routeCount > 0);
  const identities = inventory.routes.map((route) => `${route.method} ${route.path}`);
  assert.equal(new Set(identities).size, identities.length);
  for (const route of inventory.routes) {
    assert.match(route.method, /^(DELETE|GET|PATCH|POST|PUT)$/u);
    assert.match(route.path, /^\/api(?:\/[^/]+)*$/u);
    assert.match(route.controller, /^[A-Za-z][A-Za-z0-9]*Controller$/u);
    assert.match(route.source, /^apps\/api\/src\/modules\/.+\.controller\.ts$/u);
  }
});
