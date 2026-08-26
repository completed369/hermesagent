import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('the checked-in Prisma client uses the pinned JavaScript engine adapter', () => {
  const schema = read('packages', 'database', 'prisma', 'schema.prisma');
  const packageJson = JSON.parse(read('packages', 'database', 'package.json'));
  const client = read('packages', 'database', 'src', 'client.ts');
  const lockfile = read('pnpm-lock.yaml');

  assert.match(
    schema,
    /generator client \{\s+provider\s*=\s*"prisma-client-js"\s+engineType\s*=\s*"client"\s+\}/,
  );
  assert.equal(packageJson.dependencies['@prisma/adapter-pg'], '6.19.3');
  assert.equal(packageJson.dependencies['@prisma/client'], '6.19.3');
  assert.equal(packageJson.dependencies.prisma, '6.19.3');
  assert.equal(packageJson.dependencies.pg, '8.22.0');
  assert.match(client, /import \{ PrismaPg \} from '@prisma\/adapter-pg';/);
  assert.match(client, /adapter: new PrismaPg\(\{ connectionString \}\)/);
  assert.match(lockfile, /'@prisma\/adapter-pg':\s+specifier: 6\.19\.3\s+version: 6\.19\.3/);
  assert.match(lockfile, /'@prisma\/adapter-pg@6\.19\.3':/);
});
