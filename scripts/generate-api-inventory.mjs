import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modulesRoot = join(repositoryRoot, 'apps', 'api', 'src', 'modules');
const outputPath = join(repositoryRoot, 'docs', 'api', 'API_INVENTORY.json');
const mode = process.argv[2] ?? '--check';

if (!['--check', '--write'].includes(mode)) {
  throw new Error('Usage: node scripts/generate-api-inventory.mjs [--check|--write]');
}

function controllerFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? controllerFiles(path)
        : entry.isFile() && entry.name.endsWith('.controller.ts')
          ? [path]
          : [];
    })
    .sort();
}

function decoratorArgument(raw, context) {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  const match = trimmed.match(/^(['"])([^'"\r\n]*)\1$/u);
  if (!match) throw new Error(`Unsupported non-literal route decorator in ${context}: ${raw}`);
  return match[2];
}

function routePath(prefix, suffix) {
  return `/api/${[prefix, suffix].filter((part) => part.length > 0).join('/')}`.replace(
    /\/+$/u,
    '',
  );
}

const routes = [];
for (const path of controllerFiles(modulesRoot)) {
  const source = readFileSync(path, 'utf8');
  const sourcePath = relative(repositoryRoot, path).replaceAll('\\', '/');
  const tokens = [
    ...source.matchAll(
      /@Controller\(([^)]*)\)|@(Get|Post|Put|Patch|Delete)\(([^)]*)\)|export class\s+(\w+Controller)\b/gu,
    ),
  ];
  let pendingPrefix;
  let controller;
  for (const token of tokens) {
    if (token[1] !== undefined) {
      pendingPrefix = decoratorArgument(token[1], sourcePath);
      controller = undefined;
      continue;
    }
    if (token[4] !== undefined) {
      if (pendingPrefix === undefined) {
        throw new Error(`Controller class without @Controller in ${sourcePath}`);
      }
      controller = token[4];
      continue;
    }
    if (!controller || pendingPrefix === undefined || token[2] === undefined) {
      throw new Error(`Route decorator outside a controller in ${sourcePath}`);
    }
    routes.push({
      method: token[2].toUpperCase(),
      path: routePath(pendingPrefix, decoratorArgument(token[3] ?? '', sourcePath)),
      controller,
      source: sourcePath,
    });
  }
}

routes.sort((left, right) => {
  const leftKey = `${left.path}\0${left.method}\0${left.controller}`;
  const rightKey = `${right.path}\0${right.method}\0${right.controller}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
});

const inventory = `${JSON.stringify(
  {
    schemaVersion: 1,
    generatedFrom: 'apps/api/src/modules/**/*.controller.ts',
    globalPrefix: '/api',
    routeCount: routes.length,
    routes,
  },
  null,
  2,
)}\n`;

if (mode === '--write') {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, inventory, 'utf8');
  process.stdout.write(`Wrote ${relative(repositoryRoot, outputPath)} (${routes.length} routes)\n`);
} else {
  if (!existsSync(outputPath)) throw new Error('API inventory is missing; run with --write');
  const committed = readFileSync(outputPath, 'utf8');
  if (committed !== inventory) {
    throw new Error('API inventory is stale; run node scripts/generate-api-inventory.mjs --write');
  }
  process.stdout.write(`API inventory is current (${routes.length} routes)\n`);
}
