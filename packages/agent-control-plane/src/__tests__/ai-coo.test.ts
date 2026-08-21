import { describe, expect, it, vi } from 'vitest';
import type { AgentInstantiationRequest, DynamicAgentFactory } from '../agent-factory';
import {
  AiCooPolicyError,
  GovernedAiCoo,
  type AssignmentRequest,
  type CooTask,
  type ObjectivePlan,
} from '../ai-coo';
import type { WorkspaceContext } from '../contracts';
import type { RuntimeBroker, RuntimeRoutingRequest } from '../runtime-broker';
import { InMemoryOperationalEventLog, OperationalEventCapability } from '../events';

const context: WorkspaceContext = { workspaceId: 'workspace-a', principalId: 'coo' };

function ports() {
  const evidenceVerifier = {
    verify: vi.fn(() => true),
  };
  const broker = {
    route: vi.fn((_context: WorkspaceContext, request: RuntimeRoutingRequest) => ({
      requestId: request.id,
      workspaceId: request.workspaceId,
      evaluatedAt: '2026-08-21T00:00:00.000Z',
      selectedRuntimeId: 'runtime-1',
      selectedConnectionId: 'connection-1',
      selectedScoreBps: 9_000,
      tieBreakRule: 'SCORE_DESC_RUNTIME_ID_ASC_CONNECTION_ID_ASC' as const,
      evaluations: [],
    })),
  } satisfies Pick<RuntimeBroker, 'route'>;
  const factory = {
    registerPlan: vi.fn(),
    instantiate: vi.fn((_context: WorkspaceContext, request: AgentInstantiationRequest) => ({
      agent: {
        ...request,
        agentId: `agent:${request.id}`,
        role: 'Specialist',
        department: 'Engineering',
        nestingDepth: 0,
        lifecycle: 'ACTIVE' as const,
        createdAt: '2026-08-21T00:00:00.000Z',
      },
      decision: {
        requestId: request.id,
        workspaceId: request.workspaceId,
        agentId: `agent:${request.id}`,
        templateId: request.templateId,
        decidedAt: '2026-08-21T00:00:00.000Z',
        requesterId: 'coo',
        checks: ['workspace', 'linkage'],
        templateVersion: request.templateVersion,
        templateSnapshot: {
          id: request.templateId,
          workspaceId: request.workspaceId,
          version: request.templateVersion,
          role: 'Specialist',
          department: 'Engineering',
          repositoryScopes: request.repositoryScopes,
          environmentScopes: request.environmentScopes,
          dataScopes: request.dataScopes,
          capabilityIds: request.capabilityIds,
          toolGrants: request.toolGrants,
          maximumAuthority: request.authorityLevel,
          maximumBudgetMinorUnits: request.budgetMinorUnits,
          maximumComputeUnits: request.computeUnits,
          maximumRuntimeMs: request.maxRuntimeMs,
          maximumRetries: request.retryLimit,
          maximumChildren: request.childLimit,
          retention: request.retention,
        },
        templateHash: 'a'.repeat(64),
      },
    })),
  } satisfies Pick<DynamicAgentFactory, 'registerPlan' | 'instantiate'>;
  return { broker, factory, evidenceVerifier };
}

function task(
  id: string,
  dependencyIds: readonly string[] = [],
  overrides: Partial<CooTask> = {},
): CooTask {
  return {
    id,
    workspaceId: 'workspace-a',
    objectiveId: 'objective-1',
    projectId: 'project-1',
    title: `Task ${id}`,
    kind: 'repository.review',
    dependencyIds,
    requiredAuthority: 2,
    costLimit: { currency: 'USD', maximumMinorUnits: 100, maximumComputeUnits: 50 },
    estimatedDurationMs: 100,
    acceptanceCriteria: ['accepted'],
    verificationCriteria: ['verified'],
    stopConditions: ['policy denied'],
    retryPolicy: {
      maximumAttempts: 2,
      retryableFailureCodes: ['TRANSIENT'],
      stopAfterFailureCodes: ['POLICY'],
    },
    agentPolicy: {
      templateId: 'template-1',
      templateVersion: 1,
      repositoryScopes: ['repo:ventureos'],
      environmentScopes: ['test'],
      dataScopes: ['workspace'],
      capabilityIds: ['repository.review'],
      toolGrants: [{ toolId: 'git.readonly', scopes: ['read'] }],
      maxRuntimeMs: 100,
      childLimit: 0,
      retention: 'ARCHIVE',
    },
    routingPolicy: {
      requiredCapabilityIds: ['repository.review'],
      requiredTools: [{ toolId: 'git.readonly', scope: 'read' }],
      dataSensitivity: 'INTERNAL',
      minimumSecurityTier: 2,
      minimumReliabilityScoreBps: 9_000,
      maximumLatencyMs: 1_000,
      heartbeatFreshnessMs: 30_000,
    },
    ...overrides,
  };
}

