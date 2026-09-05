import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('all AJV paths resolve the patched fast-uri release', () => {
  const packageJson = JSON.parse(read('package.json'));
  const lockfile = read('pnpm-lock.yaml');

  assert.equal(packageJson.pnpm?.overrides?.['fast-uri'], '3.1.6');
  assert.match(lockfile, /^  fast-uri: 3\.1\.6$/m);
  assert.match(lockfile, /^  fast-uri@3\.1\.6:$/m);
  assert.match(
    lockfile,
    /ajv@8\.18\.0:\s+dependencies:\s+fast-deep-equal: 3\.1\.3\s+fast-uri: 3\.1\.6/,
  );
  assert.match(
    lockfile,
    /ajv@8\.20\.0:\s+dependencies:\s+fast-deep-equal: 3\.1\.3\s+fast-uri: 3\.1\.6/,
  );
  assert.doesNotMatch(lockfile, /fast-uri@3\.1\.5/);
  assert.doesNotMatch(lockfile, /fast-uri: 3\.1\.5/);
});
