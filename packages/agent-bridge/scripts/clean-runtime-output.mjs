import { rmSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(packageRoot, 'dist');
const buildInfo = resolve(packageRoot, 'tsconfig.tsbuildinfo');

if (
  output !== `${packageRoot}${sep}dist` ||
  buildInfo !== `${packageRoot}${sep}tsconfig.tsbuildinfo`
)
  throw new Error('Agent Bridge output boundary denied');
rmSync(output, { recursive: true, force: true });
rmSync(buildInfo, { force: true });
