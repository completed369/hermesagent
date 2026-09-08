import { Prisma } from '@ventureos/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { WorkflowCentreController } from './workflow-centre.controller';
import { WorkflowCentreService } from './workflow-centre.service';
import { WorkflowCentreTelemetryService } from './workflow-centre-telemetry.service';

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
    const controller = new WorkflowCentreController(
      { snapshot } as unknown as WorkflowCentreService,
      { stream: vi.fn() } as unknown as WorkflowCentreTelemetryService,
    );

    await expect(controller.snapshot(user)).resolves.toEqual({ schemaVersion: 1 });
    expect(snapshot).toHaveBeenCalledOnce();
    expect(snapshot).toHaveBeenCalledWith(user.workspaceId);
  });

  it('derives the telemetry workspace from the session and passes only the reconnect cursor', () => {
    const streamResult = { subscribe: vi.fn() };
    const stream = vi.fn().mockReturnValue(streamResult);
    const controller = new WorkflowCentreController(
      { snapshot: vi.fn() } as unknown as WorkflowCentreService,
      { stream } as unknown as WorkflowCentreTelemetryService,
    );

    expect(
      controller.streamTelemetry(user, 'v1.1788271200000.00000000-0000-4000-8000-000000000004'),
    ).toBe(streamResult);
    expect(stream).toHaveBeenCalledWith(
      user.workspaceId,
      'v1.1788271200000.00000000-0000-4000-8000-000000000004',
    );
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

  it('never infers direct runtime connectivity from an internal CONNECTED record', async () => {
    const empty = () => ({
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ observedAt: new Date('2026-08-26T06:30:00.000Z') }]),
      workflowRun: empty(),
      acpObjective: empty(),
      acpTask: empty(),
      acpTaskDependency: empty(),
      acpRun: empty(),
      acpRuntime: empty(),
      acpRuntimeConnection: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'connection-1',
            runtimeId: 'runtime-1',
            environment: 'TEST_ONLY',
            status: 'CONNECTED',
            lastHeartbeatAt: null,
            lastHeartbeatHealth: null,
            version: 1,
            updatedAt: new Date('2026-08-26T06:00:00.000Z'),
          },
        ]),
      },
      acpApprovalRequest: empty(),
    };
    databaseMock.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );

    const result = await new WorkflowCentreService().snapshot(user.workspaceId);
    expect(result.connectivity.status).toBe('NOT_CONFIGURED');
    expect(result.connections[0]?.status).toBe('CONNECTED');
  });
});
