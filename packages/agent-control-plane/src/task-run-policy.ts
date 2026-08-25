import { createHash } from 'node:crypto';

import type { AuthorityLevel, CostLimit, EntityId, TaskKind } from './contracts';

export type DurableTaskStatus =
  | 'BLOCKED'
  | 'READY'
  | 'AWAITING_APPROVAL'
  | 'ASSIGNED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'STOPPED';
export type DurableRunStatus =
  'PREPARED' | 'AWAITING_APPROVAL' | 'ASSIGNED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STOPPED';

export interface DurableApprovalPreparation {
  readonly actionCode: string;
  readonly exactTarget: string;
  readonly artifactVersionId: string;
  readonly evidenceHash: string;
}

export interface DurableTaskPlanInput {
  readonly id: EntityId;
  readonly projectId: EntityId;
  readonly title: string;
  readonly kind: TaskKind;
  readonly dependencyIds: readonly EntityId[];
  readonly requiredAuthority: AuthorityLevel;
  readonly costLimit: CostLimit;
  readonly estimatedDurationMs: number;
  readonly acceptanceCriteria: readonly string[];
  readonly verificationCriteria: readonly string[];
  readonly stopConditions: readonly string[];
  readonly retryPolicy: {
    readonly maximumAttempts: number;
    readonly retryableFailureCodes: readonly string[];
    readonly stopAfterFailureCodes: readonly string[];
  };
  readonly agentPolicy: Readonly<Record<string, unknown>>;
  readonly routingPolicy: Readonly<Record<string, unknown>>;
  readonly approval?: DurableApprovalPreparation;
}

export interface DurableObjectivePlanInput {
  readonly workspaceId: EntityId;
  readonly idempotencyKey: string;
  readonly policyVersion: string;
  readonly objective: {
    readonly id: EntityId;
    readonly title: string;
    readonly desiredOutcome: string;
    readonly maximumAuthority: AuthorityLevel;
    readonly costLimit: CostLimit;
    readonly acceptanceCriteria: readonly string[];
    readonly verificationCriteria: readonly string[];
    readonly stopConditions: readonly string[];
  };
  readonly projects: readonly {
    readonly id: EntityId;
    readonly title: string;
  }[];
  readonly tasks: readonly DurableTaskPlanInput[];
}

export interface DurableTaskPolicySnapshot {
  readonly schemaVersion: 1;
  readonly policyVersion: string;
  readonly objectiveId: EntityId;
  readonly taskId: EntityId;
  readonly projectId: EntityId;
  readonly title: string;
  readonly kind: TaskKind;
  readonly dependencyIds: readonly EntityId[];
  readonly requiredAuthority: AuthorityLevel;
  readonly costLimit: CostLimit;
  readonly estimatedDurationMs: number;
  readonly acceptanceCriteria: readonly string[];
  readonly verificationCriteria: readonly string[];
  readonly stopConditions: readonly string[];
  readonly retryPolicy: DurableTaskPlanInput['retryPolicy'];
  readonly agentPolicy: Readonly<Record<string, unknown>>;
  readonly routingPolicy: Readonly<Record<string, unknown>>;
  readonly approval?: DurableApprovalPreparation;
}

export class DurableTaskRunPolicyError extends Error {}

export interface TrustedAssignmentEvidence {
  readonly evidenceId: EntityId;
  readonly evidenceHash: string;
  readonly taskId: EntityId;
  readonly runId: EntityId;
  readonly agentId: EntityId;
  readonly runtimeId: EntityId;
  readonly connectionId: EntityId;
}

export interface AssignmentEvidenceVerifier {
  /** Trusted server-side port; implementations must not trust request payload assertions. */
  verify(workspaceId: EntityId, evidence: TrustedAssignmentEvidence): Promise<boolean>;
}

export interface TrustedArtifactEvidence {
  readonly evidenceId: EntityId;
  readonly evidenceHash: string;
  readonly taskId: EntityId;
  readonly runId: EntityId;
  readonly artifactId: EntityId;
  readonly criterion: string;
  readonly kind: string;
  readonly uriReference: string;
  readonly contentHash: string;
}

export interface DurableArtifactEvidenceVerifier {
  /** Trusted server-side port; implementations must verify runtime provenance and content hash. */
  verify(workspaceId: EntityId, evidence: TrustedArtifactEvidence): Promise<boolean>;
}

