import { describe, expect, it } from 'vitest';
import {
  AcpApprovalPolicyError,
  assertAcpApprovalBindingMatch,
  computeAcpApprovalBindingHash,
  validateAcpApprovalRequestInput,
  type AcpApprovalRequestInput,
} from '../approval-bridge';

const NOW = new Date('2026-08-21T00:00:00.000Z');
const binding: AcpApprovalRequestInput = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  objectiveId: 'objective-1',
  taskId: 'task-1',
  runId: 'run-1',
  actionCode: 'PRODUCTION.DEPLOY',
  exactTarget: 'environment:production',
  artifactVersionId: 'artifact-v1',
  evidenceHash: 'a'.repeat(64),
  policyVersion: 'policy-v1',
  policyHash: 'b'.repeat(64),
  idempotencyKey: 'approval-request-1',
  expiresAt: '2026-08-22T00:00:00.000Z',
};

describe('ACP approval binding', () => {
  it('produces a stable digest and binds every execution-sensitive field', () => {
    const hash = computeAcpApprovalBindingHash(binding);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    for (const [field, value] of [
      ['workspaceId', '22222222-2222-4222-8222-222222222222'],
      ['objectiveId', 'objective-2'],
      ['taskId', 'task-2'],
      ['runId', 'run-2'],
      ['actionCode', 'PRODUCTION.PUBLISH'],
      ['exactTarget', 'environment:other'],
      ['artifactVersionId', 'artifact-v2'],
      ['evidenceHash', 'c'.repeat(64)],
      ['policyVersion', 'policy-v2'],
      ['policyHash', 'd'.repeat(64)],
    ] as const) {
      expect(
        computeAcpApprovalBindingHash({ ...binding, [field]: value }),
        `field ${field}`,
      ).not.toBe(hash);
    }
  });

  it('rejects drift in target, task/run, evidence, and policy bindings', () => {
    for (const current of [
      { ...binding, taskId: 'task-2' },
      { ...binding, runId: 'run-2' },
      { ...binding, exactTarget: 'environment:other' },
      { ...binding, evidenceHash: 'c'.repeat(64) },
      { ...binding, policyHash: 'd'.repeat(64) },
    ]) {
      expect(() => assertAcpApprovalBindingMatch(binding, current)).toThrow(AcpApprovalPolicyError);
    }
  });

  it.each([
    ['workspaceId', 'password-workspace'],
    ['objectiveId', 'chain-of-thought'],
    ['taskId', 'password-secret'],
    ['runId', 'api-key-value'],
    ['actionCode', 'SECRET.ACTION'],
    ['exactTarget', 'token-secret'],
    ['artifactVersionId', 'credential-artifact'],
    ['policyVersion', 'private-reasoning'],
    ['idempotencyKey', 'prompt-transcript'],
    ['exactTarget', 'ghp_12345678901234567890'],
    ['idempotencyKey', 'AKIA1234567890ABCDEF'],
  ] as const)('rejects sensitive material in %s', (field, value) => {
    expect(() => validateAcpApprovalRequestInput({ ...binding, [field]: value }, NOW)).toThrow(
      /safe (?:non-sensitive reference|action code)/,
    );
  });

  it('rejects malformed hashes and unbounded or expired approval windows', () => {
    expect(() =>
      validateAcpApprovalRequestInput({ ...binding, evidenceHash: 'not-a-hash' }, NOW),
    ).toThrow(/SHA-256/);
    expect(() =>
      validateAcpApprovalRequestInput({ ...binding, expiresAt: '2026-08-21T00:00:00.000Z' }, NOW),
    ).toThrow(/future/);
    expect(() =>
      validateAcpApprovalRequestInput({ ...binding, expiresAt: '2026-09-21T00:00:00.000Z' }, NOW),
    ).toThrow(/7 days/);
  });
});
