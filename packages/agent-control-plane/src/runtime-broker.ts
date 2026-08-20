import type { EntityId, RuntimeConnectionStatus, WorkspaceContext } from './contracts';

export type DataSensitivity = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
export type RuntimeSecurityTier = 0 | 1 | 2 | 3;

export interface RuntimeTrustEvidence {
  readonly registration: {
    readonly verified: boolean;
    readonly runtimeId: EntityId;
    readonly principalId: EntityId;
    readonly connectionId: EntityId;
  };
  readonly capabilityExchange: {
    readonly verified: boolean;
    readonly runtimeId: EntityId;
    readonly principalId: EntityId;
    readonly connectionId: EntityId;
  };
  readonly heartbeat: {
    readonly verified: boolean;
    readonly runtimeId: EntityId;
    readonly principalId: EntityId;
    readonly connectionId: EntityId;
    readonly observedAt: string;
  };
  readonly taskRoundTrip: {
    readonly verified: boolean;
    readonly runtimeId: EntityId;
    readonly principalId: EntityId;
    readonly connectionId: EntityId;
  };
}

export interface RuntimeRoutingCandidate {
  readonly runtimeId: EntityId;
  readonly connectionId: EntityId;
  readonly workspaceId: EntityId;
  readonly connectionStatus: RuntimeConnectionStatus;
  readonly authenticatedPrincipalId: EntityId;
  readonly trustEvidence: RuntimeTrustEvidence;
  readonly capabilityIds: readonly EntityId[];
  readonly toolGrants: readonly {
    readonly toolId: EntityId;
    readonly scopes: readonly string[];
  }[];
  readonly maximumDataSensitivity: DataSensitivity;
  readonly securityTier: RuntimeSecurityTier;
  readonly reliabilityScoreBps: number;
  readonly qualityScoreBps: number;
  readonly expectedLatencyMs: number;
  readonly estimatedCostMinorUnits: number;
  readonly activeRuns: number;
  readonly maxConcurrentRuns: number;
  readonly remainingBudgetMinorUnits: number;
  readonly remainingComputeUnits: number;
}

export interface RuntimeRoutingWeights {
  readonly quality: number;
  readonly reliability: number;
  readonly security: number;
  readonly latency: number;
  readonly cost: number;
  readonly workload: number;
}

export interface RuntimeRoutingRequest {
  readonly id: EntityId;
  readonly workspaceId: EntityId;
  readonly requiredCapabilityIds: readonly EntityId[];
  readonly requiredTools: readonly {
    readonly toolId: EntityId;
    readonly scope: string;
  }[];
  readonly dataSensitivity: DataSensitivity;
  readonly minimumSecurityTier: RuntimeSecurityTier;
  readonly minimumReliabilityScoreBps: number;
  readonly maximumLatencyMs: number;
  readonly maximumCostMinorUnits: number;
  readonly requiredComputeUnits: number;
  readonly heartbeatFreshnessMs: number;
  readonly weights?: RuntimeRoutingWeights;
}

export type RuntimeRejectionReason =
  | 'CROSS_WORKSPACE'
  | 'NOT_CONNECTED'
  | 'UNAUTHENTICATED'
  | 'UNCORRELATED_TRUST_EVIDENCE'
  | 'STALE_HEARTBEAT'
  | 'MISSING_CAPABILITY'
  | 'MISSING_TOOL_SCOPE'
  | 'DATA_SENSITIVITY_DENIED'
  | 'SECURITY_TIER_TOO_LOW'
  | 'RELIABILITY_TOO_LOW'
  | 'LATENCY_TOO_HIGH'
  | 'TASK_COST_LIMIT_EXCEEDED'
  | 'RUNTIME_BUDGET_EXHAUSTED'
  | 'COMPUTE_BUDGET_EXHAUSTED'
  | 'RUNTIME_AT_CAPACITY'
  | 'INVALID_EVIDENCE';

export interface RuntimeScoreFactors {
  readonly quality: number;
  readonly reliability: number;
  readonly security: number;
  readonly latency: number;
  readonly cost: number;
  readonly workload: number;
}

