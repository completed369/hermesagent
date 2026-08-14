import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@ventureos/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ventureos/database')>();
  return {
    ...actual,
    prisma: {
      $executeRaw: mocks.executeRaw,
      $queryRaw: mocks.queryRaw,
      $transaction: mocks.transaction,
    },
  };
});

import { recallMemories, rememberMemory, supersedeMemory } from '../memory.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const MEMORY_ID = '22222222-2222-4222-8222-222222222222';
const REPLACEMENT_ID = '33333333-3333-4333-8333-333333333333';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: MEMORY_ID,
    workspaceId: WORKSPACE_ID,
    type: 'FACT',
    summary: 'Founder prefers low-risk staged launches',
    content: { preference: 'low-risk' },
    sourceType: 'FOUNDER_INPUT',
    sourceRef: 'onboarding',
    confidence: 1,
    sensitivity: 'INTERNAL',
    createdByAgent: null,
    tags: ['founder', 'risk'],
    importance: 80,
    expiresAt: null,
    status: 'ACTIVE',
    supersedesId: null,
    supersededAt: null,
    metadata: null,
    createdAt: new Date('2026-08-14T07:00:00.000Z'),
    ...overrides,
  };
}

describe('governed agent memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeRaw.mockResolvedValue(1);
    mocks.transaction.mockImplementation(async (callback) =>
      callback({ $executeRaw: mocks.executeRaw, $queryRaw: mocks.queryRaw }),
    );
  });

  it('fails before persistence when confidence is outside the governed range', async () => {
    await expect(
      rememberMemory({
        workspaceId: WORKSPACE_ID,
        type: 'FACT',
        summary: 'Invalid confidence',
        content: {},
        sourceType: 'TEST',
        confidence: 1.1,
      }),
    ).rejects.toThrow();

    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('stores a workspace-scoped record with normalized tags and reads it back', async () => {
    mocks.queryRaw.mockResolvedValueOnce([row()]);

    const result = await rememberMemory({
      workspaceId: WORKSPACE_ID,
      type: 'FACT',
      summary: 'Founder prefers low-risk staged launches',
      content: { preference: 'low-risk' },
      sourceType: 'FOUNDER_INPUT',
      sourceRef: 'onboarding',
      tags: ['Risk', 'founder', 'risk'],
      importance: 80,
    });

    expect(result.workspaceId).toBe(WORKSPACE_ID);
    expect(result.status).toBe('ACTIVE');
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    const sql = mocks.executeRaw.mock.calls[0]?.[0] as { values?: unknown[] };
    expect(sql.values).toContain('["founder","risk"]');
  });

  it('applies bounded tag filtering after the workspace-scoped recall query', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      row({ id: MEMORY_ID, tags: ['finance'], importance: 90 }),
      row({ id: REPLACEMENT_ID, tags: ['marketplace'], importance: 80 }),
    ]);

    const result = await recallMemories({
      workspaceId: WORKSPACE_ID,
      tags: ['Finance'],
      limit: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(MEMORY_ID);
  });

  it('refuses to supersede a memory that is not active in the same workspace', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    await expect(
      supersedeMemory({
        workspaceId: WORKSPACE_ID,
        memoryId: MEMORY_ID,
        replacement: {
          type: 'FACT',
          summary: 'Replacement',
          content: {},
          sourceType: 'TEST',
        },
      }),
    ).rejects.toThrow('Active memory not found in workspace');

    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('creates a replacement before marking the previous memory superseded', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: MEMORY_ID, status: 'ACTIVE' }])
      .mockResolvedValueOnce([
        row({
          id: REPLACEMENT_ID,
          summary: 'Updated founder preference',
          supersedesId: MEMORY_ID,
        }),
      ]);

    const result = await supersedeMemory({
      workspaceId: WORKSPACE_ID,
      memoryId: MEMORY_ID,
      replacement: {
        type: 'FACT',
        summary: 'Updated founder preference',
        content: { preference: 'measured-risk' },
        sourceType: 'FOUNDER_INPUT',
      },
    });

    expect(result.supersedesId).toBe(MEMORY_ID);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
  });
});
