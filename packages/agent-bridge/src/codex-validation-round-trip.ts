import { createHash } from 'node:crypto';

import type { AuthenticatedJsonlSessionContext } from './authenticated-jsonl-session';
import { canonicalJson, validateBridgeEnvelope } from './codec';
import type { CodexTerminalEvidence } from './codex-app-server-session';
import { CODEX_APP_SERVER_ADAPTER_KIND } from './codex-app-server-policy';
import {
  CODEX_VALIDATION_CHALLENGE,
  validateCodexValidationDispatchCandidate,
  type CodexValidationDispatchCandidate,
} from './codex-validation-dispatch';
import type { BridgeEnvelope } from './protocol';

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
export const CODEX_VALIDATION_RESULT_CODE = 'VALIDATION_COMPLETED' as const;

export type CodexValidationRoundTripErrorCode =
  | 'INVALID_EVIDENCE'
  | 'DISPATCH_MISMATCH'
  | 'BRIDGE_IDENTITY_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'RESULT_MISMATCH'
  | 'EVIDENCE_EXPIRED';

export class CodexValidationRoundTripError extends Error {
  constructor(readonly code: CodexValidationRoundTripErrorCode) {
    super(`Codex validation round trip denied: ${code}`);
  }
}

export interface CodexValidationRoundTripCandidate {
  readonly schemaVersion: 1;
  readonly adapterKind: typeof CODEX_APP_SERVER_ADAPTER_KIND;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly authGeneration: number;
  readonly validationDispatchCandidateHash: string;
  readonly heartbeatCandidateHash: string;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly authorityLevel: 0 | 1 | 2 | 3;
  readonly taskPolicyHash: string;
  readonly maximumCostMinorUnits: 0;
  readonly statusSequence: 2;
  readonly statusMessageId: string;
  readonly statusPayloadDigest: string;
  readonly statusEnvelopeDigest: string;
  readonly statusAuthenticationTagDigest: string;
  readonly statusIssuedAt: string;
  readonly statusExpiresAt: string;
  readonly terminalSequence: 3;
  readonly terminalMessageId: string;
  readonly terminalThreadId: string;
  readonly terminalTurnId: string;
  readonly terminalMessageHash: string;
  readonly terminalPayloadDigest: string;
  readonly terminalEnvelopeDigest: string;
  readonly terminalAuthenticationTagDigest: string;
  readonly terminalIssuedAt: string;
  readonly terminalExpiresAt: string;
  readonly resultCode: typeof CODEX_VALIDATION_RESULT_CODE;
  readonly statusState: 'ACCEPTED';
  readonly terminalState: 'COMPLETED';
  readonly providerAccess: 'NOT_CONFIGURED';
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly connectionTransition: 'NOT_APPLIED';
  readonly roundTripCandidateHash: string;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CodexValidationRoundTripError('INVALID_EVIDENCE');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new CodexValidationRoundTripError('INVALID_EVIDENCE');
  return value as JsonRecord;
}

function exact(value: unknown, keys: readonly string[]): JsonRecord {
  const result = record(value);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new CodexValidationRoundTripError('INVALID_EVIDENCE');
  return result;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value))
    throw new CodexValidationRoundTripError('INVALID_EVIDENCE');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new CodexValidationRoundTripError('INVALID_EVIDENCE');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new CodexValidationRoundTripError('INVALID_EVIDENCE');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new CodexValidationRoundTripError('INVALID_EVIDENCE');
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function unsigned(envelope: BridgeEnvelope): Omit<BridgeEnvelope, 'mac'> {
  const { mac: _mac, ...value } = envelope;
  return value;
}

function freeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value as Readonly<T>;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function bridgeIdentity(input: unknown) {
  const bridge = exact(input, [
    'authGeneration',
    'authenticatedAt',
    'connectionId',
    'expectedSecretDigest',
    'expiresAt',
    'parentNonce',
    'principalReference',
    'runtimeId',
    'runtimeNonce',
    'schemaVersion',
    'secretReference',
    'sessionId',
    'workspaceId',
  ]);
  if (bridge.schemaVersion !== 1 || !Number.isSafeInteger(bridge.authGeneration))
    throw new CodexValidationRoundTripError('BRIDGE_IDENTITY_MISMATCH');
  return {
    workspaceId: reference(bridge.workspaceId),
    runtimeId: reference(bridge.runtimeId),
    connectionId: reference(bridge.connectionId),
    sessionId: reference(bridge.sessionId),
    principalReference: reference(bridge.principalReference),
    authGeneration: bridge.authGeneration as number,
    authenticatedAt: timestamp(bridge.authenticatedAt),
    expiresAt: timestamp(bridge.expiresAt),
    parentNonce: reference(bridge.parentNonce),
    runtimeNonce: reference(bridge.runtimeNonce),
    secretReference: reference(bridge.secretReference),
    expectedSecretDigest: digest(bridge.expectedSecretDigest),
  };
}

