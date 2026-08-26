import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(packageRoot, 'dist');

if (!existsSync(distRoot)) throw new Error('Database build output is missing');

const forbidden = readdirSync(distRoot, { recursive: true })
  .map(String)
  .filter((path) =>
    /restore-drill\.integration\.test\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u.test(path),
  );

if (forbidden.length > 0) {
  throw new Error(
    `Test-only restore fixture entered database runtime output: ${forbidden.join(', ')}`,
  );
}

process.stdout.write('Database runtime output excludes the restore fixture\n');
