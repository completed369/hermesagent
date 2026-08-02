import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ventureos/database';
import { MinioStorageProvider } from '@ventureos/integrations';
import type { Env } from '@ventureos/config';
import { HealthService } from './health.service';
import type { TemporalHealthService } from './temporal-health.service';

const storageHealthCheck = vi.fn();

vi.mock('@ventureos/database', () => ({
  prisma: { $queryRaw: vi.fn() },
}));

vi.mock('@ventureos/integrations', () => ({
  MinioStorageProvider: vi.fn(function MockMinioStorageProvider() {
    return { healthCheck: storageHealthCheck };
  }),
}));

const env = {
  STORAGE_PROVIDER: 'minio',
  MINIO_ENDPOINT: 'storage.internal',
  MINIO_PORT: 9000,
  MINIO_USE_SSL: false,
  MINIO_ROOT_USER: 'synthetic-user',
  MINIO_ROOT_PASSWORD: 'synthetic-password',
  MINIO_BUCKET: 'synthetic-bucket',
  STORAGE_MAX_FILE_SIZE_MB: 25,
} as Env;

function temporal(status: 'ok' | 'down' = 'ok') {
  return {
    runConnectivityCheck: vi.fn().mockResolvedValue({ status }),
  } as unknown as TemporalHealthService;
}

describe('HealthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    storageHealthCheck.mockResolvedValue({ healthy: true });
  });

  it('returns liveness without touching Temporal, database, or storage', async () => {
    const temporalHealth = temporal();
    const service = new HealthService(env, temporalHealth);

    await expect(service.liveness()).resolves.toMatchObject({
      status: 'ok',
      checks: { process: { status: 'ok' } },
    });

    expect(temporalHealth.runConnectivityCheck).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(MinioStorageProvider).not.toHaveBeenCalled();
  });

  it('reports ready only when database, storage, and Temporal are available', async () => {
    const temporalHealth = temporal();
    const service = new HealthService(env, temporalHealth);

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ok',
      checks: {
        database: { status: 'ok' },
        storage: { status: 'ok' },
        temporal: { status: 'ok' },
      },
    });

    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(storageHealthCheck).toHaveBeenCalledOnce();
    expect(temporalHealth.runConnectivityCheck).toHaveBeenCalledOnce();
  });

  it('treats explicit mock storage as ready without constructing or contacting MinIO', async () => {
    const service = new HealthService({ ...env, STORAGE_PROVIDER: 'mock' }, temporal());

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ok',
      checks: { storage: { status: 'ok' } },
    });

    expect(MinioStorageProvider).not.toHaveBeenCalled();
    expect(storageHealthCheck).not.toHaveBeenCalled();
  });

  it('reports database unavailability with no internal connection detail', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(
      new Error('password=secret host=database.internal:5432 stack trace'),
    );
    const service = new HealthService(env, temporal());

    const result = await service.readiness();
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({ status: 'down', checks: { database: { status: 'down' } } });
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('database.internal');
    expect(serialized).not.toContain('stack');
  });

  it('reports Temporal unavailability as a readiness failure', async () => {
    const service = new HealthService(env, temporal('down'));

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'down',
      checks: { temporal: { status: 'down' } },
    });
  });

  it('bounds a stalled database check', async () => {
    vi.useFakeTimers();
    vi.mocked(prisma.$queryRaw).mockReturnValue(new Promise<never>(() => undefined) as never);
    const service = new HealthService(env, temporal());

    const result = service.readiness();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(result).resolves.toMatchObject({
      status: 'down',
      checks: { database: { status: 'down' } },
    });
  });

  it('returns no namespace, task queue, connection URL, credential, or stack trace fields', async () => {
    storageHealthCheck.mockRejectedValue(
      new Error('http://storage.internal:9000 taskQueue=private password=synthetic-password'),
    );
    const service = new HealthService(env, temporal('down'));

    const serialized = JSON.stringify(await service.readiness());

    for (const forbidden of [
      'namespace',
      'taskQueue',
      'storage.internal',
      'synthetic-password',
      'stack',
      'message',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
