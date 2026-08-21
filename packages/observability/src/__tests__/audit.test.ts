import { describe, expect, it } from 'vitest';
import { buildAuditEventRecord, verifyAuditEventRecord } from '../audit';

describe('buildAuditEventRecord', () => {
  it('produces a stable integrity hash for identical input', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const a = buildAuditEventRecord(
      { actorId: 'u1', action: 'APPROVE', entityType: 'Proposal', entityId: 'p1' },
      'evt1',
      now,
    );
    const b = buildAuditEventRecord(
      { actorId: 'u1', action: 'APPROVE', entityType: 'Proposal', entityId: 'p1' },
      'evt1',
      now,
    );
    expect(a.integrityHash).toBe(b.integrityHash);
  });

  it('changes the hash when the action changes (tamper-evidence)', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const a = buildAuditEventRecord(
      { actorId: 'u1', action: 'APPROVE', entityType: 'Proposal', entityId: 'p1' },
      'evt1',
      now,
    );
    const b = buildAuditEventRecord(
      { actorId: 'u1', action: 'REJECT', entityType: 'Proposal', entityId: 'p1' },
      'evt1',
      now,
    );
    expect(a.integrityHash).not.toBe(b.integrityHash);
  });

  it('supports integrity-protected anonymous security events', () => {
    const event = buildAuditEventRecord(
      { action: 'INVITE_CLAIM_DEFERRED', entityType: 'Invitation', entityId: 'invite1' },
      'evt-anonymous',
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(event.actorId).toBeNull();
    expect(event.integrityHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('binds operational provenance and idempotency metadata into version 2 checksums', () => {
    const record = buildAuditEventRecord(
      { actorId: 'user-1', action: 'TASK_CREATED', entityType: 'Task', entityId: 'task-1' },
      'event-1',
      new Date('2026-08-21T00:00:00.000Z'),
      {
        workspaceReference: 'workspace-1',
        actorReference: 'user-1',
        source: 'CONTROL_PLANE',
        sourceEventId: 'source-event-1',
        idempotencyKey: 'task-1:created',
        occurredAt: '2026-08-20T23:59:59.000Z',
      },
    );

    expect(record.integrityVersion).toBe(2);
    expect(verifyAuditEventRecord(record)).toBe(true);
    expect(verifyAuditEventRecord({ ...record, sourceEventId: 'substituted' })).toBe(false);
    expect(verifyAuditEventRecord({ ...record, actorReference: 'forged' })).toBe(false);
    expect(verifyAuditEventRecord({ ...record, actorId: null })).toBe(true);
  });

  it('canonicalizes omitted and explicit null optional persisted fields identically', () => {
    const now = new Date('2026-08-21T00:00:00.000Z');
    const omitted = buildAuditEventRecord(
      { action: 'SECURITY_CHECKED', entityType: 'Release', entityId: 'release-1' },
      'event-canonical',
      now,
    );
    const explicitNull = buildAuditEventRecord(
      {
        actorId: null,
        action: 'SECURITY_CHECKED',
        entityType: 'Release',
        entityId: 'release-1',
        before: null,
        after: null,
        correlationId: null,
        workflowId: null,
        policyResult: null,
        approvalReference: null,
        ipOrSessionId: null,
      },
      'event-canonical',
      now,
      {
        workspaceReference: null,
        actorReference: null,
        source: null,
        sourceEventId: null,
        idempotencyKey: null,
        occurredAt: null,
      },
    );

    expect(explicitNull).toEqual(omitted);
    expect(verifyAuditEventRecord(omitted)).toBe(true);
  });
});
