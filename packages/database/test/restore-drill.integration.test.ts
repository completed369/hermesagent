import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  completeDisposablePostgresRestoreDrill,
  createMigrationCompatibilityEvidence,
} from '../src/restore-drill.js';

const POSTGRES_IMAGE =
  'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const FIXTURE_LABEL = 'ventureos.fixture.owner=github-ci-restore-drill';
const FIXTURE_DATABASE_URL =
  'postgresql://ventureos:ci-only-password@localhost:5432/ventureos?schema=public';
const onOwnedGitHubRunner =
  process.env.CI === 'true' &&
  process.env.GITHUB_ACTIONS === 'true' &&
  process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
  process.env.GITHUB_REPOSITORY === 'completed369/hermesagent';

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 }).trim();
}

function resolveOwnedFixture(
  environment: NodeJS.ProcessEnv,
  dockerCommand: (...args: string[]) => string,
): { databaseUrl: string; containerId: string } {
  if (
    environment.CI !== 'true' ||
    environment.GITHUB_ACTIONS !== 'true' ||
    environment.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    environment.GITHUB_REPOSITORY !== 'completed369/hermesagent' ||
    environment.DATABASE_URL !== FIXTURE_DATABASE_URL
  )
    throw new Error('UNTRUSTED_RESTORE_FIXTURE');
  let parsed: URL;
  try {
    parsed = new URL(environment.DATABASE_URL);
  } catch {
    throw new Error('UNTRUSTED_RESTORE_FIXTURE');
  }
  if (
    parsed.protocol !== 'postgresql:' ||
    parsed.hostname !== 'localhost' ||
    parsed.port !== '5432' ||
    parsed.username !== 'ventureos' ||
    parsed.pathname !== '/ventureos' ||
    parsed.searchParams.get('schema') !== 'public' ||
    [...parsed.searchParams.keys()].some((key) => key !== 'schema')
  )
    throw new Error('UNTRUSTED_RESTORE_FIXTURE');
  const containerIds = dockerCommand(
    'ps',
    '--filter',
    `label=${FIXTURE_LABEL}`,
    '--filter',
    'publish=5432',
    '--format',
    '{{.ID}}',
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  if (containerIds.length !== 1 || !/^[0-9a-f]{12,64}$/u.test(containerIds[0]!))
    throw new Error('UNTRUSTED_RESTORE_FIXTURE');
  const containerId = containerIds[0]!;
  if (
    dockerCommand('inspect', '--format', '{{.Config.Image}}', containerId) !== POSTGRES_IMAGE ||
    dockerCommand(
      'inspect',
      '--format',
      '{{index .Config.Labels "ventureos.fixture.owner"}}',
      containerId,
    ) !== 'github-ci-restore-drill' ||
    (() => {
      const bindings = dockerCommand('port', containerId, '5432/tcp')
        .split(/\r?\n/u)
        .filter(Boolean);
      return bindings.length === 0 || bindings.some((binding) => !/:5432$/u.test(binding));
    })()
  )
    throw new Error('UNTRUSTED_RESTORE_FIXTURE');
  return { databaseUrl: environment.DATABASE_URL, containerId };
}

describe('restore fixture admission', () => {
  it('rejects untrusted activation before Docker discovery or database mutation', () => {
    for (const environment of [
      {},
      { CI: 'true', DATABASE_URL: 'postgresql://ventureos@example.com:5432/ventureos' },
      {
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'github-hosted',
        GITHUB_REPOSITORY: 'completed369/hermesagent',
        DATABASE_URL: 'postgresql://ventureos@example.com:5432/ventureos?schema=public',
      },
      {
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'github-hosted',
        GITHUB_REPOSITORY: 'completed369/hermesagent',
        DATABASE_URL: 'postgresql://ventureos:wrong@localhost:5432/ventureos?schema=public',
      },
    ]) {
      let dockerCalled = false;
      expect(() =>
        resolveOwnedFixture(environment, () => {
          dockerCalled = true;
          return '';
        }),
      ).toThrow('UNTRUSTED_RESTORE_FIXTURE');
      expect(dockerCalled).toBe(false);
    }
  });

  it('rejects missing or drifted owned-container evidence before pool creation', () => {
    const environment = {
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'github-hosted',
      GITHUB_REPOSITORY: 'completed369/hermesagent',
      DATABASE_URL: FIXTURE_DATABASE_URL,
    };
    expect(() => resolveOwnedFixture(environment, () => '')).toThrow('UNTRUSTED_RESTORE_FIXTURE');
    expect(() =>
      resolveOwnedFixture(environment, (...args) => {
        if (args[0] === 'ps') return '0123456789ab';
        if (args.includes('{{.Config.Image}}')) return 'postgres:latest';
        return 'github-ci-restore-drill';
      }),
    ).toThrow('UNTRUSTED_RESTORE_FIXTURE');
  });
});

describe.runIf(onOwnedGitHubRunner)('real disposable PostgreSQL dump/restore evidence', () => {
  it('dumps the disposable CI database, restores a fresh database, verifies content, and removes it', async () => {
    const { databaseUrl, containerId } = resolveOwnedFixture(process.env, docker);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const target = `ventureos_restore_drill_${suffix}`;
    const sentinelTable = `restore_drill_sentinel_${suffix}`;
    const sentinelDigest = 'd'.repeat(64);
    const backupReference = `ci-pgdump-${suffix}`;
    const dumpPath = `/tmp/${backupReference}.dump`;
    const admin = new Pool({ connectionString: databaseUrl });
    let targetPool: Pool | undefined;
    let targetCreated = false;
    const backupCreatedAt = new Date();
    try {
      const identity = await admin.query<{ database: string; username: string }>(
        'SELECT current_database() AS database, current_user AS username',
      );
      expect(identity.rows[0]).toEqual({ database: 'ventureos', username: 'ventureos' });
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
      await admin.query(`DROP DATABASE "${target}"`);
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
        await admin.query(`DROP DATABASE IF EXISTS "${target}"`).catch(() => undefined);
      await admin.query(`DROP TABLE IF EXISTS "${sentinelTable}"`).catch(() => undefined);
      docker('exec', containerId, 'rm', '-f', dumpPath);
      await admin.end();
    }
  });
});
