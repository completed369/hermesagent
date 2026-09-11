import { createHash } from 'node:crypto';
import {
  validateDurableObjectivePlan,
  type DurableObjectivePlanInput,
} from '@ventureos/agent-control-plane';

/** Creates the first research delegation, not a model-generated commercial strategy.
 * Raw owner text stays in the authenticated inbox, outside task/event projections.
 * This ceiling is a proposed task limit, never a reservation or spending grant.
 */
export function buildCeoInstructionPlan(input: {
  workspaceId: string;
  eventId: string;
  payloadDigest: string;
}): DurableObjectivePlanInput {
  if (!/^Ev[A-Za-z0-9]{1,100}$/.test(input.eventId))
    throw new Error('Invalid owner instruction reference');
  if (!/^[a-f0-9]{64}$/.test(input.payloadDigest))
    throw new Error('Invalid owner instruction digest');
  const key = createHash('sha256')
    .update(JSON.stringify([input.workspaceId, input.eventId]))
    .digest('hex');
  const objectiveId = `ceo-objective:${key}`;
  const projectId = `ceo-project:${key}`;
  const costLimit = { currency: 'EUR', maximumMinorUnits: 2_500, maximumComputeUnits: 100_000 };
  const acceptanceCriteria = [
    'Identify the owner goal, buyer problem and dated supporting sources',
    'Compare feasible offers and channels without imposing a permanent market',
    'Recommend one bounded experiment with cost, success and stop criteria',
  ];
  const verificationCriteria = [
    'An independent verifier checks sources, feasibility and proposed costs',
    'Recommendations are labelled estimates and contain no invented sales',
  ];
  const stopConditions = [
    'Stop on paused or revoked authority, unavailable funding or missing capability',
    'No publication, customer contact, purchases or account changes in this task',
  ];
  const plan: DurableObjectivePlanInput = {
    workspaceId: input.workspaceId,
    idempotencyKey: `ceo-instruction:${key}`,
    policyVersion: 'ceo-research-intake-v1',
    objective: {
      id: objectiveId,
      title: 'Assess owner business goal',
      desiredOutcome: `Assess stored owner instruction slack:${input.eventId}; binding ${input.payloadDigest}`,
      maximumAuthority: 1,
      costLimit,
      acceptanceCriteria,
      verificationCriteria,
      stopConditions,
    },
    projects: [{ id: projectId, title: 'Opportunity assessment' }],
    tasks: [
      {
        id: `ceo-research:${key}`,
        projectId,
        title: 'Research the owner goal and recommend a bounded experiment',
        kind: 'business.research',
        dependencyIds: [],
        requiredAuthority: 1,
        costLimit,
        estimatedDurationMs: 300_000,
        acceptanceCriteria,
        verificationCriteria,
        stopConditions,
        retryPolicy: {
          maximumAttempts: 1,
          retryableFailureCodes: ['TRANSIENT_BEFORE_DISPATCH'],
          stopAfterFailureCodes: ['POLICY_DENIED', 'PROVIDER_OUTCOME_UNKNOWN'],
        },
        agentPolicy: {
          templateId: 'business-research',
          templateVersion: 1,
          repositoryScopes: [],
          environmentScopes: ['production'],
          dataScopes: ['workspace-instruction', 'public-research'],
          capabilityIds: ['business.research'],
          toolGrants: [{ toolId: 'research.readonly', scopes: ['read'] }],
          maxRuntimeMs: 300_000,
          childLimit: 0,
          retention: 'ARCHIVE',
        },
        routingPolicy: {
          dataSensitivity: 'CONFIDENTIAL',
          minimumSecurityTier: 3,
          minimumReliabilityScoreBps: 9_000,
          maximumLatencyMs: 30_000,
          heartbeatFreshnessMs: 30_000,
          requiredCapabilityIds: ['business.research'],
          requiredTools: [{ toolId: 'research.readonly', scope: 'read' }],
        },
      },
    ],
  };
  validateDurableObjectivePlan(plan);
  return plan;
}
