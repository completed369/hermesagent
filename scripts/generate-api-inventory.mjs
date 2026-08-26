import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiSourceRoot = join(repositoryRoot, 'apps', 'api', 'src');
const apiMainPath = join(repositoryRoot, 'apps', 'api', 'src', 'main.ts');
const outputPath = join(repositoryRoot, 'docs', 'api', 'API_INVENTORY.json');
const ROUTES = new Map([
  ['All', 'ALL'],
  ['Delete', 'DELETE'],
  ['Get', 'GET'],
  ['Head', 'HEAD'],
  ['Options', 'OPTIONS'],
  ['Patch', 'PATCH'],
  ['Post', 'POST'],
  ['Put', 'PUT'],
  ['Sse', 'GET'],
]);
// These are valid Nest route decorators, but the public inventory intentionally
// does not model their uncommon/custom HTTP semantics. Seeing one must stop the
// contract instead of silently dropping an endpoint.
const UNSUPPORTED_ROUTES = new Set([
  'Copy',
  'Lock',
  'Mkcol',
  'Move',
  'Propfind',
  'Proppatch',
  'QueryMethod',
  'RequestMapping',
  'Search',
  'Unlock',
]);

export function controllerFiles(directory) {
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

function literalArgument(call, context) {
  if (call.arguments.length === 0) return '';
  if (call.arguments.length !== 1 || !ts.isStringLiteralLike(call.arguments[0])) {
    throw new Error(`Unsupported non-literal route decorator in ${context}`);
  }
  return call.arguments[0].text;
}

function routePath(globalPrefix, controllerPrefix, suffix) {
  return `/${[globalPrefix, controllerPrefix, suffix]
    .filter((part) => part.length > 0)
    .join('/')}`.replace(/\/+$/u, '');
}

function nestDecoratorImports(sourceFile) {
  const named = new Map();
  const namespaces = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@nestjs/common' ||
      !statement.importClause?.namedBindings
    ) {
      continue;
    }
    const bindings = statement.importClause.namedBindings;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      named.set(element.name.text, element.propertyName?.text ?? element.name.text);
    }
  }
  return { named, namespaces };
}

function canonicalDecorator(expression, imports) {
  if (ts.isIdentifier(expression)) return imports.named.get(expression.text);
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    imports.namespaces.has(expression.expression.text)
  ) {
    return expression.name.text;
  }
  return undefined;
}

function decorators(node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

export function parseControllerSource(source, sourcePath, globalPrefix) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
  const imports = nestDecoratorImports(sourceFile);
  const routes = [];
  let controllerCount = 0;

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name) continue;
    const controllerCalls = decorators(statement)
      .map((decorator) => decorator.expression)
      .filter(ts.isCallExpression)
      .filter((call) => canonicalDecorator(call.expression, imports) === 'Controller');
    if (controllerCalls.length === 0) continue;
    if (controllerCalls.length !== 1) throw new Error(`Ambiguous @Controller in ${sourcePath}`);
    controllerCount += 1;
    const controllerPrefix = literalArgument(controllerCalls[0], sourcePath);

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      let routeDecoratorCount = 0;
      for (const decorator of decorators(member)) {
        if (!ts.isCallExpression(decorator.expression)) continue;
        const canonical = canonicalDecorator(decorator.expression.expression, imports);
        if (canonical && UNSUPPORTED_ROUTES.has(canonical)) {
          throw new Error(`Unsupported Nest route decorator @${canonical} in ${sourcePath}`);
        }
        const method = canonical ? ROUTES.get(canonical) : undefined;
        if (!method) continue;
        routeDecoratorCount += 1;
        routes.push({
          method,
          path: routePath(
            globalPrefix,
            controllerPrefix,
            literalArgument(decorator.expression, sourcePath),
          ),
          controller: statement.name.text,
          source: sourcePath,
        });
      }
      if (routeDecoratorCount !== 1) {
        throw new Error(
          `Every controller method must use exactly one direct supported Nest route decorator in ${sourcePath}`,
        );
      }
    }
  }
  if (controllerCount === 0) throw new Error(`No imported Nest @Controller found in ${sourcePath}`);
  return routes;
}

