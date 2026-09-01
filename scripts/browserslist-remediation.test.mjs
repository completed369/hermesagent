import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('all workspace images resolve the fixed browserslist release', () => {
  const packageJson = JSON.parse(read('package.json'));
  const lockfile = read('pnpm-lock.yaml');

  assert.equal(packageJson.pnpm?.overrides?.browserslist, '4.28.7');
  assert.match(lockfile, /^  browserslist: 4\.28\.7$/m);
  assert.match(lockfile, /^  browserslist@4\.28\.7:$/m);
  assert.match(lockfile, /update-browserslist-db@1\.2\.3\(browserslist@4\.28\.7\)/);
  assert.doesNotMatch(lockfile, /browserslist@4\.28\.6/);
  assert.doesNotMatch(lockfile, /browserslist: 4\.28\.6/);
});