export const ASSIGNMENT_EVIDENCE_VERIFIER = Symbol('ASSIGNMENT_EVIDENCE_VERIFIER');
export const DURABLE_ARTIFACT_EVIDENCE_VERIFIER = Symbol('DURABLE_ARTIFACT_EVIDENCE_VERIFIER');

export function validateTrustedAssignmentEvidence(value: TrustedAssignmentEvidence): void {
  plainRecord(value, 'assignment evidence');
  exactKeys(
    value,
    ['evidenceId', 'evidenceHash', 'taskId', 'runId', 'agentId', 'runtimeId', 'connectionId'],
    'assignment evidence',
  );
  for (const [field, reference] of Object.entries(value)) {
    if (field !== 'evidenceHash') safeReference(reference, `assignment evidence.${field}`);
  }
  if (!SHA256.test(value.evidenceHash))
    throw new DurableTaskRunPolicyError(
      'assignment evidence hash must be a lowercase SHA-256 digest',
    );
}

export function validateTrustedArtifactEvidence(value: TrustedArtifactEvidence): void {
  plainRecord(value, 'artifact evidence');
  exactKeys(
    value,
    [
      'evidenceId',
      'evidenceHash',
      'taskId',
      'runId',
      'artifactId',
      'criterion',
      'kind',
      'uriReference',
      'contentHash',
    ],
    'artifact evidence',
  );
  for (const field of [
    'evidenceId',
    'taskId',
    'runId',
    'artifactId',
    'kind',
    'uriReference',
  ] as const)
    safeReference(value[field], `artifact evidence.${field}`);
  boundedText(value.criterion, 'artifact evidence.criterion');
  if (!SHA256.test(value.evidenceHash) || !SHA256.test(value.contentHash))
    throw new DurableTaskRunPolicyError(
      'artifact evidence hashes must be lowercase SHA-256 digests',
    );
}

export const TASK_KIND_MINIMUM_AUTHORITY: Readonly<Record<TaskKind, AuthorityLevel>> = {
  'repository.review': 1,
  'quality.verify': 3,
  'documentation.prepare': 2,
  'runtime.health.check': 0,
};

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SAFE_CODE = /^[A-Z0-9][A-Z0-9._-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SENSITIVE =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk|gh[opusr]|github_pat|glpat)[_-][A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/iu;

function plainRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new DurableTaskRunPolicyError(`${field} must be a plain object`);
  }
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      throw new DurableTaskRunPolicyError(`${field} contains unsupported fields`);
  }
}

function safeReference(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || SENSITIVE.test(value)) {
    throw new DurableTaskRunPolicyError(`${field} must be a safe non-sensitive reference`);
  }
}

function boundedText(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > 2_048 ||
    /\p{Cc}/u.test(value) ||
    SENSITIVE.test(value)
  ) {
    throw new DurableTaskRunPolicyError(`${field} must be bounded, printable, and non-sensitive`);
  }
}

function denseStrings(value: unknown, field: string, max = 64): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw new DurableTaskRunPolicyError(`${field} must contain between 1 and ${max} entries`);
  }
  const seen = new Set<string>();
  for (const item of value) {
    boundedText(item, field);
    if (seen.has(item)) throw new DurableTaskRunPolicyError(`${field} must not contain duplicates`);
    seen.add(item);
  }
}

function safeInteger(value: unknown, field: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new DurableTaskRunPolicyError(`${field} must be a safe integer of at least ${minimum}`);
  }
}

function authority(value: unknown, field: string): asserts value is AuthorityLevel {
  safeInteger(value, field);
  if ((value as number) > 4)
    throw new DurableTaskRunPolicyError(`${field} must be an authority level`);
}

function costLimit(value: unknown, field: string): asserts value is CostLimit {
  plainRecord(value, field);
  exactKeys(value, ['currency', 'maximumMinorUnits', 'maximumComputeUnits'], field);
  if (typeof value.currency !== 'string' || !/^[A-Z]{3}$/u.test(value.currency)) {
    throw new DurableTaskRunPolicyError(`${field}.currency must be an ISO-style currency code`);
  }
  safeInteger(value.maximumMinorUnits, `${field}.maximumMinorUnits`);
  safeInteger(value.maximumComputeUnits, `${field}.maximumComputeUnits`);
}