export function readGlobalPrefix(source) {
  const sourceName = 'apps/api/src/main.ts';
  const options = { noResolve: true, target: ts.ScriptTarget.Latest };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => fileName === sourceName;
  host.readFile = (fileName) => (fileName === sourceName ? source : undefined);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === sourceName
      ? ts.createSourceFile(sourceName, source, languageVersion, true)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram({ rootNames: [sourceName], options, host });
  const sourceFile = program.getSourceFile(sourceName);
  if (!sourceFile) throw new Error('API source could not be parsed');
  const checker = program.getTypeChecker();
  const factoryIdentifiers = new Set();
  const factoryNamespaces = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@nestjs/core' ||
      !statement.importClause?.namedBindings
    ) {
      continue;
    }
    const bindings = statement.importClause.namedBindings;
    if (ts.isNamespaceImport(bindings)) {
      factoryNamespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === 'NestFactory') {
        factoryIdentifiers.add(element.name.text);
      }
    }
  }

  const applicationDeclarations = [];
  function isFactoryCreate(expression) {
    if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'create') {
      return false;
    }
    if (ts.isIdentifier(expression.expression)) {
      return factoryIdentifiers.has(expression.expression.text);
    }
    return (
      ts.isPropertyAccessExpression(expression.expression) &&
      ts.isIdentifier(expression.expression.expression) &&
      factoryNamespaces.has(expression.expression.expression.text) &&
      expression.expression.name.text === 'NestFactory'
    );
  }
  function findApplication(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isAwaitExpression(node.initializer) &&
      ts.isCallExpression(node.initializer.expression) &&
      isFactoryCreate(node.initializer.expression.expression)
    ) {
      applicationDeclarations.push(node);
    }
    ts.forEachChild(node, findApplication);
  }
  findApplication(sourceFile);
  if (applicationDeclarations.length !== 1) {
    throw new Error('API must create one uniquely identifiable Nest application');
  }
  const [applicationDeclaration] = applicationDeclarations;
  const applicationSymbol = checker.getSymbolAtLocation(applicationDeclaration.name);
  if (!applicationSymbol) throw new Error('Nest application binding could not be resolved');

  let prefix;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      checker.getSymbolAtLocation(node.expression.expression) === applicationSymbol &&
      node.expression.name.text === 'setGlobalPrefix'
    ) {
      if (
        prefix !== undefined ||
        node.arguments.length !== 1 ||
        !ts.isStringLiteral(node.arguments[0])
      ) {
        throw new Error('API global prefix must be one unique string literal');
      }
      prefix = node.arguments[0].text.replace(/^\/+|\/+$/gu, '');
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!prefix) throw new Error('API global prefix was not found');
  return prefix;
}

export function buildInventory() {
  const globalPrefix = readGlobalPrefix(readFileSync(apiMainPath, 'utf8'));
  const routes = controllerFiles(apiSourceRoot).flatMap((path) => {
    const sourcePath = relative(repositoryRoot, path).replaceAll('\\', '/');
    return parseControllerSource(readFileSync(path, 'utf8'), sourcePath, globalPrefix);
  });
  routes.sort((left, right) => {
    const leftKey = `${left.path}\0${left.method}\0${left.controller}`;
    const rightKey = `${right.path}\0${right.method}\0${right.controller}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return {
    schemaVersion: 1,
    generatedFrom: 'apps/api/src/main.ts + apps/api/src/**/*.controller.ts',
    globalPrefix: `/${globalPrefix}`,
    routeCount: routes.length,
    routes,
  };
}

function main() {
  const mode = process.argv[2] ?? '--check';
  if (!['--check', '--write'].includes(mode)) {
    throw new Error('Usage: node scripts/generate-api-inventory.mjs [--check|--write]');
  }
  const inventory = buildInventory();
  const serialized = `${JSON.stringify(inventory, null, 2)}\n`;
  if (mode === '--write') {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, 'utf8');
    process.stdout.write(
      `Wrote ${relative(repositoryRoot, outputPath)} (${inventory.routeCount} routes)\n`,
    );
    return;
  }
  if (!existsSync(outputPath)) throw new Error('API inventory is missing; run with --write');
  if (readFileSync(outputPath, 'utf8') !== serialized) {
    throw new Error('API inventory is stale; run node scripts/generate-api-inventory.mjs --write');
  }
  process.stdout.write(`API inventory is current (${inventory.routeCount} routes)\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
