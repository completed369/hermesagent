import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(packageRoot, 'dist');
if (!existsSync(output)) throw new Error('Agent Bridge runtime output is missing');
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
if (JSON.stringify(packageJson.files) !== JSON.stringify(['dist']))
  throw new Error('Agent Bridge package allowlist is not runtime-only');

const files = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else files.push(path);
  }
};
visit(output);

for (const path of files) {
  const normalized = relative(output, path).split(sep).join('/');
  if (/(?:^|\/)__tests__(?:\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/u.test(normalized))
    throw new Error('Agent Bridge test fixture entered runtime output');
  if (extname(path) === '.js') {
    const source = readFileSync(path, 'utf8');
    if (
      /runtime-process-tree-fixture|deterministic-supervision|native-supervisor-helper|native-supervisor-addon|native-runtime-fixture|authenticated-lifecycle-addon|authenticated-supervised-lifecycle|retained-pidfd-recovery|NATIVE_SUPERVISOR_DENIED|AUTHENTICATED_TRANSCRIPT|node:child_process|MC4CAQAwBQYDK2VwBCIE/u.test(
        source,
      )
    )
      throw new Error('Agent Bridge deterministic fixture entered runtime output');
  }
}

console.log(`Agent Bridge runtime boundary: PASS (${files.length} files)`);
