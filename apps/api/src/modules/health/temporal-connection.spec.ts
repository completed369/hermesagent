import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkTemporalConnection } from '@ventureos/workflows';

describe('checkTemporalConnection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses only the standard gRPC health check under one absolute deadline', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const check = vi.fn().mockResolvedValue({ status: 1 });
    const withDeadline = vi.fn(async (_deadline: number, operation: () => Promise<unknown>) =>
      operation(),
    );
    const close = vi.fn();
    const connection = {
      healthService: { check },
      workflowService: {
        startWorkflowExecution: vi.fn(),
        executeWorkflow: vi.fn(),
        signalWorkflowExecution: vi.fn(),
        updateWorkflowExecution: vi.fn(),
        terminateWorkflowExecution: vi.fn(),
        cancelWorkflowExecution: vi.fn(),
      },
      withDeadline,
      close,
    };
    const connect = vi.fn().mockImplementation(() => {
      now = 2_500;
      return connection;
    });

    await expect(checkTemporalConnection('temporal.test:7233', 3_000, connect)).resolves.toBe(true);

    expect(connect).toHaveBeenCalledWith({ address: 'temporal.test:7233', connectTimeout: 3_000 });
    expect(withDeadline).toHaveBeenCalledOnce();
    expect(withDeadline.mock.calls[0]?.[0]).toBe(4_000);
    expect(check).toHaveBeenCalledWith({ service: '' });
    expect(connection.workflowService.startWorkflowExecution).not.toHaveBeenCalled();
    expect(connection.workflowService.executeWorkflow).not.toHaveBeenCalled();
    expect(connection.workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
    expect(connection.workflowService.updateWorkflowExecution).not.toHaveBeenCalled();
    expect(connection.workflowService.terminateWorkflowExecution).not.toHaveBeenCalled();
    expect(connection.workflowService.cancelWorkflowExecution).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not falsely report a non-serving Temporal response as ready', async () => {
    const connection = {
      healthService: { check: vi.fn().mockResolvedValue({ status: 2 }) },
      withDeadline: vi.fn(async (_deadline: number, operation: () => Promise<unknown>) =>
        operation(),
      ),
      close: vi.fn(),
    };
    const connect = vi.fn().mockReturnValue(connection);

    await expect(checkTemporalConnection('temporal.test:7233', 3_000, connect)).resolves.toBe(
      false,
    );
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it('closes the lazy connection when connectivity establishment rejects', async () => {
    const connection = {
      close: vi.fn(),
      healthService: {
        check: vi.fn().mockRejectedValue(new Error('Temporal unavailable')),
      },
      withDeadline: vi.fn(async (_deadline: number, operation: () => Promise<unknown>) =>
        operation(),
      ),
    };
    const connect = vi.fn().mockReturnValue(connection);

    await expect(checkTemporalConnection('temporal.test:7233', 3_000, connect)).rejects.toThrow(
      'Temporal unavailable',
    );
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it('waits for asynchronous connection cleanup before resolving', async () => {
    let finishClose!: () => void;
    const closeFinished = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const connection = {
      close: vi.fn(() => closeFinished),
      healthService: { check: vi.fn().mockResolvedValue({ status: 1 }) },
      withDeadline: vi.fn(async (_deadline: number, operation: () => Promise<unknown>) =>
        operation(),
      ),
    };
    const connect = vi.fn().mockReturnValue(connection);
    let resolved = false;

    const check = checkTemporalConnection('temporal.test:7233', 3_000, connect).then((result) => {
      resolved = true;
      return result;
    });
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce());
    expect(resolved).toBe(false);

    finishClose();
    await expect(check).resolves.toBe(true);
  });

  it('waits for asynchronous connection cleanup before rejecting', async () => {
    let finishClose!: () => void;
    const closeFinished = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const connection = {
      close: vi.fn(() => closeFinished),
      healthService: { check: vi.fn().mockRejectedValue(new Error('Temporal unavailable')) },
      withDeadline: vi.fn(async (_deadline: number, operation: () => Promise<unknown>) =>
        operation(),
      ),
    };
    const connect = vi.fn().mockReturnValue(connection);
    let settled = false;

    const check = checkTemporalConnection('temporal.test:7233', 3_000, connect).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    finishClose();
    await expect(check).rejects.toThrow('Temporal unavailable');
    expect(settled).toBe(true);
  });

  it('rejects at the SDK deadline and closes before settling', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const connection = {
      close: vi.fn().mockResolvedValue(undefined),
      healthService: {
        check: vi.fn(
          () =>
            new Promise<never>((_resolve, reject) => {
              setTimeout(() => reject(new Error('DEADLINE_EXCEEDED')), 3_000);
            }),
        ),
      },
      withDeadline: vi.fn(async (_deadline: number, operation: () => Promise<unknown>) =>
        operation(),
      ),
    };
    const connect = vi.fn().mockReturnValue(connection);
    let settled = false;

    const check = checkTemporalConnection('temporal.test:7233', 3_000, connect).finally(() => {
      settled = true;
    });
    const rejection = expect(check).rejects.toThrow('DEADLINE_EXCEEDED');
    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(connection.withDeadline).toHaveBeenCalledWith(4_000, expect.any(Function));
    expect(connection.close).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
  });

  it('propagates cleanup rejection', async () => {
    const connection = {
      close: vi.fn().mockRejectedValue(new Error('cleanup failed')),
      healthService: { check: vi.fn().mockResolvedValue({ status: 1 }) },
      withDeadline: vi.fn(async (_deadline: number, operation: () => Promise<unknown>) =>
        operation(),
      ),
    };
    const connect = vi.fn().mockReturnValue(connection);

    await expect(checkTemporalConnection('temporal.test:7233', 3_000, connect)).rejects.toThrow(
      'cleanup failed',
    );
  });

  it('leaves no background unsettled cleanup after repeated calls', async () => {
    let activeCleanup = 0;
    let completedCleanup = 0;
    const connect = vi.fn().mockImplementation(() => ({
      close: vi.fn(async () => {
        activeCleanup += 1;
        await Promise.resolve();
        activeCleanup -= 1;
        completedCleanup += 1;
      }),
      healthService: { check: vi.fn().mockResolvedValue({ status: 1 }) },
      withDeadline: vi.fn(async (_deadline: number, operation: () => Promise<unknown>) =>
        operation(),
      ),
    }));

    await expect(
      Promise.all(
        Array.from({ length: 10 }, () =>
          checkTemporalConnection('temporal.test:7233', 3_000, connect),
        ),
      ),
    ).resolves.toEqual(Array.from({ length: 10 }, () => true));
    expect(activeCleanup).toBe(0);
    expect(completedCleanup).toBe(10);
  });

  it('cannot obtain a WorkflowClient or workflow handle', () => {
    const implementation = checkTemporalConnection.toString();

    expect(implementation).not.toContain('WorkflowClient');
    expect(implementation).not.toContain('getHandle');
  });
});
