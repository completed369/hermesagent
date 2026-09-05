import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('all runtime query-string parser paths resolve the patched qs release', () => {
  const packageJson = JSON.parse(read('package.json'));
  const lockfile = read('pnpm-lock.yaml');

  assert.equal(packageJson.pnpm?.overrides?.qs, '6.16.0');
  assert.match(lockfile, /^  qs: 6\.16\.0$/m);
  assert.match(lockfile, /^  qs@6\.16\.0:$/m);
  assert.match(lockfile, /body-parser@2\.3\.0:[\s\S]*?qs: 6\.16\.0/);
  assert.match(lockfile, /express@5\.2\.1:[\s\S]*?qs: 6\.16\.0/);
  assert.match(lockfile, /superagent@10\.3\.0:[\s\S]*?qs: 6\.16\.0/);
  assert.doesNotMatch(lockfile, /qs@6\.15\.3/);
  assert.doesNotMatch(lockfile, /qs: 6\.15\.3/);
});
