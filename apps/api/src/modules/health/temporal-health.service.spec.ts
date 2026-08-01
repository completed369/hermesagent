import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@ventureos/config';
import { checkTemporalConnection } from '@ventureos/workflows';
import { TemporalHealthService } from './temporal-health.service';

vi.mock('@ventureos/workflows', () => ({
  checkTemporalConnection: vi.fn(),
}));

const env = {
  TEMPORAL_ADDRESS: 'temporal.internal:7233',
} as Env;

describe('TemporalHealthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('reports available after only the approved non-mutating connectivity operation', async () => {
    vi.mocked(checkTemporalConnection).mockResolvedValue(true);
    const service = new TemporalHealthService(env);

    await expect(service.runConnectivityCheck()).resolves.toEqual({ status: 'ok' });
    expect(checkTemporalConnection).toHaveBeenCalledOnce();
    expect(checkTemporalConnection).toHaveBeenCalledWith(env.TEMPORAL_ADDRESS, 3_000);
  });

  it('reports unavailable without exposing the internal Temporal error', async () => {
    vi.mocked(checkTemporalConnection).mockRejectedValue(
      new Error('connect ECONNREFUSED temporal.internal:7233 namespace=secret'),
    );
    const service = new TemporalHealthService(env);

    const result = await service.runConnectivityCheck();

    expect(result).toEqual({ status: 'down' });
    expect(JSON.stringify(result)).not.toContain('temporal.internal');
    expect(JSON.stringify(result)).not.toContain('namespace');
  });

  it('bounds a stalled Temporal check and reports timeout as unavailable', async () => {
    vi.useFakeTimers();
    vi.mocked(checkTemporalConnection).mockReturnValue(new Promise<boolean>(() => undefined));
    const service = new TemporalHealthService(env);

    const result = service.runConnectivityCheck();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(result).resolves.toEqual({ status: 'down' });
  });

  it('never obtains a workflow handle or mutates workflow state', async () => {
    vi.mocked(checkTemporalConnection).mockResolvedValue(true);
    const workflow = {
      start: vi.fn(),
      execute: vi.fn(),
      getHandle: vi.fn(),
      signal: vi.fn(),
      update: vi.fn(),
      terminate: vi.fn(),
    };
    const service = new TemporalHealthService(env);

    await service.runConnectivityCheck();
    await service.runConnectivityCheck();

    expect(workflow.start).not.toHaveBeenCalled();
    expect(workflow.execute).not.toHaveBeenCalled();
    expect(workflow.getHandle).not.toHaveBeenCalled();
    expect(workflow.signal).not.toHaveBeenCalled();
    expect(workflow.update).not.toHaveBeenCalled();
    expect(workflow.terminate).not.toHaveBeenCalled();
    expect(checkTemporalConnection).toHaveBeenCalledTimes(2);
  });
});
