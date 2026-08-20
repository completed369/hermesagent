import { describe, expect, it } from 'vitest';

import {
  ControlPlanePolicyError,
  CostLimitExceededError,
  CrossWorkspaceAccessError,
  DuplicateEventError,
  InMemoryControlPlane,
  type ControlPlaneTask,
  type RuntimeAdapter,
  type RuntimeConnection,
  type ValidatedRuntimeCancellation,
  type ValidatedRuntimeDispatch,
  type WorkspaceContext,
} from '../index';

const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const founder: WorkspaceContext = { workspaceId: 'workspace-alpha', principalId: 'founder-alpha' };
const runtimePrincipal: WorkspaceContext = {
  workspaceId: founder.workspaceId,
  principalId: 'runtime-principal',
};
const otherRuntimePrincipal: WorkspaceContext = {
  workspaceId: founder.workspaceId,
  principalId: 'other-runtime-principal',
};
const outsider: WorkspaceContext = {
  workspaceId: founder.workspaceId,
  principalId: 'outsider',
};
const beta: WorkspaceContext = { workspaceId: 'workspace-beta', principalId: 'founder-beta' };

function reviewTask(id = 'task-review'): ControlPlaneTask {
  return {
    id,
    workspaceId: founder.workspaceId,
    assignedAgentId: 'agent-1',
    kind: 'repository.review',
    input: { repository: 'completed369/hermesagent', ref: 'main' },
    requiredCapabilityIds: ['capability-review'],
    requiredToolIds: ['tool-git'],
    requiredAuthorityLevel: 1,
    costLimit: { currency: 'USD', maximumMinorUnits: 500, maximumComputeUnits: 1_000 },
    status: 'READY',
    createdAt: '2026-08-20T12:00:00.000Z',
  };
}

function healthTask(): ControlPlaneTask {
  return {
    ...reviewTask('task-health'),
    kind: 'runtime.health.check',
    input: { connectionId: 'connection-1' },
    requiredCapabilityIds: ['capability-health'],
    requiredToolIds: ['tool-runtime-health'],
    requiredAuthorityLevel: 0,
  };
}

function provision(
  plane: InMemoryControlPlane,
  options: { reviewScopes?: readonly string[]; maxConcurrentRuns?: number } = {},
): void {
  plane.putRuntime(founder, {
    id: 'runtime-1',
    workspaceId: founder.workspaceId,
    name: 'Generic bridge',
    adapterKind: 'generic.bridge',
    createdAt: '2026-08-20T12:00:00.000Z',
  });
  plane.registerRuntimeAdapter(founder, 'runtime-1', runtimeAdapter('external-default'));
  plane.putCapability(founder, {
    id: 'capability-review',
    workspaceId: founder.workspaceId,
    name: 'repository.review',
    version: '1',
  });
  plane.putCapability(founder, {
    id: 'capability-health',
    workspaceId: founder.workspaceId,
    name: 'runtime.health',
    version: '1',
  });
  plane.putTool(founder, {
    id: 'tool-git',
    workspaceId: founder.workspaceId,
    name: 'git.readonly',
    version: '1',
  });
  plane.putTool(founder, {
    id: 'tool-runtime-health',
    workspaceId: founder.workspaceId,
    name: 'runtime.health',
    version: '1',
  });
  plane.putAgent(founder, {
    id: 'agent-1',
    workspaceId: founder.workspaceId,
    runtimeId: 'runtime-1',
    name: 'Reviewer',
    role: 'reviewer',
    authorityLevel: 2,
    maxConcurrentRuns: options.maxConcurrentRuns ?? 2,
    createdAt: '2026-08-20T12:00:00.000Z',
  });
  plane.grantAgentCapability(founder, {
    id: 'agent-capability-1',
    workspaceId: founder.workspaceId,
    agentId: 'agent-1',
    capabilityId: 'capability-review',
  });
  plane.grantAgentCapability(founder, {
    id: 'agent-capability-health',
    workspaceId: founder.workspaceId,
    agentId: 'agent-1',
    capabilityId: 'capability-health',
  });
  plane.grantTool(founder, {
    id: 'tool-grant-1',
    workspaceId: founder.workspaceId,
    agentId: 'agent-1',
    toolId: 'tool-git',
    scopes: options.reviewScopes ?? ['read'],
  });
  plane.grantTool(founder, {
    id: 'tool-grant-health',
    workspaceId: founder.workspaceId,
    agentId: 'agent-1',
    toolId: 'tool-runtime-health',
    scopes: ['observe'],
  });
  plane.grantAuthority(founder, {
    id: 'authority-1',
    workspaceId: founder.workspaceId,
    agentId: 'agent-1',
    level: 2,
    actionClasses: ['repository.review', 'runtime.health.check'],
    costLimit: { currency: 'USD', maximumMinorUnits: 1_000, maximumComputeUnits: 2_000 },
    maxConcurrentRuns: options.maxConcurrentRuns ?? 2,
  });
}

