import { describe, expect, it } from 'vitest';
import { assertWorkspaceScope, isActiveMemory, type MemoryRecord } from './index';

const baseRecord: MemoryRecord = {
  id: 'memory-1',
  workspaceId: 'workspace-a',
  kind: 'FACT',
  subject: 'venture-1',
  key: 'target-market',
  payload: { value: 'digital creators' },
  sourceRef: 'audit:event-1',
  confidence: 0.9,
  sensitivity: 'INTERNAL',
  createdBy: 'agent:research',
  createdAt: new Date('2026-08-14T00:00:00Z'),
  updatedAt: new Date('2026-08-14T00:00:00Z'),
  expiresAt: null,
  supersededById: null,
  revokedAt: null,
};

describe('memory governance helpers', () => {
  it('requires an explicit workspace scope', () => {
    expect(assertWorkspaceScope('workspace-a')).toBe('workspace-a');
    expect(() => assertWorkspaceScope('')).toThrow('workspaceId is required');
  });

  it('returns only active advisory memory by default', () => {
    expect(isActiveMemory(baseRecord, new Date('2026-08-15T00:00:00Z'))).toBe(true);
    expect(
      isActiveMemory(
        { ...baseRecord, revokedAt: new Date('2026-08-14T12:00:00Z') },
        new Date('2026-08-15T00:00:00Z'),
      ),
    ).toBe(false);
    expect(
      isActiveMemory(
        { ...baseRecord, expiresAt: new Date('2026-08-14T12:00:00Z') },
        new Date('2026-08-15T00:00:00Z'),
      ),
    ).toBe(false);
    expect(
      isActiveMemory(
        { ...baseRecord, supersededById: 'memory-2' },
        new Date('2026-08-15T00:00:00Z'),
      ),
    ).toBe(false);
  });
});
