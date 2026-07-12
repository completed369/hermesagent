import { runWorker } from './worker';
import { StructuredLogger } from '@ventureos/observability';

const logger = new StructuredLogger('worker');

runWorker().catch((err) => {
  logger.error('Worker crashed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