function plan(
  tasks: readonly CooTask[] = [task('task-1'), task('task-2', ['task-1'])],
): ObjectivePlan {
  return {
    objective: {
      id: 'objective-1',
      workspaceId: 'workspace-a',
      title: 'Ship governed COO',
      desiredOutcome: 'A deterministic policy foundation',
      maximumAuthority: 4,
      costLimit: { currency: 'USD', maximumMinorUnits: 1_000, maximumComputeUnits: 1_000 },
      acceptanceCriteria: ['graph accepted'],
      verificationCriteria: ['tests pass'],
      stopConditions: ['budget exceeded'],
    },
    projects: [
      {
        id: 'project-1',
        workspaceId: 'workspace-a',
        objectiveId: 'objective-1',
        title: 'Foundation',
      },
    ],
    tasks,
  };
}

function assignment(
  taskId = 'task-1',
  overrides: Partial<AssignmentRequest> = {},
): AssignmentRequest {
  const governedTask = task(taskId);
  return {
    taskId,
    factoryRequest: {
      id: `assign-${taskId}`,
      workspaceId: 'workspace-a',
      templateId: governedTask.agentPolicy.templateId,
      templateVersion: governedTask.agentPolicy.templateVersion,
      objectiveId: 'objective-1',
      taskId,
      repositoryScopes: governedTask.agentPolicy.repositoryScopes,
      environmentScopes: governedTask.agentPolicy.environmentScopes,
      dataScopes: governedTask.agentPolicy.dataScopes,
      capabilityIds: governedTask.agentPolicy.capabilityIds,
      toolGrants: governedTask.agentPolicy.toolGrants,
      authorityLevel: governedTask.requiredAuthority,
      budgetMinorUnits: governedTask.costLimit.maximumMinorUnits,
      computeUnits: governedTask.costLimit.maximumComputeUnits,
      maxRuntimeMs: governedTask.agentPolicy.maxRuntimeMs,
      retryLimit: governedTask.retryPolicy.maximumAttempts - 1,
      childLimit: governedTask.agentPolicy.childLimit,
      acceptanceCriteria: governedTask.acceptanceCriteria,
      verificationCriteria: governedTask.verificationCriteria,
      stopCondition: governedTask.stopConditions.join(' AND '),
      retention: governedTask.agentPolicy.retention,
    },
    routingRequest: {
      id: `route-${taskId}`,
      workspaceId: 'workspace-a',
      ...governedTask.routingPolicy,
      maximumCostMinorUnits: governedTask.costLimit.maximumMinorUnits,
      requiredComputeUnits: governedTask.costLimit.maximumComputeUnits,
    },
    ...overrides,
  };
}

function coo(customPorts = ports()) {
  return {
    instance: new GovernedAiCoo(
      {
        plannerPrincipals: ['coo'],
        maximumObjectiveCostMinorUnits: 10_000,
        maximumObjectiveComputeUnits: 10_000,
        maximumTasksPerObjective: 1_000,
        maximumProjectsPerObjective: 10,
        maximumTaskDurationMs: 1_000_000,
        maximumRetriesPerTask: 3,
        clock: () => Date.parse('2026-08-21T00:00:00.000Z'),
      },
      customPorts,
    ),
    ...customPorts,
  };
}

