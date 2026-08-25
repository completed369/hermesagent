import { createHash } from 'node:crypto';

import type { EntityId } from './contracts';
import type {
  RuntimeRoutingCandidate,
  RuntimeRoutingDecision,
  RuntimeRoutingRequest,
} from './runtime-broker';

export const BROKER_RESERVATION_TTL_MS = 60_000;

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SECRET_LIKE =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk|gh[opusr]|github_pat|glpat|xox[baprs]|AKIA)[_-]?[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret)/iu;

export class BrokerReservationPolicyError extends Error {}

export interface TrustedBrokerCandidateSnapshot {
  readonly evidenceId: EntityId;
  readonly evidenceHash: string;
  readonly testOnly: boolean;
  readonly candidates: readonly RuntimeRoutingCandidate[];
}

export interface TrustedBrokerCandidateReader {
  /**
   * Server-owned candidate evidence. Production composition must fail closed
   * until real trust exists. activeRuns and remaining budgets describe measured
   * runtime state before this reservation ledger's holds; the durable service
   * adds active holds exactly once under the connection lock.
   */
  read(workspaceId: EntityId): Promise<TrustedBrokerCandidateSnapshot>;
}

export const TRUSTED_BROKER_CANDIDATE_READER = Symbol('TRUSTED_BROKER_CANDIDATE_READER');

export interface BrokerReservationBinding {
  readonly workspaceId: EntityId;
  readonly objectiveId: EntityId;
  readonly taskId: EntityId;
  readonly runId: EntityId;
  readonly agentId: EntityId;
  readonly runtimeId: EntityId;
  readonly connectionId: EntityId;
  readonly requestHash: string;
  readonly candidateEvidenceId: EntityId;
  readonly candidateEvidenceHash: string;
  readonly taskPolicyHash: string;
  readonly taskPolicyVersion: string;
  readonly selectedScoreBps: number;
  readonly estimatedCostMinorUnits: number;
  readonly reservedComputeUnits: number;
  readonly maxConcurrentRuns: number;
  readonly testOnly: boolean;
}

function reference(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !SAFE_REFERENCE.test(value) ||
    PRIVATE_TEXT.test(value) ||
    SECRET_LIKE.test(value)
  )
    throw new BrokerReservationPolicyError(`${field} must be a safe non-sensitive reference`);
}

function digest(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))
    throw new BrokerReservationPolicyError(`${field} must be a SHA-256 digest`);
}

function integer(value: unknown, field: string, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum)
    throw new BrokerReservationPolicyError(`${field} must be a bounded non-negative integer`);
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
        .map(([key, item]) => [key, normalize(item)]),
    );
  return value;
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex');
}

export function validateTrustedBrokerCandidateSnapshot(
  workspaceId: string,
  snapshot: TrustedBrokerCandidateSnapshot,
): void {
  reference(workspaceId, 'workspaceId');
  reference(snapshot.evidenceId, 'candidateEvidenceId');
  digest(snapshot.evidenceHash, 'candidateEvidenceHash');
  if (typeof snapshot.testOnly !== 'boolean')
    throw new BrokerReservationPolicyError('testOnly must be boolean');
  if (!Array.isArray(snapshot.candidates) || snapshot.candidates.length > 1_000)
    throw new BrokerReservationPolicyError('Candidate snapshot exceeds the governed bound');
  if (snapshot.candidates.some((candidate) => candidate.workspaceId !== workspaceId))
    throw new BrokerReservationPolicyError('Candidate snapshot crosses workspace');
  if (sha256Canonical(snapshot.candidates) !== snapshot.evidenceHash)
    throw new BrokerReservationPolicyError('Candidate snapshot digest mismatch');
}

export function buildBrokerReservationBinding(input: {
  readonly workspaceId: string;
  readonly objectiveId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly taskPolicyHash: string;
  readonly taskPolicyVersion: string;
  readonly request: RuntimeRoutingRequest;
  readonly snapshot: TrustedBrokerCandidateSnapshot;
  readonly decision: RuntimeRoutingDecision;
}): BrokerReservationBinding {
  for (const [field, value] of Object.entries({
    workspaceId: input.workspaceId,
    objectiveId: input.objectiveId,
    taskId: input.taskId,
    runId: input.runId,
    agentId: input.agentId,
    taskPolicyVersion: input.taskPolicyVersion,
  }))
    reference(value, field);
  digest(input.taskPolicyHash, 'taskPolicyHash');
  if (
    input.request.workspaceId !== input.workspaceId ||
    input.decision.workspaceId !== input.workspaceId ||
    input.decision.requestId !== input.request.id
  )
    throw new BrokerReservationPolicyError('Routing evidence binding mismatch');
  validateTrustedBrokerCandidateSnapshot(input.workspaceId, input.snapshot);
  const selected = input.snapshot.candidates.find(
    (candidate) =>
      candidate.runtimeId === input.decision.selectedRuntimeId &&
      candidate.connectionId === input.decision.selectedConnectionId,
  );
  if (!selected) throw new BrokerReservationPolicyError('Selected candidate is absent');
  integer(input.decision.selectedScoreBps, 'selectedScoreBps', 10_000);
  integer(selected.estimatedCostMinorUnits, 'estimatedCostMinorUnits');
  integer(input.request.requiredComputeUnits, 'reservedComputeUnits');
  integer(selected.maxConcurrentRuns, 'maxConcurrentRuns', 100_000);
  if (selected.maxConcurrentRuns < 1)
    throw new BrokerReservationPolicyError('Selected runtime has no capacity');
  return {
    workspaceId: input.workspaceId,
    objectiveId: input.objectiveId,
    taskId: input.taskId,
    runId: input.runId,
    agentId: input.agentId,
    runtimeId: selected.runtimeId,
    connectionId: selected.connectionId,
    requestHash: sha256Canonical(input.request),
    candidateEvidenceId: input.snapshot.evidenceId,
    candidateEvidenceHash: input.snapshot.evidenceHash,
    taskPolicyHash: input.taskPolicyHash,
    taskPolicyVersion: input.taskPolicyVersion,
    selectedScoreBps: input.decision.selectedScoreBps,
    estimatedCostMinorUnits: selected.estimatedCostMinorUnits,
    reservedComputeUnits: input.request.requiredComputeUnits,
    maxConcurrentRuns: selected.maxConcurrentRuns,
    testOnly: input.snapshot.testOnly,
  };
}

export function computeBrokerReservationEvidenceHash(binding: BrokerReservationBinding): string {
  return sha256Canonical({ schemaVersion: 1, ...binding });
}