function partialConnection(): RuntimeConnection {
  return {
    id: 'connection-1',
    workspaceId: founder.workspaceId,
    runtimeId: 'runtime-1',
    status: 'PARTIAL',
    credentialReference: 'secret://runtime/generic',
    authenticatedPrincipalId: runtimePrincipal.principalId,
    registrationProof: {
      connectionId: 'connection-1',
      runtimeId: 'runtime-1',
      principalId: runtimePrincipal.principalId,
      observedAt: '2026-08-20T11:59:50.000Z',
    },
    capabilityExchangeProof: {
      connectionId: 'connection-1',
      runtimeId: 'runtime-1',
      principalId: runtimePrincipal.principalId,
      capabilityIds: ['capability-review', 'capability-health'],
      observedAt: '2026-08-20T11:59:51.000Z',
    },
  };
}

function runtimeAdapter(
  externalRunId: string,
  hooks: {
    onStart?: (dispatch: ValidatedRuntimeDispatch) => void;
    onCancel?: (cancellation: ValidatedRuntimeCancellation) => void;
  } = {},
): RuntimeAdapter {
  return {
    adapterKind: 'generic.bridge',
    discoverCapabilities: async () => ['repository.review', 'runtime.health'],
    health: async () => 'HEALTHY',
    start: async (_context, dispatch) => {
      hooks.onStart?.(dispatch);
      return { externalRunId };
    },
    cancel: async (_context, cancellation) => {
      hooks.onCancel?.(cancellation);
    },
  };
}

async function dispatchAndBind(
  plane: InMemoryControlPlane,
  runId: string,
  externalRunId = `external-${runId}`,
): Promise<void> {
  plane.registerRuntimeAdapter(founder, 'runtime-1', runtimeAdapter(externalRunId));
  const permit = plane.mintDispatch(founder, runId);
  await plane.executeDispatch(runtimePrincipal, permit);
}

async function connect(plane: InMemoryControlPlane): Promise<void> {
  provision(plane);
  const partial = partialConnection();
  plane.putConnection(founder, partial);
  plane.recordHeartbeat(runtimePrincipal, {
    id: 'heartbeat-1',
    workspaceId: founder.workspaceId,
    runtimeConnectionId: partial.id,
    principalId: runtimePrincipal.principalId,
    observedAt: '2026-08-20T11:59:55.000Z',
    sequence: 1,
    health: 'HEALTHY',
  });
  const heartbeatProof = {
    connectionId: partial.id,
    principalId: runtimePrincipal.principalId,
    heartbeatId: 'heartbeat-1',
    observedAt: '2026-08-20T11:59:55.000Z',
  } as const;
  plane.putConnection(founder, { ...partial, heartbeatProof });
  plane.createTask(founder, healthTask());
  plane.startRun(founder, {
    id: 'run-health',
    workspaceId: founder.workspaceId,
    taskId: 'task-health',
    agentId: 'agent-1',
    runtimeConnectionId: partial.id,
    status: 'QUEUED',
  });
  await dispatchAndBind(plane, 'run-health');
  plane.transitionRun(founder, 'run-health', 'RUNNING');
  plane.transitionRun(founder, 'run-health', 'COMPLETED');
  plane.appendEvent(runtimePrincipal, {
    id: 'event-health-result',
    workspaceId: founder.workspaceId,
    runId: 'run-health',
    type: 'run.completed',
    occurredAt: '2026-08-20T11:59:58.000Z',
    actorId: runtimePrincipal.principalId,
    idempotencyKey: 'connection-1:run-health:result',
    payload: { outcome: 'healthy' },
  });
  plane.putConnection(founder, {
    ...partial,
    status: 'CONNECTED',
    heartbeatProof,
    taskRoundTripProof: {
      connectionId: partial.id,
      principalId: runtimePrincipal.principalId,
      taskId: 'task-health',
      runId: 'run-health',
      resultEventId: 'event-health-result',
      completedAt: '2026-08-20T11:59:58.000Z',
    },
  });
}

