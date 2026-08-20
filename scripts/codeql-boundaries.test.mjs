import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

test('staging environment generator writes only its fixed disposable file', () => {
  const source = read('scripts/generate-staging-env.mjs');
  assert.match(source, /join\(repositoryRoot, '\.staging', 'phase15\.env'\)/);
  assert.match(source, /accepts only the optional --force flag/);
  assert.doesNotMatch(source, /resolve\(process\.argv\[2\]/);
});

test('Windows build orchestration does not trust an executable from the environment', () => {
  const source = read('scripts/verify-api-build.mjs');
  assert.match(source, /spawnSync\(\s*'cmd\.exe'/);
  assert.doesNotMatch(source, /process\.env\.ComSpec/);
});
