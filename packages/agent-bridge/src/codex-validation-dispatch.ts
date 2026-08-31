import { createHash } from 'node:crypto';

import { canonicalJson } from './codec';
import { CODEX_APP_SERVER_ADAPTER_KIND } from './codex-app-server-policy';
import {
  validateCodexHeartbeatEvidenceCandidate,
  type CodexHeartbeatEvidenceCandidate,
} from './codex-heartbeat';
import { BRIDGE_PROTOCOL_VERSION, type BridgeEnvelope } from './protocol';

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_WINDOW_MS = 60_000;
export const CODEX_VALIDATION_CHALLENGE = 'codex.runtime.round-trip.v1' as const;

export type CodexValidationDispatchErrorCode =
  | 'INVALID_EVIDENCE'
  | 'HEARTBEAT_MISMATCH'
  | 'VALIDATION_LIMIT_EXCEEDED'
  | 'VALIDATION_DISPATCH_NOT_AUTHORIZED';

export class CodexValidationDispatchError extends Error {
  constructor(readonly code: CodexValidationDispatchErrorCode) {
    super(`Codex validation dispatch denied: ${code}`);
  }
}

export interface CodexValidationDispatchCandidate {
  readonly schemaVersion: 1;
  readonly adapterKind: typeof CODEX_APP_SERVER_ADAPTER_KIND;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly authGeneration: number;
  readonly registrationCandidateHash: string;
  readonly capabilityCandidateHash: string;
  readonly heartbeatCandidateHash: string;
  readonly capabilityDigest: string;
  readonly bridgeIdentityHash: string;
  readonly secretBindingHash: string;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly authorityLevel: 0 | 1 | 2 | 3;
  readonly taskPolicyHash: string;
  readonly maximumCostMinorUnits: 0;
  readonly maximumComputeUnits: number;
  readonly maximumDurationMs: number;
  readonly outboundSequence: 1;
  readonly messageId: string;
  readonly challengeCode: typeof CODEX_VALIDATION_CHALLENGE;
  readonly payloadDigest: string;
  readonly unsignedEnvelopeDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly assignmentState: 'NOT_CONFIGURED';
  readonly deliveryState: 'NOT_SENT';
  readonly providerAccess: 'NOT_CONFIGURED';
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly validationDispatchCandidateHash: string;
}

export interface CodexValidationDispatchAuthorizationRequest {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly validationDispatchCandidateHash: string;
  readonly heartbeatCandidateHash: string;
  readonly taskPolicyHash: string;
  readonly idempotencyKey: string;
}

export interface CodexValidationDispatchAuthorizationDecision {
  readonly schemaVersion: 1;
  readonly authorizationId: string;
  readonly requestHash: string;
  readonly authorizedByReference: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface CodexValidationDispatchAuthorizationSource {
  read(request: Readonly<CodexValidationDispatchAuthorizationRequest>): Promise<unknown>;
}

export const CODEX_VALIDATION_DISPATCH_AUTHORIZATION_SOURCE = Symbol(
  'CODEX_VALIDATION_DISPATCH_AUTHORIZATION_SOURCE',
);

export class DenyCodexValidationDispatchAuthorizationSource implements CodexValidationDispatchAuthorizationSource {
  async read(_request: Readonly<CodexValidationDispatchAuthorizationRequest>): Promise<never> {
    throw new CodexValidationDispatchError('VALIDATION_DISPATCH_NOT_AUTHORIZED');
  }
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  return value as JsonRecord;
}

function exact(value: unknown, keys: readonly string[]): JsonRecord {
  const result = record(value);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  return result;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value))
    throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
    throw new CodexValidationDispatchError('VALIDATION_LIMIT_EXCEEDED');
  return value as number;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function freeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value as Readonly<T>;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export function codexValidationDispatchPayload(
  candidate: Pick<
    CodexValidationDispatchCandidate,
    | 'dispatchId'
    | 'taskId'
    | 'runId'
    | 'agentId'
    | 'authorityLevel'
    | 'taskPolicyHash'
    | 'registrationCandidateHash'
    | 'capabilityCandidateHash'
    | 'heartbeatCandidateHash'
    | 'challengeCode'
  >,
): Readonly<Record<string, unknown>> {
  return freeze({
    schemaVersion: 1,
    challengeCode: candidate.challengeCode,
    dispatchId: candidate.dispatchId,
    taskId: candidate.taskId,
    runId: candidate.runId,
    agentId: candidate.agentId,
    authorityLevel: candidate.authorityLevel,
    taskPolicyHash: candidate.taskPolicyHash,
    registrationCandidateHash: candidate.registrationCandidateHash,
    capabilityCandidateHash: candidate.capabilityCandidateHash,
    heartbeatCandidateHash: candidate.heartbeatCandidateHash,
  });
}

