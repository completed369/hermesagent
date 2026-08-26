import { describe, expect, it } from 'vitest';

import type { ValidatedSupervisorAdmission } from './supervision-policy';
import {
  assertSupervisorProcessTransition,
  createSupervisorProcessBinding,
  SUPERVISOR_PROCESS_TRANSITIONS,
  validateSupervisorCancellation,
  validateSupervisorProcessBinding,
} from './supervision-lifecycle';

const admission = {
  manifest: {
    workspaceId: 'workspace-fixture',
    runtimeId: 'runtime-fixture',
    connectionId: 'connection-fixture',
    platform: 'WIN32',
    testOnly: true,
  },
  manifestHash: '1'.repeat(64),
  evidenceHash: '2'.repeat(64),
  bindingHash: '3'.repeat(64),
} as ValidatedSupervisorAdmission;

function binding() {
  return createSupervisorProcessBinding(admission, 'supervision-fixture', 'nonce-fixture');
}

describe('pure supervisor lifecycle contract', () => {
  it('binds cancellation to every exact admission and process identity field', () => {
    const current = binding();
    const cancellation = validateSupervisorCancellation(current, {
      ...current,
      cancellationId: 'cancel-fixture',
      code: 'POLICY_REVOKED',
    });
    expect(cancellation).toMatchObject({
      supervisionId: 'supervision-fixture',
      launchNonce: 'nonce-fixture',
      code: 'POLICY_REVOKED',
    });
    expect(Object.isFrozen(cancellation)).toBe(true);

    for (const field of [
      'supervisionId',
      'launchNonce',
      'workspaceId',
      'runtimeId',
      'connectionId',
      'platform',
      'manifestHash',
      'admissionEvidenceHash',
      'admissionBindingHash',
      'testOnly',
    ] as const) {
      const drifted = { ...current, cancellationId: 'cancel-fixture', code: 'SHUTDOWN' };
      Object.assign(drifted, {
        [field]:
          typeof drifted[field] === 'boolean'
            ? !drifted[field]
            : field === 'platform'
              ? 'LINUX'
              : field.endsWith('Hash')
                ? '9'.repeat(64)
                : `${String(drifted[field])}-drift`,
      });
      expect(() => validateSupervisorCancellation(current, drifted)).toThrow(/BINDING_MISMATCH/u);
    }
  });

  it('rejects unknown keys, free-form reasons, secrets, private reasoning and malformed hashes', () => {
    const current = binding();
    expect(() => validateSupervisorProcessBinding({ ...current, pid: 42 })).toThrow(
      /INVALID_BINDING/u,
    );
    expect(() =>
      validateSupervisorCancellation(current, {
        ...current,
        cancellationId: 'cancel-fixture',
        code: 'because the process looked wrong',
      }),
    ).toThrow(/INVALID_CANCELLATION/u);
    for (const cancellationId of [
      'password-reference',
      'private-reasoning',
      'github_pat_abcdefghijklmnopqrstuvwxyz',
    ]) {
      expect(() =>
        validateSupervisorCancellation(current, {
          ...current,
          cancellationId,
          code: 'SHUTDOWN',
        }),
      ).toThrow(/INVALID_CANCELLATION/u);
    }
    expect(() =>
      validateSupervisorProcessBinding({ ...current, manifestHash: 'not-a-digest' }),
    ).toThrow(/INVALID_BINDING/u);
  });

  it('permits only the declared cancellation and terminal sequence', () => {
    expect(SUPERVISOR_PROCESS_TRANSITIONS.EXITED).toEqual([]);
    expect(() => assertSupervisorProcessTransition('RUNNING', 'CANCEL_REQUESTED')).not.toThrow();
    expect(() =>
      assertSupervisorProcessTransition('CANCEL_REQUESTED', 'TERMINATING'),
    ).not.toThrow();
    expect(() => assertSupervisorProcessTransition('TERMINATING', 'KILLING')).not.toThrow();
    expect(() => assertSupervisorProcessTransition('KILLING', 'EXITED')).not.toThrow();
    expect(() => assertSupervisorProcessTransition('RUNNING', 'KILLING')).toThrow(
      /ILLEGAL_TRANSITION/u,
    );
    expect(() => assertSupervisorProcessTransition('EXITED', 'RUNNING')).toThrow(
      /ILLEGAL_TRANSITION/u,
    );
  });
});
