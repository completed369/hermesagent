import { createHash } from 'node:crypto';
import type { AuthorityLevel, EntityId, WorkspaceContext } from './contracts';

export type AgentRetention = 'DELETE_ON_COMPLETION' | 'ARCHIVE';
export type AgentLifecycle = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ARCHIVED' | 'DELETED';

export interface AgentFactoryLimits {
  maxAgents: number;
  maxAgentsPerWorkspace: number;
  maxChildrenPerAgent: number;
  maxNestingDepth: number;
  maxConcurrentAgents: number;
  maxRuntimeMs: number;
  maxRetries: number;
  maxBudgetMinorUnits: number;
  maxComputeUnits: number;
}
export interface AgentTemplate {
  id: EntityId;
  version: number;
  workspaceId: EntityId;
  role: string;
  department: string;
  repositoryScopes: readonly string[];
  environmentScopes: readonly string[];
  dataScopes: readonly string[];
  capabilityIds: readonly EntityId[];
  toolGrants: readonly { toolId: EntityId; scopes: readonly string[] }[];
  maximumAuthority: AuthorityLevel;
  maximumRuntimeMs: number;
  maximumRetries: number;
  maximumChildren: number;
  maximumBudgetMinorUnits: number;
  maximumComputeUnits: number;
  retention: AgentRetention;
}
export interface AgentInstantiationRequest {
  id: EntityId;
  workspaceId: EntityId;
  templateId: EntityId;
  templateVersion: number;
  objectiveId: EntityId;
  taskId: EntityId;
  parentAgentId?: EntityId;
  repositoryScopes: readonly string[];
  environmentScopes: readonly string[];
  dataScopes: readonly string[];
  capabilityIds: readonly EntityId[];
  toolGrants: readonly { toolId: EntityId; scopes: readonly string[] }[];
  authorityLevel: AuthorityLevel;
  budgetMinorUnits: number;
  computeUnits: number;
  maxRuntimeMs: number;
  retryLimit: number;
  childLimit: number;
  acceptanceCriteria: readonly string[];
  verificationCriteria: readonly string[];
  stopCondition: string;
  retention: AgentRetention;
}
export interface FactoryAgent extends AgentInstantiationRequest {
  agentId: EntityId;
  role: string;
  department: string;
  nestingDepth: number;
  lifecycle: AgentLifecycle;
  createdAt: string;
  archivedAt?: string;
  terminalOutcome?: 'COMPLETED' | 'FAILED';
  terminalReason?: string;
  completedAt?: string;
}
export interface AgentFactoryDecision {
  requestId: EntityId;
  workspaceId: EntityId;
  agentId: EntityId;
  templateId: EntityId;
  decidedAt: string;
  requesterId: EntityId;
  checks: readonly string[];
  templateVersion: number;
  templateSnapshot: AgentTemplate;
  templateHash: string;
}
export interface AgentFactoryEvent {
  id: string;
  workspaceId: string;
  agentId: string;
  type: 'agent.created' | 'agent.completed' | 'agent.failed' | 'agent.archived' | 'agent.deleted';
  occurredAt: string;
  reason?: string;
}
export class AgentFactoryPolicyError extends Error {}

function text(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > 2048 ||
    /\p{Cc}/u.test(value)
  )
    throw new AgentFactoryPolicyError(`${field} must be a bounded string`);
}
const integer = (value: number, field: string, max: number): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw new AgentFactoryPolicyError(`${field} is outside policy bounds`);
};
function dense(value: unknown, field: string, max = 64): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max || Object.keys(value).length !== value.length)
    throw new AgentFactoryPolicyError(`${field} must be a dense bounded array`);
}
const key = (workspaceId: string, id: string) => JSON.stringify([workspaceId, id]);

export class DynamicAgentFactory {
  readonly #authorizers: Set<EntityId>;
  readonly #cooPrincipals: Set<EntityId>;
  readonly #limits: AgentFactoryLimits;
  readonly #clock: () => number;
  readonly #templates = new Map<string, AgentTemplate>();
  readonly #agents = new Map<string, FactoryAgent>();
  readonly #consumedRequests = new Set<string>();
  readonly #objectives = new Set<string>();
  readonly #tasks = new Map<string, string>();
  readonly #decisions: AgentFactoryDecision[] = [];
  readonly #events: AgentFactoryEvent[] = [];