export interface RuntimeCandidateEvaluation {
  readonly runtimeId: EntityId;
  readonly connectionId: EntityId;
  readonly eligible: boolean;
  readonly rejectionReasons: readonly RuntimeRejectionReason[];
  readonly scoreBps?: number;
  readonly scoreFactors?: RuntimeScoreFactors;
}

export interface RuntimeRoutingDecision {
  readonly requestId: EntityId;
  readonly workspaceId: EntityId;
  readonly evaluatedAt: string;
  readonly selectedRuntimeId: EntityId;
  readonly selectedConnectionId: EntityId;
  readonly selectedScoreBps: number;
  readonly tieBreakRule: 'SCORE_DESC_RUNTIME_ID_ASC_CONNECTION_ID_ASC';
  readonly evaluations: readonly RuntimeCandidateEvaluation[];
}

export interface RuntimeNoCandidateEvidence {
  readonly requestId: EntityId;
  readonly workspaceId: EntityId;
  readonly evaluatedAt: string;
  readonly evaluations: readonly RuntimeCandidateEvaluation[];
}

export interface RuntimeBrokerOptions {
  readonly authorityPrincipals: readonly EntityId[];
  readonly clock?: () => number;
}

export class RuntimeBrokerPolicyError extends Error {}

export class NoEligibleRuntimeError extends RuntimeBrokerPolicyError {
  constructor(readonly evidence: RuntimeNoCandidateEvidence) {
    super('No eligible runtime satisfies the governed routing request');
  }
}

const DEFAULT_WEIGHTS: RuntimeRoutingWeights = {
  quality: 2_500,
  reliability: 2_500,
  security: 2_000,
  latency: 1_000,
  cost: 1_000,
  workload: 1_000,
};

const SENSITIVITY_RANK: Readonly<Record<DataSensitivity, number>> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
};

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function assertBoundedString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2_048) {
    throw new RuntimeBrokerPolicyError(`${field} must be a non-empty bounded string`);
  }
}

function assertArray(value: unknown, field: string, maximum: number): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    Object.keys(value).length !== value.length
  ) {
    throw new RuntimeBrokerPolicyError(`${field} must be a dense bounded array`);
  }
}

function assertPlainObject(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new RuntimeBrokerPolicyError(`${field} must be a plain object`);
  }
}

function assertIntegerInRange(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RuntimeBrokerPolicyError(`${field} is outside its governed integer range`);
  }
}

function ratioScore(used: number, maximum: number): number {
  if (maximum <= 0) return 0;
  const consumedBps = Number((BigInt(used) * 10_000n) / BigInt(maximum));
  return Math.max(0, 10_000 - consumedBps);
}

function uniqueReasons(reasons: readonly RuntimeRejectionReason[]): RuntimeRejectionReason[] {
  return [...new Set(reasons)].sort(compareText);
}

function validateWeights(weights: RuntimeRoutingWeights): void {
  const expectedKeys = ['cost', 'latency', 'quality', 'reliability', 'security', 'workload'];
  const actualKeys = Object.keys(weights).sort(compareText);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new RuntimeBrokerPolicyError('Routing weights must contain only governed factors');
  }
  const values = expectedKeys.map((key) => weights[key as keyof RuntimeRoutingWeights]);
  for (const [index, value] of values.entries()) {
    assertIntegerInRange(value, `routing weight ${index}`, 0, 10_000);
  }
  if (values.reduce((sum, value) => sum + value, 0) !== 10_000) {
    throw new RuntimeBrokerPolicyError('Routing weights must sum to 10,000 basis points');
  }
}

