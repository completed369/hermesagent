export type EntityId = string;

export interface WorkspaceContext {
  workspaceId: EntityId;
  principalId: EntityId;
}

export type RuntimeConnectionStatus =
  'CONNECTED' | 'PARTIAL' | 'DEGRADED' | 'DISCONNECTED' | 'NOT_CONFIGURED';
export type AuthorityLevel = 0 | 1 | 2 | 3 | 4;

export interface Runtime {
  id: EntityId;
  workspaceId: EntityId;
  name: string;
  adapterKind: string;
  createdAt: string;
}

export interface RegistrationProof {
  connectionId: EntityId;
  runtimeId: EntityId;
  principalId: EntityId;
  observedAt: string;
}

export interface CapabilityExchangeProof {
  connectionId: EntityId;
  runtimeId: EntityId;
  principalId: EntityId;
  capabilityIds: readonly EntityId[];
  observedAt: string;
}

export interface HeartbeatProof {
  connectionId: EntityId;
  principalId: EntityId;
  heartbeatId: EntityId;
  observedAt: string;
}

export interface TaskRoundTripProof {
  connectionId: EntityId;
  principalId: EntityId;
  taskId: EntityId;
  runId: EntityId;
  resultEventId: EntityId;
  completedAt: string;
}

export interface RuntimeConnection {
  id: EntityId;
  workspaceId: EntityId;
  runtimeId: EntityId;
  status: RuntimeConnectionStatus;
  credentialReference?: string;
  authenticatedPrincipalId?: EntityId;
  registrationProof?: RegistrationProof;
  capabilityExchangeProof?: CapabilityExchangeProof;
  heartbeatProof?: HeartbeatProof;
  taskRoundTripProof?: TaskRoundTripProof;
}

export interface Capability {
  id: EntityId;
  workspaceId: EntityId;
  name: string;
  version: string;
}

export interface AgentCapability {
  id: EntityId;
  workspaceId: EntityId;
  agentId: EntityId;
  capabilityId: EntityId;
}

export interface Agent {
  id: EntityId;
  workspaceId: EntityId;
  runtimeId: EntityId;
  name: string;
  role: string;
  authorityLevel: AuthorityLevel;
  maxConcurrentRuns: number;
  createdAt: string;
}

export interface Tool {
  id: EntityId;
  workspaceId: EntityId;
  name: string;
  version: string;
}

export interface ToolGrant {
  id: EntityId;
  workspaceId: EntityId;
  agentId: EntityId;
  toolId: EntityId;
  scopes: readonly string[];
  expiresAt?: string;
}

export interface CostLimit {
  currency: string;
  maximumMinorUnits: number;
  maximumComputeUnits: number;
}

export type TaskKind =
  'repository.review' | 'quality.verify' | 'documentation.prepare' | 'runtime.health.check';

export interface AuthorityGrant {
  id: EntityId;
  workspaceId: EntityId;
  agentId: EntityId;
  level: AuthorityLevel;
  actionClasses: readonly TaskKind[];
  costLimit: CostLimit;
  maxConcurrentRuns: number;
  expiresAt?: string;
}

export type TaskStatus = 'READY' | 'RUNNING' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface ControlPlaneTask {
  id: EntityId;
  workspaceId: EntityId;
  assignedAgentId: EntityId;
  kind: TaskKind;
  input: Readonly<Record<string, unknown>>;
  requiredCapabilityIds: readonly EntityId[];
  requiredToolIds: readonly EntityId[];
  requiredAuthorityLevel: AuthorityLevel;
  costLimit: CostLimit;
  status: TaskStatus;
  createdAt: string;
}

export interface TaskDependency {
  id: EntityId;
  workspaceId: EntityId;
  taskId: EntityId;
  dependsOnTaskId: EntityId;
}

