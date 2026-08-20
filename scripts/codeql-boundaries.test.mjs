import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

test('staging load test has fixed local request, result, and delay boundaries', () => {
  const source = read('load-tests/staging.mjs');
  assert.match(source, /const API_BASE = 'http:\/\/127\.0\.0\.1:3001\/api'/);
  assert.match(source, /join\(repositoryRoot, '\.staging', 'load-results\.json'\)/);
  assert.match(source, /const RATE_LIMIT_SETTLE_MS = 65_000/);
  assert.doesNotMatch(source, /STAGING_LOAD_API_BASE_URL/);
  assert.doesNotMatch(source, /STAGING_LOAD_RESULT_FILE/);
  assert.doesNotMatch(source, /STAGING_LOAD_RATE_LIMIT_SETTLE_MS/);
  assert.match(source, /encodeURIComponent\(String\(value\)\)/);
});

test('clean-file staging gate invocation generates only a confined disposable env file', () => {
  const source = read('scripts/generate-staging-env.mjs');
  const gate = read('scripts/staging-security-gate.sh');
  assert.match(source, /targetArgument = '\.staging\/phase15\.env'/);
  assert.match(source, /direct \.env file inside repository \.staging/);
  assert.doesNotMatch(source, /resolve\(process\.argv\[2\]/);
  assert.match(gate, /node scripts\/generate-staging-env\.mjs --target "\$ENV_FILE"/);

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ventureos-staging-env-'));
  const temporaryScripts = join(temporaryRoot, 'scripts');
  const copiedGenerator = join(temporaryScripts, 'generate-staging-env.mjs');
  mkdirSync(temporaryScripts);
  copyFileSync(resolve(root, 'scripts/generate-staging-env.mjs'), copiedGenerator);

  try {
    const canonicalTarget = join(temporaryRoot, '.staging', 'phase15.env');
    const canonical = spawnSync(
      process.execPath,
      [copiedGenerator, '--target', '.staging/phase15.env'],
      { cwd: temporaryRoot, encoding: 'utf8' },
    );
    assert.equal(canonical.status, 0, canonical.stderr);
    assert.equal(existsSync(canonicalTarget), true);

    const customTarget = join(temporaryRoot, '.staging', 'custom-gate.env');
    const custom = spawnSync(
      process.execPath,
      [copiedGenerator, '--target', '.staging/custom-gate.env'],
      { cwd: temporaryRoot, encoding: 'utf8' },
    );
    assert.equal(custom.status, 0, custom.stderr);
    assert.equal(existsSync(customTarget), true);

    const escaped = spawnSync(process.execPath, [copiedGenerator, '--target', 'outside.env'], {
      cwd: temporaryRoot,
      encoding: 'utf8',
    });
    assert.notEqual(escaped.status, 0);
    assert.equal(existsSync(join(temporaryRoot, 'outside.env')), false);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('Windows build orchestration does not trust an executable from the environment', () => {
  const source = read('scripts/verify-api-build.mjs');
  assert.match(source, /spawnSync\(\s*'cmd\.exe'/);
  assert.doesNotMatch(source, /process\.env\.ComSpec/);
});
