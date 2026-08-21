import { randomUUID } from 'node:crypto';
import type {
  AgentFactoryDecision,
  AgentInstantiationRequest,
  DynamicAgentFactory,
} from './agent-factory';
import type { AuthorityLevel, CostLimit, EntityId, TaskKind, WorkspaceContext } from './contracts';
import type {
  RuntimeBroker,
  RuntimeRoutingDecision,
  RuntimeRoutingRequest,
} from './runtime-broker';

export type CooTaskStatus =
  'BLOCKED' | 'READY' | 'ASSIGNED' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'STOPPED';

export interface CooObjective {
  id: EntityId;
  workspaceId: EntityId;
  title: string;
  desiredOutcome: string;
  maximumAuthority: AuthorityLevel;
  costLimit: CostLimit;
  acceptanceCriteria: readonly string[];
  verificationCriteria: readonly string[];
  stopConditions: readonly string[];
}

export interface CooProject {
  id: EntityId;
  workspaceId: EntityId;
  objectiveId: EntityId;
  title: string;
}

export interface CooRetryPolicy {
  maximumAttempts: number;
  retryableFailureCodes: readonly string[];
  stopAfterFailureCodes: readonly string[];
}

export interface CooAgentPolicy {
  templateId: EntityId;
  templateVersion: number;
  parentAgentId?: EntityId;
  repositoryScopes: readonly string[];
  environmentScopes: readonly string[];
  dataScopes: readonly string[];
  capabilityIds: readonly EntityId[];
  toolGrants: readonly { toolId: EntityId; scopes: readonly string[] }[];
  maxRuntimeMs: number;
  childLimit: number;
  retention: AgentInstantiationRequest['retention'];
}

export type CooRoutingPolicy = Omit<
  RuntimeRoutingRequest,
  'id' | 'workspaceId' | 'maximumCostMinorUnits' | 'requiredComputeUnits'
>;

export interface CooTask {
  id: EntityId;
  workspaceId: EntityId;
  objectiveId: EntityId;
  projectId: EntityId;
  title: string;
  kind: TaskKind;
  dependencyIds: readonly EntityId[];
  requiredAuthority: AuthorityLevel;
  costLimit: CostLimit;
  estimatedDurationMs: number;
  acceptanceCriteria: readonly string[];
  verificationCriteria: readonly string[];
  stopConditions: readonly string[];
  retryPolicy: CooRetryPolicy;
  agentPolicy: CooAgentPolicy;
  routingPolicy: CooRoutingPolicy;
  exactTarget?: string;
}

export interface ObjectivePlan {
  objective: CooObjective;
  projects: readonly CooProject[];
  tasks: readonly CooTask[];
}

export interface VerificationEvidence {
  criterion: string;
  runId: EntityId;
  artifactId: EntityId;
  contentHash: string;
}

export interface ArtifactEvidenceVerifier {
  verify(
    context: WorkspaceContext,
    evidence: { runId: EntityId; artifactId: EntityId; contentHash: string },
  ): boolean;
}

export interface FounderDecisionCard {
  id: EntityId;
  workspaceId: EntityId;
  objectiveId: EntityId;
  taskId: EntityId;
  requestedAction: string;
  requesterId: EntityId;
  exactTarget: string;
  reason: string;
  businessImpact: string;
  securityImpact: string;
  privacyImpact: string;
  financialImpact: string;
  alternatives: readonly string[];
  recommendedAction: string;
  rollback: string;
  expiresAt: string;
  status: 'PENDING';
}

export interface CooEvent {
  id: EntityId;
  workspaceId: EntityId;
  objectiveId: EntityId;
  projectId?: EntityId;
  taskId?: EntityId;
  type:
    | 'objective.created'
    | 'project.created'
    | 'task.created'
    | 'task.ready'
    | 'task.blocked'
    | 'task.assigned'
    | 'task.retry.ready'
    | 'task.failed'
    | 'task.stopped'
    | 'task.completed'
    | 'approval.requested'
    | 'usage.recorded';
  occurredAt: string;
  actorId: EntityId;
  facts: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

export interface CriticalPathReport {
  objectiveId: EntityId;
  taskIds: readonly EntityId[];
  totalDurationMs: number;
  blockedTaskIds: readonly EntityId[];
}

export interface CooTaskState extends CooTask {
  status: CooTaskStatus;
  attempts: number;
  costUsedMinorUnits: number;
  computeUsed: number;
  assignedAgentId?: EntityId;
  selectedRuntimeId?: EntityId;
  selectedConnectionId?: EntityId;
  runId?: EntityId;
}

export interface AssignmentRequest {
  taskId: EntityId;
  factoryRequest: AgentInstantiationRequest;
  routingRequest: RuntimeRoutingRequest;
}

export interface AssignmentDecision {
  taskId: EntityId;
  agentId: EntityId;
  runtime: RuntimeRoutingDecision;
  factoryDecision: AgentFactoryDecision;
  runId: EntityId;
}

export interface AiCooOptions {
  plannerPrincipals: readonly EntityId[];
  maximumObjectiveCostMinorUnits: number;
  maximumObjectiveComputeUnits: number;
  maximumTasksPerObjective: number;
  maximumProjectsPerObjective: number;
  maximumTaskDurationMs: number;
  maximumRetriesPerTask: number;
  clock?: () => number;
  idFactory?: () => string;
}

type BrokerPort = Pick<RuntimeBroker, 'route'>;
type FactoryPort = Pick<DynamicAgentFactory, 'registerPlan' | 'instantiate'>;

export class AiCooPolicyError extends Error {}

const recordKey = (workspaceId: string, id: string): string => JSON.stringify([workspaceId, id]);
const TERMINAL = new Set<CooTaskStatus>(['COMPLETED', 'FAILED', 'STOPPED']);
const TASK_KIND_MINIMUMS: Readonly<
  Record<
    TaskKind,
    { capabilityId: string; toolId: string; scope: string; authority: AuthorityLevel }
  >
> = {
  'repository.review': {
    capabilityId: 'repository.review',
    toolId: 'git.readonly',
    scope: 'read',
    authority: 1,
  },
  'quality.verify': {
    capabilityId: 'quality.verify',
    toolId: 'quality.runner',
    scope: 'verify',
    authority: 3,
  },
  'documentation.prepare': {
    capabilityId: 'documentation.prepare',
    toolId: 'documents.workspace',
    scope: 'write',
    authority: 2,
  },
  'runtime.health.check': {
    capabilityId: 'runtime.health',
    toolId: 'runtime.health',
    scope: 'read',
    authority: 1,
  },
};
const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
const comparePath = (left: readonly string[], right: readonly string[]): number => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const compared = compareText(left[index]!, right[index]!);
    if (compared !== 0) return compared;
  }
  return left.length - right.length;
};

