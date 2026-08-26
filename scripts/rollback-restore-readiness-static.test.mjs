import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const restoreSource = await readFile('packages/database/src/restore-drill.ts', 'utf8');
const integrationSource = await readFile(
  'packages/database/src/restore-drill.integration.test.ts',
  'utf8',
);
const rollbackSource = await readFile('scripts/release-recovery-contract.mjs', 'utf8');
const adr = await readFile('docs/ADR_0027_ROLLBACK_RESTORE_READINESS.md', 'utf8');
const runbook = await readFile('docs/ROLLBACK_RESTORE_READINESS.md', 'utf8');
const dockerIgnore = await readFile('.dockerignore', 'utf8');
const dockerfile = await readFile('Dockerfile.staging', 'utf8');
const ciWorkflow = await readFile('.github/workflows/ci.yml', 'utf8');
const databasePackage = JSON.parse(await readFile('packages/database/package.json', 'utf8'));

test('production modules remain pure and expose no process, network, filesystem, provider or deployment path', () => {
  for (const source of [restoreSource, rollbackSource]) {
    assert.doesNotMatch(
      source,
      /node:(?:child_process|fs|http|https|net|os)|\bfetch\s*\(|\bspawn\s*\(|\bexec\s*\(/u,
    );
    assert.doesNotMatch(source, /docker|kubectl|wrangler|cloudflare|github|deployments?\b/iu);
  }
});

test('positive PostgreSQL implementation is confined to the CI integration fixture and disposable names', () => {
  assert.match(integrationSource, /process\.env\.CI === 'true'/u);
  assert.match(integrationSource, /process\.env\.GITHUB_ACTIONS === 'true'/u);
  assert.match(integrationSource, /RUNNER_ENVIRONMENT === 'github-hosted'/u);
  assert.match(integrationSource, /GITHUB_REPOSITORY === 'completed369\/hermesagent'/u);
  assert.match(integrationSource, /parsed\.hostname !== 'localhost'/u);
  assert.match(integrationSource, /FIXTURE_LABEL/u);
  assert.match(integrationSource, /ventureos_restore_drill_/u);
  assert.doesNotMatch(integrationSource, /private-staging|production|customer|VPS_|CLOUDFLARE/iu);
});

test('restore fixture is available to test tooling but excluded from every final runtime image', () => {
  assert.match(dockerIgnore, /!packages\/database\/src\/restore-drill\.integration\.test\.ts/u);
  assert.match(ciWorkflow, /--label ventureos\.fixture\.owner=github-ci-restore-drill/u);
  const finalRuntimeStages = dockerfile.slice(dockerfile.indexOf(' AS runtime\n'));
  assert.ok(finalRuntimeStages.length > 0);
  assert.doesNotMatch(finalRuntimeStages, /restore-drill\.integration\.test/u);
  assert.ok(Array.isArray(databasePackage.files));
  assert.ok(!databasePackage.files.some((path) => path === 'src' || path.startsWith('src/')));
});

test('docs state the evidence and Founder boundaries without claiming a real restore or deployment', () => {
  for (const source of [adr, runbook]) {
    assert.match(source, /not\s+(?:evidence|establish|prove)|does not\s+prove/iu);
    assert.match(
      source,
      /no (?:image|external environment)|Neither\s+(?:production\s+)?contract/iu,
    );
  }
  assert.match(adr, /Level-4\s+boundaries/u);
  assert.match(runbook, /restart command as attempted work, not success/u);
});
