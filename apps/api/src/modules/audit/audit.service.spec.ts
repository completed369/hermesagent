import { describe, expect, it, vi } from 'vitest';

vi.mock('@ventureos/database', () => ({ prisma: {} }));

import { AuditService } from './audit.service';
import { OperationalEventCapability, type OperationalEvent } from '@ventureos/agent-control-plane';

const context = { workspaceId: '11111111-1111-4111-8111-111111111111', principalId: 'runtime-1' };
const capability = OperationalEventCapability.issue('CONTROL_PLANE', { 'runtime-1': 'RUNTIME' });

const operationalEvent: OperationalEvent = {
  id: 'runtime-event-1',
  workspaceId: context.workspaceId,
  type: 'run.completed',
  source: 'CONTROL_PLANE',
  actorKind: 'RUNTIME',
  actorId: context.principalId,
  subjectType: 'Run',
  subjectId: 'run-1',
  occurredAt: '2026-08-21T00:00:00.000Z',
  idempotencyKey: 'run-1:completed',
  correlationId: 'task-1',
  facts: { previousStatus: 'RUNNING', nextStatus: 'COMPLETED', taskId: 'task-1' },
};

describe('AuditService operational event persistence', () => {
  it('maps a validated runtime event without treating the runtime as a user relation', async () => {
    const create = vi.fn().mockResolvedValue({});
    await new AuditService().recordOperationalEvent(
      capability,
      context,
      operationalEvent,
      undefined,
      {
        auditEvent: { create },
      } as never,
    );

    expect(create).toHaveBeenCalledOnce();
    const data = create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({
      workspaceId: context.workspaceId,
      actorId: undefined,
      workspaceReference: context.workspaceId,
      actorReference: 'runtime-1',
      source: 'CONTROL_PLANE',
      sourceEventId: 'runtime-event-1',
      idempotencyKey: 'run-1:completed',
      action: 'run.completed',
      entityType: 'Run',
      entityId: 'run-1',
      integrityVersion: 2,
    });
    expect(data.integrityHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects relational actor substitution and writes nothing', async () => {
    const create = vi.fn();
    await expect(
      new AuditService().recordOperationalEvent(
        capability,
        context,
        operationalEvent,
        'forged-user',
        {
          auditEvent: { create },
        } as never,
      ),
    ).rejects.toThrow(/authenticated human/);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects cross-workspace operational events before persistence', async () => {
    const create = vi.fn();
    await expect(
      new AuditService().recordOperationalEvent(
        capability,
        { ...context, workspaceId: '22222222-2222-4222-8222-222222222222' },
        operationalEvent,
        undefined,
        { auditEvent: { create } } as never,
      ),
    ).rejects.toThrow(/Cross-workspace/);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects source and actor-kind substitution against the trusted capability', async () => {
    const create = vi.fn();
    await expect(
      new AuditService().recordOperationalEvent(
        capability,
        context,
        { ...operationalEvent, source: 'AI_COO' },
        undefined,
        { auditEvent: { create } } as never,
      ),
    ).rejects.toThrow(/trusted capability/);
    await expect(
      new AuditService().recordOperationalEvent(
        capability,
        context,
        { ...operationalEvent, actorKind: 'HUMAN' },
        undefined,
        { auditEvent: { create } } as never,
      ),
    ).rejects.toThrow(/trusted principal binding/);
    expect(create).not.toHaveBeenCalled();
  });
});
