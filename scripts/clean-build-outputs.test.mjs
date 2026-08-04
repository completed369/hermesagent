import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('cleanBuildOutputs removes every declared project build output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ventureos-clean-build-'));
  const project = join(root, 'apps', 'web');
  mkdirSync(join(project, 'dist'), { recursive: true });
  mkdirSync(join(project, '.next'), { recursive: true });
  writeFileSync(join(project, 'dist', 'server.js'), 'generated');
  writeFileSync(join(project, '.next', 'BUILD_ID'), 'generated');
  writeFileSync(join(project, 'tsconfig.tsbuildinfo'), 'generated');

  try {
    const { cleanBuildOutputs } = await import('./clean-build-outputs.mjs');
    cleanBuildOutputs(root);

    assert.equal(existsSync(join(project, 'dist')), false);
    assert.equal(existsSync(join(project, '.next')), false);
    assert.equal(existsSync(join(project, 'tsconfig.tsbuildinfo')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});