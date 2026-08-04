import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { HealthController } from './health.controller';
import type { HealthService, HealthStatus } from './health.service';
import type { TemporalHealthService } from './temporal-health.service';

function result(status: 'ok' | 'down', component: string): HealthStatus {
  return {
    status,
    checks: { [component]: { status } },
    timestamp: '2026-08-01T00:00:00.000Z',
  };
}

function response() {
  return { status: vi.fn() } as unknown as Response;
}

describe('HealthController', () => {
  it('keeps public liveness compatible and independent of Temporal', async () => {
    const health = {
      liveness: vi.fn().mockResolvedValue(result('ok', 'process')),
      readiness: vi.fn(),
    } as unknown as HealthService;
    const temporal = { runConnectivityCheck: vi.fn() } as unknown as TemporalHealthService;
    const controller = new HealthController(health, temporal);

    await expect(controller.live()).resolves.toEqual(result('ok', 'process'));
    expect(temporal.runConnectivityCheck).not.toHaveBeenCalled();
  });

  it('returns HTTP 200 for available readiness', async () => {
    const ready = result('ok', 'database');
    const health = {
      liveness: vi.fn(),
      readiness: vi.fn().mockResolvedValue(ready),
    } as unknown as HealthService;
    const controller = new HealthController(health, {
      runConnectivityCheck: vi.fn(),
    } as unknown as TemporalHealthService);
    const res = response();

    await expect(controller.ready(res)).resolves.toEqual(ready);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns HTTP 503 for unavailable readiness', async () => {
    const down = result('down', 'temporal');
    const health = {
      liveness: vi.fn(),
      readiness: vi.fn().mockResolvedValue(down),
    } as unknown as HealthService;
    const controller = new HealthController(health, {
      runConnectivityCheck: vi.fn(),
    } as unknown as TemporalHealthService);
    const res = response();

    await expect(controller.ready(res)).resolves.toEqual(down);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('keeps the public Temporal route but makes it a status-only non-mutating check', async () => {
    const temporalStatus = { status: 'ok' as const };
    const temporal = {
      runConnectivityCheck: vi.fn().mockResolvedValue(temporalStatus),
    } as unknown as TemporalHealthService;
    const controller = new HealthController({} as HealthService, temporal);
    const res = response();

    await expect(controller.temporal(res)).resolves.toMatchObject({
      status: 'ok',
      checks: { temporal: { status: 'ok' } },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
