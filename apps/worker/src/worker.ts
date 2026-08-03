import { NativeConnection, Worker } from '@temporalio/worker';
import { createServer, type Server } from 'node:http';
import { loadEnv } from '@ventureos/config';
import { StructuredLogger } from '@ventureos/observability';
import * as activities from './activities';

const logger = new StructuredLogger('worker');

const RETRY_MAX_ATTEMPTS = 15;
const RETRY_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Temporal's server (especially temporalio/auto-setup, which runs its own
 * schema setup on first boot) can take significantly longer to start
 * accepting connections than Postgres/MinIO. Docker Compose reporting the
 * container as "started" does not mean the gRPC port is listening yet.
 * Retry with a fixed backoff instead of crashing on the first attempt.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      logger.warn(`${label} failed, retrying`, {
        attempt,
        maxAttempts: RETRY_MAX_ATTEMPTS,
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempt < RETRY_MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

export async function runWorker(): Promise<void> {
  const env = loadEnv();

  const health = { ready: false };
  const healthServer: Server = createServer((request, response) => {
    const live = request.url === '/health/live';
    const ready = request.url === '/health/ready' && health.ready;
    response.statusCode = live || ready ? 200 : request.url?.startsWith('/health/') ? 503 : 404;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ status: live || ready ? 'ok' : 'down' }));
  });
  await new Promise<void>((resolve) =>
    healthServer.listen(env.WORKER_HEALTH_PORT, '0.0.0.0', resolve),
  );
  logger.info('Worker health server started', {
    port: env.WORKER_HEALTH_PORT,
    version: '0.1.0',
  });

  logger.info('Connecting to Temporal', {
    address: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
  });

  // NOTE: TEMPORAL_NAMESPACE must be a namespace that already exists on the
  // server. Temporal only ships the built-in "default" namespace out of the
  // box - anything else requires a manual registration step
  // (`temporal operator namespace create <name>`) before first use. Phase 1
  // uses "default" for exactly this reason: zero manual setup required.
  let connection: NativeConnection | undefined;

  try {
    connection = await withRetry('Temporal worker connect', () =>
      NativeConnection.connect({ address: env.TEMPORAL_ADDRESS }),
    );
    logger.info('Connected to Temporal');

    const worker = await Worker.create({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowsPath: require.resolve('./workflows'),
      activities,
    });

    logger.info('Worker created, starting run loop', { taskQueue: env.TEMPORAL_TASK_QUEUE });
    const requestShutdown = (signal: string) => {
      health.ready = false;
      logger.info('Worker graceful shutdown started', { signal });
      worker.shutdown();
    };
    const onSigterm = () => requestShutdown('SIGTERM');
    const onSigint = () => requestShutdown('SIGINT');
    process.once('SIGTERM', onSigterm);
    process.once('SIGINT', onSigint);
    health.ready = true;

    try {
      await worker.run();
      logger.info('Worker graceful shutdown completed');
    } finally {
      process.off('SIGTERM', onSigterm);
      process.off('SIGINT', onSigint);
      health.ready = false;
    }
  } finally {
    if (connection) await connection.close();
    await new Promise<void>((resolve, reject) =>
      healthServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