  constructor(options: {
    authorityPrincipals: readonly EntityId[];
    aiCooPrincipals?: readonly EntityId[];
    limits: AgentFactoryLimits;
    clock?: () => number;
  }) {
    this.#authorizers = new Set(options.authorityPrincipals);
    this.#cooPrincipals = new Set(options.aiCooPrincipals ?? []);
    this.#limits = structuredClone(options.limits);
    this.#clock = options.clock ?? Date.now;
    const requiredLimitKeys = [
      'maxAgents',
      'maxAgentsPerWorkspace',
      'maxChildrenPerAgent',
      'maxNestingDepth',
      'maxConcurrentAgents',
      'maxRuntimeMs',
      'maxRetries',
      'maxBudgetMinorUnits',
      'maxComputeUnits',
    ] as const;
    const actualLimitKeys = Object.keys(this.#limits).sort();
    if (
      actualLimitKeys.length !== requiredLimitKeys.length ||
      [...requiredLimitKeys].sort().some((name, index) => actualLimitKeys[index] !== name)
    )
      throw new AgentFactoryPolicyError('Limits must contain exactly the governed keys');
    for (const name of requiredLimitKeys)
      integer(this.#limits[name], name, Number.MAX_SAFE_INTEGER);
    if (this.#limits.maxAgentsPerWorkspace > this.#limits.maxAgents)
      throw new AgentFactoryPolicyError('Workspace limit exceeds global limit');
  }
  registerObjective(context: WorkspaceContext, id: EntityId): void {
    this.#assertAuthorizer(context);
    text(id, 'objectiveId');
    this.#objectives.add(key(context.workspaceId, id));
  }
  registerTask(context: WorkspaceContext, id: EntityId, objectiveId: EntityId): void {
    this.#assertAuthorizer(context);
    text(id, 'taskId');
    text(objectiveId, 'objectiveId');
    if (!this.#objectives.has(key(context.workspaceId, objectiveId)))
      throw new AgentFactoryPolicyError('Task objective is not registered');
    this.#tasks.set(key(context.workspaceId, id), objectiveId);
  }
  putTemplate(context: WorkspaceContext, template: AgentTemplate): void {
    this.#assertAuthorizer(context);
    this.#assertWorkspace(context, template.workspaceId);
    this.#validateTemplate(template);
    const templateKey = key(template.workspaceId, `${template.id}@${template.version}`);
    if (this.#templates.has(templateKey))
      throw new AgentFactoryPolicyError('Template versions are immutable');
    if (
      template.version > 1 &&
      !this.#templates.has(key(template.workspaceId, `${template.id}@${template.version - 1}`))
    )
      throw new AgentFactoryPolicyError('Template successor must follow an existing version');
    this.#templates.set(templateKey, structuredClone(template));
  }
  instantiate(
    context: WorkspaceContext,
    request: AgentInstantiationRequest,
  ): { agent: FactoryAgent; decision: AgentFactoryDecision } {
    this.#assertRequester(context);
    this.#assertWorkspace(context, request.workspaceId);
    this.#validateRequest(request);
    const template = this.#templates.get(
      key(request.workspaceId, `${request.templateId}@${request.templateVersion}`),
    );
    if (!template) throw new AgentFactoryPolicyError('Template does not exist in workspace');
    if (
      !this.#objectives.has(key(request.workspaceId, request.objectiveId)) ||
      this.#tasks.get(key(request.workspaceId, request.taskId)) !== request.objectiveId
    )
      throw new AgentFactoryPolicyError('Parent objective/task linkage is not registered');
    const active = [...this.#agents.values()].filter((a) => a.lifecycle === 'ACTIVE');
    if (
      active.length >= this.#limits.maxAgents ||
      active.length >= this.#limits.maxConcurrentAgents
    )
      throw new AgentFactoryPolicyError('Global agent limit reached');
    if (
      active.filter((a) => a.workspaceId === request.workspaceId).length >=
      this.#limits.maxAgentsPerWorkspace
    )
      throw new AgentFactoryPolicyError('Workspace agent limit reached');
    let depth = 0;
    if (request.parentAgentId !== undefined) {
      const parent = this.#agents.get(key(request.workspaceId, request.parentAgentId));
      if (!parent || parent.lifecycle !== 'ACTIVE')
        throw new AgentFactoryPolicyError('Parent agent is missing or inactive');
      depth = parent.nestingDepth + 1;
      if (parent.agentId === `agent:${request.id}`)
        throw new AgentFactoryPolicyError('Agent parent cycle denied');
      const children = [...this.#agents.values()].filter(
        (a) =>
          a.parentAgentId === parent.agentId &&
          a.workspaceId === request.workspaceId &&
          a.lifecycle === 'ACTIVE',
      ).length;
      if (children >= Math.min(parent.childLimit, this.#limits.maxChildrenPerAgent))
        throw new AgentFactoryPolicyError('Parent child limit reached');
      if (parent.objectiveId !== request.objectiveId || parent.taskId !== request.taskId)
        throw new AgentFactoryPolicyError('Child lineage must match parent objective and task');
      this.#assertSubset(request.repositoryScopes, parent.repositoryScopes, 'repository scope');
      this.#assertSubset(request.environmentScopes, parent.environmentScopes, 'environment scope');
      this.#assertSubset(request.dataScopes, parent.dataScopes, 'data scope');
      this.#assertSubset(request.capabilityIds, parent.capabilityIds, 'parent capability');
      for (const grant of request.toolGrants) {
        const parentGrant = parent.toolGrants.find((item) => item.toolId === grant.toolId);
        if (!parentGrant) throw new AgentFactoryPolicyError('Child tool exceeds parent grants');
        this.#assertSubset(grant.scopes, parentGrant.scopes, 'parent tool scope');
      }
      if (
        request.authorityLevel > parent.authorityLevel ||
        request.budgetMinorUnits > parent.budgetMinorUnits ||
        request.computeUnits > parent.computeUnits ||
        request.maxRuntimeMs > parent.maxRuntimeMs ||
        request.retryLimit > parent.retryLimit ||
        request.childLimit > parent.childLimit
      )
        throw new AgentFactoryPolicyError('Child exceeds parent ceilings');
    }
    if (depth > this.#limits.maxNestingDepth)
      throw new AgentFactoryPolicyError('Nesting depth exceeded');
    this.#assertSubset(request.capabilityIds, template.capabilityIds, 'capability');
    this.#assertSubset(request.repositoryScopes, template.repositoryScopes, 'repository scope');
    this.#assertSubset(request.environmentScopes, template.environmentScopes, 'environment scope');
    this.#assertSubset(request.dataScopes, template.dataScopes, 'data scope');
    for (const grant of request.toolGrants) {
      const allowed = template.toolGrants.find((item) => item.toolId === grant.toolId);
      if (!allowed) throw new AgentFactoryPolicyError('Tool is not granted by template');
      this.#assertSubset(grant.scopes, allowed.scopes, 'tool scope');
    }
    if (request.authorityLevel > template.maximumAuthority || request.authorityLevel > 3)
      throw new AgentFactoryPolicyError('Excess authority denied');
    const ceilings = [
      [
        request.budgetMinorUnits,
        template.maximumBudgetMinorUnits,
        this.#limits.maxBudgetMinorUnits,
        'budget',
      ],
      [request.computeUnits, template.maximumComputeUnits, this.#limits.maxComputeUnits, 'compute'],
      [request.maxRuntimeMs, template.maximumRuntimeMs, this.#limits.maxRuntimeMs, 'runtime'],
      [request.retryLimit, template.maximumRetries, this.#limits.maxRetries, 'retry'],
      [request.childLimit, template.maximumChildren, this.#limits.maxChildrenPerAgent, 'child'],
    ] as const;
    for (const [value, templateMax, globalMax, label] of ceilings)
      if (value > templateMax || value > globalMax)
        throw new AgentFactoryPolicyError(`${label} limit exceeded`);
    if (request.retention !== template.retention)
      throw new AgentFactoryPolicyError('Retention exceeds template policy');
    const agentId = `agent:${request.id}`;
    const requestKey = key(request.workspaceId, request.id);
    if (this.#consumedRequests.has(requestKey))
      throw new AgentFactoryPolicyError('Instantiation request already consumed');
    const createdAt = new Date(this.#clock()).toISOString();
    const agent: FactoryAgent = {
      ...structuredClone(request),
      agentId,
      role: template.role,
      department: template.department,
      nestingDepth: depth,
      lifecycle: 'ACTIVE',
      createdAt,
    };
    const decision: AgentFactoryDecision = {
      requestId: request.id,
      workspaceId: request.workspaceId,
      agentId,
      templateId: template.id,
      decidedAt: createdAt,
      requesterId: context.principalId,
      templateVersion: template.version,
      templateSnapshot: structuredClone(template),
      templateHash: createHash('sha256').update(JSON.stringify(template)).digest('hex'),
      checks: [
        'workspace',
        'linkage',
        'template-grants',
        'authority',
        'budget',
        'runtime',
        'retry',
        'child',
        'nesting',
        'concurrency',
        'retention',
      ],
    };
    this.#agents.set(key(request.workspaceId, agentId), agent);
    this.#consumedRequests.add(requestKey);
    this.#decisions.push(decision);
    this.#events.push({
      id: `event:${request.id}:created`,
      workspaceId: request.workspaceId,
      agentId,
      type: 'agent.created',
      occurredAt: createdAt,
    });
    return { agent: structuredClone(agent), decision: structuredClone(decision) };
  }
  complete(
    context: WorkspaceContext,
    agentId: EntityId,
    outcome: 'COMPLETED' | 'FAILED',
    reason = outcome,
  ): void {
    this.#assertAuthorizer(context);
    if (outcome !== 'COMPLETED' && outcome !== 'FAILED')
      throw new AgentFactoryPolicyError('Invalid terminal outcome');
    const stored = this.#agents.get(key(context.workspaceId, agentId));
    if (!stored || stored.lifecycle !== 'ACTIVE')
      throw new AgentFactoryPolicyError('Active agent not found');
    const activeChild = [...this.#agents.values()].some(
      (a) =>
        a.workspaceId === context.workspaceId &&
        a.parentAgentId === agentId &&
        a.lifecycle === 'ACTIVE',
    );
    if (activeChild)
      throw new AgentFactoryPolicyError('Cannot finalize agent with active children');
    text(reason, 'terminal reason');
    const at = new Date(this.#clock()).toISOString();
    stored.terminalOutcome = outcome;
    stored.terminalReason = reason;
    stored.completedAt = at;
    this.#events.push({
      id: `event:${agentId}:${outcome.toLowerCase()}`,
      workspaceId: context.workspaceId,
      agentId,
      type: outcome === 'COMPLETED' ? 'agent.completed' : 'agent.failed',
      occurredAt: at,
      reason,
    });
    stored.lifecycle = stored.retention === 'ARCHIVE' ? 'ARCHIVED' : 'DELETED';
    stored.archivedAt = at;
    this.#events.push({
      id: `event:${agentId}:${stored.lifecycle.toLowerCase()}`,
      workspaceId: context.workspaceId,
      agentId,
      type: stored.lifecycle === 'ARCHIVED' ? 'agent.archived' : 'agent.deleted',
      occurredAt: at,
    });
    if (stored.lifecycle === 'DELETED') this.#agents.delete(key(context.workspaceId, agentId));
  }
  listAgents(context: WorkspaceContext): readonly FactoryAgent[] {
    return [...this.#agents.values()]
      .filter((a) => a.workspaceId === context.workspaceId && a.lifecycle !== 'DELETED')
      .map((a) => structuredClone(a));
  }
  listDecisions(context: WorkspaceContext): readonly AgentFactoryDecision[] {
    return this.#decisions
      .filter((d) => d.workspaceId === context.workspaceId)
      .map((d) => structuredClone(d));
  }
  listEvents(context: WorkspaceContext): readonly AgentFactoryEvent[] {
    return this.#events
      .filter((e) => e.workspaceId === context.workspaceId)
      .map((e) => structuredClone(e));
  }
  #assertAuthorizer(context: WorkspaceContext) {
    if (!this.#authorizers.has(context.principalId))
      throw new AgentFactoryPolicyError('Authorizer required');
  }
  #assertRequester(context: WorkspaceContext) {
    if (
      !this.#authorizers.has(context.principalId) &&
      !this.#cooPrincipals.has(context.principalId)
    )
      throw new AgentFactoryPolicyError('Authorizer or AI COO required');
  }
  #assertWorkspace(context: WorkspaceContext, workspaceId: string) {
    if (context.workspaceId !== workspaceId)
      throw new AgentFactoryPolicyError('Cross-workspace operation denied');
  }
  #assertSubset(values: readonly string[], allowed: readonly string[], label: string) {
    for (const value of values)
      if (!allowed.includes(value))
        throw new AgentFactoryPolicyError(`${label} exceeds template grant`);
  }
  #validateTemplate(t: AgentTemplate) {
    text(t.id, 'template.id');
    text(t.workspaceId, 'workspaceId');
    text(t.role, 'role');
    text(t.department, 'department');
    integer(t.version, 'version', Number.MAX_SAFE_INTEGER);
    if (t.version < 1) throw new AgentFactoryPolicyError('Template version must be positive');
    dense(t.repositoryScopes, 'repository scopes');
    dense(t.environmentScopes, 'environment scopes');
    dense(t.dataScopes, 'data scopes');
    dense(t.capabilityIds, 'capabilities');
    dense(t.toolGrants, 'tools');
    for (const values of [t.repositoryScopes, t.environmentScopes, t.dataScopes, t.capabilityIds])
      for (const value of values) text(value, 'template scoped value');
    for (const grant of t.toolGrants) {
      if (typeof grant !== 'object' || grant === null || Array.isArray(grant))
        throw new AgentFactoryPolicyError('Template tool grant must be an object');
      text(grant.toolId, 'template toolId');
      dense(grant.scopes, 'template tool scopes');
      for (const scope of grant.scopes) text(scope, 'template tool scope');
    }
    if (t.retention !== 'ARCHIVE' && t.retention !== 'DELETE_ON_COMPLETION')
      throw new AgentFactoryPolicyError('Invalid template retention');
    integer(t.maximumAuthority, 'authority', 4);
    integer(t.maximumRuntimeMs, 'runtime', this.#limits.maxRuntimeMs);
    integer(t.maximumRetries, 'retry', this.#limits.maxRetries);
    integer(t.maximumChildren, 'children', this.#limits.maxChildrenPerAgent);
    integer(t.maximumBudgetMinorUnits, 'budget', this.#limits.maxBudgetMinorUnits);
    integer(t.maximumComputeUnits, 'compute', this.#limits.maxComputeUnits);
  }
  #validateRequest(r: AgentInstantiationRequest) {
    if (r.parentAgentId !== undefined) text(r.parentAgentId, 'parentAgentId');
    for (const [v, n] of [
      [r.id, 'id'],
      [r.workspaceId, 'workspace'],
      [r.templateId, 'template'],
      [r.objectiveId, 'objective'],
      [r.taskId, 'task'],
      [r.stopCondition, 'stop'],
    ] as const)
      text(v, n);
    for (const [v, n] of [
      [r.repositoryScopes, 'repo'],
      [r.environmentScopes, 'environment'],
      [r.dataScopes, 'data'],
      [r.capabilityIds, 'capabilities'],
      [r.toolGrants, 'tools'],
      [r.acceptanceCriteria, 'acceptance'],
      [r.verificationCriteria, 'verification'],
    ] as const)
      dense(v, n);
    for (const values of [
      r.repositoryScopes,
      r.environmentScopes,
      r.dataScopes,
      r.capabilityIds,
      r.acceptanceCriteria,
      r.verificationCriteria,
    ])
      for (const value of values) text(value, 'scoped value');
    if (
      !r.repositoryScopes.length ||
      !r.environmentScopes.length ||
      !r.dataScopes.length ||
      !r.acceptanceCriteria.length ||
      !r.verificationCriteria.length
    )
      throw new AgentFactoryPolicyError('Scoped criteria are required');
    for (const g of r.toolGrants) {
      if (typeof g !== 'object' || g === null || Array.isArray(g))
        throw new AgentFactoryPolicyError('Tool grant must be an object');
      dense(g.scopes, 'tool scopes');
      text(g.toolId, 'toolId');
      for (const scope of g.scopes) text(scope, 'tool scope');
    }
    integer(r.templateVersion, 'templateVersion', Number.MAX_SAFE_INTEGER);
    if (r.templateVersion < 1)
      throw new AgentFactoryPolicyError('Template version must be positive');
    if (r.retention !== 'ARCHIVE' && r.retention !== 'DELETE_ON_COMPLETION')
      throw new AgentFactoryPolicyError('Invalid retention');
    integer(r.authorityLevel, 'authority', 4);
    integer(r.budgetMinorUnits, 'budget', Number.MAX_SAFE_INTEGER);
    integer(r.computeUnits, 'compute', Number.MAX_SAFE_INTEGER);
    integer(r.maxRuntimeMs, 'runtime', Number.MAX_SAFE_INTEGER);
    integer(r.retryLimit, 'retry', Number.MAX_SAFE_INTEGER);
    integer(r.childLimit, 'children', Number.MAX_SAFE_INTEGER);
  }
}
