import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  controllerFiles,
  parseControllerSource,
  readGlobalPrefix,
} from './generate-api-inventory.mjs';

test('committed API inventory matches every controller route', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-api-inventory.mjs', '--check'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('API inventory is deterministic and contains unique normalized routes', () => {
  const inventory = JSON.parse(readFileSync('docs/api/API_INVENTORY.json', 'utf8'));
  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.routeCount, inventory.routes.length);
  assert.ok(inventory.routeCount > 0);
  const identities = inventory.routes.map((route) => `${route.method} ${route.path}`);
  assert.equal(new Set(identities).size, identities.length);
  for (const route of inventory.routes) {
    assert.match(route.method, /^(ALL|DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT)$/u);
    assert.match(route.path, /^\/api(?:\/[^/]+)*$/u);
    assert.match(route.controller, /^[A-Za-z][A-Za-z0-9]*Controller$/u);
    assert.match(route.source, /^apps\/api\/src\/modules\/.+\.controller\.ts$/u);
  }
});

test('aliased and namespace Nest decorators cannot bypass route inventory', () => {
  const aliased = parseControllerSource(
    `import { Controller as Scope, Get as Read, Head, Options, All, Sse } from '@nestjs/common';
     @Scope('alias') export class AliasController {
       @Read('read') read() {}
       @Head('head') head() {}
       @Options('options') options() {}
       @All('all') all() {}
       @Sse('events') events() {}
     }`,
    'alias.controller.ts',
    'api',
  );
  assert.deepEqual(
    aliased.map(({ method, path }) => ({ method, path })),
    [
      { method: 'GET', path: '/api/alias/read' },
      { method: 'HEAD', path: '/api/alias/head' },
      { method: 'OPTIONS', path: '/api/alias/options' },
      { method: 'ALL', path: '/api/alias/all' },
      { method: 'GET', path: '/api/alias/events' },
    ],
  );
  const namespaced = parseControllerSource(
    `import * as Nest from '@nestjs/common';
     @Nest.Controller('scope') export class NamespaceController { @Nest.Post('work') work() {} }`,
    'namespace.controller.ts',
    'api',
  );
  assert.equal(namespaced[0]?.method, 'POST');
});

test('custom aliases and unsupported mapping decorators fail closed', () => {
  assert.throws(
    () =>
      parseControllerSource(
        `import { Controller, Get } from '@nestjs/common';
         const Read = Get;
         @Controller('scope') export class CustomController { @Read('x') read() {} }`,
        'custom.controller.ts',
        'api',
      ),
    /exactly one direct supported Nest route decorator/u,
  );
  assert.throws(
    () =>
      parseControllerSource(
        `import { Controller, RequestMapping } from '@nestjs/common';
         @Controller('scope') export class MappingController { @RequestMapping({ path: 'x' }) read() {} }`,
        'mapping.controller.ts',
        'api',
      ),
    /Unsupported Nest route decorator/u,
  );
  for (const unsupported of [
    'Search',
    'QueryMethod',
    'Propfind',
    'Proppatch',
    'Mkcol',
    'Copy',
    'Move',
    'Lock',
    'Unlock',
  ]) {
    assert.throws(
      () =>
        parseControllerSource(
          `import { Controller, Get, ${unsupported} } from '@nestjs/common';
           @Controller('scope') export class UnsupportedController {
             @Get('x') @${unsupported}('x') read() {}
           }`,
          'unsupported.controller.ts',
          'api',
        ),
      /Unsupported Nest route decorator/u,
    );
  }
});

test('global API prefix is structurally derived and must be one literal', () => {
  const create = `import { NestFactory } from '@nestjs/core';
    const app = await NestFactory.create(AppModule);`;
  assert.equal(readGlobalPrefix(`${create} app.setGlobalPrefix('api')`), 'api');
  assert.throws(
    () => readGlobalPrefix(`${create} app.setGlobalPrefix(process.env.PREFIX)`),
    /string literal/u,
  );
  assert.throws(
    () =>
      readGlobalPrefix(
        `${create} const decoy = { setGlobalPrefix() {} }; decoy.setGlobalPrefix('api')`,
      ),
    /was not found/u,
  );
  assert.throws(
    () =>
      readGlobalPrefix(
        `${create} { const app = { setGlobalPrefix() {} }; app.setGlobalPrefix('api'); }`,
      ),
    /was not found/u,
  );
  assert.throws(
    () => readGlobalPrefix(`const app = { setGlobalPrefix() {} }; app.setGlobalPrefix('api')`),
    /uniquely identifiable Nest application/u,
  );
});

test('controller discovery covers the complete API source tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'ventureos-api-inventory-'));
  try {
    mkdirSync(join(root, 'modules', 'inside'), { recursive: true });
    writeFileSync(join(root, 'modules', 'inside', 'inside.controller.ts'), '', 'utf8');
    writeFileSync(join(root, 'outside.controller.ts'), '', 'utf8');
    writeFileSync(join(root, 'ignored.ts'), '', 'utf8');
    assert.deepEqual(
      controllerFiles(root).map((path) => path.slice(root.length + 1).replaceAll('\\', '/')),
      ['modules/inside/inside.controller.ts', 'outside.controller.ts'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
