import { Connection, WorkflowClient } from '@temporalio/client';
import type { ConnectionOptions } from '@temporalio/client';
import { loadEnv } from '@ventureos/config';

let cachedClient: WorkflowClient | undefined;

/**
 * Shared Temporal client factory used by apps/api (to start workflows and
 * send signals) and any future workflow-triggering code. Kept in its own
 * package so apps/api never needs to depend on apps/worker's process
 * entrypoint.
 */
export async function getTemporalClient(): Promise<WorkflowClient> {
  if (cachedClient) return cachedClient;
  const env = loadEnv();
  const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  cachedClient = new WorkflowClient({ connection, namespace: env.TEMPORAL_NAMESPACE });
  return cachedClient;
}

type HealthConnection = Pick<Connection, 'close' | 'healthService' | 'withDeadline'>;
type HealthConnectionFactory = (options: ConnectionOptions) => HealthConnection;

/**
 * Checks Temporal server connectivity through the standard gRPC Health Check
 * service. This intentionally creates no WorkflowClient and cannot start,
 * signal, update, terminate, or otherwise mutate a workflow.
 */
export async function checkTemporalConnection(
  address: string,
  timeoutMs: number,
  connect: HealthConnectionFactory = (options) => Connection.lazy(options),
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const connection = connect({ address, connectTimeout: timeoutMs });
  try {
    const response = await connection.withDeadline(deadline, () =>
      connection.healthService.check({ service: '' }),
    );
    // grpc.health.v1.HealthCheckResponse.ServingStatus.SERVING
    return response.status === 1;
  } finally {
    await connection.close();
  }
}
