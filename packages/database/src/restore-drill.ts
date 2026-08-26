import { createHash } from 'node:crypto';

const HASH = /^[0-9a-f]{64}$/u;
const SAFE_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
const DISPOSABLE_TARGET = /^ventureos_restore_drill_[a-z0-9_]{1,80}$/u;

export type MigrationCompatibilityDecision =
  'BACKWARD_COMPATIBLE_CODE_ROLLBACK' | 'FORWARD_FIX_ONLY' | 'RESTORE_REQUIRED';

export interface DisposablePostgresRestoreDrillPlan {
  readonly schemaVersion: 1;
  readonly drillId: string;
  readonly targetDatabaseReference: string;
  readonly backup: {
    readonly reference: string;
    readonly checksum: string;
    readonly createdAt: string;
  };
  readonly expectedMigrationHead: string;
  readonly expectedSentinelDigest: string;
  readonly maximumBackupAgeSeconds: number;
  readonly recoveryPointObjectiveSeconds: number;
  readonly recoveryTimeObjectiveSeconds: number;
  readonly migrationCompatibilityDecision: MigrationCompatibilityDecision;
  readonly migrationDecisionEvidenceHash: string;
}

export interface DisposablePostgresRestoreDrillPort {
  createDisposableTarget(targetDatabaseReference: string): Promise<void>;
  restoreBackup(targetDatabaseReference: string, backupReference: string): Promise<void>;
  readMigrationHead(targetDatabaseReference: string): Promise<string>;
  readSentinelDigest(targetDatabaseReference: string): Promise<string>;
  verifyHealth(targetDatabaseReference: string): Promise<boolean>;
  destroyDisposableTarget(targetDatabaseReference: string): Promise<void>;
}

export interface RestoreDrillEvidence {
  readonly schemaVersion: 1;
  readonly drillId: string;
  readonly targetDatabaseReference: string;
  readonly backupReference: string;
  readonly backupChecksum: string;
  readonly backupAgeSeconds: number;
  readonly recoveryPointObjectiveSeconds: number;
  readonly recoveryTimeObjectiveSeconds: number;
  readonly durationMilliseconds: number;
  readonly migrationCompatibilityDecision: MigrationCompatibilityDecision;
  readonly migrationDecisionEvidenceHash: string;
  readonly restoredMigrationHead: string;
  readonly restoredSentinelDigest: string;
  readonly healthVerified: true;
  readonly cleanupVerified: true;
  readonly completedAt: string;
  readonly evidenceHash: string;
}

export type RestoreDrillErrorCode =
  | 'INVALID_PLAN'
  | 'BACKUP_TOO_OLD'
  | 'RPO_EXCEEDED'
  | 'RTO_EXCEEDED'
  | 'MIGRATION_MISMATCH'
  | 'SENTINEL_MISMATCH'
  | 'HEALTH_FAILED'
  | 'TARGET_CREATE_FAILED'
  | 'RESTORE_FAILED'
  | 'VERIFICATION_FAILED'
  | 'CLEANUP_FAILED';

export class RestoreDrillError extends Error {
  constructor(readonly code: RestoreDrillErrorCode) {
    super(code);
    this.name = 'RestoreDrillError';
  }
}

function exactIso(value: string): number {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new RestoreDrillError('INVALID_PLAN');
  }
  return parsed.getTime();
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 31_536_000;
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function safeReference(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    SAFE_REFERENCE.test(value) &&
    !/(?:password|passwd|secret|token|cookie|authorization|chain[-_.:/ ]?of[-_.:/ ]?thought)/u.test(
      lower,
    ) &&
    !/^eyj[a-z0-9_-]*\.[a-z0-9_-]+\.[a-z0-9_-]+$/iu.test(value) &&
    !/^(?:gh[opusr]_|glpat-|sk-|xox[baprs]-)/iu.test(value)
  );
}

