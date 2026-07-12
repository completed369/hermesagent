import { Injectable } from '@nestjs/common';
import { prisma } from '@ventureos/database';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  checks: Record<string, { status: 'ok' | 'down'; message?: string }>;
  timestamp: string;
}

@Injectable()
export class HealthService {
  async liveness(): Promise<HealthStatus> {
    return { status: 'ok', checks: { process: { status: 'ok' } }, timestamp: new Date().toISOString() };
  }

  async readiness(): Promise<HealthStatus> {
    const checks: HealthStatus['checks'] = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok' };
    } catch (err) {
      checks.database = { status: 'down', message: err instanceof Error ? err.message : 'unknown error' };
    }

    const anyDown = Object.values(checks).some((c) => c.status === 'down');
    return {
      status: anyDown ? 'down' : 'ok',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
