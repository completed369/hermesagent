import { describe, expect, it } from 'vitest';
import { buildAuditEventRecord } from '../audit';

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
});
