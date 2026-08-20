import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import type {
  Agent,
  AgentCapability,
  AgentRun,
  AuthorityGrant,
  Capability,
  ControlPlaneEvent,
  ControlPlaneTask,
  EntityId,
  Heartbeat,
  RunStatus,
  Runtime,
  RuntimeAdapter,
  RuntimeCancellationPermit,
  RuntimeConnection,
  RuntimeConnectionStatus,
  RuntimeDispatchPermit,
  TaskKind,
  TaskStatus,
  Tool,
  ToolGrant,
  UsageRecord,
  ValidatedRuntimeCancellation,
  ValidatedRuntimeDispatch,
  WorkspaceContext,
} from './contracts';

export class ControlPlanePolicyError extends Error {}
export class CrossWorkspaceAccessError extends ControlPlanePolicyError {}
export class DuplicateEventError extends ControlPlanePolicyError {}
export class CostLimitExceededError extends ControlPlanePolicyError {}

interface ControlPlaneOptions {
  clock?: () => number;
  heartbeatFreshnessMs?: number;
  authorityPrincipals?: readonly EntityId[];
  plannerPrincipals?: readonly EntityId[];
}

interface TaskKindPolicy {
  inputKeys: readonly string[];
  capabilityNames: readonly string[];
  tools: readonly { name: string; scope: string }[];
  authorityLevel: ControlPlaneTask['requiredAuthorityLevel'];
}

const TASK_POLICIES: Readonly<Record<TaskKind, TaskKindPolicy>> = {
  'repository.review': {
    inputKeys: ['repository', 'ref', 'pullRequestUrl'],
    capabilityNames: ['repository.review'],
    tools: [{ name: 'git.readonly', scope: 'read' }],
    authorityLevel: 1,
  },
  'quality.verify': {
    inputKeys: ['target', 'checks'],
    capabilityNames: ['quality.verify'],
    tools: [{ name: 'quality.runner', scope: 'verify' }],
    authorityLevel: 3,
  },
  'documentation.prepare': {
    inputKeys: ['document', 'evidenceIds'],
    capabilityNames: ['documentation.prepare'],
    tools: [{ name: 'documents.workspace', scope: 'write' }],
    authorityLevel: 2,
  },
  'runtime.health.check': {
    inputKeys: ['connectionId'],
    capabilityNames: ['runtime.health'],
    tools: [{ name: 'runtime.health', scope: 'observe' }],
    authorityLevel: 0,
  },
};

const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  READY: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  RUNNING: ['BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  BLOCKED: ['READY', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

function key(workspaceId: EntityId, id: EntityId): string {
  return JSON.stringify([workspaceId, id]);
}

function assertWorkspace(context: WorkspaceContext, workspaceId: EntityId): void {
  if (context.workspaceId !== workspaceId) {
    throw new CrossWorkspaceAccessError('Resource is outside the authenticated workspace');
  }
}

function assertSafeValue(value: unknown, depth: number): void {
  if (depth > 8) throw new ControlPlanePolicyError('Payload exceeds the maximum nesting depth');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertSafeValue(item, depth + 1);
    return;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ControlPlanePolicyError('Payload must contain only JSON-safe values');
  }
  for (const item of Object.values(value as Readonly<Record<string, unknown>>)) {
    assertSafeValue(item, depth + 1);
  }
}

function assertBoundedRecord(value: Readonly<Record<string, unknown>>): void {
  assertSafeValue(value, 0);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) {
    throw new ControlPlanePolicyError('Payload exceeds 64 KiB');
  }
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2_048) {
    throw new ControlPlanePolicyError(`${field} must be a non-empty bounded string`);
  }
}

function assertStringArray(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length > 32) {
    throw new ControlPlanePolicyError(`${field} must be an array with at most 32 entries`);
  }
  for (const item of value) assertString(item, field);
}

function assertTaskInput(task: ControlPlaneTask): void {
  assertBoundedRecord(task.input);
  const policy = TASK_POLICIES[task.kind];
  if (!policy) throw new ControlPlanePolicyError(`Unsupported task kind: ${String(task.kind)}`);
  for (const inputKey of Object.keys(task.input)) {
    if (!policy.inputKeys.includes(inputKey)) {
      throw new ControlPlanePolicyError(`Input field ${inputKey} is not allowed for ${task.kind}`);
    }
  }
  if (task.kind === 'repository.review') {
    assertString(task.input.repository, 'repository');
    if (task.input.ref !== undefined) assertString(task.input.ref, 'ref');
    if (task.input.pullRequestUrl !== undefined)
      assertString(task.input.pullRequestUrl, 'pullRequestUrl');
  } else if (task.kind === 'quality.verify') {
    assertString(task.input.target, 'target');
    assertStringArray(task.input.checks, 'checks');
  } else if (task.kind === 'documentation.prepare') {
    assertString(task.input.document, 'document');
    assertStringArray(task.input.evidenceIds, 'evidenceIds');
  } else {
    assertString(task.input.connectionId, 'connectionId');
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ControlPlanePolicyError(`${field} must be a non-negative integer`);
  }
}

function parsedTime(value: string, field: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time))
    throw new ControlPlanePolicyError(`${field} must be an ISO timestamp`);
  return time;
}

function isExpired(expiresAt: string | undefined, now: number): boolean {
  return expiresAt !== undefined && parsedTime(expiresAt, 'expiresAt') <= now;
}

