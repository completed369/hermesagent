import { NativeConnection, Worker } from '@temporalio/worker';
import { loadEnv } from '@ventureos/config';
import { StructuredLogger } from '@ventureos/observability';
import * as activities from './activities';

const logger = new StructuredLogger('worker');

export async function runWorker(): Promise<void> {
  const env = loadEnv();

  logger.info('Connecting to Temporal', { address: env.TEMPORAL_ADDRESS, namespace: env.TEMPORAL_NAMESPACE });

  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });

  try {
    const worker = await Worker.create({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowsPath: require.resolve('./workflows'),
      activities,
    });

    logger.info('Worker created, starting run loop', { taskQueue: env.TEMPORAL_TASK_QUEUE });
    await worker.run();
  } finally {
    await connection.close();
  }
}