function validateRequest(context: WorkspaceContext, request: RuntimeRoutingRequest): void {
  if (context.workspaceId !== request.workspaceId) {
    throw new RuntimeBrokerPolicyError('Routing request is outside the authenticated workspace');
  }
  assertBoundedString(request.id, 'request.id');
  assertBoundedString(request.workspaceId, 'request.workspaceId');
  if (!(request.dataSensitivity in SENSITIVITY_RANK)) {
    throw new RuntimeBrokerPolicyError('dataSensitivity is not a supported policy value');
  }
  assertIntegerInRange(request.minimumSecurityTier, 'minimumSecurityTier', 0, 3);
  assertIntegerInRange(request.minimumReliabilityScoreBps, 'minimumReliabilityScoreBps', 0, 10_000);
  assertIntegerInRange(request.maximumLatencyMs, 'maximumLatencyMs', 1, 24 * 60 * 60 * 1_000);
  assertIntegerInRange(
    request.maximumCostMinorUnits,
    'maximumCostMinorUnits',
    0,
    Number.MAX_SAFE_INTEGER,
  );
  assertIntegerInRange(
    request.requiredComputeUnits,
    'requiredComputeUnits',
    0,
    Number.MAX_SAFE_INTEGER,
  );
  assertIntegerInRange(request.heartbeatFreshnessMs, 'heartbeatFreshnessMs', 1, 60 * 60 * 1_000);
  assertArray(request.requiredCapabilityIds, 'requiredCapabilityIds', 64);
  assertArray(request.requiredTools, 'requiredTools', 64);
  for (const capabilityId of request.requiredCapabilityIds) {
    assertBoundedString(capabilityId, 'requiredCapabilityId');
  }
  for (const tool of request.requiredTools) {
    assertPlainObject(tool, 'requiredTool');
    assertBoundedString(tool.toolId, 'requiredTool.toolId');
    assertBoundedString(tool.scope, 'requiredTool.scope');
  }
  validateWeights(request.weights ?? DEFAULT_WEIGHTS);
}

function validateCandidate(candidate: RuntimeRoutingCandidate): RuntimeRejectionReason[] {
  try {
    assertPlainObject(candidate, 'candidate');
    assertBoundedString(candidate.runtimeId, 'runtimeId');
    assertBoundedString(candidate.connectionId, 'connectionId');
    assertBoundedString(candidate.workspaceId, 'workspaceId');
    assertBoundedString(candidate.authenticatedPrincipalId, 'authenticatedPrincipalId');
    assertIntegerInRange(candidate.securityTier, 'securityTier', 0, 3);
    if (!(candidate.maximumDataSensitivity in SENSITIVITY_RANK)) {
      throw new RuntimeBrokerPolicyError('maximumDataSensitivity is not supported');
    }
    assertPlainObject(candidate.trustEvidence, 'trustEvidence');
    const trustEvidence = candidate.trustEvidence;
    assertPlainObject(trustEvidence.registration, 'trustEvidence.registration');
    assertPlainObject(trustEvidence.capabilityExchange, 'trustEvidence.capabilityExchange');
    assertPlainObject(trustEvidence.heartbeat, 'trustEvidence.heartbeat');
    assertPlainObject(trustEvidence.taskRoundTrip, 'trustEvidence.taskRoundTrip');
    const proofs = [
      trustEvidence.registration,
      trustEvidence.capabilityExchange,
      trustEvidence.heartbeat,
      trustEvidence.taskRoundTrip,
    ];
    for (const proof of proofs) {
      if (typeof proof.verified !== 'boolean') {
        throw new RuntimeBrokerPolicyError('Runtime proof verification must be boolean');
      }
      assertBoundedString(proof.runtimeId, 'trustEvidence.runtimeId');
      assertBoundedString(proof.principalId, 'trustEvidence.principalId');
      assertBoundedString(proof.connectionId, 'trustEvidence.connectionId');
    }
    assertBoundedString(trustEvidence.heartbeat.observedAt, 'trustEvidence.heartbeat.observedAt');
    assertIntegerInRange(candidate.reliabilityScoreBps, 'reliabilityScoreBps', 0, 10_000);
    assertIntegerInRange(candidate.qualityScoreBps, 'qualityScoreBps', 0, 10_000);
    assertIntegerInRange(candidate.expectedLatencyMs, 'expectedLatencyMs', 0, 24 * 60 * 60 * 1_000);
    assertIntegerInRange(
      candidate.estimatedCostMinorUnits,
      'estimatedCostMinorUnits',
      0,
      Number.MAX_SAFE_INTEGER,
    );
    assertIntegerInRange(candidate.activeRuns, 'activeRuns', 0, Number.MAX_SAFE_INTEGER);
    assertIntegerInRange(
      candidate.maxConcurrentRuns,
      'maxConcurrentRuns',
      1,
      Number.MAX_SAFE_INTEGER,
    );
    assertIntegerInRange(
      candidate.remainingBudgetMinorUnits,
      'remainingBudgetMinorUnits',
      0,
      Number.MAX_SAFE_INTEGER,
    );
    assertIntegerInRange(
      candidate.remainingComputeUnits,
      'remainingComputeUnits',
      0,
      Number.MAX_SAFE_INTEGER,
    );
    assertArray(candidate.capabilityIds, 'capabilityIds', 128);
    assertArray(candidate.toolGrants, 'toolGrants', 128);
    for (const capabilityId of candidate.capabilityIds) {
      assertBoundedString(capabilityId, 'capabilityId');
    }
    for (const grant of candidate.toolGrants) {
      assertPlainObject(grant, 'toolGrant');
      assertBoundedString(grant.toolId, 'toolGrant.toolId');
      assertArray(grant.scopes, 'toolGrant.scopes', 64);
      for (const scope of grant.scopes) assertBoundedString(scope, 'toolGrant.scope');
    }
    return [];
  } catch {
    return ['INVALID_EVIDENCE'];
  }
}

