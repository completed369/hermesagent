import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaMemoryStore } from '@ventureos/agent-runtime';
import { Prisma, prisma } from '@ventureos/database';

describe('governed agent memory persistence (integration)', () => {
  const workspaceIds: string[] = [];
  const store = new PrismaMemoryStore();

  async function createWorkspace(label: string) {
    const workspace = await prisma.workspace.create({
      data: {
        name: `Memory ${label} ${randomUUID()}`,
        slug: `memory-${label.toLowerCase()}-${randomUUID()}`,
      },
    });
    workspaceIds.push(workspace.id);
    return workspace;
  }

  afterAll(async () => {
    if (workspaceIds.length) {
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    await prisma.$disconnect();
  });

  it('isolates workspaces and excludes expired, revoked, and superseded records', async () => {
    const workspaceA = await createWorkspace('A');
    const workspaceB = await createWorkspace('B');

    const original = await store.put({
      workspaceId: workspaceA.id,
      kind: 'FACT',
      subject: 'venture:alpha',
      key: 'target-market',
      payload: { value: 'digital creators' },
      sourceRef: 'evidence:alpha-1',
      confidence: 0.9,
      sensitivity: 'INTERNAL',
      createdBy: 'agent:research',
    });
    await store.put({
      workspaceId: workspaceB.id,
      kind: 'FACT',
      subject: 'venture:alpha',
      key: 'target-market',
      payload: { value: 'workspace-b-only' },
      sourceRef: 'evidence:beta-1',
      confidence: 0.8,
      sensitivity: 'CONFIDENTIAL',
      createdBy: 'agent:research',
    });
    await store.put({
      workspaceId: workspaceA.id,
      kind: 'EPISODE',
      subject: 'venture:alpha',
      key: 'expired-observation',
      payload: { value: 'stale' },
      sourceRef: 'audit:expired-1',
      confidence: 0.5,
      sensitivity: 'INTERNAL',
      createdBy: 'agent:research',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const workspaceAInitial = await store.query({ workspaceId: workspaceA.id, limit: 20 });
    expect(workspaceAInitial).toHaveLength(1);
    expect(workspaceAInitial[0]?.id).toBe(original.id);
    expect(JSON.stringify(workspaceAInitial)).not.toContain('workspace-b-only');

    await expect(store.revoke(workspaceB.id, original.id, 'founder:cross-tenant')).rejects.toThrow(
      'Memory not found in workspace',
    );

    const replacementWrite = {
      workspaceId: workspaceA.id,
      kind: 'FACT' as const,
      subject: 'venture:alpha',
      key: 'target-market',
      payload: { value: 'independent digital creators' },
      sourceRef: 'evidence:alpha-2',
      confidence: 0.95,
      sensitivity: 'INTERNAL' as const,
      createdBy: 'agent:research',
    };
    const superseded = await store.supersede(
      workspaceA.id,
      original.id,
      replacementWrite,
      'founder:memory-correction',
    );
    expect(superseded.previous.supersededById).toBe(superseded.replacement.id);

    const afterSupersession = await store.query({
      workspaceId: workspaceA.id,
      subject: 'venture:alpha',
      keys: ['target-market'],
    });
    expect(afterSupersession.map(({ id }) => id)).toEqual([superseded.replacement.id]);

    const revoked = await store.revoke(
      workspaceA.id,
      superseded.replacement.id,
      'founder:data-revocation',
    );
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(
      await store.query({
        workspaceId: workspaceA.id,
        subject: 'venture:alpha',
        keys: ['target-market'],
      }),
    ).toEqual([]);

    const actorRows = await prisma.$queryRaw<
      Array<{
        id: string;
        supersededByActor: string | null;
        revokedBy: string | null;
      }>
    >(Prisma.sql`
      SELECT "id", "supersededByActor", "revokedBy"
      FROM "memory_entries"
      WHERE "workspaceId" = CAST(${workspaceA.id} AS uuid)
        AND "id" IN (CAST(${original.id} AS uuid), CAST(${superseded.replacement.id} AS uuid))
      ORDER BY "createdAt" ASC
    `);
    expect(actorRows).toEqual([
      {
        id: original.id,
        supersededByActor: 'founder:memory-correction',
        revokedBy: null,
      },
      {
        id: superseded.replacement.id,
        supersededByActor: null,
        revokedBy: 'founder:data-revocation',
      },
    ]);
  });

  it('applies deterministic kind, key, subject, and sensitivity filters', async () => {
    const workspace = await createWorkspace('Filters');
    await store.put({
      workspaceId: workspace.id,
      kind: 'DECISION',
      subject: 'venture:filters',
      key: 'channel',
      payload: { value: 'organic' },
      sourceRef: 'approval:decision-1',
      confidence: 1,
      sensitivity: 'CONFIDENTIAL',
      createdBy: 'founder:test',
    });
    await store.put({
      workspaceId: workspace.id,
      kind: 'PROCEDURE',
      subject: 'venture:filters',
      key: 'launch-checklist',
      payload: { steps: ['qa', 'approval'] },
      sourceRef: 'audit:procedure-1',
      confidence: 0.85,
      sensitivity: 'RESTRICTED',
      createdBy: 'agent:operations',
    });
    const otherWorkspace = await createWorkspace('RestrictedIsolation');
    await store.put({
      workspaceId: otherWorkspace.id,
      kind: 'PROCEDURE',
      subject: 'venture:filters',
      key: 'other-workspace-restricted',
      payload: { value: 'other workspace restricted memory' },
      sourceRef: 'audit:procedure-2',
      confidence: 0.75,
      sensitivity: 'RESTRICTED',
      createdBy: 'agent:operations',
    });

    const defaultRecall = await store.query({ workspaceId: workspace.id, limit: 20 });
    expect(defaultRecall.map(({ sensitivity }) => sensitivity)).not.toContain('RESTRICTED');
    expect(defaultRecall.map(({ key }) => key)).toEqual(['channel']);

    const decisions = await store.query({
      workspaceId: workspace.id,
      kinds: ['DECISION'],
      subject: 'venture:filters',
      keys: ['channel'],
      sensitivity: ['CONFIDENTIAL'],
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.payload).toEqual({ value: 'organic' });

    const restricted = await store.query({
      workspaceId: workspace.id,
      sensitivity: ['RESTRICTED'],
    });
    expect(restricted).toHaveLength(1);
    expect(restricted[0]?.key).toBe('launch-checklist');
    expect(JSON.stringify(restricted)).not.toContain('other workspace restricted memory');
  });
});