export type RunStatus = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface AgentRun {
  id: EntityId;
  workspaceId: EntityId;
  taskId: EntityId;
  agentId: EntityId;
  runtimeConnectionId: EntityId;
  status: RunStatus;
  externalRunId?: string;
  adapterRegistrationId?: EntityId;
  startedAt?: string;
  completedAt?: string;
}

export interface ControlPlaneEvent {
  id: EntityId;
  workspaceId: EntityId;
  runId?: EntityId;
  type: string;
  occurredAt: string;
  actorId: EntityId;
  idempotencyKey: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface Artifact {
  id: EntityId;
  workspaceId: EntityId;
  runId: EntityId;
  kind: string;
  uri: string;
  contentHash: string;
  createdAt: string;
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'HELD' | 'EXPIRED';

export interface Approval {
  id: EntityId;
  workspaceId: EntityId;
  taskId: EntityId;
  requestedByAgentId: EntityId;
  requestedAuthorityLevel: AuthorityLevel;
  exactTarget: string;
  reason: string;
  status: ApprovalStatus;
  expiresAt: string;
}

export interface Heartbeat {
  id: EntityId;
  workspaceId: EntityId;
  runtimeConnectionId: EntityId;
  principalId: EntityId;
  observedAt: string;
  sequence: number;
  health: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
}

export interface UsageRecord {
  id: EntityId;
  workspaceId: EntityId;
  runId: EntityId;
  taskId: EntityId;
  provider?: string;
  model?: string;
  computeUnits?: number;
  costMinorUnits?: number;
  currency?: string;
  recordedAt: string;
}

export interface RuntimeTaskEnvelope {
  readonly runId: EntityId;
  readonly taskId: EntityId;
  readonly workspaceId: EntityId;
  readonly kind: TaskKind;
  readonly input: Readonly<Record<string, unknown>>;
  readonly capabilityIds: readonly EntityId[];
  readonly tools: readonly { readonly toolId: EntityId; readonly scopes: readonly string[] }[];
  readonly authorityLevel: AuthorityLevel;
  readonly costLimit: Readonly<CostLimit>;
}

interface RuntimeDispatchFields {
  readonly dispatchId: EntityId;
  readonly connectionId: EntityId;
  readonly adapterRegistrationId: EntityId;
  readonly runtimePrincipalId: EntityId;
  readonly envelope: RuntimeTaskEnvelope;
}

declare const runtimeDispatchPermitBrand: unique symbol;
export interface RuntimeDispatchPermit extends RuntimeDispatchFields {
  readonly [runtimeDispatchPermitBrand]: true;
}

declare const validatedDispatchBrand: unique symbol;
export interface ValidatedRuntimeDispatch extends RuntimeDispatchFields {
  readonly [validatedDispatchBrand]: true;
}

interface RuntimeCancellationFields {
  readonly cancellationId: EntityId;
  readonly connectionId: EntityId;
  readonly adapterRegistrationId: EntityId;
  readonly runtimePrincipalId: EntityId;
  readonly runId: EntityId;
  readonly externalRunId: string;
}

declare const runtimeCancellationPermitBrand: unique symbol;
export interface RuntimeCancellationPermit extends RuntimeCancellationFields {
  readonly [runtimeCancellationPermitBrand]: true;
}

declare const validatedCancellationBrand: unique symbol;
export interface ValidatedRuntimeCancellation extends RuntimeCancellationFields {
  readonly [validatedCancellationBrand]: true;
}

export interface RuntimeAdapter {
  readonly adapterKind: string;
  discoverCapabilities(context: WorkspaceContext): Promise<readonly string[]>;
  health(
    context: WorkspaceContext,
    connectionId: EntityId,
  ): Promise<'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'>;
  start(
    context: WorkspaceContext,
    dispatch: ValidatedRuntimeDispatch,
  ): Promise<{ externalRunId: string }>;
  cancel(context: WorkspaceContext, cancellation: ValidatedRuntimeCancellation): Promise<void>;
}
