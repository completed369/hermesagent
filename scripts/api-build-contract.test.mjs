import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertApiEntrypoint } from './assert-api-entrypoint.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('API entrypoint assertion rejects a missing file explicitly', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'ventureos-api-build-'));

  try {
    assert.throws(
      () => assertApiEntrypoint(join(temporaryDirectory, 'main.js')),
      /API build entrypoint is missing/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('API entrypoint assertion rejects an empty file explicitly', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'ventureos-api-build-'));
  const entrypoint = join(temporaryDirectory, 'main.js');
  writeFileSync(entrypoint, '');

  try {
    assert.throws(() => assertApiEntrypoint(entrypoint), /API build entrypoint is empty/);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('API entrypoint assertion accepts a non-empty file', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'ventureos-api-build-'));
  const entrypoint = join(temporaryDirectory, 'main.js');
  writeFileSync(entrypoint, 'module.exports = {};\n');

  try {
    assert.doesNotThrow(() => assertApiEntrypoint(entrypoint));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
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

test('canonical root E2E serializes the production build before Playwright', () => {
  const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));

  assert.equal(
    rootPackage.scripts['test:e2e'],
    'pnpm run build && pnpm --filter @ventureos/web run test:e2e',
  );
});