function assertPlan(plan: DisposablePostgresRestoreDrillPlan, startedAt: Date): number {
  if (
    !exactKeys(plan, [
      'schemaVersion',
      'drillId',
      'targetDatabaseReference',
      'backup',
      'expectedMigrationHead',
      'expectedSentinelDigest',
      'maximumBackupAgeSeconds',
      'recoveryPointObjectiveSeconds',
      'recoveryTimeObjectiveSeconds',
      'migrationCompatibilityDecision',
      'migrationDecisionEvidenceHash',
    ]) ||
    !exactKeys(plan.backup, ['reference', 'checksum', 'createdAt']) ||
    plan.schemaVersion !== 1 ||
    !safeReference(plan.drillId) ||
    !DISPOSABLE_TARGET.test(plan.targetDatabaseReference) ||
    !safeReference(plan.targetDatabaseReference) ||
    !safeReference(plan.backup.reference) ||
    !HASH.test(plan.backup.checksum) ||
    !safeReference(plan.expectedMigrationHead) ||
    !HASH.test(plan.expectedSentinelDigest) ||
    !positiveInteger(plan.maximumBackupAgeSeconds) ||
    !positiveInteger(plan.recoveryPointObjectiveSeconds) ||
    !positiveInteger(plan.recoveryTimeObjectiveSeconds) ||
    !['BACKWARD_COMPATIBLE_CODE_ROLLBACK', 'FORWARD_FIX_ONLY', 'RESTORE_REQUIRED'].includes(
      plan.migrationCompatibilityDecision,
    ) ||
    !HASH.test(plan.migrationDecisionEvidenceHash)
  ) {
    throw new RestoreDrillError('INVALID_PLAN');
  }
  if (!Number.isFinite(startedAt.getTime())) throw new RestoreDrillError('INVALID_PLAN');
  const ageMilliseconds = startedAt.getTime() - exactIso(plan.backup.createdAt);
  if (ageMilliseconds < 0) throw new RestoreDrillError('INVALID_PLAN');
  const ageSeconds = Math.floor(ageMilliseconds / 1000);
  if (ageSeconds > plan.maximumBackupAgeSeconds) throw new RestoreDrillError('BACKUP_TOO_OLD');
  if (ageSeconds > plan.recoveryPointObjectiveSeconds) throw new RestoreDrillError('RPO_EXCEEDED');
  return ageSeconds;
}

function hashEvidence(evidence: Omit<RestoreDrillEvidence, 'evidenceHash'>): string {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}

export async function runDisposablePostgresRestoreDrill(
  plan: DisposablePostgresRestoreDrillPlan,
  port: DisposablePostgresRestoreDrillPort,
): Promise<RestoreDrillEvidence> {
  const startedAt = new Date();
  const backupAgeSeconds = assertPlan(plan, startedAt);
  let targetCreated = false;
  let primaryError: unknown;
  let result: RestoreDrillEvidence | undefined;
  let stage: 'CREATE' | 'RESTORE' | 'VERIFY' = 'CREATE';
  try {
    await port.createDisposableTarget(plan.targetDatabaseReference);
    targetCreated = true;
    stage = 'RESTORE';
    await port.restoreBackup(plan.targetDatabaseReference, plan.backup.reference);
    stage = 'VERIFY';
    const restoredMigrationHead = await port.readMigrationHead(plan.targetDatabaseReference);
    if (restoredMigrationHead !== plan.expectedMigrationHead) {
      throw new RestoreDrillError('MIGRATION_MISMATCH');
    }
    const restoredSentinelDigest = await port.readSentinelDigest(plan.targetDatabaseReference);
    if (restoredSentinelDigest !== plan.expectedSentinelDigest) {
      throw new RestoreDrillError('SENTINEL_MISMATCH');
    }
    if (!(await port.verifyHealth(plan.targetDatabaseReference))) {
      throw new RestoreDrillError('HEALTH_FAILED');
    }
    const completedAt = new Date();
    const durationMilliseconds = completedAt.getTime() - startedAt.getTime();
    if (durationMilliseconds < 0) throw new RestoreDrillError('INVALID_PLAN');
    if (durationMilliseconds > plan.recoveryTimeObjectiveSeconds * 1000) {
      throw new RestoreDrillError('RTO_EXCEEDED');
    }
    const evidenceWithoutHash = {
      schemaVersion: 1 as const,
      drillId: plan.drillId,
      targetDatabaseReference: plan.targetDatabaseReference,
      backupReference: plan.backup.reference,
      backupChecksum: plan.backup.checksum,
      backupAgeSeconds,
      recoveryPointObjectiveSeconds: plan.recoveryPointObjectiveSeconds,
      recoveryTimeObjectiveSeconds: plan.recoveryTimeObjectiveSeconds,
      durationMilliseconds,
      migrationCompatibilityDecision: plan.migrationCompatibilityDecision,
      migrationDecisionEvidenceHash: plan.migrationDecisionEvidenceHash,
      restoredMigrationHead,
      restoredSentinelDigest,
      healthVerified: true as const,
      cleanupVerified: true as const,
      completedAt: completedAt.toISOString(),
    };
    result = Object.freeze({
      ...evidenceWithoutHash,
      evidenceHash: hashEvidence(evidenceWithoutHash),
    });
  } catch (error) {
    primaryError =
      error instanceof RestoreDrillError
        ? error
        : new RestoreDrillError(
            stage === 'CREATE'
              ? 'TARGET_CREATE_FAILED'
              : stage === 'RESTORE'
                ? 'RESTORE_FAILED'
                : 'VERIFICATION_FAILED',
          );
  } finally {
    if (targetCreated) {
      try {
        await port.destroyDisposableTarget(plan.targetDatabaseReference);
      } catch {
        throw new RestoreDrillError('CLEANUP_FAILED');
      }
    }
  }
  if (primaryError) throw primaryError;
  if (!result) throw new RestoreDrillError('INVALID_PLAN');
  return result;
}