function terminalEvidence(input: unknown): Readonly<CodexTerminalEvidence> {
  const evidence = exact(input, [
    'messageHash',
    'runtimeConnection',
    'status',
    'threadId',
    'turnId',
  ]);
  if (evidence.status !== 'completed' || evidence.runtimeConnection !== 'NOT_CONFIGURED')
    throw new CodexValidationRoundTripError('RESULT_MISMATCH');
  return freeze({
    threadId: reference(evidence.threadId),
    turnId: reference(evidence.turnId),
    status: 'completed' as const,
    messageHash: digest(evidence.messageHash),
    runtimeConnection: 'NOT_CONFIGURED' as const,
  });
}

function envelope(input: unknown): BridgeEnvelope {
  try {
    validateBridgeEnvelope(input);
    return input;
  } catch {
    throw new CodexValidationRoundTripError('INVALID_EVIDENCE');
  }
}

export function createCodexValidationRoundTripCandidate(input: {
  readonly dispatch: Readonly<CodexValidationDispatchCandidate>;
  readonly bridge: Readonly<AuthenticatedJsonlSessionContext>;
  readonly terminal: Readonly<CodexTerminalEvidence>;
  readonly statusEnvelope: Readonly<BridgeEnvelope>;
  readonly terminalEnvelope: Readonly<BridgeEnvelope>;
}): Readonly<CodexValidationRoundTripCandidate> {
  const dispatch = validateCodexValidationDispatchCandidate(input.dispatch);
  const bridge = bridgeIdentity(input.bridge);
  const terminal = terminalEvidence(input.terminal);
  const statusEnvelope = envelope(input.statusEnvelope);
  const terminalEnvelope = envelope(input.terminalEnvelope);
  const identity = {
    workspaceId: bridge.workspaceId,
    runtimeId: bridge.runtimeId,
    connectionId: bridge.connectionId,
    sessionId: bridge.sessionId,
    principalReference: bridge.principalReference,
  };
  if (
    bridge.authGeneration !== dispatch.authGeneration ||
    Object.entries(identity).some(
      ([key, value]) => dispatch[key as keyof typeof identity] !== value,
    )
  )
    throw new CodexValidationRoundTripError('BRIDGE_IDENTITY_MISMATCH');
  for (const observed of [statusEnvelope, terminalEnvelope]) {
    if (
      Object.entries(identity).some(
        ([key, value]) => observed[key as keyof typeof identity] !== value,
      )
    )
      throw new CodexValidationRoundTripError('BRIDGE_IDENTITY_MISMATCH');
  }
  if (statusEnvelope.type !== 'DISPATCH_ACCEPTED' || statusEnvelope.sequence !== 2)
    throw new CodexValidationRoundTripError('STATUS_MISMATCH');
  if (terminalEnvelope.type !== 'RESULT' || terminalEnvelope.sequence !== 3)
    throw new CodexValidationRoundTripError('RESULT_MISMATCH');
  const statusPayload = exact(statusEnvelope.payload, [
    'challengeCode',
    'dispatchId',
    'runId',
    'taskId',
  ]);
  const resultPayload = exact(terminalEnvelope.payload, [
    'challengeCode',
    'dispatchId',
    'resultCode',
    'runId',
    'taskId',
    'terminalMessageHash',
    'terminalThreadId',
    'terminalStatus',
    'terminalTurnId',
  ]);
  if (
    statusPayload.challengeCode !== CODEX_VALIDATION_CHALLENGE ||
    statusPayload.dispatchId !== dispatch.dispatchId ||
    statusPayload.taskId !== dispatch.taskId ||
    statusPayload.runId !== dispatch.runId
  )
    throw new CodexValidationRoundTripError('STATUS_MISMATCH');
  if (
    resultPayload.challengeCode !== CODEX_VALIDATION_CHALLENGE ||
    resultPayload.dispatchId !== dispatch.dispatchId ||
    resultPayload.taskId !== dispatch.taskId ||
    resultPayload.runId !== dispatch.runId ||
    resultPayload.resultCode !== CODEX_VALIDATION_RESULT_CODE ||
    resultPayload.terminalStatus !== 'completed' ||
    resultPayload.terminalThreadId !== terminal.threadId ||
    resultPayload.terminalTurnId !== terminal.turnId ||
    resultPayload.terminalMessageHash !== terminal.messageHash
  )
    throw new CodexValidationRoundTripError('RESULT_MISMATCH');
  const statusIssuedAt = timestamp(statusEnvelope.issuedAt);
  const statusExpiresAt = timestamp(statusEnvelope.expiresAt);
  const terminalIssuedAt = timestamp(terminalEnvelope.issuedAt);
  const terminalExpiresAt = timestamp(terminalEnvelope.expiresAt);
  if (
    Date.parse(statusIssuedAt) < Date.parse(dispatch.issuedAt) ||
    Date.parse(terminalIssuedAt) < Date.parse(statusIssuedAt) ||
    Date.parse(statusExpiresAt) > Date.parse(dispatch.expiresAt) ||
    Date.parse(statusExpiresAt) > Date.parse(bridge.expiresAt) ||
    Date.parse(terminalExpiresAt) > Date.parse(dispatch.expiresAt) ||
    Date.parse(terminalExpiresAt) > Date.parse(bridge.expiresAt) ||
    Date.parse(terminalIssuedAt) >= Date.parse(dispatch.expiresAt)
  )
    throw new CodexValidationRoundTripError('EVIDENCE_EXPIRED');
  const normalized = {
    schemaVersion: 1 as const,
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND as typeof CODEX_APP_SERVER_ADAPTER_KIND,
    ...identity,
    authGeneration: bridge.authGeneration,
    validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
    heartbeatCandidateHash: dispatch.heartbeatCandidateHash,
    dispatchId: dispatch.dispatchId,
    taskId: dispatch.taskId,
    runId: dispatch.runId,
    agentId: dispatch.agentId,
    authorityLevel: dispatch.authorityLevel,
    taskPolicyHash: dispatch.taskPolicyHash,
    maximumCostMinorUnits: 0 as const,
    statusSequence: 2 as const,
    statusMessageId: reference(statusEnvelope.messageId),
    statusPayloadDigest: digest(statusEnvelope.payloadDigest),
    statusEnvelopeDigest: sha256(unsigned(statusEnvelope)),
    statusAuthenticationTagDigest: hashText(statusEnvelope.mac),
    statusIssuedAt,
    statusExpiresAt,
    terminalSequence: 3 as const,
    terminalMessageId: reference(terminalEnvelope.messageId),
    terminalThreadId: terminal.threadId,
    terminalTurnId: terminal.turnId,
    terminalMessageHash: terminal.messageHash,
    terminalPayloadDigest: digest(terminalEnvelope.payloadDigest),
    terminalEnvelopeDigest: sha256(unsigned(terminalEnvelope)),
    terminalAuthenticationTagDigest: hashText(terminalEnvelope.mac),
    terminalIssuedAt,
    terminalExpiresAt,
    resultCode: CODEX_VALIDATION_RESULT_CODE,
    statusState: 'ACCEPTED' as const,
    terminalState: 'COMPLETED' as const,
    providerAccess: 'NOT_CONFIGURED' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
    connectionTransition: 'NOT_APPLIED' as const,
  };
  if (normalized.statusMessageId === normalized.terminalMessageId)
    throw new CodexValidationRoundTripError('RESULT_MISMATCH');
  return freeze({ ...normalized, roundTripCandidateHash: sha256(normalized) });
}

