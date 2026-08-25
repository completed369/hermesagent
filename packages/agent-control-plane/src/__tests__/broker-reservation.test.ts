import { describe, expect, it } from 'vitest';
import {
  BrokerReservationPolicyError,
  buildBrokerReservationBinding,
  computeBrokerReservationEvidenceHash,
  sha256Canonical,
  validateTrustedBrokerCandidateSnapshot,
  type TrustedBrokerCandidateSnapshot,
  type TrustedBrokerAgentEvidence,
} from '../broker-reservation';
import type { RuntimeRoutingCandidate, RuntimeRoutingDecision } from '../runtime-broker';

const candidate: RuntimeRoutingCandidate = {
  runtimeId: 'runtime-one',
  connectionId: 'connection-one',
  workspaceId: 'workspace-one',
  connectionStatus: 'CONNECTED',
  authenticatedPrincipalId: 'runtime-principal',
  trustEvidence: {
    registration: {
      verified: true,
      runtimeId: 'runtime-one',
      connectionId: 'connection-one',
      principalId: 'runtime-principal',
    },
    capabilityExchange: {
      verified: true,
      runtimeId: 'runtime-one',
      connectionId: 'connection-one',
      principalId: 'runtime-principal',
    },
    heartbeat: {
      verified: true,
      runtimeId: 'runtime-one',
      connectionId: 'connection-one',
      principalId: 'runtime-principal',
      observedAt: '2026-08-25T20:00:00.000Z',
    },
    taskRoundTrip: {
      verified: true,
      runtimeId: 'runtime-one',
      connectionId: 'connection-one',
      principalId: 'runtime-principal',
    },
  },
  capabilityIds: ['quality.verify'],
  toolGrants: [],
  maximumDataSensitivity: 'INTERNAL',
  securityTier: 2,
  reliabilityScoreBps: 9_000,
  qualityScoreBps: 9_000,
  expectedLatencyMs: 100,
  estimatedCostMinorUnits: 5,
  activeRuns: 0,
  maxConcurrentRuns: 1,
  remainingBudgetMinorUnits: 100,
  remainingComputeUnits: 100,
};

const snapshot = (): TrustedBrokerCandidateSnapshot => ({
  evidenceId: 'candidate-snapshot-one',
  evidenceHash: sha256Canonical([candidate]),
  testOnly: true,
  candidates: [candidate],
});

const agentEvidence = (): TrustedBrokerAgentEvidence => ({
  evidenceId: 'agent-evidence-one',
  evidenceHash: sha256Canonical({
    schemaVersion: 1,
    workspaceId: 'workspace-one',
    runId: 'run-one',
    agentId: 'agent-one',
    testOnly: true,
  }),
  workspaceId: 'workspace-one',
  runId: 'run-one',
  agentId: 'agent-one',
  testOnly: true,
});

const bindingInput = () => ({
  workspaceId: 'workspace-one',
  objectiveId: 'objective-one',
  taskId: 'task-one',
  runId: 'run-one',
  agentId: 'agent-one',
  agentEvidence: agentEvidence(),
  expectedRunVersion: 1,
  taskPolicyHash: 'a'.repeat(64),
  taskPolicyVersion: 'policy-v1',
  request,
  snapshot: snapshot(),
  decision,
});

const request = {
  id: 'broker:run-one',
  workspaceId: 'workspace-one',
  requiredCapabilityIds: ['quality.verify'],
  requiredTools: [],
  dataSensitivity: 'INTERNAL' as const,
  minimumSecurityTier: 0 as const,
  minimumReliabilityScoreBps: 0,
  maximumLatencyMs: 1_000,
  maximumCostMinorUnits: 100,
  requiredComputeUnits: 10,
  heartbeatFreshnessMs: 60_000,
};

const decision: RuntimeRoutingDecision = {
  requestId: request.id,
  workspaceId: request.workspaceId,
  evaluatedAt: '2026-08-25T20:00:01.000Z',
  selectedRuntimeId: candidate.runtimeId,
  selectedConnectionId: candidate.connectionId,
  selectedScoreBps: 9_000,
  tieBreakRule: 'SCORE_DESC_RUNTIME_ID_ASC_CONNECTION_ID_ASC',
  evaluations: [],
};

describe('durable broker reservation policy', () => {
  it('creates a deterministic exact binding and evidence digest', () => {
    const binding = buildBrokerReservationBinding(bindingInput());
    expect(binding).toMatchObject({
      runtimeId: 'runtime-one',
      connectionId: 'connection-one',
      estimatedCostMinorUnits: 5,
      reservedComputeUnits: 10,
      testOnly: true,
    });
    expect(computeBrokerReservationEvidenceHash(binding)).toMatch(/^[a-f0-9]{64}$/u);
    expect(computeBrokerReservationEvidenceHash(binding)).toBe(
      computeBrokerReservationEvidenceHash({ ...binding }),
    );
  });

  it('rejects cross-workspace and digest-drifted candidate snapshots', () => {
    expect(() => validateTrustedBrokerCandidateSnapshot('other-workspace', snapshot())).toThrow(
      BrokerReservationPolicyError,
    );
    expect(() =>
      validateTrustedBrokerCandidateSnapshot('workspace-one', {
        ...snapshot(),
        evidenceHash: 'b'.repeat(64),
      }),
    ).toThrow(/digest mismatch/);
  });

  it.each([
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue',
    'glpat-abcdefghijklmnopqrstuvwxyz',
    'password-reference',
    'chain-of-thought',
  ])('rejects sensitive data smuggled through identifiers: %s', (agentId) => {
    expect(() =>
      buildBrokerReservationBinding({
        ...bindingInput(),
        agentId,
      }),
    ).toThrow(BrokerReservationPolicyError);
  });

  it('binds every selection and policy dimension into the hash', () => {
    const binding = buildBrokerReservationBinding(bindingInput());
    for (const [field, value] of [
      ['runId', 'run-two'],
      ['agentId', 'agent-two'],
      ['agentEvidenceHash', 'd'.repeat(64)],
      ['expectedRunVersion', 2],
      ['runtimeId', 'runtime-two'],
      ['connectionId', 'connection-two'],
      ['taskPolicyHash', 'b'.repeat(64)],
      ['candidateEvidenceHash', 'c'.repeat(64)],
      ['estimatedCostMinorUnits', 6],
      ['reservedComputeUnits', 11],
    ] as const) {
      expect(computeBrokerReservationEvidenceHash({ ...binding, [field]: value })).not.toBe(
        computeBrokerReservationEvidenceHash(binding),
      );
    }
  });

  it.each([
    ['runtimeId', 'password-reference'],
    ['connectionId', 'chain-of-thought'],
    ['runtimeId', 'glpat-abcdefghijklmnopqrstuvwxyz'],
    ['connectionId', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue'],
  ] as const)('rejects sensitive candidate %s references', (field, value) => {
    const unsafeCandidate = { ...candidate, [field]: value };
    expect(() =>
      validateTrustedBrokerCandidateSnapshot('workspace-one', {
        evidenceId: 'candidate-snapshot-one',
        evidenceHash: sha256Canonical([unsafeCandidate]),
        testOnly: true,
        candidates: [unsafeCandidate],
      }),
    ).toThrow(BrokerReservationPolicyError);
  });
});
