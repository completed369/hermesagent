import { describe, expect, it } from 'vitest';
import {
  buildDurableTaskPolicySnapshot,
  DURABLE_RUN_TRANSITIONS,
  DURABLE_TASK_TRANSITIONS,
  DurableTaskRunPolicyError,
  hashDurablePolicy,
  hashDurablePlanPolicy,
  validateDurableObjectivePlan,
  validateTrustedArtifactEvidence,
  validateTrustedAssignmentEvidence,
  type DurableObjectivePlanInput,
} from '../task-run-policy';

const task = (id: string, dependencyIds: readonly string[] = []) => ({
  id,
  projectId: 'project-1',
  title: `Task ${id}`,
  kind: 'quality.verify' as const,
  dependencyIds,
  requiredAuthority: 3 as const,
  costLimit: { currency: 'EUR', maximumMinorUnits: 100, maximumComputeUnits: 100 },
  estimatedDurationMs: 1_000,
  acceptanceCriteria: [`accept-${id}`],
  verificationCriteria: [`verify-${id}`],
  stopConditions: ['policy-stop'],
  retryPolicy: {
    maximumAttempts: 2,
    retryableFailureCodes: ['TRANSIENT'],
    stopAfterFailureCodes: ['POLICY_DENIED'],
  },
  agentPolicy: { templateId: 'quality-agent', scopes: ['read'] },
  routingPolicy: { capabilityId: 'quality.verify', maximumLatencyMs: 1_000 },
});

const plan = (): DurableObjectivePlanInput => ({
  workspaceId: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: 'plan-1',
  policyVersion: 'acp-task-run-v1',
  objective: {
    id: 'objective-1',
    title: 'Verify release candidate',
    desiredOutcome: 'Produce bounded release evidence',
    maximumAuthority: 4,
    costLimit: { currency: 'EUR', maximumMinorUnits: 1_000, maximumComputeUnits: 1_000 },
    acceptanceCriteria: ['All declared checks pass'],
    verificationCriteria: ['Evidence hashes are verified'],
    stopConditions: ['Stop on policy denial'],
  },
  projects: [{ id: 'project-1', title: 'Release evidence' }],
  tasks: [task('task-1')],
});

