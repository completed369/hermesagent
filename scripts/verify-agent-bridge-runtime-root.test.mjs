import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  classifyAgentBridgeRuntimeEntry,
  verifyAgentBridgeRuntimeManifest,
} from './verify-agent-bridge-runtime-root.mjs';

const packagePrefix =
  'app/node_modules/.pnpm/@ventureos+agent-bridge@file+packages+agent-bridge/node_modules/@ventureos/agent-bridge';
const testSigningFingerprint = 'MC4CAQAwBQYDK2VwBCIEIDXgLTsIlYz/jfY7Or5Ylt4TinBgk8MUM5C+13sON7Uo';

test('allows only package metadata and non-test dist files in the real package', () => {
  for (const [type, path] of [
    ['d', packagePrefix],
    ['d', `${packagePrefix}/dist`],
    ['f', `${packagePrefix}/package.json`],
    ['f', `${packagePrefix}/dist/index.js`],
  ])
    assert.equal(classifyAgentBridgeRuntimeEntry({ type, path }), null);
});

test('enforces the same boundary when the package begins at the manifest root', () => {
  for (const [type, path, expected] of [
    ['d', 'node_modules/@ventureos/agent-bridge', null],
    ['f', 'node_modules/@ventureos/agent-bridge/package.json', null],
    ['f', 'node_modules/@ventureos/agent-bridge/src/index.ts', 'PACKAGE_DRIFT'],
    ['f', 'node_modules/@ventureos/agent-bridge/__tests__/fixture.js', 'PACKAGE_DRIFT'],
    ['f', 'node_modules/@ventureos/agent-bridge/dist/reader.test.js', 'PACKAGE_DRIFT'],
    ['f', 'node_modules/@ventureos/agent-bridge/dist/reader.spec.js', 'PACKAGE_DRIFT'],
  ])
    assert.equal(classifyAgentBridgeRuntimeEntry({ type, path }), expected);
});

test('rejects source, tests, special entries, and unreviewed directories in the package', () => {
  for (const [type, path] of [
    ['f', `${packagePrefix}/src/index.ts`],
    ['f', `${packagePrefix}/__tests__/fixture.js`],
    ['f', `${packagePrefix}/dist/reader.test.js`],
    ['f', `${packagePrefix}/dist/reader.spec.cjs`],
    ['f', `${packagePrefix}/dist/reader.test.mjs`],
    ['f', `${packagePrefix}/dist/reader.spec.d.ts`],
    ['f', `${packagePrefix}/dist/reader.spec.js.map`],
    ['l', `${packagePrefix}/dist/linked.js`],
    ['p', `${packagePrefix}/dist/channel`],
    ['d', `${packagePrefix}/src`],
  ])
    assert.notEqual(classifyAgentBridgeRuntimeEntry({ type, path }), null);
});

test('allows unrelated dependency tests but denies malformed and traversal records', () => {
  assert.equal(
    classifyAgentBridgeRuntimeEntry({
      type: 'f',
      path: 'app/node_modules/dependency/__tests__/dependency.test.js',
    }),
    null,
  );
  assert.equal(
    classifyAgentBridgeRuntimeEntry({
      type: 'f',
      path: 'app/node_modules/@ventureos/agent-bridge-evil/src/index.js',
    }),
    null,
  );
  for (const path of [
    '/absolute/path',
    '../escape',
    'app/../escape',
    'app\\node_modules\\escape',
    `app/node_modules/dependency/new\nline`,
  ])
    assert.equal(classifyAgentBridgeRuntimeEntry({ type: 'f', path }), 'MALFORMED_ENTRY');
});

test('rejects native supervisor test helpers anywhere in a final image', () => {
  for (const path of [
    'packages/agent-bridge/test/native/native-supervisor-helper.c',
    'app/native-supervisor-helper',
    'app/native-supervisor-addon.node',
    'workspace/packages/agent-bridge/test/native/renamed-helper.bin',
    `${packagePrefix}/dist/native-runtime-fixture.js`,
  ])
    assert.equal(classifyAgentBridgeRuntimeEntry({ type: 'f', path }), 'NATIVE_TEST_FIXTURE');
});