function jsonSafe(value: unknown, field: string, depth = 0): void {
  if (depth > 8) throw new DurableTaskRunPolicyError(`${field} exceeds maximum nesting depth`);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new DurableTaskRunPolicyError(`${field} contains an unsafe number`);
    return;
  }
  if (typeof value === 'string') {
    boundedText(value, field);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 64)
      throw new DurableTaskRunPolicyError(`${field} contains too many entries`);
    for (const item of value) jsonSafe(item, field, depth + 1);
    return;
  }
  plainRecord(value, field);
  if (Object.keys(value).length > 64)
    throw new DurableTaskRunPolicyError(`${field} contains too many fields`);
  for (const [key, nested] of Object.entries(value)) {
    safeReference(key, `${field} field`);
    jsonSafe(nested, field, depth + 1);
  }
}

function validateApproval(value: unknown, requiredAuthority: AuthorityLevel): void {
  if (requiredAuthority !== 4) {
    if (value !== undefined)
      throw new DurableTaskRunPolicyError('Only Level-4 tasks may prepare an approval binding');
    return;
  }
  plainRecord(value, 'task.approval');
  exactKeys(
    value,
    ['actionCode', 'exactTarget', 'artifactVersionId', 'evidenceHash'],
    'task.approval',
  );
  if (typeof value.actionCode !== 'string' || !SAFE_CODE.test(value.actionCode)) {
    throw new DurableTaskRunPolicyError('task.approval.actionCode must be a safe action code');
  }
  safeReference(value.exactTarget, 'task.approval.exactTarget');
  safeReference(value.artifactVersionId, 'task.approval.artifactVersionId');
  if (typeof value.evidenceHash !== 'string' || !SHA256.test(value.evidenceHash)) {
    throw new DurableTaskRunPolicyError(
      'task.approval.evidenceHash must be a lowercase SHA-256 digest',
    );
  }
}

function validateTask(
  task: unknown,
  projectIds: Set<string>,
): asserts task is DurableTaskPlanInput {
  plainRecord(task, 'task');
  exactKeys(
    task,
    [
      'id',
      'projectId',
      'title',
      'kind',
      'dependencyIds',
      'requiredAuthority',
      'costLimit',
      'estimatedDurationMs',
      'acceptanceCriteria',
      'verificationCriteria',
      'stopConditions',
      'retryPolicy',
      'agentPolicy',
      'routingPolicy',
      'approval',
    ],
    'task',
  );
  safeReference(task.id, 'task.id');
  safeReference(task.projectId, 'task.projectId');
  if (!projectIds.has(task.projectId))
    throw new DurableTaskRunPolicyError('Task references an unknown project');
  boundedText(task.title, 'task.title');
  if (typeof task.kind !== 'string' || !(task.kind in TASK_KIND_MINIMUM_AUTHORITY))
    throw new DurableTaskRunPolicyError('Unsupported task kind');
  if (!Array.isArray(task.dependencyIds) || task.dependencyIds.length > 64) {
    throw new DurableTaskRunPolicyError('task.dependencyIds must be a bounded array');
  }
  const dependencyIds = new Set<string>();
  for (const dependencyId of task.dependencyIds) {
    safeReference(dependencyId, 'task.dependencyIds');
    if (dependencyIds.has(dependencyId))
      throw new DurableTaskRunPolicyError('Task dependencies must be unique');
    dependencyIds.add(dependencyId);
  }
  authority(task.requiredAuthority, 'task.requiredAuthority');
  const taskKind = task.kind as TaskKind;
  if (task.requiredAuthority < TASK_KIND_MINIMUM_AUTHORITY[taskKind]) {
    throw new DurableTaskRunPolicyError('Task authority is below the task-kind minimum');
  }
  costLimit(task.costLimit, 'task.costLimit');
  safeInteger(task.estimatedDurationMs, 'task.estimatedDurationMs', 1);
  denseStrings(task.acceptanceCriteria, 'task.acceptanceCriteria');
  denseStrings(task.verificationCriteria, 'task.verificationCriteria');
  denseStrings(task.stopConditions, 'task.stopConditions');
  plainRecord(task.retryPolicy, 'task.retryPolicy');
  exactKeys(
    task.retryPolicy,
    ['maximumAttempts', 'retryableFailureCodes', 'stopAfterFailureCodes'],
    'task.retryPolicy',
  );
  safeInteger(task.retryPolicy.maximumAttempts, 'task.retryPolicy.maximumAttempts', 1);
  if (task.retryPolicy.maximumAttempts > 32)
    throw new DurableTaskRunPolicyError('Retry budget exceeds 32 attempts');
  const retryableFailureCodes = task.retryPolicy.retryableFailureCodes;
  const stopAfterFailureCodes = task.retryPolicy.stopAfterFailureCodes;
  denseStrings(retryableFailureCodes, 'task.retryPolicy.retryableFailureCodes');
  denseStrings(stopAfterFailureCodes, 'task.retryPolicy.stopAfterFailureCodes');
  const overlap = retryableFailureCodes.find((code) => stopAfterFailureCodes.includes(code));
  if (overlap) throw new DurableTaskRunPolicyError('Retry and stop failure codes must not overlap');
  jsonSafe(task.agentPolicy, 'task.agentPolicy');
  jsonSafe(task.routingPolicy, 'task.routingPolicy');
  validateApproval(task.approval, task.requiredAuthority);
}

