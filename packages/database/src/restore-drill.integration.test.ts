import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  completeDisposablePostgresRestoreDrill,
  createMigrationCompatibilityEvidence,
} from './restore-drill.js';

const databaseUrl = process.env.DATABASE_URL;
const runIntegration = process.env.CI === 'true' && typeof databaseUrl === 'string';

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 }).trim();
}

describe.skipIf(!runIntegration)('real disposable PostgreSQL dump/restore evidence', () => {
  it('dumps the disposable CI database, restores a fresh database, verifies content, and removes it', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const target = `ventureos_restore_drill_${suffix}`;
    const sentinelTable = `restore_drill_sentinel_${suffix}`;
    const sentinelDigest = 'd'.repeat(64);
    const backupReference = `ci-pgdump-${suffix}`;
    const dumpPath = `/tmp/${backupReference}.dump`;
    const containerIds = docker('ps', '--filter', 'publish=5432', '--format', '{{.ID}}')
      .split(/\r?\n/u)
      .filter(Boolean);
    expect(containerIds).toHaveLength(1);
    const containerId = containerIds[0]!;
    expect(containerId).toMatch(/^[0-9a-f]{12,64}$/u);
    const admin = new Pool({ connectionString: databaseUrl });
    let targetPool: Pool | undefined;
    let targetCreated = false;
    const backupCreatedAt = new Date();
    try {
      await admin.query(`CREATE TABLE "${sentinelTable}" (digest text NOT NULL)`);
      await admin.query(`INSERT INTO "${sentinelTable}" (digest) VALUES ($1)`, [sentinelDigest]);
      const migration = await admin.query<{ migration_name: string }>(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1',
      );
      const expectedMigrationHead = migration.rows[0]!.migration_name;
      docker(
        'exec',
        containerId,
        'pg_dump',
        '-U',
        'ventureos',
        '-d',
        'ventureos',
        '--format=custom',
        `--file=${dumpPath}`,
      );
      const checksum = docker('exec', containerId, 'sha256sum', dumpPath).split(/\s+/u)[0]!;
      expect(checksum).toMatch(/^[0-9a-f]{64}$/u);
      await admin.query(`CREATE DATABASE "${target}"`);
      targetCreated = true;
      const startedAt = new Date();
      docker(
        'exec',
        containerId,
        'pg_restore',
        '-U',
        'ventureos',
        '-d',
        target,
        '--no-owner',
        dumpPath,
      );
      const targetUrl = new URL(databaseUrl!);
      targetUrl.pathname = `/${target}`;
      targetUrl.search = '';
      targetPool = new Pool({ connectionString: targetUrl.toString(), max: 1 });
      const restoredSentinel = await targetPool.query<{ digest: string }>(
        `SELECT digest FROM "${sentinelTable}"`,
      );
      const restoredMigration = await targetPool.query<{ migration_name: string }>(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1',
      );
      expect((await targetPool.query<{ ready: number }>('SELECT 1 AS ready')).rows[0]?.ready).toBe(
        1,
      );
      const completedAt = new Date();
      await targetPool.end();
      targetPool = undefined;
      await admin.query(`DROP DATABASE "${target}" WITH (FORCE)`);
      targetCreated = false;
      const migrationDecision = createMigrationCompatibilityEvidence({
        decision: 'RESTORE_REQUIRED',
        currentMigrationHead: expectedMigrationHead,
        priorMigrationHead: expectedMigrationHead,
        decidedAt: backupCreatedAt.toISOString(),
      });
      const evidence = completeDisposablePostgresRestoreDrill(
        {
          schemaVersion: 1,
          drillId: `postgres-${suffix}`,
          targetDatabaseReference: target,
          backup: {
            reference: backupReference,
            checksum,
            createdAt: backupCreatedAt.toISOString(),
          },
          expectedMigrationHead,
          expectedSentinelDigest: sentinelDigest,
          maximumBackupAgeSeconds: 60,
          recoveryPointObjectiveSeconds: 60,
          recoveryTimeObjectiveSeconds: 30,
          migrationDecision,
        },
        {
          schemaVersion: 1,
          drillId: `postgres-${suffix}`,
          targetDatabaseReference: target,
          backupReference,
          backupChecksum: checksum,
          backupCreatedAt: backupCreatedAt.toISOString(),
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          restoredMigrationHead: restoredMigration.rows[0]!.migration_name,
          restoredSentinelDigest: restoredSentinel.rows[0]!.digest,
          healthVerified: true,
          cleanupVerified: true,
        },
      );
      expect(evidence.evidenceHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(
        (
          await admin.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM pg_database WHERE datname = $1',
            [target],
          )
        ).rows[0]?.count,
      ).toBe('0');
    } finally {
      await targetPool?.end().catch(() => undefined);
      if (targetCreated)
        await admin
          .query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`)
          .catch(() => undefined);
      await admin.query(`DROP TABLE IF EXISTS "${sentinelTable}"`).catch(() => undefined);
      docker('exec', containerId, 'rm', '-f', dumpPath);
      await admin.end();
    }
  });
});
