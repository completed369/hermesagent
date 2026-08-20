import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { assertApiEntrypoint } from './assert-api-entrypoint.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDirectory = join(repositoryRoot, 'apps', 'api');
const distDirectory = join(apiDirectory, 'dist');
const entrypoint = join(distDirectory, 'main.js');
const currentBuildInfo = join(distDirectory, 'tsconfig.tsbuildinfo');
const legacyBuildInfo = join(apiDirectory, 'tsconfig.tsbuildinfo');
const previousLegacyBuildInfo = existsSync(legacyBuildInfo)
  ? readFileSync(legacyBuildInfo)
  : undefined;

function runApiBuild() {
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm --filter @ventureos/api run build'], {
          cwd: repositoryRoot,
          stdio: 'inherit',
        })
      : spawnSync('pnpm', ['--filter', '@ventureos/api', 'run', 'build'], {
          cwd: repositoryRoot,
          stdio: 'inherit',
        });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`API build failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

try {
  runApiBuild();
  assertApiEntrypoint(entrypoint);

  if (!existsSync(currentBuildInfo)) {
    throw new Error(`API incremental state is missing from dist: ${currentBuildInfo}`);
  }

  copyFileSync(currentBuildInfo, legacyBuildInfo);
  rmSync(distDirectory, { recursive: true, force: true });

  runApiBuild();
  const size = assertApiEntrypoint(entrypoint);
  console.log(
    `API stale-incremental regression verified: rebuilt a non-empty entrypoint (${size} bytes).`,
  );
} finally {
  if (previousLegacyBuildInfo === undefined) {
    rmSync(legacyBuildInfo, { force: true });
  } else {
    writeFileSync(legacyBuildInfo, previousLegacyBuildInfo);
  }
}