function sameIds(left: readonly EntityId[], right: readonly EntityId[]): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return (
    left.length === normalizedLeft.length &&
    right.length === normalizedRight.length &&
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export class InMemoryControlPlane {
  readonly #clock: () => number;
  readonly #heartbeatFreshnessMs: number;
  readonly #authorityPrincipals: ReadonlySet<EntityId>;
  readonly #plannerPrincipals: ReadonlySet<EntityId>;
  readonly #runtimes = new Map<string, Runtime>();
  readonly #runtimeAdapters = new Map<
    string,
    { registrationId: EntityId; adapter: RuntimeAdapter }
  >();
  readonly #agents = new Map<string, Agent>();
  readonly #capabilities = new Map<string, Capability>();
  readonly #agentCapabilities = new Map<string, AgentCapability>();
  readonly #tools = new Map<string, Tool>();
  readonly #toolGrants = new Map<string, ToolGrant>();
  readonly #authorityGrants = new Map<string, AuthorityGrant>();
  readonly #connections = new Map<string, RuntimeConnection>();
  readonly #heartbeats = new Map<string, Heartbeat>();
  readonly #tasks = new Map<string, ControlPlaneTask>();
  readonly #runs = new Map<string, AgentRun>();
  readonly #eventsById = new Map<string, ControlPlaneEvent>();
  readonly #eventIdempotency = new Map<string, EntityId>();
  readonly #usage = new Map<string, UsageRecord>();
  readonly #dispatches = new Map<string, RuntimeDispatchPermit>();
  readonly #cancellations = new Map<string, RuntimeCancellationPermit>();
  readonly #dispatchedRuns = new Set<string>();
  readonly #claimedDispatchRuns = new Set<string>();
  readonly #cancelledRuns = new Set<string>();

  constructor(options: ControlPlaneOptions = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#heartbeatFreshnessMs = options.heartbeatFreshnessMs ?? 5 * 60 * 1_000;
    this.#authorityPrincipals = new Set(options.authorityPrincipals ?? []);
    this.#plannerPrincipals = new Set(options.plannerPrincipals ?? []);
  }

  putRuntime(context: WorkspaceContext, runtime: Runtime): void {
    assertWorkspace(context, runtime.workspaceId);
    this.#assertAuthorizer(context);
    this.#runtimes.set(key(runtime.workspaceId, runtime.id), structuredClone(runtime));
  }

  registerRuntimeAdapter(
    context: WorkspaceContext,
    runtimeId: EntityId,
    adapter: RuntimeAdapter,
  ): void {
    this.#assertAuthorizer(context);
    const runtime = this.#require(this.#runtimes, context, runtimeId, 'Runtime');
    if (adapter.adapterKind !== runtime.adapterKind) {
      throw new ControlPlanePolicyError('Adapter kind does not match the registered runtime');
    }
    const adapterKey = key(context.workspaceId, runtime.id);
    const previous = this.#runtimeAdapters.get(adapterKey);
    if (previous) {
      const hasActiveBoundRun = [...this.#runs.values()].some((run) => {
        if (
          run.workspaceId !== context.workspaceId ||
          run.adapterRegistrationId !== previous.registrationId ||
          !['QUEUED', 'RUNNING', 'PAUSED'].includes(run.status)
        ) {
          return false;
        }
        const connection = this.#connections.get(key(run.workspaceId, run.runtimeConnectionId));
        return connection?.runtimeId === runtime.id;
      });
      if (hasActiveBoundRun) {
        throw new ControlPlanePolicyError('Cannot replace an adapter with active bound runs');
      }
    }
    this.#runtimeAdapters.set(adapterKey, {
      registrationId: randomUUID(),
      adapter: Object.freeze(adapter),
    });
  }

  putCapability(context: WorkspaceContext, capability: Capability): void {
    assertWorkspace(context, capability.workspaceId);
    this.#assertAuthorizer(context);
    this.#capabilities.set(key(capability.workspaceId, capability.id), structuredClone(capability));
  }

  putTool(context: WorkspaceContext, tool: Tool): void {
    assertWorkspace(context, tool.workspaceId);
    this.#assertAuthorizer(context);
    this.#tools.set(key(tool.workspaceId, tool.id), structuredClone(tool));
  }

  putAgent(context: WorkspaceContext, agent: Agent): void {
    assertWorkspace(context, agent.workspaceId);
    this.#assertAuthorizer(context);
    this.#require(this.#runtimes, context, agent.runtimeId, 'Runtime');
    if (!Number.isSafeInteger(agent.maxConcurrentRuns) || agent.maxConcurrentRuns < 1) {
      throw new ControlPlanePolicyError('Agent maxConcurrentRuns must be a positive integer');
    }
    this.#agents.set(key(agent.workspaceId, agent.id), structuredClone(agent));
  }

  getAgent(context: WorkspaceContext, agentId: EntityId): Agent | undefined {
    const agent = this.#agents.get(key(context.workspaceId, agentId));
    return agent ? structuredClone(agent) : undefined;
  }

  grantAgentCapability(context: WorkspaceContext, grant: AgentCapability): void {
    assertWorkspace(context, grant.workspaceId);
    this.#assertAuthorizer(context);
    this.#require(this.#agents, context, grant.agentId, 'Agent');
    this.#require(this.#capabilities, context, grant.capabilityId, 'Capability');
    this.#agentCapabilities.set(key(grant.workspaceId, grant.id), structuredClone(grant));
  }

  grantTool(context: WorkspaceContext, grant: ToolGrant): void {
    assertWorkspace(context, grant.workspaceId);
    this.#assertAuthorizer(context);
    this.#require(this.#agents, context, grant.agentId, 'Agent');
    this.#require(this.#tools, context, grant.toolId, 'Tool');
    if (grant.scopes.length === 0) throw new ControlPlanePolicyError('Tool grant requires a scope');
    this.#toolGrants.set(key(grant.workspaceId, grant.id), structuredClone(grant));
  }

  grantAuthority(context: WorkspaceContext, grant: AuthorityGrant): void {
    assertWorkspace(context, grant.workspaceId);
    this.#assertAuthorizer(context);
    const agent = this.#require(this.#agents, context, grant.agentId, 'Agent');
    if (grant.level > agent.authorityLevel) {
      throw new ControlPlanePolicyError('Authority grant exceeds the agent authority ceiling');
    }
    this.#assertCostLimit(grant.costLimit);
    if (!Number.isSafeInteger(grant.maxConcurrentRuns) || grant.maxConcurrentRuns < 1) {
      throw new ControlPlanePolicyError('Authority maxConcurrentRuns must be a positive integer');
    }
    this.#authorityGrants.set(key(grant.workspaceId, grant.id), structuredClone(grant));
  }

  putConnection(context: WorkspaceContext, connection: RuntimeConnection): void {
    assertWorkspace(context, connection.workspaceId);
    const connectionKey = key(connection.workspaceId, connection.id);
    const previous = this.#connections.get(connectionKey);
    const isAuthorizer = this.#authorityPrincipals.has(context.principalId);
    if (!previous) {
      if (!isAuthorizer) {
        throw new ControlPlanePolicyError('Initial connection provisioning requires an authorizer');
      }
    } else if (!isAuthorizer) {
      if (context.principalId !== previous.authenticatedPrincipalId) {
        throw new ControlPlanePolicyError(
          'Connection update requires its existing runtime principal',
        );
      }
      if (
        connection.runtimeId !== previous.runtimeId ||
        connection.authenticatedPrincipalId !== previous.authenticatedPrincipalId ||
        connection.credentialReference !== previous.credentialReference
      ) {
        throw new ControlPlanePolicyError(
          'Runtime identity and credential binding require authorizer rotation',
        );
      }
    }
    this.#require(this.#runtimes, context, connection.runtimeId, 'Runtime');
    if (
      connection.credentialReference &&
      !/^(secret|vault|envref):\/\//.test(connection.credentialReference)
    ) {
      throw new ControlPlanePolicyError('Runtime credentials must be stored as secret references');
    }
    this.#validateConnectionProofs(context, connection);
    this.#connections.set(connectionKey, structuredClone(connection));
    try {
      if (
        connection.status === 'CONNECTED' &&
        this.deriveConnectionStatus(context, connection.id) !== 'CONNECTED'
      ) {
        throw new ControlPlanePolicyError('CONNECTED requires fresh correlated runtime evidence');
      }
    } catch (error) {
      if (previous) this.#connections.set(connectionKey, previous);
      else this.#connections.delete(connectionKey);
      throw error;
    }
  }

  recordHeartbeat(context: WorkspaceContext, heartbeat: Heartbeat): void {
    assertWorkspace(context, heartbeat.workspaceId);
    const connection = this.#require(
      this.#connections,
      context,
      heartbeat.runtimeConnectionId,
      'Runtime connection',
    );
    if (
      heartbeat.principalId !== connection.authenticatedPrincipalId ||
      context.principalId !== heartbeat.principalId
    ) {
      throw new ControlPlanePolicyError(
        'Heartbeat principal is not bound to the runtime connection',
      );
    }
    const prior = [...this.#heartbeats.values()]
      .filter(
        (candidate) =>
          candidate.workspaceId === heartbeat.workspaceId &&
          candidate.runtimeConnectionId === heartbeat.runtimeConnectionId,
      )
      .reduce((highest, candidate) => Math.max(highest, candidate.sequence), -1);
    if (!Number.isSafeInteger(heartbeat.sequence) || heartbeat.sequence <= prior) {
      throw new ControlPlanePolicyError('Heartbeat sequence must increase monotonically');
    }
    if (this.#heartbeats.has(key(heartbeat.workspaceId, heartbeat.id))) {
      throw new ControlPlanePolicyError('Duplicate heartbeat ID');
    }
    parsedTime(heartbeat.observedAt, 'heartbeat.observedAt');
    this.#heartbeats.set(key(heartbeat.workspaceId, heartbeat.id), structuredClone(heartbeat));
  }

  deriveConnectionStatus(
    context: WorkspaceContext,
    connectionId: EntityId,
  ): RuntimeConnectionStatus {
    const connection = this.#require(
      this.#connections,
      context,
      connectionId,
      'Runtime connection',
    );
    if (!connection.credentialReference || !connection.authenticatedPrincipalId)
      return 'NOT_CONFIGURED';
    const proofs = [
      connection.registrationProof,
      connection.capabilityExchangeProof,
      connection.heartbeatProof,
      connection.taskRoundTripProof,
    ];
    if (!proofs.some(Boolean)) return 'DISCONNECTED';
    if (!proofs.every(Boolean)) return 'PARTIAL';

    const heartbeat = this.#heartbeats.get(
      key(connection.workspaceId, connection.heartbeatProof!.heartbeatId),
    );
    if (!heartbeat || heartbeat.runtimeConnectionId !== connection.id) return 'PARTIAL';
    if (heartbeat.health !== 'HEALTHY') return 'DEGRADED';
    const age = this.#clock() - parsedTime(heartbeat.observedAt, 'heartbeat.observedAt');
    if (age < -30_000 || age > this.#heartbeatFreshnessMs) return 'DEGRADED';

    const roundTrip = connection.taskRoundTripProof!;
    const task = this.#tasks.get(key(connection.workspaceId, roundTrip.taskId));
    const run = this.#runs.get(key(connection.workspaceId, roundTrip.runId));
    const event = this.#eventsById.get(key(connection.workspaceId, roundTrip.resultEventId));
    const agent = run ? this.#agents.get(key(connection.workspaceId, run.agentId)) : undefined;
    if (
      !task ||
      !run ||
      !event ||
      !agent ||
      run.taskId !== task.id ||
      task.assignedAgentId !== agent.id ||
      agent.runtimeId !== connection.runtimeId ||
      run.runtimeConnectionId !== connection.id ||
      run.status !== 'COMPLETED' ||
      event.runId !== run.id ||
      event.type !== 'run.completed' ||
      event.actorId !== connection.authenticatedPrincipalId
    ) {
      return 'PARTIAL';
    }
    return 'CONNECTED';
  }

  createTask(context: WorkspaceContext, task: ControlPlaneTask): void {
    assertWorkspace(context, task.workspaceId);
    if (
      !this.#authorityPrincipals.has(context.principalId) &&
      !this.#plannerPrincipals.has(context.principalId)
    ) {
      throw new ControlPlanePolicyError('Task creation requires an authorized planner');
    }
    if (task.status !== 'READY') throw new ControlPlanePolicyError('New tasks must start READY');
    this.#validateCurrentTaskPolicy(context, task);
    if (task.kind === 'runtime.health.check') {
      this.#require(
        this.#connections,
        context,
        task.input.connectionId as string,
        'Runtime connection',
      );
    }
    if (this.#tasks.has(key(task.workspaceId, task.id))) {
      throw new ControlPlanePolicyError('Duplicate task ID');
    }
    this.#tasks.set(key(task.workspaceId, task.id), structuredClone(task));
  }

  getTask(context: WorkspaceContext, taskId: EntityId): ControlPlaneTask | undefined {
    const task = this.#tasks.get(key(context.workspaceId, taskId));
    return task ? structuredClone(task) : undefined;
  }

  getRun(context: WorkspaceContext, runId: EntityId): AgentRun | undefined {
    const run = this.#runs.get(key(context.workspaceId, runId));
    return run ? structuredClone(run) : undefined;
  }

  transitionTask(context: WorkspaceContext, taskId: EntityId, next: TaskStatus): void {
    const task = this.#require(this.#tasks, context, taskId, 'Task');
    this.#assertTaskOperator(context, task);
    if (next === 'RUNNING' || next === 'COMPLETED') {
      throw new ControlPlanePolicyError(`${next} task state requires a valid run lifecycle`);
    }
    const activeRun = [...this.#runs.values()].some(
      (run) =>
        run.workspaceId === task.workspaceId &&
        run.taskId === task.id &&
        ['QUEUED', 'RUNNING', 'PAUSED'].includes(run.status),
    );
    if (activeRun) {
      throw new ControlPlanePolicyError('An active task may transition only through its run');
    }
    this.#transitionTaskRecord(task, next);
  }

  startRun(context: WorkspaceContext, run: AgentRun): void {
    assertWorkspace(context, run.workspaceId);
    if (run.status !== 'QUEUED') throw new ControlPlanePolicyError('New runs must start QUEUED');
    if (
      run.externalRunId !== undefined ||
      run.adapterRegistrationId !== undefined ||
      run.startedAt !== undefined ||
      run.completedAt !== undefined
    ) {
      throw new ControlPlanePolicyError(
        'New runs cannot pre-bind external ownership or lifecycle timestamps',
      );
    }
    const task = this.#require(this.#tasks, context, run.taskId, 'Task');
    const { agent, authority } = this.#validateCurrentTaskPolicy(context, task);
    const connection = this.#require(
      this.#connections,
      context,
      run.runtimeConnectionId,
      'Runtime connection',
    );
    if (
      !this.#authorityPrincipals.has(context.principalId) &&
      context.principalId !== connection.authenticatedPrincipalId
    ) {
      throw new ControlPlanePolicyError('Run start requires an authorizer or the bound runtime');
    }
    if (this.#runs.has(key(run.workspaceId, run.id))) {
      throw new ControlPlanePolicyError('Duplicate run ID');
    }
    if (
      task.status !== 'READY' ||
      task.assignedAgentId !== agent.id ||
      run.agentId !== agent.id ||
      connection.runtimeId !== agent.runtimeId
    ) {
      throw new ControlPlanePolicyError(
        'Run references do not match a ready task, agent, and runtime',
      );
    }
    this.#assertConnectionCanRunTask(context, connection, task);
    this.#assertRemainingTaskBudget(task);
    const taskAlreadyActive = [...this.#runs.values()].some(
      (candidate) =>
        candidate.workspaceId === run.workspaceId &&
        candidate.taskId === task.id &&
        ['QUEUED', 'RUNNING', 'PAUSED'].includes(candidate.status),
    );
    if (taskAlreadyActive) throw new ControlPlanePolicyError('Task already has an active run');
    const activeRuns = [...this.#runs.values()].filter(
      (candidate) =>
        candidate.workspaceId === run.workspaceId &&
        candidate.agentId === agent.id &&
        ['QUEUED', 'RUNNING', 'PAUSED'].includes(candidate.status),
    ).length;
    if (activeRuns >= Math.min(agent.maxConcurrentRuns, authority.maxConcurrentRuns)) {
      throw new ControlPlanePolicyError('Agent concurrency limit reached');
    }
    this.#runs.set(key(run.workspaceId, run.id), structuredClone(run));
  }

  mintDispatch(context: WorkspaceContext, runId: EntityId): RuntimeDispatchPermit {
    const run = this.#require(this.#runs, context, runId, 'Dispatch run');
    if (run.status !== 'QUEUED')
      throw new ControlPlanePolicyError('Only a queued run may dispatch');
    const runKey = key(run.workspaceId, run.id);
    if (this.#dispatchedRuns.has(runKey)) {
      throw new ControlPlanePolicyError('Run already has a policy-minted dispatch');
    }
    const connection = this.#require(
      this.#connections,
      context,
      run.runtimeConnectionId,
      'Dispatch connection',
    );
    this.#assertConnectionOperator(context, connection, 'Dispatch');
    const adapterRegistration = this.#runtimeAdapters.get(
      key(context.workspaceId, connection.runtimeId),
    );
    if (!adapterRegistration) {
      throw new ControlPlanePolicyError('Runtime adapter is not registered');
    }
    const task = this.#require(this.#tasks, context, run.taskId, 'Dispatch task');
    const requirements = this.#deriveTaskRequirements(task);
    const dispatch = {
      dispatchId: randomUUID(),
      connectionId: connection.id,
      adapterRegistrationId: adapterRegistration.registrationId,
      runtimePrincipalId: connection.authenticatedPrincipalId!,
      envelope: {
        runId: run.id,
        taskId: task.id,
        workspaceId: task.workspaceId,
        kind: task.kind,
        input: task.input,
        capabilityIds: task.requiredCapabilityIds,
        tools: requirements.tools.map((tool) => ({
          toolId: tool.id,
          scopes: [tool.scope],
        })),
        authorityLevel: task.requiredAuthorityLevel,
        costLimit: task.costLimit,
      },
    } as unknown as RuntimeDispatchPermit;
    this.#dispatches.set(key(task.workspaceId, dispatch.dispatchId), structuredClone(dispatch));
    this.#dispatchedRuns.add(runKey);
    return structuredClone(dispatch);
  }

  async executeDispatch(
    context: WorkspaceContext,
    dispatch: RuntimeDispatchPermit,
  ): Promise<{ externalRunId: string }> {
    const validated = this.#claimDispatch(context, dispatch);
    const run = this.#require(this.#runs, context, validated.envelope.runId, 'Dispatch run');
    const connection = this.#require(
      this.#connections,
      context,
      run.runtimeConnectionId,
      'Dispatch connection',
    );
    const runtime = this.#require(
      this.#runtimes,
      context,
      connection.runtimeId,
      'Dispatch runtime',
    );
    const adapterRegistration = this.#runtimeAdapters.get(key(context.workspaceId, runtime.id));
    if (
      !adapterRegistration ||
      adapterRegistration.registrationId !== validated.adapterRegistrationId
    ) {
      throw new ControlPlanePolicyError('Dispatch adapter registration is stale');
    }
    const result = await adapterRegistration.adapter.start(context, validated);
    assertString(result.externalRunId, 'externalRunId');
    this.#bindExternalRun(
      context,
      run.id,
      result.externalRunId,
      adapterRegistration.registrationId,
    );
    return { externalRunId: result.externalRunId };
  }

  #claimDispatch(
    context: WorkspaceContext,
    dispatch: RuntimeDispatchPermit,
  ): ValidatedRuntimeDispatch {
    const dispatchKey = key(context.workspaceId, dispatch.dispatchId);
    const stored = this.#dispatches.get(dispatchKey);
    if (
      !stored ||
      context.principalId !== stored.runtimePrincipalId ||
      JSON.stringify(stored) !== JSON.stringify(dispatch)
    ) {
      throw new ControlPlanePolicyError('Dispatch is not a policy-minted runtime envelope');
    }
    const runKey = key(context.workspaceId, stored.envelope.runId);
    try {
      const run = this.#require(this.#runs, context, stored.envelope.runId, 'Dispatch run');
      const task = this.#require(this.#tasks, context, stored.envelope.taskId, 'Dispatch task');
      const connection = this.#require(
        this.#connections,
        context,
        stored.connectionId,
        'Dispatch connection',
      );
      if (
        run.status !== 'QUEUED' ||
        task.status !== 'READY' ||
        run.taskId !== task.id ||
        run.runtimeConnectionId !== connection.id ||
        stored.adapterRegistrationId !==
          this.#runtimeAdapters.get(key(context.workspaceId, connection.runtimeId))
            ?.registrationId ||
        stored.runtimePrincipalId !== connection.authenticatedPrincipalId ||
        context.principalId !== connection.authenticatedPrincipalId
      ) {
        throw new ControlPlanePolicyError('Dispatch permit is stale or no longer owned');
      }
      const expectedEnvelope = {
        runId: run.id,
        taskId: task.id,
        workspaceId: task.workspaceId,
        kind: task.kind,
        input: task.input,
        capabilityIds: task.requiredCapabilityIds,
        tools: this.#deriveTaskRequirements(task).tools.map((tool) => ({
          toolId: tool.id,
          scopes: [tool.scope],
        })),
        authorityLevel: task.requiredAuthorityLevel,
        costLimit: task.costLimit,
      };
      if (JSON.stringify(stored.envelope) !== JSON.stringify(expectedEnvelope)) {
        throw new ControlPlanePolicyError('Dispatch permit no longer matches current task policy');
      }
      const { agent, authority } = this.#validateCurrentTaskPolicy(context, task);
      if (run.agentId !== agent.id || connection.runtimeId !== agent.runtimeId) {
        throw new ControlPlanePolicyError('Dispatch no longer matches its agent and runtime');
      }
      this.#assertConnectionCanRunTask(context, connection, task);
      this.#assertRemainingTaskBudget(task);
      const activeRuns = [...this.#runs.values()].filter(
        (candidate) =>
          candidate.workspaceId === run.workspaceId &&
          candidate.agentId === agent.id &&
          ['QUEUED', 'RUNNING', 'PAUSED'].includes(candidate.status),
      ).length;
      if (activeRuns > Math.min(agent.maxConcurrentRuns, authority.maxConcurrentRuns)) {
        throw new ControlPlanePolicyError('Dispatch exceeds the current concurrency budget');
      }
    } catch (error) {
      this.#dispatches.delete(dispatchKey);
      this.#dispatchedRuns.delete(runKey);
      throw error;
    }
    this.#dispatches.delete(dispatchKey);
    this.#claimedDispatchRuns.add(runKey);
    return deepFreeze(structuredClone(stored)) as unknown as ValidatedRuntimeDispatch;
  }

  #bindExternalRun(
    context: WorkspaceContext,
    runId: EntityId,
    externalRunId: string,
    adapterRegistrationId: EntityId,
  ): void {
    assertString(externalRunId, 'externalRunId');
    const run = this.#require(this.#runs, context, runId, 'External run');
    const connection = this.#require(
      this.#connections,
      context,
      run.runtimeConnectionId,
      'External run connection',
    );
    if (context.principalId !== connection.authenticatedPrincipalId) {
      throw new ControlPlanePolicyError(
        'External run binding requires the authenticated runtime principal',
      );
    }
    if (!this.#claimedDispatchRuns.has(key(run.workspaceId, run.id))) {
      throw new ControlPlanePolicyError('External run binding requires a claimed dispatch');
    }
    const currentAdapter = this.#runtimeAdapters.get(
      key(context.workspaceId, connection.runtimeId),
    );
    if (!currentAdapter || currentAdapter.registrationId !== adapterRegistrationId) {
      throw new ControlPlanePolicyError('External run adapter registration is stale');
    }
    if (!['QUEUED', 'RUNNING', 'PAUSED'].includes(run.status)) {
      throw new ControlPlanePolicyError('Only an active run may bind an external run');
    }
    if (run.externalRunId && run.externalRunId !== externalRunId) {
      throw new ControlPlanePolicyError('External run is already bound');
    }
    const externalRunAlreadyBound = [...this.#runs.values()].some(
      (candidate) =>
        candidate.workspaceId === run.workspaceId &&
        candidate.id !== run.id &&
        candidate.runtimeConnectionId === connection.id &&
        candidate.externalRunId === externalRunId,
    );
    if (externalRunAlreadyBound) {
      throw new ControlPlanePolicyError('External run is already bound to another run');
    }
    this.#runs.set(key(run.workspaceId, run.id), {
      ...run,
      externalRunId,
      adapterRegistrationId,
    });
  }

  mintCancellation(context: WorkspaceContext, runId: EntityId): RuntimeCancellationPermit {
    const run = this.#require(this.#runs, context, runId, 'Cancellation run');
    if (
      !['QUEUED', 'RUNNING', 'PAUSED'].includes(run.status) ||
      !run.externalRunId ||
      !run.adapterRegistrationId
    ) {
      throw new ControlPlanePolicyError('Cancellation requires an active bound external run');
    }
    const runKey = key(run.workspaceId, run.id);
    if (this.#cancelledRuns.has(runKey)) {
      throw new ControlPlanePolicyError('Run already has a policy-minted cancellation');
    }
    const connection = this.#require(
      this.#connections,
      context,
      run.runtimeConnectionId,
      'Cancellation connection',
    );
    this.#assertConnectionOperator(context, connection, 'Cancellation');
    const adapterRegistration = this.#runtimeAdapters.get(
      key(context.workspaceId, connection.runtimeId),
    );
    if (!adapterRegistration) {
      throw new ControlPlanePolicyError('Runtime adapter is not registered');
    }
    if (adapterRegistration.registrationId !== run.adapterRegistrationId) {
      throw new ControlPlanePolicyError('Originating runtime adapter is no longer registered');
    }
    const cancellation = {
      cancellationId: randomUUID(),
      connectionId: connection.id,
      adapterRegistrationId: run.adapterRegistrationId,
      runtimePrincipalId: connection.authenticatedPrincipalId!,
      runId: run.id,
      externalRunId: run.externalRunId,
    } as RuntimeCancellationPermit;
    this.#cancellations.set(
      key(run.workspaceId, cancellation.cancellationId),
      structuredClone(cancellation),
    );
    this.#cancelledRuns.add(runKey);
    return structuredClone(cancellation);
  }

  async executeCancellation(
    context: WorkspaceContext,
    cancellation: RuntimeCancellationPermit,
  ): Promise<void> {
    const validated = this.#claimCancellation(context, cancellation);
    const run = this.#require(this.#runs, context, validated.runId, 'Cancellation run');
    const connection = this.#require(
      this.#connections,
      context,
      run.runtimeConnectionId,
      'Cancellation connection',
    );
    const runtime = this.#require(
      this.#runtimes,
      context,
      connection.runtimeId,
      'Cancellation runtime',
    );
    const adapterRegistration = this.#runtimeAdapters.get(key(context.workspaceId, runtime.id));
    if (
      !adapterRegistration ||
      adapterRegistration.registrationId !== validated.adapterRegistrationId
    ) {
      throw new ControlPlanePolicyError('Cancellation adapter registration is stale');
    }
    await adapterRegistration.adapter.cancel(context, validated);
  }

  #claimCancellation(
    context: WorkspaceContext,
    cancellation: RuntimeCancellationPermit,
  ): ValidatedRuntimeCancellation {
    const cancellationKey = key(context.workspaceId, cancellation.cancellationId);
    const stored = this.#cancellations.get(cancellationKey);
    if (
      !stored ||
      context.principalId !== stored.runtimePrincipalId ||
      JSON.stringify(stored) !== JSON.stringify(cancellation)
    ) {
      throw new ControlPlanePolicyError('Cancellation is not bound to this runtime and run');
    }
    const runKey = key(context.workspaceId, stored.runId);
    try {
      const run = this.#require(this.#runs, context, stored.runId, 'Cancellation run');
      const connection = this.#require(
        this.#connections,
        context,
        stored.connectionId,
        'Cancellation connection',
      );
      if (
        !['QUEUED', 'RUNNING', 'PAUSED'].includes(run.status) ||
        run.runtimeConnectionId !== connection.id ||
        !run.externalRunId ||
        run.adapterRegistrationId !== stored.adapterRegistrationId ||
        run.externalRunId !== stored.externalRunId ||
        stored.adapterRegistrationId !==
          this.#runtimeAdapters.get(key(context.workspaceId, connection.runtimeId))
            ?.registrationId ||
        stored.runtimePrincipalId !== connection.authenticatedPrincipalId ||
        context.principalId !== connection.authenticatedPrincipalId
      ) {
        throw new ControlPlanePolicyError('Cancellation permit is stale or no longer owned');
      }
    } catch (error) {
      this.#cancellations.delete(cancellationKey);
      this.#cancelledRuns.delete(runKey);
      throw error;
    }
    this.#cancellations.delete(cancellationKey);
    return deepFreeze(structuredClone(stored)) as unknown as ValidatedRuntimeCancellation;
  }

  transitionRun(context: WorkspaceContext, runId: EntityId, next: RunStatus): void {
    const run = this.#require(this.#runs, context, runId, 'Run');
    const connection = this.#require(
      this.#connections,
      context,
      run.runtimeConnectionId,
      'Runtime connection',
    );
    if (
      !this.#authorityPrincipals.has(context.principalId) &&
      context.principalId !== connection.authenticatedPrincipalId
    ) {
      throw new ControlPlanePolicyError(
        'Run transition requires an authorizer or the bound runtime',
      );
    }
    if (!RUN_TRANSITIONS[run.status].includes(next)) {
      throw new ControlPlanePolicyError(`Illegal run transition ${run.status} -> ${next}`);
    }
    if (
      run.status === 'QUEUED' &&
      next === 'RUNNING' &&
      (!this.#claimedDispatchRuns.has(key(run.workspaceId, run.id)) || !run.externalRunId)
    ) {
      throw new ControlPlanePolicyError(
        'A queued run requires a claimed dispatch and bound external run before starting',
      );
    }
    const task = this.#require(this.#tasks, context, run.taskId, 'Run task');
    let taskNext: TaskStatus | undefined;
    if (run.status === 'QUEUED' && next === 'RUNNING') taskNext = 'RUNNING';
    if (next === 'COMPLETED') taskNext = 'COMPLETED';
    if (next === 'FAILED') taskNext = 'FAILED';
    if (next === 'CANCELLED') taskNext = 'CANCELLED';
    if (taskNext && !TASK_TRANSITIONS[task.status].includes(taskNext)) {
      throw new ControlPlanePolicyError(`Illegal task transition ${task.status} -> ${taskNext}`);
    }
    const now = new Date(this.#clock()).toISOString();
    const updated: AgentRun = {
      ...run,
      status: next,
      startedAt: next === 'RUNNING' && !run.startedAt ? now : run.startedAt,
      completedAt: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(next) ? now : run.completedAt,
    };
    this.#runs.set(key(run.workspaceId, run.id), updated);
    if (taskNext) this.#tasks.set(key(task.workspaceId, task.id), { ...task, status: taskNext });
  }

  appendEvent(context: WorkspaceContext, event: ControlPlaneEvent): void {
    assertWorkspace(context, event.workspaceId);
    if (context.principalId !== event.actorId) {
      throw new ControlPlanePolicyError('Event actor must match the authenticated principal');
    }
    assertBoundedRecord(event.payload);
    const eventIdKey = key(event.workspaceId, event.id);
    const idempotencyKey = key(event.workspaceId, event.idempotencyKey);
    if (this.#eventsById.has(eventIdKey))
      throw new DuplicateEventError('Duplicate workspace event ID');
    if (this.#eventIdempotency.has(idempotencyKey)) {
      throw new DuplicateEventError('Duplicate workspace event idempotency key');
    }
    if (event.runId) {
      const run = this.#require(this.#runs, context, event.runId, 'Run');
      const connection = this.#require(
        this.#connections,
        context,
        run.runtimeConnectionId,
        'Event runtime connection',
      );
      if (event.actorId !== connection.authenticatedPrincipalId) {
        throw new ControlPlanePolicyError('Run event actor does not own the runtime connection');
      }
    }
    this.#eventsById.set(eventIdKey, structuredClone(event));
    this.#eventIdempotency.set(idempotencyKey, event.id);
  }

  recordUsage(context: WorkspaceContext, usage: UsageRecord): void {
    assertWorkspace(context, usage.workspaceId);
    const usageKey = key(usage.workspaceId, usage.id);
    if (this.#usage.has(usageKey))
      throw new DuplicateEventError('Duplicate workspace usage record');
    const task = this.#require(this.#tasks, context, usage.taskId, 'Usage task');
    const run = this.#require(this.#runs, context, usage.runId, 'Usage run');
    const connection = this.#require(
      this.#connections,
      context,
      run.runtimeConnectionId,
      'Runtime connection',
    );
    if (
      !this.#authorityPrincipals.has(context.principalId) &&
      context.principalId !== connection.authenticatedPrincipalId
    ) {
      throw new ControlPlanePolicyError('Usage requires an authorizer or the bound runtime');
    }
    if (run.taskId !== task.id)
      throw new ControlPlanePolicyError('Usage run does not belong to task');
    if (usage.costMinorUnits !== undefined)
      assertNonNegativeInteger(usage.costMinorUnits, 'Usage cost');
    if (usage.computeUnits !== undefined)
      assertNonNegativeInteger(usage.computeUnits, 'Compute usage');
    if (usage.costMinorUnits !== undefined && usage.currency !== task.costLimit.currency) {
      throw new ControlPlanePolicyError('Usage currency must match the task cost limit currency');
    }
    const prior = [...this.#usage.values()].filter(
      (record) => record.workspaceId === usage.workspaceId && record.taskId === usage.taskId,
    );
    const accumulatedCost = prior.reduce((sum, record) => sum + (record.costMinorUnits ?? 0), 0);
    const accumulatedCompute = prior.reduce((sum, record) => sum + (record.computeUnits ?? 0), 0);
    if (
      usage.costMinorUnits !== undefined &&
      accumulatedCost + usage.costMinorUnits > task.costLimit.maximumMinorUnits
    ) {
      throw new CostLimitExceededError('Usage would exceed the task cost limit');
    }
    if (
      usage.computeUnits !== undefined &&
      task.costLimit.maximumComputeUnits !== undefined &&
      accumulatedCompute + usage.computeUnits > task.costLimit.maximumComputeUnits
    ) {
      throw new CostLimitExceededError('Usage would exceed the task compute limit');
    }
    this.#usage.set(usageKey, structuredClone(usage));
  }

  #assertAuthorizer(context: WorkspaceContext): void {
    if (!this.#authorityPrincipals.has(context.principalId)) {
      throw new ControlPlanePolicyError('Principal is not authorized to issue grants');
    }
  }

  #assertTaskOperator(context: WorkspaceContext, task: ControlPlaneTask): void {
    if (this.#authorityPrincipals.has(context.principalId)) return;
    const agent = this.#require(this.#agents, context, task.assignedAgentId, 'Task agent');
    const boundRuntime = [...this.#connections.values()].some(
      (connection) =>
        connection.workspaceId === task.workspaceId &&
        connection.runtimeId === agent.runtimeId &&
        connection.authenticatedPrincipalId === context.principalId &&
        this.deriveConnectionStatus(context, connection.id) === 'CONNECTED',
    );
    if (!boundRuntime) {
      throw new ControlPlanePolicyError('Task transition requires an authorizer or bound runtime');
    }
  }

  #assertConnectionOperator(
    context: WorkspaceContext,
    connection: RuntimeConnection,
    action: string,
  ): void {
    if (
      !this.#authorityPrincipals.has(context.principalId) &&
      context.principalId !== connection.authenticatedPrincipalId
    ) {
      throw new ControlPlanePolicyError(
        `${action} requires an authorizer or the bound runtime principal`,
      );
    }
  }

  #transitionTaskRecord(task: ControlPlaneTask, next: TaskStatus): void {
    if (!TASK_TRANSITIONS[task.status].includes(next)) {
      throw new ControlPlanePolicyError(`Illegal task transition ${task.status} -> ${next}`);
    }
    this.#tasks.set(key(task.workspaceId, task.id), { ...task, status: next });
  }

  #assertCostLimit(limit: ControlPlaneTask['costLimit']): void {
    assertString(limit.currency, 'currency');
    assertNonNegativeInteger(limit.maximumMinorUnits, 'maximumMinorUnits');
    assertNonNegativeInteger(limit.maximumComputeUnits, 'maximumComputeUnits');
  }

  #validateCurrentTaskPolicy(
    context: WorkspaceContext,
    task: ControlPlaneTask,
  ): { agent: Agent; authority: AuthorityGrant } {
    assertTaskInput(task);
    this.#assertCostLimit(task.costLimit);
    const agent = this.#require(this.#agents, context, task.assignedAgentId, 'Agent');
    const requirements = this.#deriveTaskRequirements(task);
    if (
      !sameIds(task.requiredCapabilityIds, requirements.capabilityIds) ||
      !sameIds(
        task.requiredToolIds,
        requirements.tools.map((tool) => tool.id),
      ) ||
      task.requiredAuthorityLevel !== requirements.authorityLevel
    ) {
      throw new ControlPlanePolicyError(
        'Task capability, tool, and authority requirements must exactly match task-kind policy',
      );
    }
    if (task.requiredAuthorityLevel > agent.authorityLevel) {
      throw new ControlPlanePolicyError('Task exceeds the agent authority ceiling');
    }
    for (const capabilityId of requirements.capabilityIds) {
      this.#require(this.#capabilities, context, capabilityId, 'Capability');
      const granted = [...this.#agentCapabilities.values()].some(
        (grant) =>
          grant.workspaceId === task.workspaceId &&
          grant.agentId === agent.id &&
          grant.capabilityId === capabilityId,
      );
      if (!granted) throw new ControlPlanePolicyError(`Agent lacks capability ${capabilityId}`);
    }
    for (const requiredTool of requirements.tools) {
      const granted = [...this.#toolGrants.values()].some(
        (grant) =>
          grant.workspaceId === task.workspaceId &&
          grant.agentId === agent.id &&
          grant.toolId === requiredTool.id &&
          grant.scopes.includes(requiredTool.scope) &&
          !isExpired(grant.expiresAt, this.#clock()),
      );
      if (!granted) {
        throw new ControlPlanePolicyError(
          `Agent lacks ${requiredTool.scope} scope for ${requiredTool.id}`,
        );
      }
    }
    return { agent, authority: this.#requireApplicableAuthorityGrant(task) };
  }

  #assertConnectionCanRunTask(
    context: WorkspaceContext,
    connection: RuntimeConnection,
    task: ControlPlaneTask,
  ): void {
    const connectionStatus = this.deriveConnectionStatus(context, connection.id);
    const bootstrapRoundTrip =
      task.kind === 'runtime.health.check' &&
      connectionStatus === 'PARTIAL' &&
      Boolean(
        connection.registrationProof &&
        connection.capabilityExchangeProof &&
        connection.heartbeatProof,
      );
    if (connectionStatus !== 'CONNECTED' && !bootstrapRoundTrip) {
      throw new ControlPlanePolicyError(
        'Run requires a connected runtime or a bounded health-check bootstrap',
      );
    }
    const exchangedCapabilities = connection.capabilityExchangeProof?.capabilityIds ?? [];
    for (const capabilityId of task.requiredCapabilityIds) {
      if (!exchangedCapabilities.includes(capabilityId)) {
        throw new ControlPlanePolicyError(
          `Runtime did not exchange required capability ${capabilityId}`,
        );
      }
    }
  }

  #assertRemainingTaskBudget(task: ControlPlaneTask): void {
    const usage = [...this.#usage.values()].filter(
      (record) => record.workspaceId === task.workspaceId && record.taskId === task.id,
    );
    const cost = usage.reduce((sum, record) => sum + (record.costMinorUnits ?? 0), 0);
    const compute = usage.reduce((sum, record) => sum + (record.computeUnits ?? 0), 0);
    if (cost >= task.costLimit.maximumMinorUnits || compute >= task.costLimit.maximumComputeUnits) {
      throw new CostLimitExceededError('Task budget is exhausted');
    }
  }

  #deriveTaskRequirements(task: ControlPlaneTask): {
    capabilityIds: readonly EntityId[];
    tools: readonly { id: EntityId; scope: string }[];
    authorityLevel: ControlPlaneTask['requiredAuthorityLevel'];
  } {
    const policy = TASK_POLICIES[task.kind];
    if (!policy) throw new ControlPlanePolicyError(`Unsupported task kind: ${String(task.kind)}`);
    const findUnique = <T extends { id: EntityId; name: string; workspaceId: EntityId }>(
      records: Iterable<T>,
      name: string,
      label: string,
    ): T => {
      const matches = [...records].filter(
        (record) => record.workspaceId === task.workspaceId && record.name === name,
      );
      if (matches.length !== 1) {
        throw new ControlPlanePolicyError(
          `${label} ${name} must resolve uniquely in the workspace`,
        );
      }
      return matches[0]!;
    };
    return {
      capabilityIds: policy.capabilityNames.map(
        (name) => findUnique(this.#capabilities.values(), name, 'Capability').id,
      ),
      tools: policy.tools.map((requirement) => ({
        id: findUnique(this.#tools.values(), requirement.name, 'Tool').id,
        scope: requirement.scope,
      })),
      authorityLevel: policy.authorityLevel,
    };
  }

  #requireApplicableAuthorityGrant(task: ControlPlaneTask): AuthorityGrant {
    const candidates = [...this.#authorityGrants.values()].filter(
      (grant) =>
        grant.workspaceId === task.workspaceId &&
        grant.agentId === task.assignedAgentId &&
        grant.level >= task.requiredAuthorityLevel &&
        grant.actionClasses.includes(task.kind) &&
        !isExpired(grant.expiresAt, this.#clock()) &&
        grant.costLimit.currency === task.costLimit.currency &&
        grant.costLimit.maximumMinorUnits >= task.costLimit.maximumMinorUnits &&
        grant.costLimit.maximumComputeUnits >= task.costLimit.maximumComputeUnits,
    );
    const grant = candidates.sort((left, right) => left.level - right.level)[0];
    if (!grant) throw new ControlPlanePolicyError('No stored authority grant permits this task');
    return grant;
  }

  #validateConnectionProofs(context: WorkspaceContext, connection: RuntimeConnection): void {
    const principal = connection.authenticatedPrincipalId;
    if ((connection.credentialReference || connection.registrationProof) && !principal) {
      throw new ControlPlanePolicyError('Runtime evidence requires an authenticated principal');
    }
    const correlated = (proof: { connectionId: string; principalId: string }): boolean =>
      proof.connectionId === connection.id && proof.principalId === principal;
    if (
      connection.registrationProof &&
      (!correlated(connection.registrationProof) ||
        connection.registrationProof.runtimeId !== connection.runtimeId)
    ) {
      throw new ControlPlanePolicyError(
        'Registration proof is not correlated to the runtime connection',
      );
    }
    if (connection.registrationProof) {
      parsedTime(connection.registrationProof.observedAt, 'registrationProof.observedAt');
    }
    if (
      connection.capabilityExchangeProof &&
      (!correlated(connection.capabilityExchangeProof) ||
        connection.capabilityExchangeProof.runtimeId !== connection.runtimeId)
    ) {
      throw new ControlPlanePolicyError(
        'Capability proof is not correlated to the runtime connection',
      );
    }
    if (connection.capabilityExchangeProof) {
      parsedTime(
        connection.capabilityExchangeProof.observedAt,
        'capabilityExchangeProof.observedAt',
      );
    }
    for (const capabilityId of connection.capabilityExchangeProof?.capabilityIds ?? []) {
      this.#require(this.#capabilities, context, capabilityId, 'Runtime capability');
    }
    if (connection.heartbeatProof) {
      if (!correlated(connection.heartbeatProof)) {
        throw new ControlPlanePolicyError(
          'Heartbeat proof is not correlated to the runtime connection',
        );
      }
      const heartbeat = this.#require(
        this.#heartbeats,
        context,
        connection.heartbeatProof.heartbeatId,
        'Heartbeat proof',
      );
      if (
        heartbeat.runtimeConnectionId !== connection.id ||
        heartbeat.principalId !== principal ||
        heartbeat.observedAt !== connection.heartbeatProof.observedAt
      ) {
        throw new ControlPlanePolicyError('Heartbeat proof does not match the stored heartbeat');
      }
    }
    if (connection.taskRoundTripProof && !correlated(connection.taskRoundTripProof)) {
      throw new ControlPlanePolicyError('Task proof is not correlated to the runtime connection');
    }
    if (connection.taskRoundTripProof) {
      parsedTime(connection.taskRoundTripProof.completedAt, 'taskRoundTripProof.completedAt');
      const task = this.#require(
        this.#tasks,
        context,
        connection.taskRoundTripProof.taskId,
        'Task proof task',
      );
      const run = this.#require(
        this.#runs,
        context,
        connection.taskRoundTripProof.runId,
        'Task proof run',
      );
      const agent = this.#require(this.#agents, context, run.agentId, 'Task proof agent');
      const event = this.#require(
        this.#eventsById,
        context,
        connection.taskRoundTripProof.resultEventId,
        'Task proof result event',
      );
      if (
        run.taskId !== task.id ||
        run.runtimeConnectionId !== connection.id ||
        task.assignedAgentId !== agent.id ||
        agent.runtimeId !== connection.runtimeId ||
        event.runId !== run.id ||
        event.actorId !== principal ||
        event.type !== 'run.completed'
      ) {
        throw new ControlPlanePolicyError('Task proof references are not a correlated result');
      }
    }
  }

  #require<T extends { workspaceId: EntityId }>(
    records: ReadonlyMap<string, T>,
    context: WorkspaceContext,
    id: EntityId,
    label: string,
  ): T {
    const record = records.get(key(context.workspaceId, id));
    if (!record)
      throw new ControlPlanePolicyError(`${label} not found in the authenticated workspace`);
    return record;
  }
}