function boundedText(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > 2_048 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new AiCooPolicyError(`${field} must be a bounded printable string`);
  }
}

function boundedDenseStrings(
  values: unknown,
  field: string,
  maximum = 64,
): asserts values is string[] {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > maximum ||
    Object.keys(values).length !== values.length
  ) {
    throw new AiCooPolicyError(`${field} must be a non-empty dense bounded array`);
  }
  for (const value of values) boundedText(value, field);
  if (new Set(values).size !== values.length)
    throw new AiCooPolicyError(`${field} must not contain duplicates`);
}

function denseStrings(values: unknown, field: string, maximum = 64): asserts values is string[] {
  if (
    !Array.isArray(values) ||
    values.length > maximum ||
    Object.keys(values).length !== values.length
  )
    throw new AiCooPolicyError(`${field} must be a dense bounded array`);
  for (const value of values) boundedText(value, field);
  if (new Set(values).size !== values.length)
    throw new AiCooPolicyError(`${field} must not contain duplicates`);
}

function integer(value: unknown, field: string, maximum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new AiCooPolicyError(`${field} is outside policy bounds`);
  }
}

function validateCost(limit: CostLimit, field: string): void {
  if (!limit || typeof limit !== 'object') throw new AiCooPolicyError(`${field} is required`);
  exactKeys(limit, ['currency', 'maximumComputeUnits', 'maximumMinorUnits'], field);
  boundedText(limit.currency, `${field}.currency`);
  integer(limit.maximumMinorUnits, `${field}.maximumMinorUnits`, Number.MAX_SAFE_INTEGER);
  integer(limit.maximumComputeUnits, `${field}.maximumComputeUnits`, Number.MAX_SAFE_INTEGER);
}

