import { describe, expect, it } from 'vitest';
import {
  completeDisposablePostgresRestoreDrill,
  createMigrationCompatibilityEvidence,
  type DisposablePostgresRestoreDrillPlan,
  type DisposablePostgresRestoreObservation,
} from './restore-drill.js';

const migrationDecision = createMigrationCompatibilityEvidence({
  decision: 'RESTORE_REQUIRED',
  currentMigrationHead: 'migration-2',
  priorMigrationHead: 'migration-1',
  decidedAt: '2026-08-26T00:00:30.000Z',
});
const plan: DisposablePostgresRestoreDrillPlan = {
  schemaVersion: 1,
  drillId: 'drill-1',
  targetDatabaseReference: 'ventureos_restore_drill_unit_1',
  backup: {
    reference: 'synthetic-backup-1',
    checksum: 'b'.repeat(64),
    createdAt: '2026-08-26T00:00:00.000Z',
  },
  expectedMigrationHead: 'migration-2',
  expectedSentinelDigest: 'a'.repeat(64),
  maximumBackupAgeSeconds: 7200,
  recoveryPointObjectiveSeconds: 3600,
  recoveryTimeObjectiveSeconds: 60,
  migrationDecision,
};
const observation = (): DisposablePostgresRestoreObservation => ({
  schemaVersion: 1,
  drillId: plan.drillId,
  targetDatabaseReference: plan.targetDatabaseReference,
  backupReference: plan.backup.reference,
  backupChecksum: plan.backup.checksum,
  backupCreatedAt: plan.backup.createdAt,
  startedAt: '2026-08-26T00:30:00.000Z',
  completedAt: '2026-08-26T00:30:12.000Z',
  restoredMigrationHead: plan.expectedMigrationHead,
  restoredSentinelDigest: plan.expectedSentinelDigest,
  healthVerified: true,
  cleanupVerified: true,
});

describe('pure disposable PostgreSQL restore evidence completion', () => {
  it('binds exact backup identity, migration, sentinel, health, cleanup, RPO and RTO evidence', () => {
    expect(completeDisposablePostgresRestoreDrill(plan, observation())).toMatchObject({
      backupAgeSeconds: 1800,
      durationMilliseconds: 12_000,
      healthVerified: true,
      cleanupVerified: true,
    });
  });

  it.each([
    [{ backupChecksum: 'c'.repeat(64) }, 'BACKUP_IDENTITY_MISMATCH'],
    [{ restoredMigrationHead: 'wrong' }, 'MIGRATION_MISMATCH'],
    [{ restoredSentinelDigest: 'd'.repeat(64) }, 'SENTINEL_MISMATCH'],
    [
      {
        startedAt: '2026-08-26T02:00:01.000Z',
        completedAt: '2026-08-26T02:00:02.000Z',
      },
      'BACKUP_TOO_OLD',
    ],
    [{ completedAt: '2026-08-26T00:31:00.001Z' }, 'RTO_EXCEEDED'],
  ])('rejects drift or objective breach %#', (override, code) => {
    expect(() =>
      completeDisposablePostgresRestoreDrill(plan, { ...observation(), ...override }),
    ).toThrow(code);
  });

  it('rejects forged migration decision hashes', () => {
    expect(() =>
      completeDisposablePostgresRestoreDrill(
        { ...plan, migrationDecision: { ...plan.migrationDecision, evidenceHash: 'f'.repeat(64) } },
        observation(),
      ),
    ).toThrow('MIGRATION_EVIDENCE_HASH_MISMATCH');
  });

  it('canonicalizes migration and final evidence independent of key insertion order', () => {
    const reordered = createMigrationCompatibilityEvidence({
      decidedAt: migrationDecision.decidedAt,
      priorMigrationHead: migrationDecision.priorMigrationHead,
      currentMigrationHead: migrationDecision.currentMigrationHead,
      decision: migrationDecision.decision,
    });
    expect(reordered.evidenceHash).toBe(migrationDecision.evidenceHash);
    const reversedObservation = Object.fromEntries(
      Object.entries(observation()).reverse(),
    ) as unknown as DisposablePostgresRestoreObservation;
    expect(completeDisposablePostgresRestoreDrill(plan, reversedObservation).evidenceHash).toBe(
      completeDisposablePostgresRestoreDrill(plan, observation()).evidenceHash,
    );
  });

  it('rejects credential and private-reasoning references and non-disposable targets', () => {
    for (const reference of [
      'password-reference',
      'glpat-example',
      'eyJabc.def.ghi',
      'chain-of-thought',
    ]) {
      expect(() =>
        completeDisposablePostgresRestoreDrill(
          { ...plan, backup: { ...plan.backup, reference } },
          observation(),
        ),
      ).toThrow('INVALID_PLAN');
    }
    expect(() =>
      completeDisposablePostgresRestoreDrill(
        { ...plan, targetDatabaseReference: 'ventureos' },
        observation(),
      ),
    ).toThrow('INVALID_PLAN');
  });

  it('returns fixed restore errors for malformed runtime scalar types', () => {
    for (const malformed of [
      null,
      { ...plan, drillId: 1 },
      { ...plan, targetDatabaseReference: Symbol('target') },
      { ...plan, backup: { ...plan.backup, createdAt: {} } },
      { ...plan, migrationDecision: { ...plan.migrationDecision, currentMigrationHead: [] } },
    ]) {
      expect(() => completeDisposablePostgresRestoreDrill(malformed, observation())).toThrow(
        'INVALID_PLAN',
      );
    }
    for (const malformed of [
      null,
      { ...observation(), drillId: 1 },
      { ...observation(), restoredSentinelDigest: Symbol('digest') },
      { ...observation(), startedAt: {} },
      { ...observation(), backupChecksum: [] },
      { ...observation(), restoredMigrationHead: false },
    ]) {
      expect(() => completeDisposablePostgresRestoreDrill(plan, malformed)).toThrow(
        'INVALID_OBSERVATION',
      );
    }
    expect(() =>
      createMigrationCompatibilityEvidence({
        decision: 'RESTORE_REQUIRED',
        currentMigrationHead: {},
        priorMigrationHead: 'migration-1',
        decidedAt: '2026-08-26T00:00:30.000Z',
      }),
    ).toThrow('INVALID_PLAN');
  });
});
