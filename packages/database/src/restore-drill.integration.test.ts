import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  runDisposablePostgresRestoreDrill,
  type DisposablePostgresRestoreDrillPort,
} from './restore-drill.js';

const databaseUrl = process.env.DATABASE_URL;
const runIntegration = process.env.CI === 'true' && typeof databaseUrl === 'string';

function targetUrl(reference: string): string {
  const url = new URL(databaseUrl!);
  url.pathname = `/${reference}`;
  url.search = '';
  return url.toString();
}

describe.skipIf(!runIntegration)('disposable PostgreSQL restore drill integration', () => {
  it('restores and verifies a synthetic snapshot in a fresh database, then destroys it', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const target = `ventureos_restore_drill_${suffix}`;
    const sentinel = 'd'.repeat(64);
    const migrationHead = 'synthetic_migration_head_1';
    const admin = new Pool({ connectionString: databaseUrl });
    let restored: Pool | undefined;
    const port: DisposablePostgresRestoreDrillPort = {
      async createDisposableTarget(reference) {
        await admin.query(`CREATE DATABASE "${reference}"`);
      },
      async restoreBackup(reference) {
        restored = new Pool({ connectionString: targetUrl(reference), max: 1 });
        await restored.query(
          'CREATE TABLE restore_drill_evidence (migration_head text NOT NULL, sentinel_digest text NOT NULL)',
        );
        await restored.query(
          'INSERT INTO restore_drill_evidence (migration_head, sentinel_digest) VALUES ($1, $2)',
          [migrationHead, sentinel],
        );
      },
      async readMigrationHead() {
        const result = await restored!.query<{ migration_head: string }>(
          'SELECT migration_head FROM restore_drill_evidence',
        );
        return result.rows[0]!.migration_head;
      },
      async readSentinelDigest() {
        const result = await restored!.query<{ sentinel_digest: string }>(
          'SELECT sentinel_digest FROM restore_drill_evidence',
        );
        return result.rows[0]!.sentinel_digest;
      },
      async verifyHealth() {
        return (await restored!.query<{ ready: number }>('SELECT 1 AS ready')).rows[0]?.ready === 1;
      },
      async destroyDisposableTarget(reference) {
        await restored?.end();
        restored = undefined;
        await admin.query(`DROP DATABASE "${reference}" WITH (FORCE)`);
      },
    };
    const started = new Date();
    try {
      const evidence = await runDisposablePostgresRestoreDrill(
        {
          schemaVersion: 1,
          drillId: `postgres-${suffix}`,
          targetDatabaseReference: target,
          backup: {
            reference: `synthetic-snapshot-${suffix}`,
            checksum: 'e'.repeat(64),
            createdAt: new Date(started.getTime() - 10_000).toISOString(),
          },
          expectedMigrationHead: migrationHead,
          expectedSentinelDigest: sentinel,
          maximumBackupAgeSeconds: 60,
          recoveryPointObjectiveSeconds: 60,
          recoveryTimeObjectiveSeconds: 10,
          migrationCompatibilityDecision: 'RESTORE_REQUIRED',
          migrationDecisionEvidenceHash: 'f'.repeat(64),
        },
        port,
      );
      expect(evidence).toMatchObject({
        targetDatabaseReference: target,
        cleanupVerified: true,
        healthVerified: true,
        restoredMigrationHead: migrationHead,
        restoredSentinelDigest: sentinel,
      });
      const remaining = await admin.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM pg_database WHERE datname = $1',
        [target],
      );
      expect(remaining.rows[0]?.count).toBe('0');
    } finally {
      await restored?.end().catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`).catch(() => undefined);
      await admin.end();
    }
  });
});
