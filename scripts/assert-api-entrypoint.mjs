import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '..');
const defaultEntrypoint = joinRepositoryPath('apps', 'api', 'dist', 'main.js');

function joinRepositoryPath(...segments) {
  return resolve(repositoryRoot, ...segments);
}

export function assertApiEntrypoint(entrypoint = defaultEntrypoint) {
  let stats;

  try {
    stats = statSync(entrypoint);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`API build entrypoint is missing: ${entrypoint}`);
    }
    throw error;
  }

  if (!stats.isFile()) {
    throw new Error(`API build entrypoint is not a file: ${entrypoint}`);
  }
  if (stats.size === 0) {
    throw new Error(`API build entrypoint is empty: ${entrypoint}`);
  }

  return stats.size;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const size = assertApiEntrypoint();
    console.log(`API build entrypoint verified (${size} bytes).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
