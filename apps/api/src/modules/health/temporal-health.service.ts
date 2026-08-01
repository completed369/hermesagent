import { Inject, Injectable } from '@nestjs/common';
import { checkTemporalConnection } from '@ventureos/workflows';
import type { Env } from '@ventureos/config';
import { ENV_TOKEN } from '../../config/env.provider';
import { HEALTH_CHECK_TIMEOUT_MS, withHealthTimeout } from './health-timeout';

@Injectable()
export class TemporalHealthService {
  constructor(@Inject(ENV_TOKEN) private readonly env: Env) {}

  /**
   * Checks only Temporal server connectivity. This does not prove that an
   * application worker is polling the configured task queue.
   */
  async runConnectivityCheck(): Promise<{ status: 'ok' | 'down' }> {
    try {
      const serving = await withHealthTimeout(
        checkTemporalConnection(this.env.TEMPORAL_ADDRESS, HEALTH_CHECK_TIMEOUT_MS),
      );
      return { status: serving ? 'ok' : 'down' };
    } catch {
      return { status: 'down' };
    }
  }
}
