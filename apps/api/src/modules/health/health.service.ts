import { Inject, Injectable } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import { MinioStorageProvider } from '@ventureos/integrations';
import { ENV_TOKEN } from '../../config/env.provider';
import type { Env } from '@ventureos/config';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  checks: Record<string, { status: 'ok' | 'down'; message?: string }>;
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(@Inject(ENV_TOKEN) private readonly env: Env) {}

  async liveness(): Promise<HealthStatus> {
    return {
      status: 'ok',
      checks: { process: { status: 'ok' } },
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<HealthStatus> {
    const checks: HealthStatus['checks'] = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok' };
    } catch (err) {
      checks.database = {
        status: 'down',
        message: err instanceof Error ? err.message : 'unknown error',
      };
    }

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
      const result = await storage.healthCheck();
      checks.storage = result.healthy
        ? { status: 'ok' }
        : { status: 'down', message: result.message };
    } catch (err) {
      checks.storage = {
        status: 'down',
        message: err instanceof Error ? err.message : 'unknown error',
      };
    }

    const anyDown = Object.values(checks).some((c) => c.status === 'down');
    return {
      status: anyDown ? 'down' : 'ok',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