export function validateCodexValidationRoundTripCandidate(
  input: unknown,
): Readonly<CodexValidationRoundTripCandidate> {
  const candidate = exact(input, [
    'adapterKind',
    'agentId',
    'authGeneration',
    'authorityLevel',
    'connectionId',
    'connectionTransition',
    'dispatchId',
    'heartbeatCandidateHash',
    'maximumCostMinorUnits',
    'principalReference',
    'providerAccess',
    'resultCode',
    'roundTripCandidateHash',
    'runId',
    'runtimeConnection',
    'runtimeId',
    'schemaVersion',
    'sessionId',
    'statusAuthenticationTagDigest',
    'statusEnvelopeDigest',
    'statusExpiresAt',
    'statusIssuedAt',
    'statusMessageId',
    'statusPayloadDigest',
    'statusSequence',
    'statusState',
    'taskId',
    'taskPolicyHash',
    'terminalAuthenticationTagDigest',
    'terminalEnvelopeDigest',
    'terminalExpiresAt',
    'terminalIssuedAt',
    'terminalMessageHash',
    'terminalMessageId',
    'terminalPayloadDigest',
    'terminalSequence',
    'terminalState',
    'terminalThreadId',
    'terminalTurnId',
    'validationDispatchCandidateHash',
    'workspaceId',
  ]);
  if (
    candidate.schemaVersion !== 1 ||
    candidate.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
    candidate.maximumCostMinorUnits !== 0 ||
    candidate.statusSequence !== 2 ||
    candidate.terminalSequence !== 3 ||
    candidate.statusState !== 'ACCEPTED' ||
    candidate.terminalState !== 'COMPLETED' ||
    candidate.resultCode !== CODEX_VALIDATION_RESULT_CODE ||
    candidate.providerAccess !== 'NOT_CONFIGURED' ||
    candidate.runtimeConnection !== 'NOT_CONFIGURED' ||
    candidate.connectionTransition !== 'NOT_APPLIED' ||
    !Number.isSafeInteger(candidate.authGeneration) ||
    !Number.isSafeInteger(candidate.authorityLevel) ||
    (candidate.authorityLevel as number) < 0 ||
    (candidate.authorityLevel as number) > 3
  )
    throw new CodexValidationRoundTripError('INVALID_EVIDENCE');
  const normalized = {
    schemaVersion: 1 as const,
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND as typeof CODEX_APP_SERVER_ADAPTER_KIND,
    workspaceId: reference(candidate.workspaceId),
    runtimeId: reference(candidate.runtimeId),
    connectionId: reference(candidate.connectionId),
    sessionId: reference(candidate.sessionId),
    principalReference: reference(candidate.principalReference),
    authGeneration: candidate.authGeneration as number,
    validationDispatchCandidateHash: digest(candidate.validationDispatchCandidateHash),
    heartbeatCandidateHash: digest(candidate.heartbeatCandidateHash),
    dispatchId: reference(candidate.dispatchId),
    taskId: reference(candidate.taskId),
    runId: reference(candidate.runId),
    agentId: reference(candidate.agentId),
    authorityLevel: candidate.authorityLevel as 0 | 1 | 2 | 3,
    taskPolicyHash: digest(candidate.taskPolicyHash),
    maximumCostMinorUnits: 0 as const,
    statusSequence: 2 as const,
    statusMessageId: reference(candidate.statusMessageId),
    statusPayloadDigest: digest(candidate.statusPayloadDigest),
    statusEnvelopeDigest: digest(candidate.statusEnvelopeDigest),
    statusAuthenticationTagDigest: digest(candidate.statusAuthenticationTagDigest),
    statusIssuedAt: timestamp(candidate.statusIssuedAt),
    statusExpiresAt: timestamp(candidate.statusExpiresAt),
    terminalSequence: 3 as const,
    terminalMessageId: reference(candidate.terminalMessageId),
    terminalThreadId: reference(candidate.terminalThreadId),
    terminalTurnId: reference(candidate.terminalTurnId),
    terminalMessageHash: digest(candidate.terminalMessageHash),
    terminalPayloadDigest: digest(candidate.terminalPayloadDigest),
    terminalEnvelopeDigest: digest(candidate.terminalEnvelopeDigest),
    terminalAuthenticationTagDigest: digest(candidate.terminalAuthenticationTagDigest),
    terminalIssuedAt: timestamp(candidate.terminalIssuedAt),
    terminalExpiresAt: timestamp(candidate.terminalExpiresAt),
    resultCode: CODEX_VALIDATION_RESULT_CODE,
    statusState: 'ACCEPTED' as const,
    terminalState: 'COMPLETED' as const,
    providerAccess: 'NOT_CONFIGURED' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
    connectionTransition: 'NOT_APPLIED' as const,
  };
  if (
    normalized.statusMessageId === normalized.terminalMessageId ||
    Date.parse(normalized.terminalIssuedAt) < Date.parse(normalized.statusIssuedAt) ||
    Date.parse(normalized.statusExpiresAt) <= Date.parse(normalized.statusIssuedAt) ||
    Date.parse(normalized.terminalExpiresAt) <= Date.parse(normalized.terminalIssuedAt)
  )
    throw new CodexValidationRoundTripError('INVALID_EVIDENCE');
  const expectedHash = sha256(normalized);
  if (digest(candidate.roundTripCandidateHash) !== expectedHash)
    throw new CodexValidationRoundTripError('INVALID_EVIDENCE');
  return freeze({ ...normalized, roundTripCandidateHash: expectedHash });
}
