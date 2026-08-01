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
  });

  it('reports serving as available through the approved helper', async () => {
    vi.mocked(checkTemporalConnection).mockResolvedValue(true);
    const service = new TemporalHealthService(env);

    await expect(service.runConnectivityCheck()).resolves.toEqual({ status: 'ok' });
    expect(checkTemporalConnection).toHaveBeenCalledOnce();
    expect(checkTemporalConnection).toHaveBeenCalledWith(env.TEMPORAL_ADDRESS, 3_000);
  });

  it('reports a non-serving response as unavailable', async () => {
    vi.mocked(checkTemporalConnection).mockResolvedValue(false);
    const service = new TemporalHealthService(env);

    await expect(service.runConnectivityCheck()).resolves.toEqual({ status: 'down' });
  });

  it('reports connection or Health Check rejection without internal details', async () => {
    vi.mocked(checkTemporalConnection).mockRejectedValue(
      new Error('connect ECONNREFUSED temporal.internal:7233 namespace=secret'),
    );
    const service = new TemporalHealthService(env);

    const result = await service.runConnectivityCheck();
    const serialized = JSON.stringify(result);

    expect(result).toEqual({ status: 'down' });
    expect(serialized).not.toContain('temporal.internal');
    expect(serialized).not.toContain('namespace');
    expect(serialized).not.toContain('ECONNREFUSED');
  });

  it('reports an SDK deadline rejection as unavailable', async () => {
    vi.mocked(checkTemporalConnection).mockRejectedValue(
      new Error('DEADLINE_EXCEEDED temporal.internal:7233'),
    );
    const service = new TemporalHealthService(env);

    await expect(service.runConnectivityCheck()).resolves.toEqual({ status: 'down' });
  });

  it('waits for the fully settled helper instead of racing it with another timeout', async () => {
    let finishCheck!: (serving: boolean) => void;
    vi.mocked(checkTemporalConnection).mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishCheck = resolve;
      }),
    );
    const service = new TemporalHealthService(env);
    let settled = false;

    const result = service.runConnectivityCheck().then((status) => {
      settled = true;
      return status;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishCheck(true);
    await expect(result).resolves.toEqual({ status: 'ok' });
  });

  it('converts connection cleanup rejection to a generic unavailable result', async () => {
    vi.mocked(checkTemporalConnection).mockRejectedValue(
      new Error('close failed for temporal.internal:7233 namespace=secret'),
    );
    const service = new TemporalHealthService(env);

    const result = await service.runConnectivityCheck();
    const serialized = JSON.stringify(result);

    expect(result).toEqual({ status: 'down' });
    expect(serialized).not.toContain('temporal.internal');
    expect(serialized).not.toContain('namespace');
    expect(serialized).not.toContain('close failed');
  });

  it('contains no independent Promise.race timeout', () => {
    const implementation = TemporalHealthService.prototype.runConnectivityCheck.toString();

    expect(implementation).not.toContain('Promise.race');
    expect(implementation).not.toContain('withHealthTimeout');
  });
});
