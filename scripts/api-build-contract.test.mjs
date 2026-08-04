import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertApiEntrypoint } from './assert-api-entrypoint.mjs';
import { assertWorkerEntrypoint } from './assert-worker-entrypoint.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function withTemporaryEntrypoint(prefix, contents, callback) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), prefix));
  const entrypoint = join(temporaryDirectory, 'entrypoint.js');
  if (contents !== null) writeFileSync(entrypoint, contents);

  try {
    callback(entrypoint);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

test('API entrypoint assertion rejects a missing file explicitly', () => {
  withTemporaryEntrypoint('ventureos-api-build-', null, (entrypoint) => {
    assert.throws(() => assertApiEntrypoint(entrypoint), /API build entrypoint is missing/);
  });
});

test('API entrypoint assertion rejects an empty file explicitly', () => {
  withTemporaryEntrypoint('ventureos-api-build-', '', (entrypoint) => {
    assert.throws(() => assertApiEntrypoint(entrypoint), /API build entrypoint is empty/);
  });
});

test('API entrypoint assertion accepts a non-empty file', () => {
  withTemporaryEntrypoint('ventureos-api-build-', 'module.exports = {};\n', (entrypoint) => {
    assert.doesNotThrow(() => assertApiEntrypoint(entrypoint));
  });
});

test('API incremental state is disposable with its build output', () => {
  const tsconfig = JSON.parse(
    readFileSync(join(repositoryRoot, 'apps', 'api', 'tsconfig.json'), 'utf8'),
  );

  assert.match(
    tsconfig.compilerOptions.tsBuildInfoFile,
    /^(?:\.\/)?dist[\\/]/,
    'apps/api tsBuildInfoFile must be inside dist',
  );
});

test('worker incremental state is disposable with its build output', () => {
  const tsconfig = JSON.parse(
    readFileSync(join(repositoryRoot, 'apps', 'worker', 'tsconfig.json'), 'utf8'),
  );

  assert.match(
    tsconfig.compilerOptions.tsBuildInfoFile,
    /^(?:\.\/)?dist[\\/]/,
    'apps/worker tsBuildInfoFile must be inside dist',
  );
});

test('worker entrypoint assertion rejects a missing file explicitly', () => {
  withTemporaryEntrypoint('ventureos-worker-build-', null, (entrypoint) => {
    assert.throws(() => assertWorkerEntrypoint(entrypoint), /Worker build entrypoint is missing/);
  });
});

test('canonical root E2E serializes the production build before Playwright', () => {
  const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));

  assert.equal(
    rootPackage.scripts['test:e2e'],
    'pnpm run build && pnpm --filter @ventureos/web run test:e2e',
  );
});

test('canonical validation cleans output and uses root integration orchestration', () => {
  const validationScript = readFileSync(
    join(repositoryRoot, 'scripts', 'run-validation.ps1'),
    'utf8',
  );

  assert.match(validationScript, /scripts\/clean-build-outputs\.mjs/);
  assert.match(
    validationScript,
    /Name = "Integration tests"; Command = "pnpm"; Args = @\("run", "test:integration"\)/,
  );
  assert.doesNotMatch(validationScript, /--filter.*@ventureos\/api.*test:integration/);
});
