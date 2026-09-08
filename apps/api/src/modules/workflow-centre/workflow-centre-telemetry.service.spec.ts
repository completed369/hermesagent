import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowCentreTelemetryService } from './workflow-centre-telemetry.service';

const databaseMock = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@ventureos/database', () => ({
  prisma: { auditEvent: { findMany: databaseMock.findMany } },
}));

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('WorkflowCentreTelemetryService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    databaseMock.findMany.mockReset();
  });

  it('rejects malformed reconnect cursors before opening a stream', () => {
    expect(() =>
      new WorkflowCentreTelemetryService().stream(workspaceId, 'arbitrary-history'),
    ).toThrow(BadRequestException);
    expect(databaseMock.findMany).not.toHaveBeenCalled();
  });

  it('projects only allowlisted metadata from bounded workspace-scoped operational events', async () => {
    const createdAt = new Date();
    databaseMock.findMany.mockResolvedValueOnce([
      {
        id: '00000000-0000-4000-8000-000000000010',
        source: 'CONTROL_PLANE',
        action: 'RUN_PROGRESS_RECORDED',
        entityType: 'ACP_RUN',
        entityId: 'run/password',
        correlationId: 'correlation-1',
        occurredAt: null,
        createdAt,
      },
    ]);

    const received: Array<{ type?: string; id?: string; data: unknown }> = [];
    const subscription = new WorkflowCentreTelemetryService().stream(workspaceId).subscribe({
      next: (event) => received.push(event),
    });

    await vi.waitFor(() => expect(databaseMock.findMany).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(received.some((event) => event.type === 'operational.event')).toBe(true),
    );
    subscription.unsubscribe();

    expect(databaseMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId,
          source: { in: ['CONTROL_PLANE', 'AI_COO', 'AGENT_FACTORY'] },
        }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        select: {
          id: true,
          source: true,
          action: true,
          entityType: true,
          entityId: true,
          correlationId: true,
          occurredAt: true,
          createdAt: true,
        },
      }),
    );
    const event = received.find((candidate) => candidate.type === 'operational.event');
    expect(event).toEqual({
      id: `v1.${createdAt.getTime()}.00000000-0000-4000-8000-000000000010`,
      type: 'operational.event',
      retry: 5_000,
      data: {
        schemaVersion: 1,
        source: 'CONTROL_PLANE',
        type: 'RUN_PROGRESS_RECORDED',
        subjectType: 'ACP_RUN',
        subjectId: 'REDACTED_REFERENCE',
        correlationId: 'correlation-1',
        occurredAt: createdAt.toISOString(),
        recordedAt: createdAt.toISOString(),
      },
    });
    expect(JSON.stringify(event)).not.toContain('after');
    expect(JSON.stringify(event)).not.toContain('actor');
  });

  it('labels keepalives as transport-only and never as runtime connectivity evidence', async () => {
    databaseMock.findMany.mockResolvedValue([]);
    const received: Array<{ type?: string; data: unknown }> = [];
    const subscription = new WorkflowCentreTelemetryService().stream(workspaceId).subscribe({
      next: (event) => received.push(event),
    });

    await vi.waitFor(() =>
      expect(received.some((event) => event.type === 'transport.keepalive')).toBe(true),
    );
    subscription.unsubscribe();

    expect(received.find((event) => event.type === 'transport.keepalive')?.data).toMatchObject({
      meaning: 'SSE_TRANSPORT_ONLY',
      connectivity: 'NOT_CONFIGURED',
    });
  });

  it('continues strictly after a valid native Last-Event-ID cursor', async () => {
    databaseMock.findMany.mockResolvedValue([]);
    const cursorCreatedAt = new Date(Date.now() - 60_000);
    const cursorId = '00000000-0000-4000-8000-000000000004';
    const cursor = `v1.${cursorCreatedAt.getTime()}.${cursorId}`;
    const subscription = new WorkflowCentreTelemetryService()
      .stream(workspaceId, cursor)
      .subscribe();

    await vi.waitFor(() => expect(databaseMock.findMany).toHaveBeenCalledOnce());
    subscription.unsubscribe();

    expect(databaseMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { createdAt: { gt: cursorCreatedAt } },
            {
              createdAt: cursorCreatedAt,
              id: { gt: cursorId },
            },
          ],
        }),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 25,
      }),
    );
  });
});
