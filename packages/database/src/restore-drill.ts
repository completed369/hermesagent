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

function exactIso(value: unknown, code: RestoreDrillErrorCode): number {
  if (typeof value !== 'string') throw new RestoreDrillError(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new RestoreDrillError(code);
  return parsed.getTime();
}

function safeReference(value: unknown): value is string {
  if (typeof value !== 'string') return false;
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

function positiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 31_536_000
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function createMigrationCompatibilityEvidence(input: unknown) {
  if (!exactKeys(input, ['decision', 'currentMigrationHead', 'priorMigrationHead', 'decidedAt'])) {
    throw new RestoreDrillError('INVALID_PLAN');
  }
  const candidate = input as Record<string, unknown>;
  if (
    typeof candidate.decision !== 'string' ||
    !['BACKWARD_COMPATIBLE_CODE_ROLLBACK', 'FORWARD_FIX_ONLY', 'RESTORE_REQUIRED'].includes(
      candidate.decision,
    ) ||
    !safeReference(candidate.currentMigrationHead) ||
    !safeReference(candidate.priorMigrationHead) ||
    typeof candidate.decidedAt !== 'string'
  )
    throw new RestoreDrillError('INVALID_PLAN');
  exactIso(candidate.decidedAt, 'INVALID_PLAN');
  const normalized = {
    decision: candidate.decision as MigrationCompatibilityDecision,
    currentMigrationHead: candidate.currentMigrationHead,
    priorMigrationHead: candidate.priorMigrationHead,
    decidedAt: candidate.decidedAt,
  };
  return Object.freeze({ ...normalized, evidenceHash: hash(normalized) });
}

function validatePlan(plan: unknown): asserts plan is DisposablePostgresRestoreDrillPlan {
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
    ])
  )
    throw new RestoreDrillError('INVALID_PLAN');
  const candidate = plan as Record<string, unknown>;
  if (
    !exactKeys(candidate.backup, ['reference', 'checksum', 'createdAt']) ||
    !exactKeys(candidate.migrationDecision, [
      'decision',
      'currentMigrationHead',
      'priorMigrationHead',
      'decidedAt',
      'evidenceHash',
    ])
  )
    throw new RestoreDrillError('INVALID_PLAN');
  const backup = candidate.backup as Record<string, unknown>;
  const migrationDecision = candidate.migrationDecision as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    !safeReference(candidate.drillId) ||
    !safeReference(candidate.targetDatabaseReference) ||
    !DISPOSABLE_TARGET.test(candidate.targetDatabaseReference) ||
    !safeReference(backup.reference) ||
    typeof backup.checksum !== 'string' ||
    !HASH.test(backup.checksum) ||
    !safeReference(candidate.expectedMigrationHead) ||
    typeof candidate.expectedSentinelDigest !== 'string' ||
    !HASH.test(candidate.expectedSentinelDigest) ||
    !positiveInteger(candidate.maximumBackupAgeSeconds) ||
    !positiveInteger(candidate.recoveryPointObjectiveSeconds) ||
    !positiveInteger(candidate.recoveryTimeObjectiveSeconds)
  )
    throw new RestoreDrillError('INVALID_PLAN');
  exactIso(backup.createdAt, 'INVALID_PLAN');
  const decision = createMigrationCompatibilityEvidence({
    decision: migrationDecision.decision,
    currentMigrationHead: migrationDecision.currentMigrationHead,
    priorMigrationHead: migrationDecision.priorMigrationHead,
    decidedAt: migrationDecision.decidedAt,
  });
  if (decision.evidenceHash !== migrationDecision.evidenceHash) {
    throw new RestoreDrillError('MIGRATION_EVIDENCE_HASH_MISMATCH');
  }
}

export function completeDisposablePostgresRestoreDrill(
  plan: unknown,
  observation: unknown,
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
    ])
  ) {
    throw new RestoreDrillError('INVALID_OBSERVATION');
  }
  const candidate = observation as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.healthVerified !== true ||
    candidate.cleanupVerified !== true ||
    !safeReference(candidate.drillId) ||
    !safeReference(candidate.targetDatabaseReference) ||
    !safeReference(candidate.backupReference) ||
    typeof candidate.backupChecksum !== 'string' ||
    !HASH.test(candidate.backupChecksum) ||
    typeof candidate.backupCreatedAt !== 'string' ||
    !safeReference(candidate.restoredMigrationHead) ||
    typeof candidate.restoredSentinelDigest !== 'string' ||
    !HASH.test(candidate.restoredSentinelDigest)
  )
    throw new RestoreDrillError('INVALID_OBSERVATION');
  if (
    candidate.drillId !== plan.drillId ||
    candidate.targetDatabaseReference !== plan.targetDatabaseReference ||
    candidate.backupReference !== plan.backup.reference ||
    candidate.backupChecksum !== plan.backup.checksum ||
    candidate.backupCreatedAt !== plan.backup.createdAt
  )
    throw new RestoreDrillError('BACKUP_IDENTITY_MISMATCH');
  const startedAt = exactIso(candidate.startedAt, 'INVALID_OBSERVATION');
  const completedAt = exactIso(candidate.completedAt, 'INVALID_OBSERVATION');
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
  if (candidate.restoredMigrationHead !== plan.expectedMigrationHead)
    throw new RestoreDrillError('MIGRATION_MISMATCH');
  if (candidate.restoredSentinelDigest !== plan.expectedSentinelDigest)
    throw new RestoreDrillError('SENTINEL_MISMATCH');
  const evidenceWithoutHash = {
    ...(candidate as unknown as DisposablePostgresRestoreObservation),
    backupAgeSeconds,
    durationMilliseconds,
    recoveryPointObjectiveSeconds: plan.recoveryPointObjectiveSeconds,
    recoveryTimeObjectiveSeconds: plan.recoveryTimeObjectiveSeconds,
    migrationDecisionEvidenceHash: plan.migrationDecision.evidenceHash,
  };
  return Object.freeze({ ...evidenceWithoutHash, evidenceHash: hash(evidenceWithoutHash) });
}
