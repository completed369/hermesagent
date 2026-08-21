import { describe, expect, it } from 'vitest';
import {
  DynamicAgentFactory,
  AgentFactoryPolicyError,
  InMemoryOperationalEventLog,
  OperationalEventCapability,
  type AgentInstantiationRequest,
  type AgentTemplate,
  type OperationalEventSink,
} from '../index';
const ctx = { workspaceId: 'w1', principalId: 'founder' },
  coo = { workspaceId: 'w1', principalId: 'coo' };
const limits = {
  maxAgents: 5,
  maxAgentsPerWorkspace: 4,
  maxChildrenPerAgent: 2,
  maxNestingDepth: 1,
  maxConcurrentAgents: 3,
  maxRuntimeMs: 1000,
  maxRetries: 2,
  maxBudgetMinorUnits: 100,
  maxComputeUnits: 100,
};
const template: AgentTemplate = {
  id: 't1',
  version: 1,
  workspaceId: 'w1',
  role: 'Reviewer',
  department: 'Engineering',
  repositoryScopes: ['repo'],
  environmentScopes: ['staging'],
  dataScopes: ['internal'],
  capabilityIds: ['review'],
  toolGrants: [{ toolId: 'git', scopes: ['read'] }],
  maximumAuthority: 2,
  maximumRuntimeMs: 1000,
  maximumRetries: 2,
  maximumChildren: 2,
  maximumBudgetMinorUnits: 100,
  maximumComputeUnits: 100,
  retention: 'ARCHIVE',
};
const request = (
  id = 'r1',
  over: Partial<AgentInstantiationRequest> = {},
): AgentInstantiationRequest => ({
  id,
  workspaceId: 'w1',
  templateId: 't1',
  templateVersion: 1,
  objectiveId: 'o1',
  taskId: 'task1',
  repositoryScopes: ['repo'],
  environmentScopes: ['staging'],
  dataScopes: ['internal'],
  capabilityIds: ['review'],
  toolGrants: [{ toolId: 'git', scopes: ['read'] }],
  authorityLevel: 2,
  budgetMinorUnits: 50,
  computeUnits: 50,
  maxRuntimeMs: 500,
  retryLimit: 1,
  childLimit: 1,
  acceptanceCriteria: ['done'],
  verificationCriteria: ['tests'],
  stopCondition: 'criteria met',
  retention: 'ARCHIVE',
  ...over,
});
function factory(eventSink?: OperationalEventSink) {
  const f = new DynamicAgentFactory({
    authorityPrincipals: ['founder'],
    aiCooPrincipals: ['coo'],
    limits,
    clock: () => 1,
    ...(eventSink
      ? {
          eventSink,
          eventCapability: OperationalEventCapability.issue('AGENT_FACTORY', [
            { workspaceId: 'w1', principalId: 'founder', actorKind: 'HUMAN' },
            { workspaceId: 'w1', principalId: 'coo', actorKind: 'AGENT' },
          ]),
        }
      : {}),
  });
  f.putTemplate(ctx, template);
  f.registerObjective(ctx, 'o1');
  f.registerTask(ctx, 'task1', 'o1');
  return f;
}
describe('DynamicAgentFactory', () => {
  it('rejects missing or unexpected governed limits', () => {
    expect(
      () => new DynamicAgentFactory({ authorityPrincipals: ['founder'], limits: {} as never }),
    ).toThrow(/exactly/);
    expect(
      () =>
        new DynamicAgentFactory({
          authorityPrincipals: ['founder'],
          limits: { ...limits, extra: 1 } as never,
        }),
    ).toThrow(/exactly/);
  });
  it('rejects Unicode control characters in governed identifiers', () => {
    expect(() => factory().registerObjective(ctx, 'objective\u0085injected')).toThrow(
      /bounded string/,
    );
  });
  it('creates deterministic audited model records without execution', () => {
    const out = factory().instantiate(coo, request());
    expect(out.agent).toMatchObject({ agentId: 'agent:r1', lifecycle: 'ACTIVE', nestingDepth: 0 });
    expect(out.decision.checks).toContain('authority');
  });
  it('projects lifecycle facts into the unified event spine without private agent data', () => {
    const events = new InMemoryOperationalEventLog();
    const f = factory(events);
    const agent = f.instantiate(coo, request()).agent;
    f.complete(ctx, agent.agentId, 'COMPLETED', 'password=hunter2');

    expect(
      events
        .list(coo)
        .map((event) => event.type)
        .sort(),
    ).toEqual(['agent.created', 'agent.lifecycle.changed', 'agent.lifecycle.changed']);
    expect(events.list(coo).find((event) => event.facts.reasonPresent)?.facts).toEqual({
      lifecycle: 'agent.completed',
      reasonPresent: true,
    });
    expect(JSON.stringify(events.list(coo))).not.toContain('password=hunter2');
  });
  it('rejects hidden request fields and protects factory read models', () => {
    const f = factory();
    expect(() =>
      f.instantiate(coo, { ...request(), chainOfThought: 'private' } as AgentInstantiationRequest),
    ).toThrow(/unsupported fields/);
    expect(() => f.listAgents({ workspaceId: 'w1', principalId: 'viewer' })).toThrow(/AI COO/);
    expect(() => f.listDecisions({ workspaceId: 'w1', principalId: 'viewer' })).toThrow(/AI COO/);
    expect(() => f.listEvents({ workspaceId: 'w1', principalId: 'viewer' })).toThrow(/AI COO/);
  });
  it('denies unauthorized and cross-tenant requests', () => {
    const f = factory();
    expect(() => f.instantiate({ workspaceId: 'w1', principalId: 'runtime' }, request())).toThrow(
      /AI COO/,
    );
    expect(() => f.instantiate({ ...coo, workspaceId: 'w2' }, request())).toThrow(
      /Cross-workspace/,
    );
  });
  it('denies excess grants authority and budgets', () => {
    for (const bad of [
      request('a', { capabilityIds: ['admin'] }),
      request('b', { toolGrants: [{ toolId: 'git', scopes: ['write'] }] }),
      request('c', { authorityLevel: 3 }),
      request('d', { budgetMinorUnits: 101 }),
    ])
      expect(() => factory().instantiate(coo, bad)).toThrow(AgentFactoryPolicyError);
  });
  it('requires registered objective/task linkage and consumes IDs once', () => {
    const f = factory();
    f.instantiate(coo, request());
    expect(() => f.instantiate(coo, request())).toThrow(/consumed/);
    expect(() => f.instantiate(coo, request('x', { taskId: 'missing' }))).toThrow(/linkage/);
  });
  it('registers objective/task plans atomically and rejects linkage collisions', () => {
    const f = new DynamicAgentFactory({ authorityPrincipals: ['founder'], limits });
    f.registerObjective(ctx, 'existing');
    f.registerTask(ctx, 'shared-task', 'existing');
    expect(() =>
      f.registerPlan(ctx, 'new-objective', [{ id: 'shared-task', objectiveId: 'new-objective' }]),
    ).toThrow(/already exists/);
    expect(() =>
      f.registerPlan(ctx, 'new-objective', [{ id: 'new-task', objectiveId: 'new-objective' }]),
    ).not.toThrow();
    expect(() => f.registerObjective(ctx, 'new-objective')).toThrow(/already exists/);
    expect(() => f.registerTask(ctx, 'new-task', 'new-objective')).toThrow(/already exists/);
  });
  it('allows the configured AI COO to register an atomic governed plan', () => {
    const f = new DynamicAgentFactory({
      authorityPrincipals: ['founder'],
      aiCooPrincipals: ['coo'],
      limits,
    });
    expect(() =>
      f.registerPlan(coo, 'coo-objective', [{ id: 'coo-task', objectiveId: 'coo-objective' }]),
    ).not.toThrow();
  });
  it('enforces child and nesting explosion limits', () => {
    const f = factory();
    const parent = f.instantiate(coo, request()).agent;
    const child = f.instantiate(coo, request('c', { parentAgentId: parent.agentId })).agent;
    expect(() => f.instantiate(coo, request('g', { parentAgentId: child.agentId }))).toThrow(
      /Nesting/,
    );
    expect(() => f.complete(ctx, parent.agentId, 'COMPLETED')).toThrow(/active children/);
  });
  it('intersects child tool grants with the parent', () => {
    const f = factory();
    const parent = f.instantiate(coo, request('p', { toolGrants: [] })).agent;
    expect(() =>
      f.instantiate(coo, request('child-tool', { parentAgentId: parent.agentId })),
    ).toThrow(/parent grants/);
  });
  it('archives or hides temporary agents according to retention', () => {
    const f = factory();
    const a = f.instantiate(coo, request()).agent;
    expect(() => f.complete(ctx, a.agentId, 'CANCELLED' as never)).toThrow(/terminal outcome/);
    f.complete(ctx, a.agentId, 'COMPLETED');
    expect(f.listAgents(ctx)[0]?.lifecycle).toBe('ARCHIVED');
    expect(f.listAgents(ctx)[0]?.terminalOutcome).toBe('COMPLETED');
    expect(f.listEvents(ctx).map((event) => event.type)).toEqual([
      'agent.created',
      'agent.completed',
      'agent.archived',
    ]);
    const f2 = new DynamicAgentFactory({ authorityPrincipals: ['founder'], limits });
    f2.putTemplate(ctx, { ...template, retention: 'DELETE_ON_COMPLETION' });
    f2.registerObjective(ctx, 'o1');
    f2.registerTask(ctx, 'task1', 'o1');
    const b = f2.instantiate(ctx, request('d', { retention: 'DELETE_ON_COMPLETION' })).agent;
    f2.complete(ctx, b.agentId, 'FAILED');
    expect(f2.listAgents(ctx)).toEqual([]);
    expect(() => f2.instantiate(ctx, request('d', { retention: 'DELETE_ON_COMPLETION' }))).toThrow(
      /consumed/,
    );
  });
  it('fails closed on malformed nested values, enums, control characters, and version gaps', () => {
    const f = factory();
    for (const malformed of [
      request('m1', { repositoryScopes: 'repo' as unknown as readonly string[] }),
      request('m2', { acceptanceCriteria: [null] as unknown as readonly string[] }),
      request('m3', {
        toolGrants: [{ toolId: 'git', scopes: 'bread' as unknown as readonly string[] }],
      }),
      request('m4', { retention: 'FOREVER' as unknown as AgentInstantiationRequest['retention'] }),
      request('m5', { stopCondition: 'stop\u0000now' }),
      request('m6', { templateVersion: 99 }),
      request('m7', { parentAgentId: '' }),
    ])
      expect(() => f.instantiate(coo, malformed)).toThrow();
    expect(() => f.putTemplate(ctx, { ...template, version: 3 })).toThrow(/successor/);
    for (const malformed of [
      { ...template, id: 'bad-scope', repositoryScopes: ['repo', 'bad\u0000scope'] },
      { ...template, id: 'bad-cap', capabilityIds: ['review', null] as unknown as string[] },
      {
        ...template,
        id: 'bad-tool',
        toolGrants: [{ toolId: 'git', scopes: ['read', null] as unknown as string[] }],
      },
      {
        ...template,
        id: 'bad-retention',
        retention: 'INVALID' as unknown as AgentTemplate['retention'],
      },
    ])
      expect(() => f.putTemplate(ctx, malformed)).toThrow();
  });
});
