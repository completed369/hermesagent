import { describe, expect, it } from 'vitest';

import {
  NoEligibleRuntimeError,
  RuntimeBroker,
  RuntimeBrokerPolicyError,
  type RuntimeRoutingCandidate,
  type RuntimeRoutingRequest,
} from '../index';

const NOW = Date.parse('2026-08-21T00:00:00.000Z');
const context = { workspaceId: 'workspace-alpha', principalId: 'founder-alpha' };

function request(overrides: Partial<RuntimeRoutingRequest> = {}): RuntimeRoutingRequest {
  return {
    id: 'route-1',
    workspaceId: context.workspaceId,
    requiredCapabilityIds: ['capability-review'],
    requiredTools: [{ toolId: 'tool-git', scope: 'read' }],
    dataSensitivity: 'CONFIDENTIAL',
    minimumSecurityTier: 2,
    minimumReliabilityScoreBps: 8_000,
    maximumLatencyMs: 2_000,
    maximumCostMinorUnits: 500,
    requiredComputeUnits: 100,
    heartbeatFreshnessMs: 60_000,
    ...overrides,
  };
}

function candidate(
  runtimeId: string,
  overrides: Partial<RuntimeRoutingCandidate> = {},
): RuntimeRoutingCandidate {
  const principalId = `principal-${runtimeId}`;
  const connectionId = `connection-${runtimeId}`;
  const built: RuntimeRoutingCandidate = {
    runtimeId,
    connectionId,
    workspaceId: context.workspaceId,
    connectionStatus: 'CONNECTED',
    authenticatedPrincipalId: principalId,
    trustEvidence: {
      registration: { verified: true, runtimeId, principalId, connectionId },
      capabilityExchange: { verified: true, runtimeId, principalId, connectionId },
      heartbeat: {
        verified: true,
        runtimeId,
        principalId,
        connectionId,
        observedAt: '2026-08-20T23:59:30.000Z',
      },
      taskRoundTrip: { verified: true, runtimeId, principalId, connectionId },
    },
    capabilityIds: ['capability-review'],
    toolGrants: [{ toolId: 'tool-git', scopes: ['read'] }],
    maximumDataSensitivity: 'RESTRICTED',
    securityTier: 3,
    reliabilityScoreBps: 9_500,
    qualityScoreBps: 9_000,
    expectedLatencyMs: 500,
    estimatedCostMinorUnits: 100,
    activeRuns: 1,
    maxConcurrentRuns: 4,
    remainingBudgetMinorUnits: 1_000,
    remainingComputeUnits: 1_000,
    ...overrides,
  };
  if (overrides.connectionId !== undefined && overrides.trustEvidence === undefined) {
    const proofConnectionId = overrides.connectionId;
    return {
      ...built,
      trustEvidence: {
        registration: { ...built.trustEvidence.registration, connectionId: proofConnectionId },
        capabilityExchange: {
          ...built.trustEvidence.capabilityExchange,
          connectionId: proofConnectionId,
        },
        heartbeat: { ...built.trustEvidence.heartbeat, connectionId: proofConnectionId },
        taskRoundTrip: { ...built.trustEvidence.taskRoundTrip, connectionId: proofConnectionId },
      },
    };
  }
  return built;
}

function broker(...candidates: RuntimeRoutingCandidate[]): RuntimeBroker {
  const instance = new RuntimeBroker({
    clock: () => NOW,
    authorityPrincipals: [context.principalId],
  });
  for (const runtimeCandidate of candidates) {
    instance.putCandidateEvidence(context, runtimeCandidate);
  }
  return instance;
}

