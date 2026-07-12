import { Connection, WorkflowClient } from '@temporalio/client';
import { loadEnv } from '@ventureos/config';

let cachedClient: WorkflowClient | undefined;

export async function getTemporalClient(): Promise<WorkflowClient> {
  if (cachedClient) return cachedClient;
  const env = loadEnv();
  const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  cachedClient = new WorkflowClient({ connection, namespace: env.TEMPORAL_NAMESPACE });
  return cachedClient;
}
