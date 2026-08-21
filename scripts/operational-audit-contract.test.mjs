import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const migration = readFileSync(
  resolve(
    'packages/database/prisma/migrations/20260821113000_operational_audit_spine/migration.sql',
  ),
  'utf8',
);

test('operational audit replay keys retain workspace scope after relational erasure', () => {
  assert.match(
    migration,
    /UNIQUE INDEX "audit_events_workspaceReference_source_sourceEventId_key"[\s\S]*?\("workspaceReference", "source", "sourceEventId"\)/,
  );
  assert.match(
    migration,
    /UNIQUE INDEX "audit_events_workspaceReference_source_idempotencyKey_key"[\s\S]*?\("workspaceReference", "source", "idempotencyKey"\)/,
  );
});

test('audit content updates fail closed while identity relations may be cleared for erasure', () => {
  assert.match(migration, /BEFORE UPDATE ON "audit_events"/);
  assert.match(migration, /RAISE EXCEPTION 'audit event content is immutable'/);
  assert.match(migration, /OLD\."workspaceId" IS NOT NULL AND NEW\."workspaceId" IS NULL/);
  assert.match(migration, /OLD\."actorId" IS NOT NULL AND NEW\."actorId" IS NULL/);
  assert.doesNotMatch(migration, /BEFORE DELETE ON "audit_events"/);
});

test('legacy audit checksums are preserved while current provenance is retained', () => {
  assert.match(migration, /"integrityVersion" INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /"workspaceReference" = "workspaceId"::text/);
  assert.match(migration, /"actorReference" = "actorId"::text/);
  assert.match(migration, /Existing checksums remain integrityVersion 1 and are not rewritten/);
});