describe('RuntimeBroker eligibility', () => {
  it('cannot route raw self-asserted candidates or ingest them as a runtime principal', () => {
    const instance = new RuntimeBroker({
      clock: () => NOW,
      authorityPrincipals: [context.principalId],
    });
    const selfAsserted = candidate('runtime-attacker');
    expect(() =>
      instance.putCandidateEvidence(
        { workspaceId: context.workspaceId, principalId: selfAsserted.authenticatedPrincipalId },
        selfAsserted,
      ),
    ).toThrow(/authorized control-plane principal/);
    expect(() =>
      (instance.route as unknown as (...args: unknown[]) => unknown)(context, request(), [
        selfAsserted,
      ]),
    ).toThrow(NoEligibleRuntimeError);
  });

  it('rejects cross-workspace candidates without leaking them into selection', () => {
    const instance = new RuntimeBroker({
      clock: () => NOW,
      authorityPrincipals: [context.principalId],
    });
    instance.putCandidateEvidence(
      { ...context, workspaceId: 'workspace-beta' },
      candidate('runtime-beta', { workspaceId: 'workspace-beta' }),
    );
    instance.putCandidateEvidence(context, candidate('runtime-alpha'));
    const decision = instance.route(context, request());
    expect(decision.selectedRuntimeId).toBe('runtime-alpha');
    expect(JSON.stringify(decision)).not.toContain('runtime-beta');
  });

  it('requires connected correlated runtime identity and all four proofs', () => {
    const forged = candidate('runtime-forged', {
      trustEvidence: {
        ...candidate('runtime-forged').trustEvidence,
        registration: {
          verified: true,
          runtimeId: 'runtime-other',
          principalId: 'principal-runtime-forged',
          connectionId: 'connection-runtime-forged',
        },
      },
    });
    const disconnected = candidate('runtime-disconnected', { connectionStatus: 'PARTIAL' });
    const instance = broker();
    expect(() => instance.putCandidateEvidence(context, forged)).toThrow(/not identity-correlated/);
    instance.putCandidateEvidence(context, disconnected);
    expect(() => instance.route(context, request())).toThrow(NoEligibleRuntimeError);
    try {
      instance.route(context, request());
    } catch (error) {
      expect((error as NoEligibleRuntimeError).evidence.evaluations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runtimeId: 'runtime-disconnected',
            rejectionReasons: ['NOT_CONNECTED'],
          }),
        ]),
      );
    }
  });

  it('rejects proof replay from another connection of the same runtime principal', () => {
    const original = candidate('runtime-a');
    const replayed = {
      ...original,
      connectionId: 'connection-b',
    };
    expect(() => broker(replayed)).toThrow(/not identity-correlated/);
  });

  it('rejects stale and future heartbeat evidence', () => {
    for (const observedAt of ['2026-08-20T23:58:00.000Z', '2026-08-21T00:01:00.000Z']) {
      const stale = candidate('runtime-stale');
      const tampered = {
        ...stale,
        trustEvidence: {
          ...stale.trustEvidence,
          heartbeat: { ...stale.trustEvidence.heartbeat, observedAt },
        },
      };
      expect(() => broker(tampered).route(context, request())).toThrow(NoEligibleRuntimeError);
    }
  });

  it('enforces exact capability and tool scope grants', () => {
    const noCapability = candidate('runtime-no-capability', { capabilityIds: [] });
    const broadButWrongScope = candidate('runtime-wrong-scope', {
      toolGrants: [{ toolId: 'tool-git', scopes: ['write', 'admin'] }],
    });
    try {
      broker(noCapability, broadButWrongScope).route(context, request());
      throw new Error('expected route to fail');
    } catch (error) {
      const evidence = (error as NoEligibleRuntimeError).evidence.evaluations;
      expect(
        evidence.find((item) => item.runtimeId === 'runtime-no-capability')?.rejectionReasons,
      ).toContain('MISSING_CAPABILITY');
      expect(
        evidence.find((item) => item.runtimeId === 'runtime-wrong-scope')?.rejectionReasons,
      ).toContain('MISSING_TOOL_SCOPE');
    }
  });

  it('rejects non-array, sparse, null, and substring grant evidence at ingestion', () => {
    const invalidCandidates = [
      { ...candidate('runtime-string-capability'), capabilityIds: 'capability-review' },
      {
        ...candidate('runtime-string-scope'),
        toolGrants: [{ toolId: 'tool-git', scopes: 'bread' }],
      },
      { ...candidate('runtime-null-tools'), toolGrants: null },
      { ...candidate('runtime-object-tools'), toolGrants: { 0: 'tool-git', length: 1 } },
      {
        ...candidate('runtime-sparse-capabilities'),
        capabilityIds: Array(2),
      },
    ] as unknown as RuntimeRoutingCandidate[];
    for (const invalidCandidate of invalidCandidates) {
      expect(() => broker(invalidCandidate)).toThrow(/malformed/);
    }
  });

  it('enforces sensitivity, security, reliability, latency, and capacity before scoring', () => {
    const denied = candidate('runtime-denied', {
      maximumDataSensitivity: 'INTERNAL',
      securityTier: 1,
      reliabilityScoreBps: 7_999,
      expectedLatencyMs: 2_001,
      activeRuns: 4,
      maxConcurrentRuns: 4,
    });
    try {
      broker(denied).route(context, request());
      throw new Error('expected route to fail');
    } catch (error) {
      expect((error as NoEligibleRuntimeError).evidence.evaluations[0]?.rejectionReasons).toEqual([
        'DATA_SENSITIVITY_DENIED',
        'LATENCY_TOO_HIGH',
        'RELIABILITY_TOO_LOW',
        'RUNTIME_AT_CAPACITY',
        'SECURITY_TIER_TOO_LOW',
      ]);
    }
  });

  it('fails closed for task, runtime, and compute budget exhaustion', () => {
    const overBudget = candidate('runtime-over-budget', {
      estimatedCostMinorUnits: 501,
      remainingBudgetMinorUnits: 100,
      remainingComputeUnits: 99,
    });
    try {
      broker(overBudget).route(context, request());
      throw new Error('expected route to fail');
    } catch (error) {
      expect((error as NoEligibleRuntimeError).evidence.evaluations[0]?.rejectionReasons).toEqual([
        'COMPUTE_BUDGET_EXHAUSTED',
        'RUNTIME_BUDGET_EXHAUSTED',
        'TASK_COST_LIMIT_EXCEEDED',
      ]);
    }
  });
});