function assertAcyclic(tasks: readonly DurableTaskPlanInput[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id))
      throw new DurableTaskRunPolicyError('Task dependency graph contains a cycle');
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) throw new DurableTaskRunPolicyError('Task references an unknown dependency');
    visiting.add(id);
    for (const dependencyId of task.dependencyIds) {
      if (dependencyId === id) throw new DurableTaskRunPolicyError('Task cannot depend on itself');
      visit(dependencyId);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

export function validateDurableObjectivePlan(
  input: unknown,
): asserts input is DurableObjectivePlanInput {
  plainRecord(input, 'plan');
  exactKeys(
    input,
    ['workspaceId', 'idempotencyKey', 'policyVersion', 'objective', 'projects', 'tasks'],
    'plan',
  );
  safeReference(input.workspaceId, 'plan.workspaceId');
  safeReference(input.idempotencyKey, 'plan.idempotencyKey');
  safeReference(input.policyVersion, 'plan.policyVersion');
  plainRecord(input.objective, 'plan.objective');
  exactKeys(
    input.objective,
    [
      'id',
      'title',
      'desiredOutcome',
      'maximumAuthority',
      'costLimit',
      'acceptanceCriteria',
      'verificationCriteria',
      'stopConditions',
    ],
    'plan.objective',
  );
  safeReference(input.objective.id, 'objective.id');
  boundedText(input.objective.title, 'objective.title');
  boundedText(input.objective.desiredOutcome, 'objective.desiredOutcome');
  authority(input.objective.maximumAuthority, 'objective.maximumAuthority');
  costLimit(input.objective.costLimit, 'objective.costLimit');
  denseStrings(input.objective.acceptanceCriteria, 'objective.acceptanceCriteria');
  denseStrings(input.objective.verificationCriteria, 'objective.verificationCriteria');
  denseStrings(input.objective.stopConditions, 'objective.stopConditions');
  if (!Array.isArray(input.projects) || input.projects.length === 0 || input.projects.length > 64) {
    throw new DurableTaskRunPolicyError('Plan must contain between 1 and 64 projects');
  }
  const projectIds = new Set<string>();
  for (const project of input.projects) {
    plainRecord(project, 'project');
    exactKeys(project, ['id', 'title'], 'project');
    safeReference(project.id, 'project.id');
    boundedText(project.title, 'project.title');
    if (projectIds.has(project.id))
      throw new DurableTaskRunPolicyError('Project IDs must be unique');
    projectIds.add(project.id);
  }
  if (!Array.isArray(input.tasks) || input.tasks.length === 0 || input.tasks.length > 256) {
    throw new DurableTaskRunPolicyError('Plan must contain between 1 and 256 tasks');
  }
  const taskIds = new Set<string>();
  let totalCostMinorUnits = 0;
  let totalComputeUnits = 0;
  for (const task of input.tasks) {
    validateTask(task, projectIds);
    if (taskIds.has(task.id)) throw new DurableTaskRunPolicyError('Task IDs must be unique');
    taskIds.add(task.id);
    if (task.requiredAuthority > input.objective.maximumAuthority) {
      throw new DurableTaskRunPolicyError('Task authority exceeds the objective maximum');
    }
    if (
      task.costLimit.currency !== input.objective.costLimit.currency ||
      task.costLimit.maximumMinorUnits > input.objective.costLimit.maximumMinorUnits ||
      task.costLimit.maximumComputeUnits > input.objective.costLimit.maximumComputeUnits
    ) {
      throw new DurableTaskRunPolicyError(
        'Task budget exceeds or conflicts with the objective budget',
      );
    }
    totalCostMinorUnits += task.costLimit.maximumMinorUnits;
    totalComputeUnits += task.costLimit.maximumComputeUnits;
    if (
      !Number.isSafeInteger(totalCostMinorUnits) ||
      !Number.isSafeInteger(totalComputeUnits) ||
      totalCostMinorUnits > input.objective.costLimit.maximumMinorUnits ||
      totalComputeUnits > input.objective.costLimit.maximumComputeUnits
    ) {
      throw new DurableTaskRunPolicyError('Aggregate task budgets exceed the objective budget');
    }
  }
  assertAcyclic(input.tasks);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}

export function buildDurableTaskPolicySnapshot(
  input: DurableObjectivePlanInput,
  task: DurableTaskPlanInput,
): DurableTaskPolicySnapshot {
  validateDurableObjectivePlan(input);
  if (!input.tasks.includes(task))
    throw new DurableTaskRunPolicyError('Task is not part of the validated plan');
  return deepFreeze({
    schemaVersion: 1,
    policyVersion: input.policyVersion,
    objectiveId: input.objective.id,
    taskId: task.id,
    projectId: task.projectId,
    title: task.title,
    kind: task.kind,
    dependencyIds: [...task.dependencyIds].sort(),
    requiredAuthority: task.requiredAuthority,
    costLimit: { ...task.costLimit },
    estimatedDurationMs: task.estimatedDurationMs,
    acceptanceCriteria: [...task.acceptanceCriteria],
    verificationCriteria: [...task.verificationCriteria],
    stopConditions: [...task.stopConditions],
    retryPolicy: {
      ...task.retryPolicy,
      retryableFailureCodes: [...task.retryPolicy.retryableFailureCodes],
      stopAfterFailureCodes: [...task.retryPolicy.stopAfterFailureCodes],
    },
    agentPolicy: canonical(task.agentPolicy) as Readonly<Record<string, unknown>>,
    routingPolicy: canonical(task.routingPolicy) as Readonly<Record<string, unknown>>,
    ...(task.approval ? { approval: { ...task.approval } } : {}),
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function hashDurablePolicy(value: DurableTaskPolicySnapshot): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function hashDurablePlanPolicy(
  input: DurableObjectivePlanInput,
  taskHashes: readonly string[],
): string {
  validateDurableObjectivePlan(input);
  if (taskHashes.length !== input.tasks.length || taskHashes.some((hash) => !SHA256.test(hash))) {
    throw new DurableTaskRunPolicyError('Plan task hashes must exactly cover the validated tasks');
  }
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          schemaVersion: 1,
          workspaceId: input.workspaceId,
          policyVersion: input.policyVersion,
          objective: input.objective,
          projects: input.projects,
          taskHashes,
        }),
      ),
    )
    .digest('hex');
}

export const DURABLE_TASK_TRANSITIONS: Readonly<
  Record<DurableTaskStatus, readonly DurableTaskStatus[]>
> = {
  BLOCKED: ['READY', 'AWAITING_APPROVAL', 'STOPPED'],
  READY: ['ASSIGNED', 'STOPPED'],
  AWAITING_APPROVAL: ['STOPPED'],
  ASSIGNED: ['READY', 'RUNNING', 'FAILED', 'STOPPED'],
  RUNNING: ['READY', 'COMPLETED', 'FAILED', 'STOPPED'],
  COMPLETED: [],
  FAILED: [],
  STOPPED: [],
};

export const DURABLE_RUN_TRANSITIONS: Readonly<
  Record<DurableRunStatus, readonly DurableRunStatus[]>
> = {
  PREPARED: ['ASSIGNED', 'STOPPED'],
  AWAITING_APPROVAL: ['STOPPED'],
  ASSIGNED: ['RUNNING', 'FAILED', 'STOPPED'],
  RUNNING: ['COMPLETED', 'FAILED', 'STOPPED'],
  COMPLETED: [],
  FAILED: [],
  STOPPED: [],
};