describe('stored grants and workspace references', () => {
  it('rejects self-asserted authority and missing stored capability/tool grants', () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    plane.putRuntime(founder, {
      id: 'runtime-1',
      workspaceId: founder.workspaceId,
      name: 'Runtime',
      adapterKind: 'generic',
      createdAt: '2026-08-20T12:00:00.000Z',
    });
    plane.putAgent(founder, {
      id: 'agent-1',
      workspaceId: founder.workspaceId,
      runtimeId: 'runtime-1',
      name: 'Agent',
      role: 'reviewer',
      authorityLevel: 4,
      maxConcurrentRuns: 1,
      createdAt: '2026-08-20T12:00:00.000Z',
    });
    expect(() => plane.createTask(founder, reviewTask())).toThrow(ControlPlanePolicyError);
    expect(() =>
      plane.grantAuthority(runtimePrincipal, {
        id: 'forged',
        workspaceId: founder.workspaceId,
        agentId: 'agent-1',
        level: 4,
        actionClasses: ['repository.review'],
        costLimit: { currency: 'USD', maximumMinorUnits: 1_000, maximumComputeUnits: 2_000 },
        maxConcurrentRuns: 1,
      }),
    ).toThrow(ControlPlanePolicyError);
  });

  it('fails closed for missing and cross-workspace references', () => {
    const plane = new InMemoryControlPlane({ authorityPrincipals: [founder.principalId] });
    expect(() =>
      plane.putAgent(founder, {
        id: 'agent-1',
        workspaceId: founder.workspaceId,
        runtimeId: 'missing-runtime',
        name: 'Agent',
        role: 'reviewer',
        authorityLevel: 1,
        maxConcurrentRuns: 1,
        createdAt: '2026-08-20T12:00:00.000Z',
      }),
    ).toThrow(ControlPlanePolicyError);
    expect(() =>
      plane.putRuntime(beta, { ...partialRuntime(), workspaceId: founder.workspaceId }),
    ).toThrow(CrossWorkspaceAccessError);

    const collisionPlane = new InMemoryControlPlane({ authorityPrincipals: ['founder'] });
    const first = { workspaceId: 'a:b', principalId: 'founder' };
    const second = { workspaceId: 'a', principalId: 'founder' };
    collisionPlane.putRuntime(first, {
      id: 'c',
      workspaceId: first.workspaceId,
      name: 'First runtime',
      adapterKind: 'generic',
      createdAt: '2026-08-20T12:00:00.000Z',
    });
    expect(() =>
      collisionPlane.putAgent(second, {
        id: 'agent-collision',
        workspaceId: second.workspaceId,
        runtimeId: 'b:c',
        name: 'Agent',
        role: 'reviewer',
        authorityLevel: 1,
        maxConcurrentRuns: 1,
        createdAt: '2026-08-20T12:00:00.000Z',
      }),
    ).toThrow(/Runtime not found/);
  });
});

