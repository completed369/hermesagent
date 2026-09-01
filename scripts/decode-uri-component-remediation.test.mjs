import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('the MinIO query-string path resolves the patched decode-uri-component release', () => {
  const packageJson = JSON.parse(read('package.json'));
  const lockfile = read('pnpm-lock.yaml');

  assert.equal(packageJson.pnpm?.overrides?.['decode-uri-component'], '0.5.0');
  assert.match(lockfile, /^  decode-uri-component: 0\.5\.0$/m);
  assert.match(lockfile, /^  decode-uri-component@0\.5\.0:$/m);
  assert.match(lockfile, /query-string@7\.1\.3:\s+dependencies:\s+decode-uri-component: 0\.5\.0/);
  assert.doesNotMatch(lockfile, /decode-uri-component@0\.2\.2/);
  assert.doesNotMatch(lockfile, /decode-uri-component: 0\.2\.2/);
});