function normalizeCandidate(candidate: RuntimeRoutingCandidate): RuntimeRoutingCandidate {
  return {
    runtimeId: candidate.runtimeId,
    connectionId: candidate.connectionId,
    workspaceId: candidate.workspaceId,
    connectionStatus: candidate.connectionStatus,
    authenticatedPrincipalId: candidate.authenticatedPrincipalId,
    trustEvidence: {
      registration: { ...candidate.trustEvidence.registration },
      capabilityExchange: { ...candidate.trustEvidence.capabilityExchange },
      heartbeat: { ...candidate.trustEvidence.heartbeat },
      taskRoundTrip: { ...candidate.trustEvidence.taskRoundTrip },
    },
    capabilityIds: [...candidate.capabilityIds],
    toolGrants: candidate.toolGrants.map((grant) => ({
      toolId: grant.toolId,
      scopes: [...grant.scopes],
    })),
    maximumDataSensitivity: candidate.maximumDataSensitivity,
    securityTier: candidate.securityTier,
    reliabilityScoreBps: candidate.reliabilityScoreBps,
    qualityScoreBps: candidate.qualityScoreBps,
    expectedLatencyMs: candidate.expectedLatencyMs,
    estimatedCostMinorUnits: candidate.estimatedCostMinorUnits,
    activeRuns: candidate.activeRuns,
    maxConcurrentRuns: candidate.maxConcurrentRuns,
    remainingBudgetMinorUnits: candidate.remainingBudgetMinorUnits,
    remainingComputeUnits: candidate.remainingComputeUnits,
  };
}

export class RuntimeBroker {
  readonly #clock: () => number;
  readonly #authorityPrincipals: Set<EntityId>;
  readonly #candidates = new Map<string, RuntimeRoutingCandidate>();

  constructor(options: RuntimeBrokerOptions) {
    this.#clock = options.clock ?? Date.now;
    this.#authorityPrincipals = new Set(options.authorityPrincipals);
  }

  putCandidateEvidence(context: WorkspaceContext, candidate: RuntimeRoutingCandidate): void {
    const { identity, normalized } = this.#validatedEvidence(context, candidate);
    if (this.#candidates.has(identity)) {
      throw new RuntimeBrokerPolicyError('Candidate evidence identity already exists');
    }
    this.#candidates.set(identity, normalized);
  }

  replaceCandidateEvidence(context: WorkspaceContext, candidate: RuntimeRoutingCandidate): void {
    const { identity, normalized } = this.#validatedEvidence(context, candidate);
    if (!this.#candidates.has(identity)) {
      throw new RuntimeBrokerPolicyError('Candidate evidence identity does not exist');
    }
    this.#candidates.set(identity, normalized);
  }

