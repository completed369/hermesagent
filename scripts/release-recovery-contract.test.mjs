import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RecoveryContractError,
  executeVerifiedRollback,
  validateRollbackReadiness,
} from './release-recovery-contract.mjs';

const hash = 'a'.repeat(64);
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
    priorHealth: {
      sourceSha: '2'.repeat(40),
      images,
      checks,
      checkedAt: '2026-08-26T00:00:00.000Z',
      evidenceHash: hash,
    },
    migrationDecision: {
      decision,
      currentMigrationHead: '20260826043000',
      priorMigrationHead: '20260825230000',
      decidedAt: '2026-08-26T00:01:00.000Z',
      evidenceHash: 'b'.repeat(64),
    },
  };
}

test('binds exact prior source, five digests, health evidence and migration decision', () => {
  const ready = validateRollbackReadiness(plan());
  assert.equal(ready.automaticCodeRollbackAllowed, true);
  assert.match(ready.bindingHash, /^[0-9a-f]{64}$/u);
});

test('denies automatic code rollback for forward-fix and restore-required decisions', async () => {
  for (const decision of ['FORWARD_FIX_ONLY', 'RESTORE_REQUIRED']) {
    await assert.rejects(
      executeVerifiedRollback(plan(decision), {
        restartPriorRelease: async () => assert.fail('must not restart'),
        observePriorRelease: async () => assert.fail('must not observe'),
      }),
      (error) =>
        error instanceof RecoveryContractError && error.code === 'AUTOMATIC_ROLLBACK_DENIED',
    );
  }
});

test('rejects stale or forged source, digest and health bindings', () => {
  assert.throws(
    () =>
      validateRollbackReadiness({
        ...plan(),
        priorHealth: { ...plan().priorHealth, sourceSha: '3'.repeat(40) },
      }),
    /PRIOR_SOURCE_MISMATCH/u,
  );
  assert.throws(
    () =>
      validateRollbackReadiness({
        ...plan(),
        priorHealth: {
          ...plan().priorHealth,
          images: { ...images, api: `sha256:${'f'.repeat(64)}` },
        },
      }),
    /PRIOR_DIGEST_MISMATCH/u,
  );
  assert.throws(
    () =>
      validateRollbackReadiness({
        ...plan(),
        priorHealth: { ...plan().priorHealth, checks: { ...checks, api: 'FAILED' } },
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
        validateRollbackReadiness({
          ...plan(),
          migrationDecision: { ...plan().migrationDecision, currentMigrationHead },
        }),
      /INVALID_MIGRATION_DECISION/u,
    );
  }
});

test('failure injection never reports verified rollback without post-restart source, digest and health proof', async () => {
  const cases = [
    { sourceSha: '3'.repeat(40), images, checks },
    { sourceSha: '2'.repeat(40), images: { ...images, web: `sha256:${'f'.repeat(64)}` }, checks },
    { sourceSha: '2'.repeat(40), images, checks: { ...checks, worker: 'FAILED' } },
  ];
  for (const observed of cases) {
    let restarted = 0;
    await assert.rejects(
      executeVerifiedRollback(plan(), {
        restartPriorRelease: async () => {
          restarted += 1;
        },
        observePriorRelease: async () => observed,
      }),
      RecoveryContractError,
    );
    assert.equal(restarted, 1);
  }
});

test('returns VERIFIED only after the exact prior release is observed healthy', async () => {
  const result = await executeVerifiedRollback(plan(), {
    restartPriorRelease: async () => undefined,
    observePriorRelease: async () => ({ sourceSha: '2'.repeat(40), images, checks }),
  });
  assert.equal(result.outcome, 'VERIFIED');
  assert.equal(result.sourceSha, '2'.repeat(40));
});
