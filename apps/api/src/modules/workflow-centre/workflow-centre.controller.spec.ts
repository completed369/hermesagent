import { Prisma } from '@ventureos/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { WorkflowCentreController } from './workflow-centre.controller';
import { WorkflowCentreService } from './workflow-centre.service';

const databaseMock = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock('@ventureos/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ventureos/database')>()),
  prisma: { $transaction: databaseMock.transaction },
}));

const user: AuthenticatedUser = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  email: 'viewer@example.test',
  isFounder: false,
  workspaceId: '00000000-0000-4000-8000-000000000003',
  workspaceName: 'Viewer workspace',
  roleKey: 'VIEWER',
  permissions: ['workflow:view'],
};

describe('WorkflowCentreController', () => {
  it('derives the only workspace argument from the authenticated user', async () => {
    const snapshot = vi.fn().mockResolvedValue({ schemaVersion: 1 });
    const controller = new WorkflowCentreController({
      snapshot,
    } as unknown as WorkflowCentreService);

    await expect(controller.snapshot(user)).resolves.toEqual({ schemaVersion: 1 });
    expect(snapshot).toHaveBeenCalledOnce();
    expect(snapshot).toHaveBeenCalledWith(user.workspaceId);
  });
});

describe('WorkflowCentreService transaction boundary', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('requests a repeatable-read snapshot rather than unrelated point-in-time reads', async () => {
    const expected = { schemaVersion: 1 };
    databaseMock.transaction.mockResolvedValue(expected);

    await expect(new WorkflowCentreService().snapshot(user.workspaceId)).resolves.toBe(expected);
    expect(databaseMock.transaction).toHaveBeenCalledOnce();
    expect(databaseMock.transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });
});