function partialRuntime() {
  return {
    id: 'runtime-beta',
    workspaceId: beta.workspaceId,
    name: 'Runtime',
    adapterKind: 'generic',
    createdAt: '2026-08-20T12:00:00.000Z',
  };
}

describe('allowlisted structured tasks', () => {
  it('allows only an authorized planner or founder to create a task', () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
      plannerPrincipals: ['planner'],
    });
    provision(plane);
    expect(() => plane.createTask(outsider, reviewTask())).toThrow(/authorized planner/);
    plane.createTask(
      { workspaceId: founder.workspaceId, principalId: 'planner' },
      reviewTask('task-planned'),
    );
    expect(plane.getTask(founder, 'task-planned')).toBeDefined();
  });

  it('derives mandatory capability, tool, and exact tool-scope requirements from policy', () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    provision(plane);
    expect(() =>
      plane.createTask(founder, {
        ...reviewTask('task-empty-requirements'),
        requiredCapabilityIds: [],
        requiredToolIds: [],
      }),
    ).toThrow(/exactly match/);
    expect(() =>
      plane.createTask(founder, {
        ...reviewTask('task-forged-authority'),
        requiredAuthorityLevel: 0,
      }),
    ).toThrow(/exactly match/);

    const wrongScopePlane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    provision(wrongScopePlane, { reviewScopes: ['write'] });
    expect(() => wrongScopePlane.createTask(founder, reviewTask())).toThrow(/read scope/);
  });

  it('rejects unknown task kinds and command-shaped fields', () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    provision(plane);
    expect(() =>
      plane.createTask(founder, {
        ...reviewTask(),
        kind: 'shell.execute',
      } as unknown as ControlPlaneTask),
    ).toThrow(ControlPlanePolicyError);
    for (const field of ['command', 'cmd', 'arguments', 'argv', 'script']) {
      expect(() =>
        plane.createTask(founder, {
          ...reviewTask(`task-${field}`),
          input: { repository: 'completed369/hermesagent', [field]: 'anything' },
        }),
      ).toThrow(ControlPlanePolicyError);
    }
  });

  it('counts UTF-8 bytes rather than JavaScript characters', () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    provision(plane);
    expect(() =>
      plane.createTask(founder, {
        ...reviewTask(),
        input: { repository: '😀'.repeat(17_000) },
      }),
    ).toThrow(/64 KiB/);
  });
});

describe('authenticated connection evidence', () => {
  it('requires correlated principal-bound proofs and a fresh heartbeat', async () => {
    let now = NOW;
    const plane = new InMemoryControlPlane({
      clock: () => now,
      authorityPrincipals: [founder.principalId],
      heartbeatFreshnessMs: 60_000,
    });
    await connect(plane);
    expect(plane.deriveConnectionStatus(founder, 'connection-1')).toBe('CONNECTED');
    now += 61_000;
    expect(plane.deriveConnectionStatus(founder, 'connection-1')).toBe('DEGRADED');
  });

  it('rejects mismatched registration and heartbeat principals', () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    provision(plane);
    const connection = partialConnection();
    expect(() =>
      plane.putConnection(founder, {
        ...connection,
        registrationProof: { ...connection.registrationProof!, principalId: 'impersonator' },
      }),
    ).toThrow(ControlPlanePolicyError);
    expect(() =>
      plane.putConnection(founder, {
        ...connection,
        taskRoundTripProof: {
          connectionId: connection.id,
          principalId: runtimePrincipal.principalId,
          taskId: 'missing-task',
          runId: 'missing-run',
          resultEventId: 'missing-event',
          completedAt: '2026-08-20T12:00:00.000Z',
        },
      }),
    ).toThrow(/Task proof task/);
    plane.putConnection(founder, connection);
    expect(() =>
      plane.recordHeartbeat(runtimePrincipal, {
        id: 'forged-heartbeat',
        workspaceId: founder.workspaceId,
        runtimeConnectionId: connection.id,
        principalId: 'impersonator',
        observedAt: '2026-08-20T12:00:00.000Z',
        sequence: 1,
        health: 'HEALTHY',
      }),
    ).toThrow(ControlPlanePolicyError);
  });
});

