import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const integrationsRequire = createRequire(
  path.join(root, 'packages', 'integrations', 'package.json'),
);
const minioRoot = path.dirname(integrationsRequire.resolve('minio/package.json'));

async function notificationModules() {
  const commonJs = integrationsRequire(path.join(minioRoot, 'dist', 'main', 'notification.js'));
  const esm = await import(
    pathToFileURL(path.join(minioRoot, 'dist', 'esm', 'notification.mjs')).href
  );
  return [commonJs, esm];
}

function collectNotifications(NotificationPoller, chunks, expectedCount) {
  return new Promise((resolve, reject) => {
    const response = Readable.from(chunks);
    const poller = new NotificationPoller(
      {
        region: 'us-east-1',
        makeRequestAsync: async () => response,
      },
      'synthetic-bucket',
      '',
      '',
      [],
    );
    const notifications = [];
    poller.on('error', (error) => {
      poller.stop();
      reject(error);
    });
    poller.on('notification', (notification) => {
      notifications.push(notification);
      if (notifications.length === expectedCount) {
        poller.stop();
        resolve(notifications);
      }
    });
    poller.start();
  });
}

test('MinIO resolves only the fixed stream-json release through the frozen compatibility patch', () => {
  const packageJson = JSON.parse(read('package.json'));
  const lockfile = read('pnpm-lock.yaml');
  const patchFile = read('patches', 'minio@8.0.7.patch');

  assert.equal(packageJson.pnpm?.overrides?.['stream-json'], '3.5.0');
  assert.equal(packageJson.pnpm?.patchedDependencies?.['minio@8.0.7'], 'patches/minio@8.0.7.patch');
  assert.match(lockfile, /^  stream-json: 3\.5\.0$/m);
  assert.match(lockfile, /^  stream-json@3\.5\.0:$/m);
  assert.match(lockfile, /minio@8\.0\.7\(patch_hash=[a-z0-9]+\):[\s\S]*?stream-json: 3\.5\.0/);
  assert.doesNotMatch(lockfile, /stream-json@1\./);
  assert.doesNotMatch(lockfile, /stream-json: 1\./);
  assert.match(patchFile, /^-import jsonLineParser from 'stream-json\/jsonl\/Parser\.js';$/m);
  assert.match(patchFile, /^\+import \{ Transform \} from 'node:stream';$/m);
  assert.match(patchFile, /MAX_NOTIFICATION_LINE_BYTES = 1024 \* 1024/);
  for (const builtNotification of [
    path.join(minioRoot, 'dist', 'main', 'notification.js'),
    path.join(minioRoot, 'dist', 'esm', 'notification.mjs'),
  ]) {
    const installed = fs.readFileSync(builtNotification, 'utf8');
    assert.doesNotMatch(installed, /stream-json/);
    assert.match(installed, /MAX_NOTIFICATION_LINE_BYTES = 1024 \* 1024/);
  }
});

test('patched MinIO CommonJS and ESM package entrypoints load', async () => {
  assert.equal(typeof integrationsRequire('minio').Client, 'function');
  const esm = await import(pathToFileURL(path.join(minioRoot, 'dist', 'esm', 'minio.mjs')).href);
  assert.equal(typeof esm.Client, 'function');
});

test('patched MinIO CommonJS and ESM builds parse fragmented UTF-8 JSON lines identically', async () => {
  const first = Buffer.from('{"Records":[{"key":"café"}]}\n');
  const second = Buffer.from('{"Records":[{"key":"final"}]}');
  const split = first.indexOf(Buffer.from('é')) + 1;
  assert.ok(split > 0 && split < first.length);

  for (const { NotificationPoller } of await notificationModules()) {
    const notifications = await collectNotifications(
      NotificationPoller,
      [first.subarray(0, split), first.subarray(split), second],
      2,
    );
    assert.deepEqual(notifications, [{ key: 'café' }, { key: 'final' }]);
  }
});

test('patched MinIO rejects oversized terminated and unterminated notification lines', async () => {
  const [{ NotificationPoller }] = await notificationModules();
  for (const terminator of [Buffer.alloc(0), Buffer.from('\n')]) {
    const response = Readable.from([
      Buffer.concat([Buffer.alloc(1024 * 1024 + 1, 0x61), terminator]),
    ]);
    const poller = new NotificationPoller(
      {
        region: 'us-east-1',
        makeRequestAsync: async () => response,
      },
      'synthetic-bucket',
      '',
      '',
      [],
    );

    const error = await new Promise((resolve) => {
      poller.on('error', (candidate) => {
        poller.stop();
        resolve(candidate);
      });
      poller.start();
    });
    assert.match(String(error), /exceeds the maximum size/);
  }
});