function exactKeys(value: unknown, expected: readonly string[], field: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiCooPolicyError(`${field} must be an object`);
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index]))
    throw new AiCooPolicyError(`${field} contains unsupported fields`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function equalData(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, normalize(item)]),
      );
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export class GovernedAiCoo {
  readonly #planners: Set<EntityId>;
  readonly #options: Omit<AiCooOptions, 'plannerPrincipals' | 'clock' | 'idFactory'>;
  readonly #clock: () => number;
  readonly #idFactory: () => string;
  readonly #broker: BrokerPort;
  readonly #factory: FactoryPort;
  readonly #evidenceVerifier: ArtifactEvidenceVerifier;
  readonly #objectives = new Map<string, CooObjective>();
  readonly #projects = new Map<string, CooProject>();
  readonly #tasks = new Map<string, CooTaskState>();
  readonly #events: CooEvent[] = [];
  readonly #eventIds = new Set<EntityId>();
  readonly #approvals = new Map<string, FounderDecisionCard>();
  readonly #consumedAssignmentRequests = new Set<string>();
  readonly #entityIds = new Set<string>();

  constructor(
    options: AiCooOptions,
    dependencies: {
      broker: BrokerPort;
      factory: FactoryPort;
      evidenceVerifier: ArtifactEvidenceVerifier;
    },
  ) {
    this.#planners = new Set(options.plannerPrincipals);
    this.#clock = options.clock ?? Date.now;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#broker = dependencies.broker;
    this.#factory = dependencies.factory;
    this.#evidenceVerifier = dependencies.evidenceVerifier;
    this.#options = {
      maximumObjectiveCostMinorUnits: options.maximumObjectiveCostMinorUnits,
      maximumObjectiveComputeUnits: options.maximumObjectiveComputeUnits,
      maximumTasksPerObjective: options.maximumTasksPerObjective,
      maximumProjectsPerObjective: options.maximumProjectsPerObjective,
      maximumTaskDurationMs: options.maximumTaskDurationMs,
      maximumRetriesPerTask: options.maximumRetriesPerTask,
    };
    integer(
      this.#options.maximumObjectiveCostMinorUnits,
      'maximumObjectiveCostMinorUnits',
      Number.MAX_SAFE_INTEGER,
    );
    integer(
      this.#options.maximumObjectiveComputeUnits,
      'maximumObjectiveComputeUnits',
      Number.MAX_SAFE_INTEGER,
    );
    integer(this.#options.maximumTasksPerObjective, 'maximumTasksPerObjective', 1_000);
    integer(this.#options.maximumProjectsPerObjective, 'maximumProjectsPerObjective', 100);
    integer(
      this.#options.maximumTaskDurationMs,
      'maximumTaskDurationMs',
      365 * 24 * 60 * 60 * 1_000,
    );
    integer(this.#options.maximumRetriesPerTask, 'maximumRetriesPerTask', 100);
  }

  createPlan(context: WorkspaceContext, untrustedPlan: ObjectivePlan): CriticalPathReport {
    this.#assertPlanner(context);
    const plan = this.#validatePlan(context, untrustedPlan);
    const objectiveKey = recordKey(context.workspaceId, plan.objective.id);
    if (this.#objectives.has(objectiveKey)) throw new AiCooPolicyError('Objective already exists');
    const planEntityIds = [
      plan.objective.id,
      ...plan.projects.map(({ id }) => id),
      ...plan.tasks.map(({ id }) => id),
    ];
    if (new Set(planEntityIds).size !== planEntityIds.length)
      throw new AiCooPolicyError('Entity IDs must be unique across the plan');
    for (const id of planEntityIds) {
      if (this.#entityIds.has(recordKey(context.workspaceId, id)))
        throw new AiCooPolicyError('Entity ID already exists in workspace');
    }

    // Factory linkage validates and commits atomically before the COO publishes.
    this.#factory.registerPlan(
      context,
      plan.objective.id,
      plan.tasks.map(({ id, objectiveId }) => ({ id, objectiveId })),
    );

    this.#objectives.set(objectiveKey, clone(plan.objective));
    this.#entityIds.add(objectiveKey);
    for (const project of plan.projects)
      (this.#projects.set(recordKey(project.workspaceId, project.id), clone(project)),
        this.#entityIds.add(recordKey(project.workspaceId, project.id)));
    for (const task of plan.tasks) {
      const status: CooTaskStatus =
        task.requiredAuthority === 4
          ? 'AWAITING_APPROVAL'
          : task.dependencyIds.length
            ? 'BLOCKED'
            : 'READY';
      const stored: CooTaskState = {
        ...clone(task),
        status,
        attempts: 0,
        costUsedMinorUnits: 0,
        computeUsed: 0,
      };
      this.#tasks.set(recordKey(task.workspaceId, task.id), stored);
      this.#entityIds.add(recordKey(task.workspaceId, task.id));
    }
    this.#emit(context, plan.objective.id, 'objective.created', { title: plan.objective.title });
    for (const project of plan.projects)
      this.#emit(
        context,
        plan.objective.id,
        'project.created',
        { title: project.title },
        project.id,
      );
    for (const task of plan.tasks) {
      this.#emit(
        context,
        task.objectiveId,
        'task.created',
        { title: task.title },
        task.projectId,
        task.id,
      );
      const stored = this.#tasks.get(recordKey(task.workspaceId, task.id))!;
      this.#emit(
        context,
        task.objectiveId,
        stored.status === 'AWAITING_APPROVAL'
          ? 'approval.requested'
          : stored.status === 'READY'
            ? 'task.ready'
            : 'task.blocked',
        { dependencyIds: task.dependencyIds },
        task.projectId,
        task.id,
      );
      if (task.requiredAuthority === 4) this.#createLevelFourCard(context, task);
    }
    return this.criticalPath(context, plan.objective.id);
  }

  requestAssignment(context: WorkspaceContext, request: AssignmentRequest): AssignmentDecision {
    this.#assertPlanner(context);
    exactKeys(request, ['factoryRequest', 'routingRequest', 'taskId'], 'assignmentRequest');
    exactKeys(
      request.factoryRequest,
      [
        'acceptanceCriteria',
        'authorityLevel',
        'budgetMinorUnits',
        'capabilityIds',
        'childLimit',
        'computeUnits',
        'dataScopes',
        'environmentScopes',
        'id',
        'maxRuntimeMs',
        'objectiveId',
        'parentAgentId',
        'repositoryScopes',
        'retention',
        'retryLimit',
        'stopCondition',
        'taskId',
        'templateId',
        'templateVersion',
        'toolGrants',
        'verificationCriteria',
        'workspaceId',
      ].filter(
        (key) => key !== 'parentAgentId' || Object.hasOwn(request.factoryRequest, 'parentAgentId'),
      ),
      'assignmentRequest.factoryRequest',
    );
    exactKeys(
      request.routingRequest,
      [
        'dataSensitivity',
        'heartbeatFreshnessMs',
        'id',
        'maximumCostMinorUnits',
        'maximumLatencyMs',
        'minimumReliabilityScoreBps',
        'minimumSecurityTier',
        'requiredCapabilityIds',
        'requiredComputeUnits',
        'requiredTools',
        'weights',
        'workspaceId',
      ].filter((key) => key !== 'weights' || Object.hasOwn(request.routingRequest, 'weights')),
      'assignmentRequest.routingRequest',
    );
    boundedText(request.taskId, 'taskId');
    const requestKey = recordKey(context.workspaceId, request.factoryRequest.id);
    if (this.#consumedAssignmentRequests.has(requestKey))
      throw new AiCooPolicyError('Assignment request already consumed');
    const task = this.#requireTask(context, request.taskId);
    this.#refreshTaskReadiness(context, task);
    if (task.requiredAuthority === 4)
      throw new AiCooPolicyError('Level-4 tasks require a Founder decision and cannot be assigned');
    if (task.status !== 'READY') throw new AiCooPolicyError('Task is not ready for assignment');
    if (
      request.factoryRequest.workspaceId !== task.workspaceId ||
      request.factoryRequest.objectiveId !== task.objectiveId ||
      request.factoryRequest.taskId !== task.id ||
      request.routingRequest.workspaceId !== task.workspaceId
    ) {
      throw new AiCooPolicyError('Assignment linkage crosses the governed task graph');
    }
    if (
      request.factoryRequest.authorityLevel > task.requiredAuthority ||
      request.factoryRequest.authorityLevel > 3 ||
      request.factoryRequest.budgetMinorUnits > task.costLimit.maximumMinorUnits ||
      request.factoryRequest.computeUnits > task.costLimit.maximumComputeUnits ||
      request.routingRequest.maximumCostMinorUnits > task.costLimit.maximumMinorUnits ||
      request.routingRequest.requiredComputeUnits > task.costLimit.maximumComputeUnits
    ) {
      throw new AiCooPolicyError('Assignment exceeds task authority or budget ceilings');
    }
    const expectedFactoryPolicy = {
      ...task.agentPolicy,
      authorityLevel: task.requiredAuthority,
      budgetMinorUnits: task.costLimit.maximumMinorUnits,
      computeUnits: task.costLimit.maximumComputeUnits,
      retryLimit: task.retryPolicy.maximumAttempts - 1,
      acceptanceCriteria: task.acceptanceCriteria,
      verificationCriteria: task.verificationCriteria,
      stopCondition: task.stopConditions.join(' AND '),
    };
    const actualFactoryPolicy = {
      templateId: request.factoryRequest.templateId,
      templateVersion: request.factoryRequest.templateVersion,
      ...(request.factoryRequest.parentAgentId === undefined
        ? {}
        : { parentAgentId: request.factoryRequest.parentAgentId }),
      repositoryScopes: request.factoryRequest.repositoryScopes,
      environmentScopes: request.factoryRequest.environmentScopes,
      dataScopes: request.factoryRequest.dataScopes,
      capabilityIds: request.factoryRequest.capabilityIds,
      toolGrants: request.factoryRequest.toolGrants,
      maxRuntimeMs: request.factoryRequest.maxRuntimeMs,
      childLimit: request.factoryRequest.childLimit,
      retention: request.factoryRequest.retention,
      authorityLevel: request.factoryRequest.authorityLevel,
      budgetMinorUnits: request.factoryRequest.budgetMinorUnits,
      computeUnits: request.factoryRequest.computeUnits,
      retryLimit: request.factoryRequest.retryLimit,
      acceptanceCriteria: request.factoryRequest.acceptanceCriteria,
      verificationCriteria: request.factoryRequest.verificationCriteria,
      stopCondition: request.factoryRequest.stopCondition,
    };
    const expectedRoutingPolicy = {
      ...task.routingPolicy,
      maximumCostMinorUnits: task.costLimit.maximumMinorUnits,
      requiredComputeUnits: task.costLimit.maximumComputeUnits,
    };
    const actualRoutingPolicy = { ...request.routingRequest } as Record<string, unknown>;
    delete actualRoutingPolicy.id;
    delete actualRoutingPolicy.workspaceId;
    if (
      !equalData(actualFactoryPolicy, expectedFactoryPolicy) ||
      !equalData(actualRoutingPolicy, expectedRoutingPolicy)
    )
      throw new AiCooPolicyError('Assignment policy must exactly match the governed task');
    if (
      JSON.stringify(request.factoryRequest.acceptanceCriteria) !==
        JSON.stringify(task.acceptanceCriteria) ||
      JSON.stringify(request.factoryRequest.verificationCriteria) !==
        JSON.stringify(task.verificationCriteria)
    ) {
      throw new AiCooPolicyError('Assignment criteria must exactly match the governed task');
    }
    const runtime = this.#broker.route(context, clone(request.routingRequest));
    const { agent, decision: factoryDecision } = this.#factory.instantiate(
      context,
      clone(request.factoryRequest),
    );
    task.status = 'ASSIGNED';
    task.attempts += 1;
    task.assignedAgentId = agent.agentId;
    task.selectedRuntimeId = runtime.selectedRuntimeId;
    task.selectedConnectionId = runtime.selectedConnectionId;
    task.runId = `coo-run:${request.factoryRequest.id}`;
    this.#consumedAssignmentRequests.add(requestKey);
    this.#emit(
      context,
      task.objectiveId,
      'task.assigned',
      { agentId: agent.agentId, runtimeId: runtime.selectedRuntimeId, attempt: task.attempts },
      task.projectId,
      task.id,
    );
    return {
      taskId: task.id,
      agentId: agent.agentId,
      runtime: clone(runtime),
      factoryDecision: clone(factoryDecision),
      runId: task.runId,
    };
  }

  recordUsage(
    context: WorkspaceContext,
    taskId: EntityId,
    costMinorUnits: number,
    computeUnits: number,
  ): void {
    this.#assertPlanner(context);
    const task = this.#requireTask(context, taskId);
    if (task.status !== 'ASSIGNED') throw new AiCooPolicyError('Usage requires an assigned task');
    integer(costMinorUnits, 'costMinorUnits', Number.MAX_SAFE_INTEGER);
    integer(computeUnits, 'computeUnits', Number.MAX_SAFE_INTEGER);
    const objective = this.#requireObjective(context, task.objectiveId);
    const objectiveTasks = this.#objectiveTasks(context.workspaceId, objective.id);
    const objectiveCost = objectiveTasks.reduce(
      (sum, item) => sum + BigInt(item.costUsedMinorUnits),
      0n,
    );
    const objectiveCompute = objectiveTasks.reduce(
      (sum, item) => sum + BigInt(item.computeUsed),
      0n,
    );
    if (
      BigInt(task.costUsedMinorUnits) + BigInt(costMinorUnits) >
        BigInt(task.costLimit.maximumMinorUnits) ||
      BigInt(task.computeUsed) + BigInt(computeUnits) >
        BigInt(task.costLimit.maximumComputeUnits) ||
      objectiveCost + BigInt(costMinorUnits) > BigInt(objective.costLimit.maximumMinorUnits) ||
      objectiveCompute + BigInt(computeUnits) > BigInt(objective.costLimit.maximumComputeUnits)
    ) {
      throw new AiCooPolicyError('Usage exceeds task or objective cost ceiling');
    }
    task.costUsedMinorUnits += costMinorUnits;
    task.computeUsed += computeUnits;
    this.#emit(
      context,
      task.objectiveId,
      'usage.recorded',
      {
        costMinorUnits,
        computeUnits,
        taskCostUsedMinorUnits: task.costUsedMinorUnits,
        taskComputeUsed: task.computeUsed,
      },
      task.projectId,
      task.id,
    );
  }

  completeTask(
    context: WorkspaceContext,
    taskId: EntityId,
    evidence: readonly VerificationEvidence[],
  ): void {
    this.#assertPlanner(context);
    const task = this.#requireTask(context, taskId);
    if (task.status !== 'ASSIGNED')
      throw new AiCooPolicyError('Only an assigned task can complete');
    if (!Array.isArray(evidence) || Object.keys(evidence).length !== evidence.length)
      throw new AiCooPolicyError('Evidence must be a dense array');
    const byCriterion = new Map<string, VerificationEvidence>();
    for (const item of evidence) {
      exactKeys(item, ['artifactId', 'contentHash', 'criterion', 'runId'], 'evidence');
      boundedText(item.criterion, 'evidence.criterion');
      boundedText(item.runId, 'evidence.runId');
      boundedText(item.artifactId, 'evidence.artifactId');
      if (!/^[a-f0-9]{64}$/u.test(item.contentHash))
        throw new AiCooPolicyError('Evidence contentHash must be SHA-256');
      if (byCriterion.has(item.criterion))
        throw new AiCooPolicyError('Duplicate verification evidence');
      if (
        item.runId !== task.runId ||
        !this.#evidenceVerifier.verify(context, {
          runId: item.runId,
          artifactId: item.artifactId,
          contentHash: item.contentHash,
        })
      )
        throw new AiCooPolicyError('Evidence is not bound to the assigned workspace run artifact');
      byCriterion.set(item.criterion, clone(item));
    }
    const requiredCriteria = [
      ...new Set([...task.acceptanceCriteria, ...task.verificationCriteria]),
    ];
    if (
      requiredCriteria.some((criterion) => !byCriterion.has(criterion)) ||
      byCriterion.size !== requiredCriteria.length
    )
      throw new AiCooPolicyError(
        'Every acceptance and verification criterion requires exact artifact evidence',
      );
    task.status = 'COMPLETED';
    this.#emit(
      context,
      task.objectiveId,
      'task.completed',
      { artifactIds: [...byCriterion.values()].map((item) => item.artifactId) },
      task.projectId,
      task.id,
    );
    for (const candidate of this.#objectiveTasks(context.workspaceId, task.objectiveId))
      this.#refreshTaskReadiness(context, candidate);
  }

  recordFailure(context: WorkspaceContext, taskId: EntityId, failureCode: string): CooTaskStatus {
    this.#assertPlanner(context);
    boundedText(failureCode, 'failureCode');
    const task = this.#requireTask(context, taskId);
    if (task.status !== 'ASSIGNED') throw new AiCooPolicyError('Only an assigned task can fail');
    const mustStop = task.retryPolicy.stopAfterFailureCodes.includes(failureCode);
    const canRetry =
      task.retryPolicy.retryableFailureCodes.includes(failureCode) &&
      task.attempts < task.retryPolicy.maximumAttempts &&
      !mustStop;
    task.assignedAgentId = undefined;
    task.selectedRuntimeId = undefined;
    task.selectedConnectionId = undefined;
    task.runId = undefined;
    task.status = mustStop ? 'STOPPED' : canRetry ? 'READY' : 'FAILED';
    this.#emit(
      context,
      task.objectiveId,
      task.status === 'READY'
        ? 'task.retry.ready'
        : task.status === 'STOPPED'
          ? 'task.stopped'
          : 'task.failed',
      { failureCode, attempt: task.attempts },
      task.projectId,
      task.id,
    );
    return task.status;
  }

  criticalPath(context: WorkspaceContext, objectiveId: EntityId): CriticalPathReport {
    this.#assertPlanner(context);
    this.#requireObjective(context, objectiveId);
    const tasks = this.#objectiveTasks(context.workspaceId, objectiveId);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const indegree = new Map(tasks.map((task) => [task.id, task.dependencyIds.length]));
    const dependents = new Map<string, string[]>();
    for (const task of tasks)
      for (const dependencyId of task.dependencyIds)
        dependents.set(dependencyId, [...(dependents.get(dependencyId) ?? []), task.id]);
    const ready = [...indegree.entries()]
      .filter(([, count]) => count === 0)
      .map(([id]) => id)
      .sort(compareText);
    const ordered: string[] = [];
    while (ready.length > 0) {
      const id = ready.shift()!;
      ordered.push(id);
      for (const dependentId of (dependents.get(id) ?? []).sort(compareText)) {
        const next = indegree.get(dependentId)! - 1;
        indegree.set(dependentId, next);
        if (next === 0) {
          ready.push(dependentId);
          ready.sort(compareText);
        }
      }
    }
    if (ordered.length !== tasks.length)
      throw new AiCooPolicyError('Task dependency graph contains a cycle');
    const best = new Map<string, { duration: number; path: string[] }>();
    for (const id of ordered) {
      const task = byId.get(id)!;
      const longestDependency = task.dependencyIds
        .map((dependencyId) => best.get(dependencyId)!)
        .sort(
          (left, right) => right.duration - left.duration || comparePath(left.path, right.path),
        )[0];
      const duration = task.estimatedDurationMs + (longestDependency?.duration ?? 0);
      if (!Number.isSafeInteger(duration))
        throw new AiCooPolicyError('Critical path exceeds numeric bounds');
      best.set(id, { duration, path: [...(longestDependency?.path ?? []), id] });
    }
    const longest = [...best.values()].sort(
      (left, right) => right.duration - left.duration || comparePath(left.path, right.path),
    )[0];
    return {
      objectiveId,
      taskIds: longest?.path ?? [],
      totalDurationMs: longest?.duration ?? 0,
      blockedTaskIds: tasks
        .filter((task) => task.status === 'BLOCKED' || task.status === 'AWAITING_APPROVAL')
        .map((task) => task.id)
        .sort(),
    };
  }

  listTasks(context: WorkspaceContext, objectiveId: EntityId): readonly CooTaskState[] {
    this.#assertPlanner(context);
    this.#requireObjective(context, objectiveId);
    return this.#objectiveTasks(context.workspaceId, objectiveId).map(clone);
  }

  listEvents(context: WorkspaceContext): readonly CooEvent[] {
    this.#assertPlanner(context);
    return this.#events.filter((event) => event.workspaceId === context.workspaceId).map(clone);
  }

  listFounderDecisions(context: WorkspaceContext): readonly FounderDecisionCard[] {
    this.#assertPlanner(context);
    return [...this.#approvals.values()]
      .filter((card) => card.workspaceId === context.workspaceId)
      .map(clone);
  }

  #validatePlan(context: WorkspaceContext, untrusted: ObjectivePlan): ObjectivePlan {
    let plan: ObjectivePlan;
    try {
      plan = clone(untrusted);
    } catch {
      throw new AiCooPolicyError('Plan must be structured-cloneable data');
    }
    if (!plan || typeof plan !== 'object' || !plan.objective)
      throw new AiCooPolicyError('Objective plan is required');
    exactKeys(plan, ['objective', 'projects', 'tasks'], 'plan');
    if (!Array.isArray(plan.projects) || !Array.isArray(plan.tasks))
      throw new AiCooPolicyError('Projects and tasks must be arrays');
    if (
      Object.keys(plan.projects).length !== plan.projects.length ||
      Object.keys(plan.tasks).length !== plan.tasks.length
    )
      throw new AiCooPolicyError('Projects and tasks must be dense arrays');
    const objective = plan.objective;
    exactKeys(
      objective,
      [
        'acceptanceCriteria',
        'costLimit',
        'desiredOutcome',
        'id',
        'maximumAuthority',
        'stopConditions',
        'title',
        'verificationCriteria',
        'workspaceId',
      ],
      'objective',
    );
    this.#assertWorkspace(context, objective.workspaceId);
    for (const [value, field] of [
      [objective.id, 'objective.id'],
      [objective.title, 'objective.title'],
      [objective.desiredOutcome, 'objective.desiredOutcome'],
    ] as const)
      boundedText(value, field);
    integer(objective.maximumAuthority, 'objective.maximumAuthority', 4);
    validateCost(objective.costLimit, 'objective.costLimit');
    if (
      objective.costLimit.maximumMinorUnits > this.#options.maximumObjectiveCostMinorUnits ||
      objective.costLimit.maximumComputeUnits > this.#options.maximumObjectiveComputeUnits
    )
      throw new AiCooPolicyError('Objective exceeds company cost ceilings');
    boundedDenseStrings(objective.acceptanceCriteria, 'objective.acceptanceCriteria');
    boundedDenseStrings(objective.verificationCriteria, 'objective.verificationCriteria');
    boundedDenseStrings(objective.stopConditions, 'objective.stopConditions');
    if (
      plan.projects.length === 0 ||
      plan.projects.length > this.#options.maximumProjectsPerObjective
    )
      throw new AiCooPolicyError('Project count exceeds policy');
    if (plan.tasks.length === 0 || plan.tasks.length > this.#options.maximumTasksPerObjective)
      throw new AiCooPolicyError('Task count exceeds policy');
    const projectIds = new Set<string>();
    for (const project of plan.projects) {
      exactKeys(project, ['id', 'objectiveId', 'title', 'workspaceId'], 'project');
      this.#assertWorkspace(context, project.workspaceId);
      boundedText(project.id, 'project.id');
      boundedText(project.title, 'project.title');
      if (project.objectiveId !== objective.id)
        throw new AiCooPolicyError('Project objective linkage is invalid');
      if (projectIds.has(project.id)) throw new AiCooPolicyError('Duplicate project ID');
      projectIds.add(project.id);
    }
    const taskIds = new Set<string>();
    let totalCost = 0n;
    let totalCompute = 0n;
    for (const task of plan.tasks) {
      exactKeys(
        task,
        [
          'acceptanceCriteria',
          'agentPolicy',
          'costLimit',
          'dependencyIds',
          'estimatedDurationMs',
          'exactTarget',
          'id',
          'kind',
          'objectiveId',
          'projectId',
          'requiredAuthority',
          'retryPolicy',
          'routingPolicy',
          'stopConditions',
          'title',
          'verificationCriteria',
          'workspaceId',
        ].filter((key) => key !== 'exactTarget' || Object.hasOwn(task, 'exactTarget')),
        'task',
      );
      this.#assertWorkspace(context, task.workspaceId);
      for (const [value, field] of [
        [task.id, 'task.id'],
        [task.title, 'task.title'],
        [task.projectId, 'task.projectId'],
      ] as const)
        boundedText(value, field);
      if (task.objectiveId !== objective.id || !projectIds.has(task.projectId))
        throw new AiCooPolicyError('Task graph linkage is invalid');
      if (taskIds.has(task.id)) throw new AiCooPolicyError('Duplicate task ID');
      taskIds.add(task.id);
      if (
        ![
          'repository.review',
          'quality.verify',
          'documentation.prepare',
          'runtime.health.check',
        ].includes(task.kind)
      )
        throw new AiCooPolicyError('Unsupported task kind');
      if (
        !Array.isArray(task.dependencyIds) ||
        Object.keys(task.dependencyIds).length !== task.dependencyIds.length ||
        new Set(task.dependencyIds).size !== task.dependencyIds.length
      )
        throw new AiCooPolicyError('Task dependencies must be a unique dense array');
      for (const dependencyId of task.dependencyIds) boundedText(dependencyId, 'dependencyId');
      integer(task.requiredAuthority, 'task.requiredAuthority', 4);
      const minimum = TASK_KIND_MINIMUMS[task.kind as TaskKind];
      if (task.requiredAuthority < minimum.authority)
        throw new AiCooPolicyError('Task authority is below its canonical task-kind policy');
      if (task.requiredAuthority > objective.maximumAuthority)
        throw new AiCooPolicyError('Task exceeds objective authority ceiling');
      if (task.requiredAuthority === 4 && !task.exactTarget)
        throw new AiCooPolicyError('Level-4 task requires an exact approval target');
      validateCost(task.costLimit, 'task.costLimit');
      if (task.costLimit.currency !== objective.costLimit.currency)
        throw new AiCooPolicyError('Task currency must match objective currency');
      totalCost += BigInt(task.costLimit.maximumMinorUnits);
      totalCompute += BigInt(task.costLimit.maximumComputeUnits);
      integer(
        task.estimatedDurationMs,
        'task.estimatedDurationMs',
        this.#options.maximumTaskDurationMs,
      );
      if (task.estimatedDurationMs === 0)
        throw new AiCooPolicyError('Task duration must be positive');
      boundedDenseStrings(task.acceptanceCriteria, 'task.acceptanceCriteria');
      boundedDenseStrings(task.verificationCriteria, 'task.verificationCriteria');
      boundedDenseStrings(task.stopConditions, 'task.stopConditions');
      this.#validateAgentPolicy(task.agentPolicy, task);
      this.#validateRoutingPolicy(task.routingPolicy);
      const agentTool = task.agentPolicy.toolGrants.find(
        ({ toolId }: { toolId: EntityId }) => toolId === minimum.toolId,
      );
      const routingTool = task.routingPolicy.requiredTools.find(
        ({ toolId, scope }: { toolId: EntityId; scope: string }) =>
          toolId === minimum.toolId && scope === minimum.scope,
      );
      if (
        !task.agentPolicy.capabilityIds.includes(minimum.capabilityId) ||
        !task.routingPolicy.requiredCapabilityIds.includes(minimum.capabilityId) ||
        !agentTool?.scopes.includes(minimum.scope) ||
        !routingTool
      )
        throw new AiCooPolicyError(
          'Task does not satisfy canonical task-kind capabilities and tools',
        );
      exactKeys(
        task.retryPolicy,
        ['maximumAttempts', 'retryableFailureCodes', 'stopAfterFailureCodes'],
        'task.retryPolicy',
      );
      integer(
        task.retryPolicy.maximumAttempts,
        'task.retryPolicy.maximumAttempts',
        this.#options.maximumRetriesPerTask + 1,
      );
      if (
        task.retryPolicy.maximumAttempts < 1 ||
        task.retryPolicy.maximumAttempts - 1 > this.#options.maximumRetriesPerTask
      )
        throw new AiCooPolicyError('Retry policy exceeds company ceiling');
      boundedDenseStrings(
        task.retryPolicy.retryableFailureCodes,
        'task.retryPolicy.retryableFailureCodes',
      );
      boundedDenseStrings(
        task.retryPolicy.stopAfterFailureCodes,
        'task.retryPolicy.stopAfterFailureCodes',
      );
      if (
        task.retryPolicy.retryableFailureCodes.some((code: string) =>
          task.retryPolicy.stopAfterFailureCodes.includes(code),
        )
      )
        throw new AiCooPolicyError('Failure code cannot be both retryable and terminal');
    }
    if (
      totalCost > BigInt(objective.costLimit.maximumMinorUnits) ||
      totalCompute > BigInt(objective.costLimit.maximumComputeUnits)
    )
      throw new AiCooPolicyError('Task reservations exceed objective budget');
    for (const task of plan.tasks) {
      for (const dependencyId of task.dependencyIds) {
        if (!taskIds.has(dependencyId))
          throw new AiCooPolicyError('Dependency is outside the objective');
        if (dependencyId === task.id) throw new AiCooPolicyError('Task cannot depend on itself');
      }
    }
    this.#assertAcyclic(plan.tasks);
    return plan;
  }

  #assertAcyclic(tasks: readonly CooTask[]): void {
    const indegree = new Map(tasks.map((task) => [task.id, task.dependencyIds.length]));
    const dependents = new Map<string, string[]>();
    for (const task of tasks)
      for (const dependency of task.dependencyIds)
        dependents.set(dependency, [...(dependents.get(dependency) ?? []), task.id]);
    const ready = [...indegree.entries()]
      .filter(([, count]) => count === 0)
      .map(([id]) => id)
      .sort();
    let visited = 0;
    while (ready.length) {
      const id = ready.shift()!;
      visited += 1;
      for (const dependent of (dependents.get(id) ?? []).sort()) {
        const next = indegree.get(dependent)! - 1;
        indegree.set(dependent, next);
        if (next === 0) {
          ready.push(dependent);
          ready.sort();
        }
      }
    }
    if (visited !== tasks.length)
      throw new AiCooPolicyError('Task dependency graph contains a cycle');
  }

  #validateAgentPolicy(policy: CooAgentPolicy, task: CooTask): void {
    exactKeys(
      policy,
      [
        'capabilityIds',
        'childLimit',
        'dataScopes',
        'environmentScopes',
        'maxRuntimeMs',
        'parentAgentId',
        'repositoryScopes',
        'retention',
        'templateId',
        'templateVersion',
        'toolGrants',
      ].filter((key) => key !== 'parentAgentId' || Object.hasOwn(policy, 'parentAgentId')),
      'task.agentPolicy',
    );
    boundedText(policy.templateId, 'task.agentPolicy.templateId');
    if (policy.parentAgentId !== undefined)
      boundedText(policy.parentAgentId, 'task.agentPolicy.parentAgentId');
    integer(policy.templateVersion, 'task.agentPolicy.templateVersion', Number.MAX_SAFE_INTEGER);
    if (policy.templateVersion < 1)
      throw new AiCooPolicyError('Agent template version must be positive');
    boundedDenseStrings(policy.repositoryScopes, 'task.agentPolicy.repositoryScopes');
    boundedDenseStrings(policy.environmentScopes, 'task.agentPolicy.environmentScopes');
    boundedDenseStrings(policy.dataScopes, 'task.agentPolicy.dataScopes');
    denseStrings(policy.capabilityIds, 'task.agentPolicy.capabilityIds');
    if (
      !Array.isArray(policy.toolGrants) ||
      Object.keys(policy.toolGrants).length !== policy.toolGrants.length ||
      policy.toolGrants.length > 64
    )
      throw new AiCooPolicyError('task.agentPolicy.toolGrants must be a dense bounded array');
    for (const grant of policy.toolGrants) {
      exactKeys(grant, ['scopes', 'toolId'], 'task.agentPolicy.toolGrant');
      boundedText(grant.toolId, 'task.agentPolicy.toolId');
      boundedDenseStrings(grant.scopes, 'task.agentPolicy.toolScopes');
    }
    integer(
      policy.maxRuntimeMs,
      'task.agentPolicy.maxRuntimeMs',
      this.#options.maximumTaskDurationMs,
    );
    if (policy.maxRuntimeMs === 0 || policy.maxRuntimeMs > task.estimatedDurationMs)
      throw new AiCooPolicyError('Agent runtime exceeds task duration policy');
    integer(policy.childLimit, 'task.agentPolicy.childLimit', 100);
    if (policy.retention !== 'ARCHIVE' && policy.retention !== 'DELETE_ON_COMPLETION')
      throw new AiCooPolicyError('Unsupported agent retention policy');
  }

  #validateRoutingPolicy(policy: CooRoutingPolicy): void {
    exactKeys(
      policy,
      [
        'dataSensitivity',
        'heartbeatFreshnessMs',
        'maximumLatencyMs',
        'minimumReliabilityScoreBps',
        'minimumSecurityTier',
        'requiredCapabilityIds',
        'requiredTools',
        'weights',
      ].filter((key) => key !== 'weights' || Object.hasOwn(policy, 'weights')),
      'task.routingPolicy',
    );
    if (!['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'].includes(policy.dataSensitivity))
      throw new AiCooPolicyError('Unsupported routing data sensitivity');
    integer(policy.minimumSecurityTier, 'task.routingPolicy.minimumSecurityTier', 3);
    integer(
      policy.minimumReliabilityScoreBps,
      'task.routingPolicy.minimumReliabilityScoreBps',
      10_000,
    );
    integer(policy.maximumLatencyMs, 'task.routingPolicy.maximumLatencyMs', 24 * 60 * 60 * 1_000);
    if (policy.maximumLatencyMs === 0)
      throw new AiCooPolicyError('Routing latency must be positive');
    integer(
      policy.heartbeatFreshnessMs,
      'task.routingPolicy.heartbeatFreshnessMs',
      60 * 60 * 1_000,
    );
    if (policy.heartbeatFreshnessMs === 0)
      throw new AiCooPolicyError('Heartbeat freshness must be positive');
    denseStrings(policy.requiredCapabilityIds, 'task.routingPolicy.requiredCapabilityIds');
    if (
      !Array.isArray(policy.requiredTools) ||
      Object.keys(policy.requiredTools).length !== policy.requiredTools.length ||
      policy.requiredTools.length > 64
    )
      throw new AiCooPolicyError('task.routingPolicy.requiredTools must be a dense bounded array');
    for (const tool of policy.requiredTools) {
      exactKeys(tool, ['scope', 'toolId'], 'task.routingPolicy.requiredTool');
      boundedText(tool.toolId, 'task.routingPolicy.toolId');
      boundedText(tool.scope, 'task.routingPolicy.toolScope');
    }
    if (policy.weights !== undefined) {
      exactKeys(
        policy.weights,
        ['cost', 'latency', 'quality', 'reliability', 'security', 'workload'],
        'task.routingPolicy.weights',
      );
      const values = Object.values(policy.weights);
      for (const value of values) integer(value, 'task.routingPolicy.weight', 10_000);
      if (values.reduce((sum, value) => sum + value, 0) !== 10_000)
        throw new AiCooPolicyError('Routing weights must total 10,000 basis points');
    }
  }

  #refreshTaskReadiness(context: WorkspaceContext, task: CooTaskState): void {
    if (
      TERMINAL.has(task.status) ||
      task.status === 'ASSIGNED' ||
      task.status === 'AWAITING_APPROVAL'
    )
      return;
    const previous = task.status;
    const dependencies = task.dependencyIds.map((id) => this.#requireTask(context, id));
    if (
      dependencies.some(
        (dependency) => dependency.status === 'FAILED' || dependency.status === 'STOPPED',
      )
    ) {
      task.status = 'BLOCKED';
    } else {
      task.status = dependencies.every((dependency) => dependency.status === 'COMPLETED')
        ? 'READY'
        : 'BLOCKED';
    }
    if (task.status !== previous)
      this.#emit(
        context,
        task.objectiveId,
        task.status === 'READY' ? 'task.ready' : 'task.blocked',
        { dependencyIds: task.dependencyIds },
        task.projectId,
        task.id,
      );
  }

  #createLevelFourCard(context: WorkspaceContext, task: CooTask): void {
    const id = `approval:${task.id}`;
    const card: FounderDecisionCard = {
      id,
      workspaceId: task.workspaceId,
      objectiveId: task.objectiveId,
      taskId: task.id,
      requestedAction: task.title,
      requesterId: context.principalId,
      exactTarget: task.exactTarget!,
      reason: 'Task requires Level-4 Founder authority',
      businessImpact: 'Execution is blocked until an authorized human decision',
      securityImpact: 'No execution permit or runtime assignment has been issued',
      privacyImpact: 'No additional data access has been granted',
      financialImpact: `${task.costLimit.maximumMinorUnits} ${task.costLimit.currency} minor units maximum`,
      alternatives: [
        'Reject the action',
        'Reduce the task to Level 3 or below',
        'Hold for more evidence',
      ],
      recommendedAction: 'Review evidence and decide through the protected Founder interface',
      rollback: 'No action has executed; rejection leaves the task blocked',
      expiresAt: new Date(this.#clock() + 24 * 60 * 60 * 1_000).toISOString(),
      status: 'PENDING',
    };
    this.#approvals.set(recordKey(card.workspaceId, card.id), card);
  }

  #emit(
    context: WorkspaceContext,
    objectiveId: string,
    type: CooEvent['type'],
    facts: CooEvent['facts'],
    projectId?: string,
    taskId?: string,
  ): void {
    const id = this.#idFactory();
    boundedText(id, 'event.id');
    if (this.#eventIds.has(id)) throw new AiCooPolicyError('Duplicate event ID');
    this.#eventIds.add(id);
    this.#events.push({
      id,
      workspaceId: context.workspaceId,
      objectiveId,
      projectId,
      taskId,
      type,
      occurredAt: new Date(this.#clock()).toISOString(),
      actorId: context.principalId,
      facts: clone(facts),
    });
  }

  #assertPlanner(context: WorkspaceContext): void {
    if (!this.#planners.has(context.principalId))
      throw new AiCooPolicyError('AI COO planner authority required');
    boundedText(context.workspaceId, 'context.workspaceId');
  }
  #assertWorkspace(context: WorkspaceContext, workspaceId: string): void {
    if (context.workspaceId !== workspaceId)
      throw new AiCooPolicyError('Cross-workspace graph link denied');
  }
  #requireObjective(context: WorkspaceContext, id: string): CooObjective {
    const value = this.#objectives.get(recordKey(context.workspaceId, id));
    if (!value) throw new AiCooPolicyError('Objective not found in authenticated workspace');
    return value;
  }
  #requireTask(context: WorkspaceContext, id: string): CooTaskState {
    const value = this.#tasks.get(recordKey(context.workspaceId, id));
    if (!value) throw new AiCooPolicyError('Task not found in authenticated workspace');
    return value;
  }
  #objectiveTasks(workspaceId: string, objectiveId: string): CooTaskState[] {
    return [...this.#tasks.values()].filter(
      (task) => task.workspaceId === workspaceId && task.objectiveId === objectiveId,
    );
  }
}