describe('RuntimeBroker deterministic scoring', () => {
  it('selects the highest governed score and explains every factor', () => {
    const decision = broker(
      candidate('runtime-slow-expensive', {
        expectedLatencyMs: 1_500,
        estimatedCostMinorUnits: 400,
        activeRuns: 3,
      }),
      candidate('runtime-efficient'),
    ).route(context, request());
    expect(decision.selectedRuntimeId).toBe('runtime-efficient');
    const selected = decision.evaluations.find((item) => item.runtimeId === 'runtime-efficient');
    expect(selected).toMatchObject({ eligible: true, rejectionReasons: [] });
    expect(selected?.scoreBps).toBeTypeOf('number');
    expect(selected?.scoreFactors).toEqual({
      quality: 9_000,
      reliability: 9_500,
      security: 10_000,
      latency: 7_500,
      cost: 8_000,
      workload: 7_500,
    });
  });

  it('uses a deterministic runtime then connection tie-break independent of input order', () => {
    const first = candidate('runtime-a', { connectionId: 'connection-z' });
    const second = candidate('runtime-a', { connectionId: 'connection-a' });
    const third = candidate('runtime-b');
    for (const candidates of [
      [first, second, third],
      [third, second, first],
    ]) {
      const decision = broker(...candidates).route(context, request());
      expect(decision.selectedRuntimeId).toBe('runtime-a');
      expect(decision.selectedConnectionId).toBe('connection-a');
      expect(decision.tieBreakRule).toBe('SCORE_DESC_RUNTIME_ID_ASC_CONNECTION_ID_ASC');
    }
  });

  it('rejects duplicate trusted evidence identities instead of overwriting them', () => {
    const duplicate = candidate('runtime-a');
    const instance = broker(duplicate);
    expect(() => instance.putCandidateEvidence(context, duplicate)).toThrow(
      /identity already exists/,
    );
    instance.replaceCandidateEvidence(context, {
      ...duplicate,
      expectedLatencyMs: 750,
    });
    expect(instance.route(context, request()).selectedRuntimeId).toBe('runtime-a');
    expect(() =>
      instance.replaceCandidateEvidence(context, candidate('runtime-not-ingested')),
    ).toThrow(/does not exist/);
  });

  it('rejects malformed evidence before it enters the trusted read model', () => {
    const malformed = {
      ...candidate('runtime-malformed'),
      trustEvidence: undefined,
    } as unknown as RuntimeRoutingCandidate;
    expect(() => broker(malformed)).toThrow(/malformed/);

    const instance = broker(candidate('runtime-safe'));
    const throwing = { ...candidate('runtime-safe') } as RuntimeRoutingCandidate;
    Object.defineProperty(throwing, 'workspaceId', {
      enumerable: true,
      get: () => {
        throw new Error('untrusted getter');
      },
    });
    expect(() => instance.replaceCandidateEvidence(context, throwing)).toThrow(
      RuntimeBrokerPolicyError,
    );
    expect(instance.route(context, request()).selectedRuntimeId).toBe('runtime-safe');
    expect(() =>
      instance.putCandidateEvidence(context, null as unknown as RuntimeRoutingCandidate),
    ).toThrow(RuntimeBrokerPolicyError);
  });

  it('validates governed weights and request workspace', () => {
    expect(() =>
      broker(candidate('runtime-a')).route(
        context,
        request({
          weights: { quality: 1, reliability: 1, security: 1, latency: 1, cost: 1, workload: 1 },
        }),
      ),
    ).toThrow(RuntimeBrokerPolicyError);
    expect(() =>
      broker(candidate('runtime-a')).route(
        context,
        request({
          weights: {
            quality: 2_000,
            reliability: 2_000,
            security: 2_000,
            latency: 1_000,
            cost: 1_000,
            workload: 1_000,
            injected: 1_000,
          } as unknown as NonNullable<RuntimeRoutingRequest['weights']>,
        }),
      ),
    ).toThrow(/only governed factors/);
    expect(() =>
      broker(candidate('runtime-a')).route(context, request({ workspaceId: 'workspace-beta' })),
    ).toThrow(/outside the authenticated workspace/);
    expect(() =>
      broker(candidate('runtime-a')).route(
        context,
        request({ dataSensitivity: 'UNKNOWN' as RuntimeRoutingRequest['dataSensitivity'] }),
      ),
    ).toThrow(/not a supported policy value/);
  });

  it('scores maximum safe integer budgets without arithmetic overflow', () => {
    const decision = broker(
      candidate('runtime-large-budget', {
        estimatedCostMinorUnits: Number.MAX_SAFE_INTEGER - 1,
        remainingBudgetMinorUnits: Number.MAX_SAFE_INTEGER,
      }),
    ).route(context, request({ maximumCostMinorUnits: Number.MAX_SAFE_INTEGER }));
    expect(decision.selectedRuntimeId).toBe('runtime-large-budget');
    expect(decision.evaluations[0]?.scoreFactors?.cost).toBe(1);
  });
});