test(
  'accepts the root-excluding NUL manifest emitted by real GNU find',
  { skip: process.platform !== 'linux' },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'ventureos-image-manifest-'));
    try {
      const directory = join(root, 'app', 'node_modules', 'dependency', '__tests__');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'dependency.test.js'), 'fixture');
      const manifest = execFileSync('/usr/bin/find', [
        root,
        '-mindepth',
        '1',
        '-printf',
        '%y\\0%P\\0%l\\0',
      ]);
      assert.equal(verifyAgentBridgeRuntimeManifest(manifest), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'byte-safe fingerprint matching denies binary content and preserves fixed statuses',
  { skip: process.platform !== 'linux' },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'ventureos-fingerprint-'));
    try {
      const denied = join(root, 'denied.bin');
      const clean = join(root, 'clean.bin');
      writeFileSync(
        denied,
        Buffer.concat([Buffer.from([0, 1]), Buffer.from(testSigningFingerprint)]),
      );
      writeFileSync(clean, Buffer.from([0, 1, 2, 3]));
      assert.equal(spawnSync('/usr/bin/grep', ['-aFq', testSigningFingerprint, denied]).status, 0);
      assert.equal(spawnSync('/usr/bin/grep', ['-aFq', testSigningFingerprint, clean]).status, 1);
      assert.equal(
        spawnSync('/usr/bin/grep', ['-aFq', testSigningFingerprint, join(root, 'missing')]).status,
        2,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('allows only the expected relative pnpm package-root symlink', () => {
  const direct = 'app/node_modules/@ventureos/agent-bridge';
  assert.equal(
    classifyAgentBridgeRuntimeEntry({
      type: 'l',
      path: direct,
      linkTarget:
        '../.pnpm/@ventureos+agent-bridge@file+packages+agent-bridge/node_modules/@ventureos/agent-bridge',
    }),
    null,
  );
  for (const linkTarget of [
    '/tmp/agent-bridge',
    '../../../outside',
    '../dependency',
    '../.pnpm/forged/node_modules/@ventureos/agent-bridge/extra',
    '../../../other/node_modules/.pnpm/@ventureos+agent-bridge@forged/node_modules/@ventureos/agent-bridge',
  ])
    assert.notEqual(classifyAgentBridgeRuntimeEntry({ type: 'l', path: direct, linkTarget }), null);
});

test('confines a manifest-root package symlink to its exact pnpm target', () => {
  const direct = 'node_modules/@ventureos/agent-bridge';
  assert.equal(
    classifyAgentBridgeRuntimeEntry({
      type: 'l',
      path: direct,
      linkTarget:
        '../.pnpm/@ventureos+agent-bridge@file+packages+agent-bridge/node_modules/@ventureos/agent-bridge',
    }),
    null,
  );
  assert.notEqual(
    classifyAgentBridgeRuntimeEntry({ type: 'l', path: direct, linkTarget: '../../outside' }),
    null,
  );
});

test('requires the exact pnpm package-link target to exist as a real directory entry', () => {
  const direct = 'app/node_modules/@ventureos/agent-bridge';
  const target =
    'app/node_modules/.pnpm/@ventureos+agent-bridge@file+packages+agent-bridge/node_modules/@ventureos/agent-bridge';
  const linkTarget =
    '../.pnpm/@ventureos+agent-bridge@file+packages+agent-bridge/node_modules/@ventureos/agent-bridge';
  const manifest = (...records) => Buffer.from([...records.flat(), ''].join('\0'));
  assert.equal(
    verifyAgentBridgeRuntimeManifest(manifest(['d', target, ''], ['l', direct, linkTarget])),
    null,
  );
  assert.equal(
    verifyAgentBridgeRuntimeManifest(manifest(['l', direct, linkTarget])),
    'UNSAFE_PACKAGE_ROOT',
  );

  const rootDirect = 'node_modules/@ventureos/agent-bridge';
  const rootTarget =
    'node_modules/.pnpm/@ventureos+agent-bridge@file+packages+agent-bridge/node_modules/@ventureos/agent-bridge';
  assert.equal(
    verifyAgentBridgeRuntimeManifest(
      manifest(['d', rootTarget, ''], ['l', rootDirect, linkTarget]),
    ),
    null,
  );
  assert.equal(
    verifyAgentBridgeRuntimeManifest(manifest(['l', rootDirect, linkTarget])),
    'UNSAFE_PACKAGE_ROOT',
  );
  assert.equal(
    verifyAgentBridgeRuntimeManifest(
      manifest(['f', rootTarget, ''], ['l', rootDirect, linkTarget]),
    ),
    'UNSAFE_PACKAGE_ROOT',
  );
  assert.equal(
    verifyAgentBridgeRuntimeManifest(
      manifest(['l', rootTarget, '../forged'], ['l', rootDirect, linkTarget]),
    ),
    'UNSAFE_PACKAGE_ROOT',
  );

  const hoistedDirect = 'app/node_modules/.pnpm/node_modules/@ventureos/agent-bridge';
  const hoistedTarget =
    'app/node_modules/.pnpm/@ventureos+agent-bridge@file+packages+agent-bridge/node_modules/@ventureos/agent-bridge';
  const hoistedLinkTarget =
    '../../@ventureos+agent-bridge@file+packages+agent-bridge/node_modules/@ventureos/agent-bridge';
  assert.equal(
    verifyAgentBridgeRuntimeManifest(
      manifest(['d', hoistedTarget, ''], ['l', hoistedDirect, hoistedLinkTarget]),
    ),
    null,
  );
  assert.equal(
    verifyAgentBridgeRuntimeManifest(manifest(['l', hoistedDirect, hoistedLinkTarget])),
    'UNSAFE_PACKAGE_ROOT',
  );
});

test('parses bounded NUL-delimited type, relative-path, and link-target records', () => {
  const input = Buffer.from(
    [
      'f',
      `${packagePrefix}/package.json`,
      '',
      'f',
      'app/node_modules/dependency/test.js',
      '',
      '',
    ].join('\0'),
  );
  assert.equal(verifyAgentBridgeRuntimeManifest(input), null);
  assert.equal(
    verifyAgentBridgeRuntimeManifest(Buffer.from('f\0missing-terminator')),
    'MALFORMED_MANIFEST',
  );
});

test('rejects test signing material in manifest path and link metadata', () => {
  const manifest = (...records) => Buffer.from([...records.flat(), ''].join('\0'));
  assert.equal(
    verifyAgentBridgeRuntimeManifest(manifest(['f', `app/${testSigningFingerprint}/fixture`, ''])),
    'TEST_SIGNING_MATERIAL',
  );
  assert.equal(
    verifyAgentBridgeRuntimeManifest(
      manifest(['l', 'app/runtime-link', `../${testSigningFingerprint}`]),
    ),
    'TEST_SIGNING_MATERIAL',
  );
});
