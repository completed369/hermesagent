import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkTemporalConnection } from '@ventureos/workflows';

describe('checkTemporalConnection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses only the standard gRPC health check under a shared deadline', async () => {
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
        signalWorkflowExecution: vi.fn(),
        terminateWorkflowExecution: vi.fn(),
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
    expect(connection.workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
    expect(connection.workflowService.terminateWorkflowExecution).not.toHaveBeenCalled();
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
});