function unsignedEnvelope(
  candidate: Omit<
    CodexValidationDispatchCandidate,
    'payloadDigest' | 'unsignedEnvelopeDigest' | 'validationDispatchCandidateHash'
  > & { readonly payloadDigest?: string },
): Omit<BridgeEnvelope, 'mac'> {
  const payload = codexValidationDispatchPayload(candidate);
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    workspaceId: candidate.workspaceId,
    runtimeId: candidate.runtimeId,
    connectionId: candidate.connectionId,
    sessionId: candidate.sessionId,
    principalReference: candidate.principalReference,
    sequence: candidate.outboundSequence,
    messageId: candidate.messageId,
    type: 'DISPATCH',
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt,
    payloadDigest: candidate.payloadDigest ?? sha256(payload),
    payload,
  };
}

export function createCodexValidationDispatchCandidate(input: {
  readonly heartbeat: Readonly<CodexHeartbeatEvidenceCandidate>;
  readonly dispatchId: unknown;
  readonly taskId: unknown;
  readonly runId: unknown;
  readonly agentId: unknown;
  readonly authorityLevel: unknown;
  readonly taskPolicyHash: unknown;
  readonly maximumCostMinorUnits: unknown;
  readonly maximumComputeUnits: unknown;
  readonly maximumDurationMs: unknown;
  readonly issuedAt: unknown;
  readonly expiresAt: unknown;
}): Readonly<CodexValidationDispatchCandidate> {
  const heartbeat = validateCodexHeartbeatEvidenceCandidate(input.heartbeat);
  const authorityLevel = boundedInteger(input.authorityLevel, 0, 3) as 0 | 1 | 2 | 3;
  if (input.maximumCostMinorUnits !== 0)
    throw new CodexValidationDispatchError('VALIDATION_LIMIT_EXCEEDED');
  const maximumComputeUnits = boundedInteger(input.maximumComputeUnits, 1, 100);
  const maximumDurationMs = boundedInteger(input.maximumDurationMs, 1, MAX_WINDOW_MS);
  const issuedAt = timestamp(input.issuedAt);
  const expiresAt = timestamp(input.expiresAt);
  if (
    Date.parse(issuedAt) < Date.parse(heartbeat.issuedAt) ||
    Date.parse(issuedAt) - Date.parse(heartbeat.issuedAt) > MAX_WINDOW_MS ||
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    Date.parse(expiresAt) - Date.parse(issuedAt) > MAX_WINDOW_MS ||
    Date.parse(expiresAt) > Date.parse(heartbeat.expiresAt)
  )
    throw new CodexValidationDispatchError('HEARTBEAT_MISMATCH');
  const dispatchId = reference(input.dispatchId);
  const candidate = {
    schemaVersion: 1 as const,
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND as typeof CODEX_APP_SERVER_ADAPTER_KIND,
    workspaceId: heartbeat.workspaceId,
    runtimeId: heartbeat.runtimeId,
    connectionId: heartbeat.connectionId,
    sessionId: heartbeat.sessionId,
    principalReference: heartbeat.principalReference,
    authGeneration: heartbeat.authGeneration,
    registrationCandidateHash: heartbeat.registrationCandidateHash,
    capabilityCandidateHash: heartbeat.capabilityCandidateHash,
    heartbeatCandidateHash: heartbeat.heartbeatCandidateHash,
    capabilityDigest: heartbeat.capabilityDigest,
    bridgeIdentityHash: heartbeat.bridgeIdentityHash,
    secretBindingHash: heartbeat.secretBindingHash,
    dispatchId,
    taskId: reference(input.taskId),
    runId: reference(input.runId),
    agentId: reference(input.agentId),
    authorityLevel,
    taskPolicyHash: digest(input.taskPolicyHash),
    maximumCostMinorUnits: 0 as const,
    maximumComputeUnits,
    maximumDurationMs,
    outboundSequence: 1 as const,
    messageId: dispatchId,
    challengeCode: CODEX_VALIDATION_CHALLENGE,
    issuedAt,
    expiresAt,
    assignmentState: 'NOT_CONFIGURED' as const,
    deliveryState: 'NOT_SENT' as const,
    providerAccess: 'NOT_CONFIGURED' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  const unsigned = unsignedEnvelope(candidate);
  const normalized = {
    ...candidate,
    payloadDigest: unsigned.payloadDigest,
    unsignedEnvelopeDigest: sha256(unsigned),
  };
  return freeze({ ...normalized, validationDispatchCandidateHash: sha256(normalized) });
}

export function validateCodexValidationDispatchCandidate(
  input: unknown,
): Readonly<CodexValidationDispatchCandidate> {
  const candidate = exact(input, [
    'adapterKind',
    'agentId',
    'assignmentState',
    'authGeneration',
    'authorityLevel',
    'bridgeIdentityHash',
    'capabilityCandidateHash',
    'capabilityDigest',
    'challengeCode',
    'connectionId',
    'deliveryState',
    'dispatchId',
    'expiresAt',
    'heartbeatCandidateHash',
    'issuedAt',
    'maximumComputeUnits',
    'maximumCostMinorUnits',
    'maximumDurationMs',
    'messageId',
    'outboundSequence',
    'payloadDigest',
    'principalReference',
    'providerAccess',
    'registrationCandidateHash',
    'runId',
    'runtimeConnection',
    'runtimeId',
    'schemaVersion',
    'secretBindingHash',
    'sessionId',
    'taskId',
    'taskPolicyHash',
    'unsignedEnvelopeDigest',
    'validationDispatchCandidateHash',
    'workspaceId',
  ]);
  if (
    candidate.schemaVersion !== 1 ||
    candidate.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
    candidate.maximumCostMinorUnits !== 0 ||
    candidate.outboundSequence !== 1 ||
    candidate.challengeCode !== CODEX_VALIDATION_CHALLENGE ||
    candidate.assignmentState !== 'NOT_CONFIGURED' ||
    candidate.deliveryState !== 'NOT_SENT' ||
    candidate.providerAccess !== 'NOT_CONFIGURED' ||
    candidate.runtimeConnection !== 'NOT_CONFIGURED'
  )
    throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  const dispatchId = reference(candidate.dispatchId);
  if (candidate.messageId !== dispatchId)
    throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  const issuedAt = timestamp(candidate.issuedAt);
  const expiresAt = timestamp(candidate.expiresAt);
  if (
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    Date.parse(expiresAt) - Date.parse(issuedAt) > MAX_WINDOW_MS
  )
    throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  const normalized = {
    schemaVersion: 1 as const,
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND as typeof CODEX_APP_SERVER_ADAPTER_KIND,
    workspaceId: reference(candidate.workspaceId),
    runtimeId: reference(candidate.runtimeId),
    connectionId: reference(candidate.connectionId),
    sessionId: reference(candidate.sessionId),
    principalReference: reference(candidate.principalReference),
    authGeneration: boundedInteger(candidate.authGeneration, 1, Number.MAX_SAFE_INTEGER),
    registrationCandidateHash: digest(candidate.registrationCandidateHash),
    capabilityCandidateHash: digest(candidate.capabilityCandidateHash),
    heartbeatCandidateHash: digest(candidate.heartbeatCandidateHash),
    capabilityDigest: digest(candidate.capabilityDigest),
    bridgeIdentityHash: digest(candidate.bridgeIdentityHash),
    secretBindingHash: digest(candidate.secretBindingHash),
    dispatchId,
    taskId: reference(candidate.taskId),
    runId: reference(candidate.runId),
    agentId: reference(candidate.agentId),
    authorityLevel: boundedInteger(candidate.authorityLevel, 0, 3) as 0 | 1 | 2 | 3,
    taskPolicyHash: digest(candidate.taskPolicyHash),
    maximumCostMinorUnits: 0 as const,
    maximumComputeUnits: boundedInteger(candidate.maximumComputeUnits, 1, 100),
    maximumDurationMs: boundedInteger(candidate.maximumDurationMs, 1, MAX_WINDOW_MS),
    outboundSequence: 1 as const,
    messageId: dispatchId,
    challengeCode: CODEX_VALIDATION_CHALLENGE,
    payloadDigest: digest(candidate.payloadDigest),
    unsignedEnvelopeDigest: digest(candidate.unsignedEnvelopeDigest),
    issuedAt,
    expiresAt,
    assignmentState: 'NOT_CONFIGURED' as const,
    deliveryState: 'NOT_SENT' as const,
    providerAccess: 'NOT_CONFIGURED' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  const unsigned = unsignedEnvelope(normalized);
  if (
    normalized.payloadDigest !== sha256(unsigned.payload) ||
    normalized.unsignedEnvelopeDigest !== sha256(unsigned)
  )
    throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  const expectedHash = sha256(normalized);
  if (digest(candidate.validationDispatchCandidateHash) !== expectedHash)
    throw new CodexValidationDispatchError('INVALID_EVIDENCE');
  return freeze({ ...normalized, validationDispatchCandidateHash: expectedHash });
}

export function createCodexValidationDispatchAuthorizationRequest(
  candidateInput: unknown,
  idempotencyKeyInput: unknown,
): Readonly<CodexValidationDispatchAuthorizationRequest> {
  const candidate = validateCodexValidationDispatchCandidate(candidateInput);
  return freeze({
    schemaVersion: 1 as const,
    workspaceId: candidate.workspaceId,
    runtimeId: candidate.runtimeId,
    connectionId: candidate.connectionId,
    taskId: candidate.taskId,
    runId: candidate.runId,
    validationDispatchCandidateHash: candidate.validationDispatchCandidateHash,
    heartbeatCandidateHash: candidate.heartbeatCandidateHash,
    taskPolicyHash: candidate.taskPolicyHash,
    idempotencyKey: reference(idempotencyKeyInput),
  });
}

export function codexValidationDispatchAuthorizationRequestHash(
  request: Readonly<CodexValidationDispatchAuthorizationRequest>,
): string {
  return sha256(request);
}

export function validateCodexValidationDispatchAuthorizationDecision(
  input: unknown,
  expectedRequestHash: string,
): Readonly<CodexValidationDispatchAuthorizationDecision> {
  const decision = exact(input, [
    'authorizationId',
    'authorizedByReference',
    'expiresAt',
    'issuedAt',
    'requestHash',
    'schemaVersion',
  ]);
  if (decision.schemaVersion !== 1 || digest(decision.requestHash) !== expectedRequestHash)
    throw new CodexValidationDispatchError('VALIDATION_DISPATCH_NOT_AUTHORIZED');
  const issuedAt = timestamp(decision.issuedAt);
  const expiresAt = timestamp(decision.expiresAt);
  if (
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    Date.parse(expiresAt) - Date.parse(issuedAt) > 5 * 60_000
  )
    throw new CodexValidationDispatchError('VALIDATION_DISPATCH_NOT_AUTHORIZED');
  return freeze({
    schemaVersion: 1,
    authorizationId: reference(decision.authorizationId),
    requestHash: expectedRequestHash,
    authorizedByReference: reference(decision.authorizedByReference),
    issuedAt,
    expiresAt,
  });
}

export function codexValidationDispatchUnsignedEnvelope(
  input: unknown,
): Omit<BridgeEnvelope, 'mac'> {
  return freeze(unsignedEnvelope(validateCodexValidationDispatchCandidate(input)));
}
