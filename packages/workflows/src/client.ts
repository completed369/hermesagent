import { Connection, WorkflowClient } from '@temporalio/client';
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
