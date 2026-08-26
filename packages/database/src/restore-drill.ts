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
  readonly migrationDecision: {
    readonly decision: MigrationCompatibilityDecision;
    readonly currentMigrationHead: string;
    readonly priorMigrationHead: string;
    readonly decidedAt: string;
    readonly evidenceHash: string;
  };
}

export interface DisposablePostgresRestoreObservation {
  readonly schemaVersion: 1;
  readonly drillId: string;
  readonly targetDatabaseReference: string;
  readonly backupReference: string;
  readonly backupChecksum: string;
  readonly backupCreatedAt: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly restoredMigrationHead: string;
  readonly restoredSentinelDigest: string;
  readonly healthVerified: true;
  readonly cleanupVerified: true;
}

export interface RestoreDrillEvidence extends DisposablePostgresRestoreObservation {
  readonly backupAgeSeconds: number;
  readonly durationMilliseconds: number;
  readonly recoveryPointObjectiveSeconds: number;
  readonly recoveryTimeObjectiveSeconds: number;
  readonly migrationDecisionEvidenceHash: string;
  readonly evidenceHash: string;
}

export type RestoreDrillErrorCode =
  | 'INVALID_PLAN'
  | 'INVALID_OBSERVATION'
  | 'BACKUP_IDENTITY_MISMATCH'
  | 'BACKUP_TOO_OLD'
  | 'RPO_EXCEEDED'
  | 'RTO_EXCEEDED'
  | 'MIGRATION_MISMATCH'
  | 'SENTINEL_MISMATCH'
  | 'MIGRATION_EVIDENCE_HASH_MISMATCH';

export class RestoreDrillError extends Error {
  constructor(readonly code: RestoreDrillErrorCode) {
    super(code);
    this.name = 'RestoreDrillError';
  }
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function exactIso(value: string, code: RestoreDrillErrorCode): number {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new RestoreDrillError(code);
  return parsed.getTime();
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

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 31_536_000;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function createMigrationCompatibilityEvidence(
  input: Omit<DisposablePostgresRestoreDrillPlan['migrationDecision'], 'evidenceHash'>,
) {
  if (
    !exactKeys(input, ['decision', 'currentMigrationHead', 'priorMigrationHead', 'decidedAt']) ||
    !['BACKWARD_COMPATIBLE_CODE_ROLLBACK', 'FORWARD_FIX_ONLY', 'RESTORE_REQUIRED'].includes(
      input.decision,
    ) ||
    !safeReference(input.currentMigrationHead) ||
    !safeReference(input.priorMigrationHead)
  ) {
    throw new RestoreDrillError('INVALID_PLAN');
  }
  exactIso(input.decidedAt, 'INVALID_PLAN');
  return Object.freeze({ ...input, evidenceHash: hash(input) });
}

function validatePlan(plan: DisposablePostgresRestoreDrillPlan): void {
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
      'migrationDecision',
    ]) ||
    !exactKeys(plan.backup, ['reference', 'checksum', 'createdAt']) ||
    !exactKeys(plan.migrationDecision, [
      'decision',
      'currentMigrationHead',
      'priorMigrationHead',
      'decidedAt',
      'evidenceHash',
    ]) ||
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
    !positiveInteger(plan.recoveryTimeObjectiveSeconds)
  )
    throw new RestoreDrillError('INVALID_PLAN');
  exactIso(plan.backup.createdAt, 'INVALID_PLAN');
  const decision = createMigrationCompatibilityEvidence({
    decision: plan.migrationDecision.decision,
    currentMigrationHead: plan.migrationDecision.currentMigrationHead,
    priorMigrationHead: plan.migrationDecision.priorMigrationHead,
    decidedAt: plan.migrationDecision.decidedAt,
  });
  if (decision.evidenceHash !== plan.migrationDecision.evidenceHash) {
    throw new RestoreDrillError('MIGRATION_EVIDENCE_HASH_MISMATCH');
  }
}

export function completeDisposablePostgresRestoreDrill(
  plan: DisposablePostgresRestoreDrillPlan,
  observation: DisposablePostgresRestoreObservation,
): RestoreDrillEvidence {
  validatePlan(plan);
  if (
    !exactKeys(observation, [
      'schemaVersion',
      'drillId',
      'targetDatabaseReference',
      'backupReference',
      'backupChecksum',
      'backupCreatedAt',
      'startedAt',
      'completedAt',
      'restoredMigrationHead',
      'restoredSentinelDigest',
      'healthVerified',
      'cleanupVerified',
    ]) ||
    observation.schemaVersion !== 1 ||
    observation.healthVerified !== true ||
    observation.cleanupVerified !== true
  ) {
    throw new RestoreDrillError('INVALID_OBSERVATION');
  }
  if (
    observation.drillId !== plan.drillId ||
    observation.targetDatabaseReference !== plan.targetDatabaseReference ||
    observation.backupReference !== plan.backup.reference ||
    observation.backupChecksum !== plan.backup.checksum ||
    observation.backupCreatedAt !== plan.backup.createdAt
  )
    throw new RestoreDrillError('BACKUP_IDENTITY_MISMATCH');
  const startedAt = exactIso(observation.startedAt, 'INVALID_OBSERVATION');
  const completedAt = exactIso(observation.completedAt, 'INVALID_OBSERVATION');
  const backupAgeSeconds = Math.floor(
    (startedAt - exactIso(plan.backup.createdAt, 'INVALID_PLAN')) / 1000,
  );
  const durationMilliseconds = completedAt - startedAt;
  if (backupAgeSeconds < 0 || durationMilliseconds < 0)
    throw new RestoreDrillError('INVALID_OBSERVATION');
  if (backupAgeSeconds > plan.maximumBackupAgeSeconds)
    throw new RestoreDrillError('BACKUP_TOO_OLD');
  if (backupAgeSeconds > plan.recoveryPointObjectiveSeconds)
    throw new RestoreDrillError('RPO_EXCEEDED');
  if (durationMilliseconds > plan.recoveryTimeObjectiveSeconds * 1000)
    throw new RestoreDrillError('RTO_EXCEEDED');
  if (observation.restoredMigrationHead !== plan.expectedMigrationHead)
    throw new RestoreDrillError('MIGRATION_MISMATCH');
  if (observation.restoredSentinelDigest !== plan.expectedSentinelDigest)
    throw new RestoreDrillError('SENTINEL_MISMATCH');
  const evidenceWithoutHash = {
    ...observation,
    backupAgeSeconds,
    durationMilliseconds,
    recoveryPointObjectiveSeconds: plan.recoveryPointObjectiveSeconds,
    recoveryTimeObjectiveSeconds: plan.recoveryTimeObjectiveSeconds,
    migrationDecisionEvidenceHash: plan.migrationDecision.evidenceHash,
  };
  return Object.freeze({ ...evidenceWithoutHash, evidenceHash: hash(evidenceWithoutHash) });
}
