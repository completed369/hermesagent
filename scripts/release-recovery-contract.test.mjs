import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RecoveryContractError,
  completeRollbackVerification,
  createMigrationDecisionEvidence,
  createPriorHealthEvidence,
  validateRollbackReadiness,
} from './release-recovery-contract.mjs';

const images = Object.fromEntries(
  ['api', 'ingress', 'tools', 'web', 'worker'].map((name, index) => [
    name,
    `sha256:${String(index + 1).repeat(64)}`,
  ]),
);
const checks = {
  api: 'HEALTHY',
  apiIngress: 'HEALTHY',
  postgres: 'HEALTHY',
  temporal: 'HEALTHY',
  web: 'HEALTHY',
  webIngress: 'HEALTHY',
  worker: 'HEALTHY',
};

function plan(decision = 'BACKWARD_COMPATIBLE_CODE_ROLLBACK') {
  return {
    schemaVersion: 1,
    currentSourceSha: '1'.repeat(40),
    priorRelease: { sourceSha: '2'.repeat(40), images },
    priorHealth: createPriorHealthEvidence({
      sourceSha: '2'.repeat(40),
      images,
      checks,
      checkedAt: '2026-08-26T00:00:00.000Z',
    }),
    migrationDecision: createMigrationDecisionEvidence({
      decision,
      currentMigrationHead: '20260826043000',
      priorMigrationHead: '20260825230000',
      decidedAt: '2026-08-26T00:01:00.000Z',
    }),
  };
}

const observation = () => ({
  sourceSha: '2'.repeat(40),
  images,
  checks,
  checkedAt: '2026-08-26T00:02:00.000Z',
});

test('binds exact prior source, five digests, health evidence and migration decision', () => {
  const ready = validateRollbackReadiness(plan());
  assert.equal(ready.automaticCodeRollbackAllowed, true);
  assert.match(ready.bindingHash, /^[0-9a-f]{64}$/u);
});

test('denies completion for forward-fix and restore-required decisions', () => {
  for (const decision of ['FORWARD_FIX_ONLY', 'RESTORE_REQUIRED']) {
    assert.throws(
      () => completeRollbackVerification(plan(decision), observation()),
      (error) =>
        error instanceof RecoveryContractError && error.code === 'AUTOMATIC_ROLLBACK_DENIED',
    );
  }
});

test('rejects source, digest, health and canonical evidence-hash drift', () => {
  assert.throws(
    () =>
      validateRollbackReadiness({
        ...plan(),
        priorHealth: { ...plan().priorHealth, evidenceHash: 'f'.repeat(64) },
      }),
    /HEALTH_EVIDENCE_HASH_MISMATCH/u,
  );
  assert.throws(
    () =>
      validateRollbackReadiness({
        ...plan(),
        migrationDecision: { ...plan().migrationDecision, evidenceHash: 'f'.repeat(64) },
      }),
    /MIGRATION_EVIDENCE_HASH_MISMATCH/u,
  );
  assert.throws(
    () => completeRollbackVerification(plan(), { ...observation(), sourceSha: '3'.repeat(40) }),
    /ROLLBACK_SOURCE_NOT_VERIFIED/u,
  );
  assert.throws(
    () =>
      completeRollbackVerification(plan(), {
        ...observation(),
        images: { ...images, web: `sha256:${'f'.repeat(64)}` },
      }),
    /ROLLBACK_DIGEST_NOT_VERIFIED/u,
  );
  assert.throws(
    () =>
      completeRollbackVerification(plan(), {
        ...observation(),
        checks: { ...checks, api: 'FAILED' },
      }),
    /PRIOR_RELEASE_NOT_HEALTHY/u,
  );
});

test('rejects credential or private-reasoning text in migration references', () => {
  for (const currentMigrationHead of [
    'password-reference',
    'glpat-example',
    'eyJabc.def.ghi',
    'chain-of-thought',
  ]) {
    assert.throws(
      () =>
        createMigrationDecisionEvidence({
          decision: 'RESTORE_REQUIRED',
          currentMigrationHead,
          priorMigrationHead: 'migration-1',
          decidedAt: '2026-08-26T00:01:00.000Z',
        }),
      /INVALID_MIGRATION_DECISION/u,
    );
  }
});

test('returns VERIFIED only from exact post-action observation evidence', () => {
  const result = completeRollbackVerification(plan(), observation());
  assert.equal(result.outcome, 'VERIFIED');
  assert.match(result.observationHash, /^[0-9a-f]{64}$/u);
});
