import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getTemporalClient } from '@ventureos/workflows';
import { loadEnv } from '@ventureos/config';

@Injectable()
export class TemporalHealthService {
  /**
   * Starts the Phase 1 connectivity-proof workflow (helloWorkflow) and waits
   * for its result. Requires the worker process to be running and connected
   * to the same Temporal server/namespace/task queue.
   */
  async runConnectivityCheck(): Promise<{ healthy: boolean; result?: unknown; message?: string }> {
    try {
      const env = loadEnv();
      const client = await getTemporalClient();
      const handle = await client.start('helloWorkflow', {
        taskQueue: env.TEMPORAL_TASK_QUEUE,
        workflowId: `health-check-${randomUUID()}`,
        args: [{ name: 'Founder' }],
      });
      const result = await handle.result();
      return { healthy: true, result };
    } catch (err) {
      return { healthy: false, message: err instanceof Error ? err.message : 'unknown error' };
    }
  }
}