  #validatedEvidence(
    context: WorkspaceContext,
    candidate: RuntimeRoutingCandidate,
  ): { identity: string; normalized: RuntimeRoutingCandidate } {
    if (!this.#authorityPrincipals.has(context.principalId)) {
      throw new RuntimeBrokerPolicyError(
        'Only an authorized control-plane principal may ingest evidence',
      );
    }
    if (validateCandidate(candidate).length > 0) {
      throw new RuntimeBrokerPolicyError('Candidate evidence is malformed');
    }
    let normalized: RuntimeRoutingCandidate;
    try {
      normalized = normalizeCandidate(candidate);
    } catch {
      throw new RuntimeBrokerPolicyError('Candidate evidence could not be normalized');
    }
    if (validateCandidate(normalized).length > 0) {
      throw new RuntimeBrokerPolicyError('Normalized candidate evidence is malformed');
    }
    if (
      Object.values(normalized.trustEvidence).some(
        (proof) =>
          !proof.verified ||
          proof.runtimeId !== normalized.runtimeId ||
          proof.principalId !== normalized.authenticatedPrincipalId ||
          proof.connectionId !== normalized.connectionId,
      )
    ) {
      throw new RuntimeBrokerPolicyError('Candidate trust evidence is not identity-correlated');
    }
    if (normalized.workspaceId !== context.workspaceId) {
      throw new RuntimeBrokerPolicyError(
        'Candidate evidence is outside the authenticated workspace',
      );
    }
    return {
      identity: JSON.stringify([
        normalized.workspaceId,
        normalized.runtimeId,
        normalized.connectionId,
      ]),
      normalized,
    };
  }

  route(context: WorkspaceContext, request: RuntimeRoutingRequest): RuntimeRoutingDecision {
    validateRequest(context, request);
    const candidates = [...this.#candidates.values()].filter(
      (candidate) => candidate.workspaceId === context.workspaceId,
    );
    if (candidates.length > 1_000) {
      throw new RuntimeBrokerPolicyError('Runtime candidate set exceeds the governed bound');
    }
    const evaluatedAtMs = this.#clock();
    if (!Number.isSafeInteger(evaluatedAtMs) || evaluatedAtMs < 0) {
      throw new RuntimeBrokerPolicyError('Broker clock returned an invalid time');
    }
    const evaluatedAt = new Date(evaluatedAtMs).toISOString();
    const evaluations = candidates.map((candidate) =>
      this.#evaluateCandidate(request, candidate, evaluatedAtMs),
    );
    const eligible = evaluations
      .filter(
        (evaluation): evaluation is RuntimeCandidateEvaluation & { scoreBps: number } =>
          evaluation.eligible && evaluation.scoreBps !== undefined,
      )
      .sort(
        (left, right) =>
          right.scoreBps - left.scoreBps ||
          compareText(left.runtimeId, right.runtimeId) ||
          compareText(left.connectionId, right.connectionId),
      );
    const orderedEvaluations = [...evaluations].sort(
      (left, right) =>
        compareText(left.runtimeId, right.runtimeId) ||
        compareText(left.connectionId, right.connectionId),
    );
    const selected = eligible[0];
    if (!selected) {
      throw new NoEligibleRuntimeError({
        requestId: request.id,
        workspaceId: request.workspaceId,
        evaluatedAt,
        evaluations: orderedEvaluations,
      });
    }
    return {
      requestId: request.id,
      workspaceId: request.workspaceId,
      evaluatedAt,
      selectedRuntimeId: selected.runtimeId,
      selectedConnectionId: selected.connectionId,
      selectedScoreBps: selected.scoreBps,
      tieBreakRule: 'SCORE_DESC_RUNTIME_ID_ASC_CONNECTION_ID_ASC',
      evaluations: orderedEvaluations,
    };
  }

  #evaluateCandidate(
    request: RuntimeRoutingRequest,
    candidate: RuntimeRoutingCandidate,
    now: number,
  ): RuntimeCandidateEvaluation {
    const reasons = validateCandidate(candidate);
    if (candidate.workspaceId !== request.workspaceId) {
      return {
        runtimeId: '[cross-workspace]',
        connectionId: '[cross-workspace]',
        eligible: false,
        rejectionReasons: ['CROSS_WORKSPACE'],
      };
    }
    if (reasons.includes('INVALID_EVIDENCE')) {
      return {
        runtimeId: candidate.runtimeId,
        connectionId: candidate.connectionId,
        eligible: false,
        rejectionReasons: uniqueReasons(reasons),
      };
    }
    if (candidate.connectionStatus !== 'CONNECTED') reasons.push('NOT_CONNECTED');
    const principal = candidate.authenticatedPrincipalId;
    if (!principal) reasons.push('UNAUTHENTICATED');
    const proofs = Object.values(candidate.trustEvidence);
    if (
      proofs.some(
        (proof) =>
          !proof.verified ||
          proof.runtimeId !== candidate.runtimeId ||
          proof.principalId !== principal ||
          proof.connectionId !== candidate.connectionId,
      )
    ) {
      reasons.push('UNCORRELATED_TRUST_EVIDENCE');
    }
    const heartbeatTime = Date.parse(candidate.trustEvidence.heartbeat.observedAt);
    if (
      !Number.isFinite(heartbeatTime) ||
      heartbeatTime > now + 30_000 ||
      now - heartbeatTime > request.heartbeatFreshnessMs
    ) {
      reasons.push('STALE_HEARTBEAT');
    }
    for (const capabilityId of request.requiredCapabilityIds) {
      if (!candidate.capabilityIds.includes(capabilityId)) reasons.push('MISSING_CAPABILITY');
    }
    for (const requiredTool of request.requiredTools) {
      const granted = candidate.toolGrants.some(
        (grant) =>
          grant.toolId === requiredTool.toolId && grant.scopes.includes(requiredTool.scope),
      );
      if (!granted) reasons.push('MISSING_TOOL_SCOPE');
    }
    if (
      SENSITIVITY_RANK[candidate.maximumDataSensitivity] < SENSITIVITY_RANK[request.dataSensitivity]
    ) {
      reasons.push('DATA_SENSITIVITY_DENIED');
    }
    if (candidate.securityTier < request.minimumSecurityTier) reasons.push('SECURITY_TIER_TOO_LOW');
    if (candidate.reliabilityScoreBps < request.minimumReliabilityScoreBps) {
      reasons.push('RELIABILITY_TOO_LOW');
    }
    if (candidate.expectedLatencyMs > request.maximumLatencyMs) reasons.push('LATENCY_TOO_HIGH');
    if (candidate.estimatedCostMinorUnits > request.maximumCostMinorUnits) {
      reasons.push('TASK_COST_LIMIT_EXCEEDED');
    }
    if (candidate.estimatedCostMinorUnits > candidate.remainingBudgetMinorUnits) {
      reasons.push('RUNTIME_BUDGET_EXHAUSTED');
    }
    if (request.requiredComputeUnits > candidate.remainingComputeUnits) {
      reasons.push('COMPUTE_BUDGET_EXHAUSTED');
    }
    if (candidate.activeRuns >= candidate.maxConcurrentRuns) reasons.push('RUNTIME_AT_CAPACITY');
    const rejectionReasons = uniqueReasons(reasons);
    if (rejectionReasons.length > 0) {
      return {
        runtimeId: candidate.runtimeId,
        connectionId: candidate.connectionId,
        eligible: false,
        rejectionReasons,
      };
    }

    const weights = request.weights ?? DEFAULT_WEIGHTS;
    const costCeiling = Math.min(
      request.maximumCostMinorUnits,
      candidate.remainingBudgetMinorUnits,
    );
    const factors: RuntimeScoreFactors = {
      quality: candidate.qualityScoreBps,
      reliability: candidate.reliabilityScoreBps,
      security: Math.floor(((candidate.securityTier + 1) * 10_000) / 4),
      latency: ratioScore(candidate.expectedLatencyMs, request.maximumLatencyMs),
      cost:
        costCeiling === 0
          ? candidate.estimatedCostMinorUnits === 0
            ? 10_000
            : 0
          : ratioScore(candidate.estimatedCostMinorUnits, costCeiling),
      workload: ratioScore(candidate.activeRuns, candidate.maxConcurrentRuns),
    };
    const scoreBps = Math.floor(
      (factors.quality * weights.quality +
        factors.reliability * weights.reliability +
        factors.security * weights.security +
        factors.latency * weights.latency +
        factors.cost * weights.cost +
        factors.workload * weights.workload) /
        10_000,
    );
    return {
      runtimeId: candidate.runtimeId,
      connectionId: candidate.connectionId,
      eligible: true,
      rejectionReasons: [],
      scoreBps,
      scoreFactors: factors,
    };
  }
}