describe('runs, events, and budgets', () => {
  it('enforces one active run per task, concurrency, and legal run transitions', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await connect(plane);
    plane.createTask(founder, reviewTask('task-1'));
    plane.createTask(founder, reviewTask('task-2'));
    plane.createTask(founder, reviewTask('task-3'));
    plane.startRun(founder, {
      id: 'run-1',
      workspaceId: founder.workspaceId,
      taskId: 'task-1',
      agentId: 'agent-1',
      runtimeConnectionId: 'connection-1',
      status: 'QUEUED',
    });
    expect(() =>
      plane.startRun(founder, {
        id: 'run-2',
        workspaceId: founder.workspaceId,
        taskId: 'task-1',
        agentId: 'agent-1',
        runtimeConnectionId: 'connection-1',
        status: 'QUEUED',
      }),
    ).toThrow(/already has an active run/);
    plane.startRun(founder, {
      id: 'run-2',
      workspaceId: founder.workspaceId,
      taskId: 'task-2',
      agentId: 'agent-1',
      runtimeConnectionId: 'connection-1',
      status: 'QUEUED',
    });
    expect(() =>
      plane.startRun(founder, {
        id: 'run-3',
        workspaceId: founder.workspaceId,
        taskId: 'task-3',
        agentId: 'agent-1',
        runtimeConnectionId: 'connection-1',
        status: 'QUEUED',
      }),
    ).toThrow(/concurrency/);
    expect(() => plane.transitionRun(founder, 'run-1', 'COMPLETED')).toThrow(/Illegal run/);
    await dispatchAndBind(plane, 'run-1');
    plane.transitionRun(founder, 'run-1', 'RUNNING');
    plane.transitionRun(founder, 'run-1', 'COMPLETED');
    expect(() => plane.transitionRun(founder, 'run-1', 'RUNNING')).toThrow(/Illegal run/);
  });

  it('reserves RUNNING/COMPLETED task states for an atomic run lifecycle', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await connect(plane);
    plane.createTask(founder, reviewTask('task-atomic'));
    expect(() => plane.transitionTask(founder, 'task-atomic', 'RUNNING')).toThrow(/run lifecycle/);
    expect(() => plane.transitionTask(founder, 'task-atomic', 'COMPLETED')).toThrow(
      /run lifecycle/,
    );
    plane.startRun(founder, {
      id: 'run-atomic',
      workspaceId: founder.workspaceId,
      taskId: 'task-atomic',
      agentId: 'agent-1',
      runtimeConnectionId: 'connection-1',
      status: 'QUEUED',
    });
    await dispatchAndBind(plane, 'run-atomic');
    plane.transitionRun(founder, 'run-atomic', 'RUNNING');
    plane.transitionRun(founder, 'run-atomic', 'PAUSED');
    plane.transitionRun(founder, 'run-atomic', 'RUNNING');
    expect(plane.getTask(founder, 'task-atomic')?.status).toBe('RUNNING');

    expect(() => plane.transitionTask(founder, 'task-atomic', 'BLOCKED')).toThrow(/active task/);
    expect(plane.getRun(founder, 'run-atomic')?.status).toBe('RUNNING');
    expect(plane.getTask(founder, 'task-atomic')?.status).toBe('RUNNING');
    plane.transitionRun(founder, 'run-atomic', 'COMPLETED');
    expect(plane.getRun(founder, 'run-atomic')?.status).toBe('COMPLETED');
    expect(plane.getTask(founder, 'task-atomic')?.status).toBe('COMPLETED');
  });

  it('rejects direct task cancellation while a queued run exists and cancels both atomically', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await connect(plane);
    plane.createTask(founder, reviewTask('task-queued-cancel'));
    plane.startRun(founder, {
      id: 'run-queued-cancel',
      workspaceId: founder.workspaceId,
      taskId: 'task-queued-cancel',
      agentId: 'agent-1',
      runtimeConnectionId: 'connection-1',
      status: 'QUEUED',
    });
    expect(() => plane.transitionTask(founder, 'task-queued-cancel', 'CANCELLED')).toThrow(
      /active task/,
    );
    plane.transitionRun(founder, 'run-queued-cancel', 'CANCELLED');
    expect(plane.getRun(founder, 'run-queued-cancel')?.status).toBe('CANCELLED');
    expect(plane.getTask(founder, 'task-queued-cancel')?.status).toBe('CANCELLED');
  });

  it('requires the runtime capability exchange to satisfy the task', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await connect(plane);
    const connection = partialConnection();
    plane.putConnection(founder, {
      ...connection,
      capabilityExchangeProof: {
        ...connection.capabilityExchangeProof!,
        capabilityIds: ['capability-health'],
      },
      heartbeatProof: {
        connectionId: connection.id,
        principalId: runtimePrincipal.principalId,
        heartbeatId: 'heartbeat-1',
        observedAt: '2026-08-20T11:59:55.000Z',
      },
      taskRoundTripProof: {
        connectionId: connection.id,
        principalId: runtimePrincipal.principalId,
        taskId: 'task-health',
        runId: 'run-health',
        resultEventId: 'event-health-result',
        completedAt: '2026-08-20T11:59:58.000Z',
      },
      status: 'CONNECTED',
    });
    plane.createTask(founder, reviewTask('task-capability-exchange'));
    expect(() =>
      plane.startRun(founder, {
        id: 'run-capability-exchange',
        workspaceId: founder.workspaceId,
        taskId: 'task-capability-exchange',
        agentId: 'agent-1',
        runtimeConnectionId: 'connection-1',
        status: 'QUEUED',
      }),
    ).toThrow(/did not exchange required capability/);
  });

  it('rejects duplicate event IDs independently of idempotency keys', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await connect(plane);
    const event = {
      id: 'event-duplicate',
      workspaceId: founder.workspaceId,
      type: 'objective.created',
      occurredAt: '2026-08-20T12:00:00.000Z',
      actorId: founder.principalId,
      idempotencyKey: 'objective:1',
      payload: { objectiveId: 'objective-1' },
    } as const;
    plane.appendEvent(founder, event);
    expect(() => plane.appendEvent(founder, { ...event, idempotencyKey: 'objective:2' })).toThrow(
      DuplicateEventError,
    );
  });

  it('enforces cumulative financial and compute budgets across runs', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await connect(plane);
    plane.recordUsage(founder, {
      id: 'usage-1',
      workspaceId: founder.workspaceId,
      taskId: 'task-health',
      runId: 'run-health',
      costMinorUnits: 400,
      computeUnits: 900,
      currency: 'USD',
      recordedAt: '2026-08-20T12:00:00.000Z',
    });
    expect(() =>
      plane.recordUsage(founder, {
        id: 'usage-compute-over',
        workspaceId: founder.workspaceId,
        taskId: 'task-health',
        runId: 'run-health',
        computeUnits: 101,
        recordedAt: '2026-08-20T12:01:00.000Z',
      }),
    ).toThrow(CostLimitExceededError);
    expect(() =>
      plane.recordUsage(founder, {
        id: 'usage-cost-over',
        workspaceId: founder.workspaceId,
        taskId: 'task-health',
        runId: 'run-health',
        costMinorUnits: 101,
        currency: 'USD',
        recordedAt: '2026-08-20T12:01:00.000Z',
      }),
    ).toThrow(CostLimitExceededError);
  });
});

