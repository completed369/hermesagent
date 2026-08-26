import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RestoreDrillError,
  runDisposablePostgresRestoreDrill,
  type DisposablePostgresRestoreDrillPlan,
  type DisposablePostgresRestoreDrillPort,
} from './restore-drill.js';

const sentinel = 'a'.repeat(64);
const plan: DisposablePostgresRestoreDrillPlan = {
  schemaVersion: 1,
  drillId: 'drill-1',
  targetDatabaseReference: 'ventureos_restore_drill_unit_1',
  backup: {
    reference: 'synthetic-backup-1',
    checksum: 'b'.repeat(64),
    createdAt: '2026-08-26T00:00:00.000Z',
  },
  expectedMigrationHead: '20260826043000',
  expectedSentinelDigest: sentinel,
  maximumBackupAgeSeconds: 7200,
  recoveryPointObjectiveSeconds: 3600,
  recoveryTimeObjectiveSeconds: 60,
  migrationCompatibilityDecision: 'RESTORE_REQUIRED',
  migrationDecisionEvidenceHash: 'c'.repeat(64),
};

function fixture(overrides: Partial<DisposablePostgresRestoreDrillPort> = {}) {
  const calls: string[] = [];
  const port: DisposablePostgresRestoreDrillPort = {
    createDisposableTarget: vi.fn(async () => {
      calls.push('create');
    }),
    restoreBackup: vi.fn(async () => {
      calls.push('restore');
    }),
    readMigrationHead: vi.fn(async () => plan.expectedMigrationHead),
    readSentinelDigest: vi.fn(async () => sentinel),
    verifyHealth: vi.fn(async () => true),
    destroyDisposableTarget: vi.fn(async () => {
      calls.push('destroy');
    }),
    ...overrides,
  };
  return { calls, port };
}

describe('disposable PostgreSQL restore drill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T00:30:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('records bounded RPO/RTO and exact restored evidence, then removes the target', async () => {
    const { calls, port } = fixture();
    const evidence = await runDisposablePostgresRestoreDrill(plan, port);
    expect(evidence).toMatchObject({
      backupAgeSeconds: 1800,
      durationMilliseconds: 0,
      healthVerified: true,
      cleanupVerified: true,
      migrationCompatibilityDecision: 'RESTORE_REQUIRED',
    });
    expect(evidence.evidenceHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(calls).toEqual(['create', 'restore', 'destroy']);
  });

  it.each([
    ['migration', { readMigrationHead: vi.fn(async () => 'wrong') }, 'MIGRATION_MISMATCH'],
    ['sentinel', { readSentinelDigest: vi.fn(async () => 'd'.repeat(64)) }, 'SENTINEL_MISMATCH'],
    ['health', { verifyHealth: vi.fn(async () => false) }, 'HEALTH_FAILED'],
  ])(
    'fails closed on %s verification and still destroys the target',
    async (_label, overrides, code) => {
      const { calls, port } = fixture(overrides);
      await expect(runDisposablePostgresRestoreDrill(plan, port)).rejects.toMatchObject({ code });
      expect(calls.at(-1)).toBe('destroy');
    },
  );

  it('rejects stale backups before creating a target', async () => {
    const { port } = fixture();
    vi.setSystemTime(new Date('2026-08-26T02:00:01.000Z'));
    await expect(runDisposablePostgresRestoreDrill(plan, port)).rejects.toEqual(
      new RestoreDrillError('BACKUP_TOO_OLD'),
    );
    expect(port.createDisposableTarget).not.toHaveBeenCalled();
  });

  it('rejects an RPO breach even when the general maximum age is not breached', async () => {
    const { port } = fixture();
    vi.setSystemTime(new Date('2026-08-26T00:01:01.000Z'));
    await expect(
      runDisposablePostgresRestoreDrill(
        { ...plan, maximumBackupAgeSeconds: 7200, recoveryPointObjectiveSeconds: 60 },
        port,
      ),
    ).rejects.toMatchObject({ code: 'RPO_EXCEEDED' });
    expect(port.createDisposableTarget).not.toHaveBeenCalled();
  });

  it('fails closed when the measured drill duration exceeds the supplied RTO', async () => {
    const { calls, port } = fixture({
      verifyHealth: vi.fn(async () => {
        vi.setSystemTime(new Date('2026-08-26T00:30:01.001Z'));
        return true;
      }),
    });
    await expect(
      runDisposablePostgresRestoreDrill({ ...plan, recoveryTimeObjectiveSeconds: 1 }, port),
    ).rejects.toMatchObject({ code: 'RTO_EXCEEDED' });
    expect(calls.at(-1)).toBe('destroy');
  });

  it('rejects non-disposable target names before any I/O', async () => {
    const { port } = fixture();
    await expect(
      runDisposablePostgresRestoreDrill({ ...plan, targetDatabaseReference: 'ventureos' }, port),
    ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    expect(port.createDisposableTarget).not.toHaveBeenCalled();
  });

  it.each(['password-reference', 'glpat-example', 'eyJabc.def.ghi', 'chain-of-thought'])(
    'rejects sensitive or private-text backup references: %s',
    async (reference) => {
      const { port } = fixture();
      await expect(
        runDisposablePostgresRestoreDrill({ ...plan, backup: { ...plan.backup, reference } }, port),
      ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
      expect(port.createDisposableTarget).not.toHaveBeenCalled();
    },
  );

  it('rejects sensitive text in the persisted disposable target reference', async () => {
    const { port } = fixture();
    await expect(
      runDisposablePostgresRestoreDrill(
        { ...plan, targetDatabaseReference: 'ventureos_restore_drill_password_token' },
        port,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    expect(port.createDisposableTarget).not.toHaveBeenCalled();
  });

  it('reports cleanup failure instead of claiming usable evidence', async () => {
    const { port } = fixture({
      destroyDisposableTarget: vi.fn(async () => {
        throw new Error('synthetic cleanup failure');
      }),
    });
    await expect(runDisposablePostgresRestoreDrill(plan, port)).rejects.toMatchObject({
      code: 'CLEANUP_FAILED',
    });
  });
});
