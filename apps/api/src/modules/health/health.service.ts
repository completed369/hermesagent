import { Inject, Injectable } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import { MinioStorageProvider } from '@ventureos/integrations';
import { ENV_TOKEN } from '../../config/env.provider';
import type { Env } from '@ventureos/config';
import { TemporalHealthService } from './temporal-health.service';
import { withHealthTimeout } from './health-timeout';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  checks: Record<string, { status: 'ok' | 'down' }>;
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    @Inject(TemporalHealthService) private readonly temporalHealthService: TemporalHealthService,
  ) {}

  async liveness(): Promise<HealthStatus> {
    return {
      status: 'ok',
      checks: { process: { status: 'ok' } },
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<HealthStatus> {
    const [database, storage, temporal] = await Promise.all([
      this.databaseReadiness(),
      this.storageReadiness(),
      this.temporalHealthService.runConnectivityCheck(),
    ]);
    const checks: HealthStatus['checks'] = { database, storage, temporal };

    const anyDown = Object.values(checks).some((c) => c.status === 'down');
    return {
      status: anyDown ? 'down' : 'ok',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private async databaseReadiness(): Promise<{ status: 'ok' | 'down' }> {
    try {
      await withHealthTimeout(prisma.$queryRaw`SELECT 1`);
      return { status: 'ok' };
    } catch {
      return { status: 'down' };
    }
  }

  private async storageReadiness(): Promise<{ status: 'ok' | 'down' }> {
    try {
      const storage = new MinioStorageProvider({
        endPoint: this.env.MINIO_ENDPOINT,
        port: this.env.MINIO_PORT,
        useSSL: this.env.MINIO_USE_SSL,
        accessKey: this.env.MINIO_ROOT_USER,
        secretKey: this.env.MINIO_ROOT_PASSWORD,
        bucket: this.env.MINIO_BUCKET,
        maxFileSizeMb: this.env.STORAGE_MAX_FILE_SIZE_MB,
      });
      const result = await withHealthTimeout(storage.healthCheck());
      return { status: result.healthy ? 'ok' : 'down' };
    } catch {
      return { status: 'down' };
    }
  }
}