describe('runtime adapter boundary', () => {
  async function queuedReviewRun(plane: InMemoryControlPlane): Promise<void> {
    await connect(plane);
    plane.registerRuntimeAdapter(founder, 'runtime-1', runtimeAdapter('external-run-dispatch'));
    plane.createTask(founder, reviewTask('task-dispatch'));
    plane.startRun(founder, {
      id: 'run-dispatch',
      workspaceId: founder.workspaceId,
      taskId: 'task-dispatch',
      agentId: 'agent-1',
      runtimeConnectionId: 'connection-1',
      status: 'QUEUED',
    });
  }

  it('accepts only an exact, one-use policy-minted dispatch envelope', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await queuedReviewRun(plane);
    const dispatch = plane.mintDispatch(founder, 'run-dispatch');
    expect(() => plane.mintDispatch(founder, 'run-dispatch')).toThrow(/already has/);
    const forged = {
      ...dispatch,
      envelope: {
        ...dispatch.envelope,
        capabilityIds: [],
        tools: [],
        authorityLevel: 4 as const,
      },
    };
    await expect(plane.executeDispatch(runtimePrincipal, forged)).rejects.toThrow(/policy-minted/);
    await expect(plane.executeDispatch(runtimePrincipal, dispatch)).resolves.toEqual({
      externalRunId: 'external-run-dispatch',
    });
    await expect(plane.executeDispatch(runtimePrincipal, dispatch)).rejects.toThrow(
      /policy-minted/,
    );
  });

  it('invalidates a permit if its registered adapter changes before execution', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await queuedReviewRun(plane);
    const dispatch = plane.mintDispatch(founder, 'run-dispatch');
    plane.registerRuntimeAdapter(founder, 'runtime-1', runtimeAdapter('external-replacement'));
    await expect(plane.executeDispatch(runtimePrincipal, dispatch)).rejects.toThrow(/stale/);
    await expect(plane.executeDispatch(runtimePrincipal, dispatch)).rejects.toThrow(
      /policy-minted/,
    );
  });

  it('deep-freezes exact authority and tool scopes before invoking the adapter', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await queuedReviewRun(plane);
    plane.grantTool(founder, {
      id: 'tool-grant-1',
      workspaceId: founder.workspaceId,
      agentId: 'agent-1',
      toolId: 'tool-git',
      scopes: ['read', 'write', 'admin'],
    });
    let received: ValidatedRuntimeDispatch | undefined;
    plane.registerRuntimeAdapter(
      founder,
      'runtime-1',
      runtimeAdapter('external-frozen', {
        onStart: (validated) => {
          expect(Object.isFrozen(validated)).toBe(true);
          expect(Object.isFrozen(validated.envelope)).toBe(true);
          expect(Object.isFrozen(validated.envelope.tools[0]?.scopes)).toBe(true);
          try {
            (validated.envelope as { authorityLevel: number }).authorityLevel = 4;
          } catch {}
          try {
            (validated.envelope.tools[0]!.scopes as string[])[0] = 'admin';
          } catch {}
          received = structuredClone(validated);
        },
      }),
    );
    const dispatch = plane.mintDispatch(founder, 'run-dispatch');
    await plane.executeDispatch(runtimePrincipal, dispatch);
    expect(received?.envelope.authorityLevel).toBe(1);
    expect(received?.envelope.tools).toEqual([{ toolId: 'tool-git', scopes: ['read'] }]);
  });

  it('invalidates a dispatch permit when its queued run was cancelled before claim', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await queuedReviewRun(plane);
    const dispatch = plane.mintDispatch(founder, 'run-dispatch');
    plane.transitionRun(founder, 'run-dispatch', 'CANCELLED');
    await expect(plane.executeDispatch(runtimePrincipal, dispatch)).rejects.toThrow(/stale/);
    await expect(plane.executeDispatch(runtimePrincipal, dispatch)).rejects.toThrow(
      /policy-minted/,
    );
  });

  it('revalidates current grants and remaining budgets before validating dispatch', async () => {
    const grantPlane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await queuedReviewRun(grantPlane);
    const staleGrantDispatch = grantPlane.mintDispatch(founder, 'run-dispatch');
    grantPlane.grantTool(founder, {
      id: 'tool-grant-1',
      workspaceId: founder.workspaceId,
      agentId: 'agent-1',
      toolId: 'tool-git',
      scopes: ['read'],
      expiresAt: '2026-08-20T11:59:59.000Z',
    });
    await expect(grantPlane.executeDispatch(runtimePrincipal, staleGrantDispatch)).rejects.toThrow(
      /lacks read scope/,
    );
    await expect(grantPlane.executeDispatch(runtimePrincipal, staleGrantDispatch)).rejects.toThrow(
      /policy-minted/,
    );

    const budgetPlane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await queuedReviewRun(budgetPlane);
    const exhaustedBudgetDispatch = budgetPlane.mintDispatch(founder, 'run-dispatch');
    budgetPlane.recordUsage(founder, {
      id: 'usage-exhausted-before-dispatch',
      workspaceId: founder.workspaceId,
      taskId: 'task-dispatch',
      runId: 'run-dispatch',
      costMinorUnits: 500,
      computeUnits: 1_000,
      currency: 'USD',
      recordedAt: '2026-08-20T12:00:00.000Z',
    });
    await expect(
      budgetPlane.executeDispatch(runtimePrincipal, exhaustedBudgetDispatch),
    ).rejects.toThrow(CostLimitExceededError);
  });

  it('binds immutable cancellation to the owning runtime principal and external run', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await queuedReviewRun(plane);
    expect(() =>
      plane.appendEvent(otherRuntimePrincipal, {
        id: 'cross-runtime-event',
        workspaceId: founder.workspaceId,
        runId: 'run-dispatch',
        type: 'run.progress',
        occurredAt: '2026-08-20T12:00:00.000Z',
        actorId: otherRuntimePrincipal.principalId,
        idempotencyKey: 'other-runtime:run-dispatch:progress',
        payload: { status: 'working' },
      }),
    ).toThrow(/does not own/);

    await dispatchAndBind(plane, 'run-dispatch', 'external-123');
    let received: ValidatedRuntimeCancellation | undefined;
    plane.registerRuntimeAdapter(
      founder,
      'runtime-1',
      runtimeAdapter('external-123', {
        onCancel: (validated) => {
          expect(Object.isFrozen(validated)).toBe(true);
          try {
            (validated as { externalRunId: string }).externalRunId = 'external-replaced';
          } catch {}
          received = structuredClone(validated);
        },
      }),
    );
    const cancellation = plane.mintCancellation(founder, 'run-dispatch');
    await expect(plane.executeCancellation(otherRuntimePrincipal, cancellation)).rejects.toThrow(
      /not bound to this runtime/,
    );
    const forged = { ...cancellation, externalRunId: 'external-forged' };
    await expect(plane.executeCancellation(runtimePrincipal, forged)).rejects.toThrow(
      /not bound to this runtime/,
    );
    await plane.executeCancellation(runtimePrincipal, cancellation);
    expect(received?.externalRunId).toBe('external-123');
    await expect(plane.executeCancellation(runtimePrincipal, cancellation)).rejects.toThrow(
      /not bound to this runtime/,
    );
    expect(() => plane.mintCancellation(founder, 'run-dispatch')).toThrow(/already has/);
  });

  it('invalidates a cancellation permit when its run completed before claim', async () => {
    const plane = new InMemoryControlPlane({
      clock: () => NOW,
      authorityPrincipals: [founder.principalId],
    });
    await queuedReviewRun(plane);
    await dispatchAndBind(plane, 'run-dispatch');
    plane.transitionRun(founder, 'run-dispatch', 'RUNNING');
    const cancellation = plane.mintCancellation(founder, 'run-dispatch');
    plane.transitionRun(founder, 'run-dispatch', 'COMPLETED');
    await expect(plane.executeCancellation(runtimePrincipal, cancellation)).rejects.toThrow(
      /stale/,
    );
    await expect(plane.executeCancellation(runtimePrincipal, cancellation)).rejects.toThrow(
      /not bound/,
    );
  });
});
