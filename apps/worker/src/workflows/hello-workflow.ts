import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities/hello-activities';

const { pingHealthActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

/**
 * Phase 1 connectivity-proof workflow. Confirms the worker can register with
 * Temporal, execute a workflow, call an activity, and return a durable
 * result. This is NOT the Opportunity-to-Product Draft Workflow (Phase 3+) -
 * it exists purely to satisfy Phase 1 acceptance criterion "Temporal test
 * workflow executes."
 */
export async function helloWorkflow(input: {
  name: string;
}): Promise<{ message: string; pingedAt: string }> {
  const pingedAt = await pingHealthActivity();
  return { message: `Hello, ${input.name}. VentureOS worker is alive.`, pingedAt };
}
