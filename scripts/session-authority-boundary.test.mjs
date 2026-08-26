import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const guard = readFileSync(
  new URL('../apps/api/src/common/guards/session-auth.guard.ts', import.meta.url),
  'utf8',
);

test('session authority is one exact database-clock-bound projection', () => {
  assert.equal((guard.match(/prisma\.\$queryRaw/gu) ?? []).length, 1);
  assert.match(guard, /s\."tokenDigest" = \$\{hashSessionToken\(token\)\}/u);
  assert.match(guard, /s\."revokedAt" IS NULL/u);
  assert.match(guard, /s\."expiresAt" > \(clock_timestamp\(\) AT TIME ZONE 'UTC'\)/u);
  assert.match(guard, /wm\."workspaceId" = s\."activeWorkspaceId"/u);
  assert.match(guard, /w\."deletedAt" IS NULL/u);
  assert.match(guard, /u\."deletedAt" IS NULL/u);
  assert.match(guard, /LIMIT \$\{MAX_SESSION_PERMISSIONS \+ 1\}/u);
});

test('malformed cookie values are denied before hashing or database access', () => {
  assert.match(guard, /const SESSION_TOKEN = \/\^\[a-f0-9\]\{64\}\$\/u/u);
  const validation = guard.indexOf("typeof token !== 'string' || !SESSION_TOKEN.test(token)");
  const hashing = guard.lastIndexOf('hashSessionToken(token)');
  const query = guard.indexOf('prisma.$queryRaw');
  assert.ok(validation >= 0 && validation < query && query < hashing);
});

test('session authority cannot hydrate every membership or use the application clock', () => {
  assert.doesNotMatch(guard, /\bmemberships\b/u);
  assert.doesNotMatch(guard, /\binclude\s*:/u);
  assert.doesNotMatch(guard, /isSessionExpired|Date\.now|new Date/u);
});

test('projected permissions are bounded, validated, deduplicated, and sorted by the database', () => {
  assert.match(guard, /const MAX_SESSION_PERMISSIONS = 128/u);
  assert.match(guard, /ORDER BY p\."key"/u);
  assert.match(guard, /permissions\.length > MAX_SESSION_PERMISSIONS/u);
  assert.match(guard, /SAFE_PERMISSION_KEY\.test\(permission\)/u);
  assert.match(guard, /new Set\(permissions\)\.size !== permissions\.length/u);
});