describe('GovernedAiCoo', () => {
  it('builds a deterministic graph and unlocks dependents only after evidenced completion', () => {
    const { instance, broker, factory } = coo();
    expect(instance.createPlan(context, plan())).toMatchObject({
      taskIds: ['task-1', 'task-2'],
      totalDurationMs: 200,
      blockedTaskIds: ['task-2'],
    });
    const decision = instance.requestAssignment(context, assignment());
    expect(decision.factoryDecision.templateHash).toBe('a'.repeat(64));
    expect(broker.route).toHaveBeenCalledOnce();
    expect(factory.instantiate).toHaveBeenCalledOnce();
    expect(() =>
      instance.completeTask(context, 'task-1', [
        {
          criterion: 'verified',
          runId: decision.runId,
          artifactId: 'artifact-1',
          contentHash: 'b'.repeat(64),
        },
      ]),
    ).toThrow(/acceptance and verification/);
    instance.completeTask(context, 'task-1', [
      {
        criterion: 'accepted',
        runId: decision.runId,
        artifactId: 'artifact-1',
        contentHash: 'b'.repeat(64),
      },
      {
        criterion: 'verified',
        runId: decision.runId,
        artifactId: 'artifact-2',
        contentHash: 'c'.repeat(64),
      },
    ]);
    expect(
      instance.listTasks(context, 'objective-1').find(({ id }) => id === 'task-2')?.status,
    ).toBe('READY');
  });

  it('projects sanitized planning facts into the unified workspace event spine', () => {
    const dependencies = ports();
    const events = new InMemoryOperationalEventLog();
    const instance = new GovernedAiCoo(
      {
        plannerPrincipals: ['coo'],
        maximumObjectiveCostMinorUnits: 10_000,
        maximumObjectiveComputeUnits: 10_000,
        maximumTasksPerObjective: 1_000,
        maximumProjectsPerObjective: 10,
        maximumTaskDurationMs: 1_000_000,
        maximumRetriesPerTask: 3,
        clock: () => Date.parse('2026-08-21T00:00:00.000Z'),
      },
      {
        ...dependencies,
        eventSink: events,
        eventCapability: OperationalEventCapability.issue('AI_COO', { coo: 'AGENT' }),
      },
    );

    const sensitiveTitlePlan = plan([
      task('level-4', [], { requiredAuthority: 4, exactTarget: 'production:release-1' }),
    ]);
    sensitiveTitlePlan.objective.title = 'password=hunter2';
    instance.createPlan(context, sensitiveTitlePlan);
    const projected = events.list(context);
    expect(projected.map((event) => event.type)).toContain('approval.requested');
    expect(projected.every((event) => event.source === 'AI_COO')).toBe(true);
    expect(JSON.stringify(projected)).not.toMatch(/chainOfThought|privateReasoning|prompt/i);
    expect(JSON.stringify(projected)).not.toContain('password=hunter2');
  });

  it.each([
    ['cross-workspace', () => plan([task('task-1', [], { workspaceId: 'workspace-b' })])],
    ['missing dependency', () => plan([task('task-1', ['missing'])])],
    ['self dependency', () => plan([task('task-1', ['task-1'])])],
    ['cycle', () => plan([task('task-1', ['task-2']), task('task-2', ['task-1'])])],
  ])('rejects %s graphs', (_label, makePlan) => {
    expect(() => coo().instance.createPlan(context, makePlan())).toThrow(AiCooPolicyError);
  });

  it('rejects hidden fields rather than retaining private reasoning', () => {
    const poisoned = plan() as ObjectivePlan & { chainOfThought: string };
    poisoned.chainOfThought = 'private reasoning';
    expect(() => coo().instance.createPlan(context, poisoned)).toThrow(/unsupported fields/);
  });

  it('requires planner authority for graph and decision reads', () => {
    const { instance } = coo();
    instance.createPlan(context, plan());
    const viewer = { workspaceId: 'workspace-a', principalId: 'viewer' };
    expect(() => instance.listTasks(viewer, 'objective-1')).toThrow(/planner authority/);
    expect(() => instance.listEvents(viewer)).toThrow(/planner authority/);
    expect(() => instance.listFounderDecisions(viewer)).toThrow(/planner authority/);
  });

  it('rejects workspace-global entity ID reuse across plans', () => {
    const { instance } = coo();
    instance.createPlan(context, plan([task('shared')]));
    const second = plan([task('other')]);
    second.objective.id = 'objective-2';
    second.projects[0]!.objectiveId = 'objective-2';
    second.tasks[0]!.objectiveId = 'objective-2';
    second.projects[0]!.id = 'shared';
    second.tasks[0]!.projectId = 'shared';
    expect(() => instance.createPlan(context, second)).toThrow(/Entity ID already exists/);
  });

  it('does not publish a COO plan when atomic factory registration fails', () => {
    const dependencies = ports();
    dependencies.factory.registerPlan.mockImplementationOnce(() => {
      throw new Error('collision');
    });
    const { instance } = coo(dependencies);
    expect(() => instance.createPlan(context, plan())).toThrow('collision');
    expect(() => instance.listTasks(context, 'objective-1')).toThrow(/Objective not found/);
  });

  it('rejects weakened broker or factory policy before either port is invoked', () => {
    const { instance, broker, factory } = coo();
    instance.createPlan(context, plan());
    const request = assignment();
    const weakened = {
      ...request,
      routingRequest: { ...request.routingRequest, minimumSecurityTier: 0 as const },
    };
    expect(() => instance.requestAssignment(context, weakened)).toThrow(/exactly match/);
    expect(broker.route).not.toHaveBeenCalled();
    expect(factory.instantiate).not.toHaveBeenCalled();
  });

  it('rejects hidden assignment fields before they can reach an agent record', () => {
    const { instance, factory } = coo();
    instance.createPlan(context, plan());
    const request = assignment();
    const poisoned = {
      ...request,
      factoryRequest: { ...request.factoryRequest, chainOfThought: 'private reasoning' },
    } as AssignmentRequest;
    expect(() => instance.requestAssignment(context, poisoned)).toThrow(/unsupported fields/);
    expect(factory.instantiate).not.toHaveBeenCalled();
  });

  it('requires workspace/run-bound artifact verification before completion', () => {
    const dependencies = ports();
    dependencies.evidenceVerifier.verify.mockReturnValue(false);
    const { instance } = coo(dependencies);
    instance.createPlan(context, plan([task('task-1')]));
    const decision = instance.requestAssignment(context, assignment());
    expect(() =>
      instance.completeTask(context, 'task-1', [
        {
          criterion: 'accepted',
          runId: decision.runId,
          artifactId: 'fabricated-1',
          contentHash: 'b'.repeat(64),
        },
        {
          criterion: 'verified',
          runId: decision.runId,
          artifactId: 'fabricated-2',
          contentHash: 'c'.repeat(64),
        },
      ]),
    ).toThrow(/workspace run artifact/);
  });

  it('enforces canonical task-kind capability, tool, and authority minimums', () => {
    const weakCapability = task('weak-capability', [], {
      agentPolicy: { ...task('x').agentPolicy, capabilityIds: [] },
    });
    const weakAuthority = task('weak-authority', [], {
      kind: 'quality.verify',
      requiredAuthority: 2,
      agentPolicy: {
        ...task('x').agentPolicy,
        capabilityIds: ['quality.verify'],
        toolGrants: [{ toolId: 'quality.runner', scopes: ['verify'] }],
      },
      routingPolicy: {
        ...task('x').routingPolicy,
        requiredCapabilityIds: ['quality.verify'],
        requiredTools: [{ toolId: 'quality.runner', scope: 'verify' }],
      },
    });
    expect(() => coo().instance.createPlan(context, plan([weakCapability]))).toThrow(/canonical/);
    expect(() => coo().instance.createPlan(context, plan([weakAuthority]))).toThrow(/canonical/);
  });

  it('creates an expiring Founder card but cannot assign Level-4 work', () => {
    const { instance } = coo();
    instance.createPlan(
      context,
      plan([task('production', [], { requiredAuthority: 4, exactTarget: 'production/release-1' })]),
    );
    expect(instance.listFounderDecisions(context)).toMatchObject([
      { taskId: 'production', exactTarget: 'production/release-1', status: 'PENDING' },
    ]);
    expect(() => instance.requestAssignment(context, assignment('production'))).toThrow(/Level-4/);
  });

  it('enforces assigned-only usage and task/objective ceilings without overflow', () => {
    const { instance } = coo();
    instance.createPlan(context, plan([task('task-1')]));
    expect(() => instance.recordUsage(context, 'task-1', 1, 1)).toThrow(/assigned/);
    instance.requestAssignment(context, assignment());
    expect(() => instance.recordUsage(context, 'task-1', 101, 1)).toThrow(/ceiling/);
    instance.recordUsage(context, 'task-1', 100, 50);
    expect(() => instance.recordUsage(context, 'task-1', Number.MAX_SAFE_INTEGER, 0)).toThrow(
      /ceiling/,
    );
  });

  it('applies retry ceilings and terminal stop codes deterministically', () => {
    const { instance } = coo();
    instance.createPlan(context, plan([task('task-1')]));
    instance.requestAssignment(context, assignment());
    expect(instance.recordFailure(context, 'task-1', 'TRANSIENT')).toBe('READY');
    instance.requestAssignment(
      context,
      assignment('task-1', { factoryRequest: { ...assignment().factoryRequest, id: 'assign-2' } }),
    );
    expect(instance.recordFailure(context, 'task-1', 'TRANSIENT')).toBe('FAILED');
  });

  it('handles a deep graph iteratively with code-point deterministic tie-breaking', () => {
    const tasks = Array.from({ length: 500 }, (_, index) =>
      task(
        `task-${String(index).padStart(3, '0')}`,
        index === 0 ? [] : [`task-${String(index - 1).padStart(3, '0')}`],
        { costLimit: { currency: 'USD', maximumMinorUnits: 0, maximumComputeUnits: 0 } },
      ),
    );
    const deepPlan = plan(tasks);
    deepPlan.objective.costLimit = {
      currency: 'USD',
      maximumMinorUnits: 0,
      maximumComputeUnits: 0,
    };
    const report = coo().instance.createPlan(context, deepPlan);
    expect(report.taskIds).toHaveLength(500);
    expect(report.totalDurationMs).toBe(50_000);
  });
});
