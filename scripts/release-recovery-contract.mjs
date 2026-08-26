import { createHash } from 'node:crypto';

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const SAFE_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
const IMAGE_NAMES = ['api', 'ingress', 'tools', 'web', 'worker'];
const HEALTH_NAMES = ['api', 'apiIngress', 'postgres', 'temporal', 'web', 'webIngress', 'worker'];

export class RecoveryContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RecoveryContractError';
    this.code = code;
  }
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RecoveryContractError(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new RecoveryContractError(code);
}

function iso(value, code) {
  if (typeof value !== 'string') throw new RecoveryContractError(code);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value)
    throw new RecoveryContractError(code);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function safeReference(value) {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value)) return false;
  const lower = value.toLowerCase();
  return (
    !/(?:password|passwd|secret|token|cookie|authorization|chain[-_.:/ ]?of[-_.:/ ]?thought)/u.test(
      lower,
    ) &&
    !/^eyj[a-z0-9_-]*\.[a-z0-9_-]+\.[a-z0-9_-]+$/iu.test(value) &&
    !/^(?:gh[opusr]_|glpat-|sk-|xox[baprs]-)/iu.test(value)
  );
}

function images(value) {
  exactKeys(value, IMAGE_NAMES, 'INVALID_IMAGE_SET');
  const normalized = {};
  for (const name of IMAGE_NAMES) {
    if (!DIGEST.test(value[name])) throw new RecoveryContractError('INVALID_IMAGE_SET');
    normalized[name] = value[name];
  }
  return normalized;
}

function health(value) {
  exactKeys(value, HEALTH_NAMES, 'INVALID_HEALTH_EVIDENCE');
  const normalized = {};
  for (const name of HEALTH_NAMES) {
    if (value[name] !== 'HEALTHY') throw new RecoveryContractError('PRIOR_RELEASE_NOT_HEALTHY');
    normalized[name] = 'HEALTHY';
  }
  return normalized;
}

export function validateRollbackReadiness(input) {
  exactKeys(
    input,
    ['schemaVersion', 'currentSourceSha', 'priorRelease', 'priorHealth', 'migrationDecision'],
    'INVALID_ROLLBACK_PLAN',
  );
  if (input.schemaVersion !== 1 || !SHA.test(input.currentSourceSha)) {
    throw new RecoveryContractError('INVALID_ROLLBACK_PLAN');
  }
  exactKeys(input.priorRelease, ['sourceSha', 'images'], 'INVALID_PRIOR_RELEASE');
  if (
    !SHA.test(input.priorRelease.sourceSha) ||
    input.priorRelease.sourceSha === input.currentSourceSha
  ) {
    throw new RecoveryContractError('INVALID_PRIOR_RELEASE');
  }
  const priorImages = images(input.priorRelease.images);

  exactKeys(
    input.priorHealth,
    ['sourceSha', 'images', 'checks', 'checkedAt', 'evidenceHash'],
    'INVALID_HEALTH_EVIDENCE',
  );
  if (input.priorHealth.sourceSha !== input.priorRelease.sourceSha) {
    throw new RecoveryContractError('PRIOR_SOURCE_MISMATCH');
  }
  const observedImages = images(input.priorHealth.images);
  if (canonical(observedImages) !== canonical(priorImages)) {
    throw new RecoveryContractError('PRIOR_DIGEST_MISMATCH');
  }
  const checks = health(input.priorHealth.checks);
  iso(input.priorHealth.checkedAt, 'INVALID_HEALTH_EVIDENCE');
  if (!HASH.test(input.priorHealth.evidenceHash))
    throw new RecoveryContractError('INVALID_HEALTH_EVIDENCE');

  exactKeys(
    input.migrationDecision,
    ['decision', 'currentMigrationHead', 'priorMigrationHead', 'decidedAt', 'evidenceHash'],
    'INVALID_MIGRATION_DECISION',
  );
  if (
    !['BACKWARD_COMPATIBLE_CODE_ROLLBACK', 'FORWARD_FIX_ONLY', 'RESTORE_REQUIRED'].includes(
      input.migrationDecision.decision,
    ) ||
    !safeReference(input.migrationDecision.currentMigrationHead) ||
    !safeReference(input.migrationDecision.priorMigrationHead) ||
    !HASH.test(input.migrationDecision.evidenceHash)
  ) {
    throw new RecoveryContractError('INVALID_MIGRATION_DECISION');
  }
  iso(input.migrationDecision.decidedAt, 'INVALID_MIGRATION_DECISION');

  const normalized = {
    schemaVersion: 1,
    currentSourceSha: input.currentSourceSha,
    priorRelease: { sourceSha: input.priorRelease.sourceSha, images: priorImages },
    priorHealth: {
      sourceSha: input.priorHealth.sourceSha,
      images: observedImages,
      checks,
      checkedAt: input.priorHealth.checkedAt,
      evidenceHash: input.priorHealth.evidenceHash,
    },
    migrationDecision: { ...input.migrationDecision },
  };
  return Object.freeze({
    ...normalized,
    bindingHash: sha256(normalized),
    automaticCodeRollbackAllowed:
      normalized.migrationDecision.decision === 'BACKWARD_COMPATIBLE_CODE_ROLLBACK',
  });
}

export async function executeVerifiedRollback(readiness, driver) {
  const verified = validateRollbackReadiness(readiness);
  if (!verified.automaticCodeRollbackAllowed)
    throw new RecoveryContractError('AUTOMATIC_ROLLBACK_DENIED');
  await driver.restartPriorRelease(verified.priorRelease);
  const observed = await driver.observePriorRelease();
  if (observed.sourceSha !== verified.priorRelease.sourceSha) {
    throw new RecoveryContractError('ROLLBACK_SOURCE_NOT_VERIFIED');
  }
  if (canonical(images(observed.images)) !== canonical(verified.priorRelease.images)) {
    throw new RecoveryContractError('ROLLBACK_DIGEST_NOT_VERIFIED');
  }
  health(observed.checks);
  return Object.freeze({
    schemaVersion: 1,
    bindingHash: verified.bindingHash,
    sourceSha: observed.sourceSha,
    images: images(observed.images),
    checks: health(observed.checks),
    outcome: 'VERIFIED',
  });
}
