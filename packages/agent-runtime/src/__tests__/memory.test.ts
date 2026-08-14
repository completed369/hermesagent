import { describe, expect, it } from 'vitest';
import {
  assertWorkspaceScope,
  isActiveMemory,
  memoryRecordSchema,
  type MemoryRecord,
} from '../memory.js';

const MEMORY_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const SUPERSEDING_MEMORY_ID = '33333333-3333-4333-8333-333333333333';

const baseRecord: MemoryRecord = {
  id: MEMORY_ID,
  workspaceId: WORKSPACE_ID,
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
  it('requires a valid UUID workspace scope', () => {
    expect(assertWorkspaceScope(WORKSPACE_ID)).toBe(WORKSPACE_ID);
    expect(() => assertWorkspaceScope('')).toThrow('workspaceId must be a valid UUID');
    expect(() => assertWorkspaceScope('workspace-a')).toThrow('workspaceId must be a valid UUID');
  });

  it('validates record and memory IDs as UUIDs in the public contract', () => {
    expect(memoryRecordSchema.parse(baseRecord).id).toBe(MEMORY_ID);
    expect(() => memoryRecordSchema.parse({ ...baseRecord, id: 'memory-1' })).toThrow();
    expect(() => memoryRecordSchema.parse({ ...baseRecord, workspaceId: 'workspace-a' })).toThrow();
    expect(() => memoryRecordSchema.parse({ ...baseRecord, supersededById: 'memory-2' })).toThrow();
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
        { ...baseRecord, supersededById: SUPERSEDING_MEMORY_ID },
        new Date('2026-08-15T00:00:00Z'),
      ),
    ).toBe(false);
  });
});