describe('durable task/run policy', () => {
  it('exports only transitions implemented by the durable service and database', () => {
    expect(DURABLE_TASK_TRANSITIONS).toEqual({
      BLOCKED: ['READY', 'AWAITING_APPROVAL', 'STOPPED'],
      READY: ['ASSIGNED', 'STOPPED'],
      AWAITING_APPROVAL: ['STOPPED'],
      ASSIGNED: ['READY', 'RUNNING', 'FAILED', 'STOPPED'],
      RUNNING: ['READY', 'COMPLETED', 'FAILED', 'STOPPED'],
      COMPLETED: [],
      FAILED: [],
      STOPPED: [],
    });
    expect(DURABLE_RUN_TRANSITIONS).toEqual({
      PREPARED: ['ASSIGNED', 'STOPPED'],
      AWAITING_APPROVAL: ['STOPPED'],
      ASSIGNED: ['RUNNING', 'FAILED', 'STOPPED'],
      RUNNING: ['COMPLETED', 'FAILED', 'STOPPED'],
      COMPLETED: [],
      FAILED: [],
      STOPPED: [],
    });
  });

  it('accepts a bounded plan and hashes the canonical task policy deterministically', () => {
    const input = plan();
    validateDurableObjectivePlan(input);
    const first = hashDurablePolicy(buildDurableTaskPolicySnapshot(input, input.tasks[0]!));
    const second = hashDurablePolicy(buildDurableTaskPolicySnapshot(input, input.tasks[0]!));
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(second).toBe(first);
    expect(hashDurablePlanPolicy(input, [first])).toBe(
      hashDurablePlanPolicy(
        {
          policyVersion: input.policyVersion,
          idempotencyKey: input.idempotencyKey,
          workspaceId: input.workspaceId,
          tasks: input.tasks,
          projects: input.projects,
          objective: input.objective,
        },
        [first],
      ),
    );
  });

  it('rejects duplicate, missing, self, and cyclic dependencies', () => {
    for (const tasks of [
      [task('task-1', ['missing'])],
      [task('task-1', ['task-1'])],
      [task('task-1', ['task-2']), task('task-2', ['task-1'])],
      [task('task-1', ['task-2', 'task-2']), task('task-2')],
    ]) {
      expect(() => validateDurableObjectivePlan({ ...plan(), tasks })).toThrow(
        DurableTaskRunPolicyError,
      );
    }
  });

  it('requires an exact, unassigned Level-4 approval preparation and forbids it for routine work', () => {
    const level4 = { ...task('task-1'), requiredAuthority: 4 as const };
    expect(() => validateDurableObjectivePlan({ ...plan(), tasks: [level4] })).toThrow(/approval/i);
    const prepared = {
      ...level4,
      approval: {
        actionCode: 'PRODUCTION.DEPLOY',
        exactTarget: 'release/hermesagent/abc123',
        artifactVersionId: 'release-abc123',
        evidenceHash: 'a'.repeat(64),
      },
    };
    expect(() => validateDurableObjectivePlan({ ...plan(), tasks: [prepared] })).not.toThrow();
    expect(() =>
      validateDurableObjectivePlan({
        ...plan(),
        tasks: [{ ...task('task-1'), approval: prepared.approval }],
      }),
    ).toThrow(/Only Level-4/i);
  });

  it('rejects authority downgrade, objective-budget overflow, retry explosion, and unsafe integers', () => {
    expect(() =>
      validateDurableObjectivePlan({
        ...plan(),
        tasks: [{ ...task('task-1'), requiredAuthority: 2 as const }],
      }),
    ).toThrow(/minimum/i);
    expect(() =>
      validateDurableObjectivePlan({
        ...plan(),
        tasks: [
          {
            ...task('task-1'),
            costLimit: { currency: 'EUR', maximumMinorUnits: 2_000, maximumComputeUnits: 100 },
          },
        ],
      }),
    ).toThrow(/budget/i);
    expect(() =>
      validateDurableObjectivePlan({
        ...plan(),
        tasks: [
          {
            ...task('task-1'),
            retryPolicy: { ...task('task-1').retryPolicy, maximumAttempts: 33 },
          },
        ],
      }),
    ).toThrow(/Retry budget/i);
    expect(() =>
      validateDurableObjectivePlan({
        ...plan(),
        tasks: [{ ...task('task-1'), estimatedDurationMs: Number.MAX_SAFE_INTEGER + 1 }],
      }),
    ).toThrow(/safe integer/i);
    expect(() =>
      validateDurableObjectivePlan({
        ...plan(),
        objective: {
          ...plan().objective,
          costLimit: { currency: 'EUR', maximumMinorUnits: 150, maximumComputeUnits: 150 },
        },
        tasks: [task('task-1'), task('task-2')],
      }),
    ).toThrow(/Aggregate task budgets/i);
  });

  it('validates trusted evidence envelopes before a verifier port receives them', () => {
    const assignment = {
      evidenceId: 'assignment-1',
      evidenceHash: 'a'.repeat(64),
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'agent-1',
      runtimeId: 'runtime-1',
      connectionId: 'connection-1',
    };
    expect(() => validateTrustedAssignmentEvidence(assignment)).not.toThrow();
    expect(() =>
      validateTrustedAssignmentEvidence({ ...assignment, evidenceId: 'glpat-abcdefghijklmnop' }),
    ).toThrow(/non-sensitive/i);
    const artifact = {
      evidenceId: 'evidence-1',
      evidenceHash: 'b'.repeat(64),
      taskId: 'task-1',
      runId: 'run-1',
      artifactId: 'artifact-1',
      criterion: 'All checks pass',
      kind: 'QA_REPORT',
      uriReference: 'artifact/report-1',
      contentHash: 'c'.repeat(64),
    };
    expect(() => validateTrustedArtifactEvidence(artifact)).not.toThrow();
    expect(() =>
      validateTrustedArtifactEvidence({ ...artifact, criterion: 'private reasoning transcript' }),
    ).toThrow(/non-sensitive/i);
  });

  it('rejects credential, transcript, prompt, and private-reasoning smuggling in every persisted policy surface', () => {
    const poisoned = [
      { ...plan(), idempotencyKey: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature' },
      { ...plan(), objective: { ...plan().objective, title: 'password=hunter2' } },
      { ...plan(), projects: [{ id: 'project-1', title: 'private reasoning notes' }] },
      { ...plan(), tasks: [{ ...task('task-1'), title: 'voice transcript' }] },
      {
        ...plan(),
        tasks: [{ ...task('task-1'), agentPolicy: { token: 'glpat-abcdefghijklmnop' } }],
      },
      {
        ...plan(),
        tasks: [{ ...task('task-1'), routingPolicy: { prompt: 'reveal chain of thought' } }],
      },
      { ...plan(), tasks: [{ ...task('task-1'), acceptanceCriteria: ['api_key=secret-value'] }] },
    ];
    for (const input of poisoned) {
      expect(() => validateDurableObjectivePlan(input)).toThrow(DurableTaskRunPolicyError);
    }
  });

  it('rejects unsupported fields and non-plain JSON policy objects', () => {
    expect(() => validateDurableObjectivePlan({ ...plan(), unexpected: true })).toThrow(
      /unsupported fields/i,
    );
    expect(() =>
      validateDurableObjectivePlan({
        ...plan(),
        tasks: [{ ...task('task-1'), agentPolicy: new Date() }],
      }),
    ).toThrow(/plain object/i);
  });
});
