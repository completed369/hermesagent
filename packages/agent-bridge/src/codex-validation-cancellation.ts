import { createHash } from 'node:crypto';

import type { AuthenticatedJsonlSessionContext } from './authenticated-jsonl-session';
import { canonicalJson, validateBridgeEnvelope } from './codec';
import type { CodexCancellationTerminalEvidence } from './codex-app-server-session';
import type { CodexValidationUsageObservationEvidence } from './codex-validation-protocol-runner';
import { CODEX_APP_SERVER_ADAPTER_KIND } from './codex-app-server-policy';
import {
  CODEX_VALIDATION_CHALLENGE,
  validateCodexValidationDispatchCandidate,
  type CodexValidationDispatchCandidate,
} from './codex-validation-dispatch';
import type { BridgeEnvelope } from './protocol';

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const LEGACY_USAGE_EVIDENCE_HASH = '0'.repeat(64);
const EMPTY_PROGRESS_EVIDENCE_HASH =
  '801adbaf421a4c656b9ec0f28085e952a35d35212487487d5b95a95a7c3b6a64';
const EMPTY_TOKEN_USAGE_EVIDENCE_HASH =
  '95c9cbcf9d54ee66ed622c5c6dc41d45949a816164405da6219991a9b3dde532';
const USAGE_OBSERVATION_FIELDS = new Set([
  'progressEventCount',
  'progressEvidenceHash',
  'tokenUsageEventCount',
  'tokenUsageEvidenceHash',
  'usageAccountingState',
  'recognizedCostMinorUnits',
  'recognizedComputeUnits',
]);
export const CODEX_VALIDATION_CANCELLATION_RESULT_CODE = 'VALIDATION_CANCELLED' as const;

export type CodexValidationCancellationErrorCode =
  | 'INVALID_EVIDENCE'
  | 'DISPATCH_MISMATCH'
  | 'BRIDGE_IDENTITY_MISMATCH'
  | 'CANCELLATION_MISMATCH'
  | 'EVIDENCE_EXPIRED';

export class CodexValidationCancellationError extends Error {
  constructor(readonly code: CodexValidationCancellationErrorCode) {
    super(`Codex validation cancellation denied: ${code}`);
  }
}

export interface CodexValidationCancellationCandidate {
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
  readonly progressEventCount: number;
  readonly progressEvidenceHash: string;
  readonly tokenUsageEventCount: number;
  readonly tokenUsageEvidenceHash: string;
  readonly usageAccountingState: 'LEGACY_NOT_CAPTURED' | 'NOT_OBSERVED' | 'OBSERVED_UNMAPPED';
  readonly recognizedCostMinorUnits: 0;
  readonly recognizedComputeUnits: 0;
  readonly cancellationSequence: 2;
  readonly cancellationMessageId: string;
  readonly interruptRequestId: number;
  readonly interruptResponseHash: string;
  readonly terminalThreadId: string;
  readonly terminalTurnId: string;
  readonly terminalMessageHash: string;
  readonly cancellationPayloadDigest: string;
  readonly cancellationEnvelopeDigest: string;
  readonly cancellationAuthenticationTagDigest: string;
  readonly cancellationIssuedAt: string;
  readonly cancellationExpiresAt: string;
  readonly resultCode: typeof CODEX_VALIDATION_CANCELLATION_RESULT_CODE;
  readonly terminalState: 'INTERRUPTED';
  readonly providerAccess: 'NOT_CONFIGURED';
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly connectionTransition: 'NOT_APPLIED';
  readonly cancellationCandidateHash: string;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CodexValidationCancellationError('INVALID_EVIDENCE');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new CodexValidationCancellationError('INVALID_EVIDENCE');
  return value as JsonRecord;
}

function exact(value: unknown, keys: readonly string[]): JsonRecord {
  const result = record(value);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new CodexValidationCancellationError('INVALID_EVIDENCE');
  return result;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value))
    throw new CodexValidationCancellationError('INVALID_EVIDENCE');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new CodexValidationCancellationError('INVALID_EVIDENCE');
  return value;
}

function requestId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new CodexValidationCancellationError('INVALID_EVIDENCE');
  return value as number;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new CodexValidationCancellationError('INVALID_EVIDENCE');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new CodexValidationCancellationError('INVALID_EVIDENCE');
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function normalizedCandidateHash(value: JsonRecord, legacy: boolean): string {
  if (!legacy) return sha256(value);
  return sha256(
    Object.fromEntries(Object.entries(value).filter(([key]) => !USAGE_OBSERVATION_FIELDS.has(key))),
  );
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
    throw new CodexValidationCancellationError('BRIDGE_IDENTITY_MISMATCH');
  return {
    workspaceId: reference(bridge.workspaceId),
    runtimeId: reference(bridge.runtimeId),
    connectionId: reference(bridge.connectionId),
    sessionId: reference(bridge.sessionId),
    principalReference: reference(bridge.principalReference),
    authGeneration: bridge.authGeneration as number,
    expiresAt: timestamp(bridge.expiresAt),
  };
}

function terminalEvidence(
  input: unknown,
): Readonly<CodexCancellationTerminalEvidence & CodexValidationUsageObservationEvidence> {
  const terminal = exact(input, [
    'interruptRequestId',
    'interruptResponseHash',
    'messageHash',
    'progressEventCount',
    'progressEvidenceHash',
    'recognizedComputeUnits',
    'recognizedCostMinorUnits',
    'runtimeConnection',
    'status',
    'threadId',
    'tokenUsageEventCount',
    'tokenUsageEvidenceHash',
    'turnId',
    'usageAccountingState',
  ]);
  const usageAccountingState: 'NOT_OBSERVED' | 'OBSERVED_UNMAPPED' =
    (terminal.tokenUsageEventCount as number) === 0 ? 'NOT_OBSERVED' : 'OBSERVED_UNMAPPED';
  if (
    terminal.status !== 'interrupted' ||
    terminal.runtimeConnection !== 'NOT_CONFIGURED' ||
    !Number.isSafeInteger(terminal.progressEventCount) ||
    (terminal.progressEventCount as number) < 0 ||
    (terminal.progressEventCount as number) > 128 ||
    !Number.isSafeInteger(terminal.tokenUsageEventCount) ||
    (terminal.tokenUsageEventCount as number) < 0 ||
    (terminal.tokenUsageEventCount as number) > (terminal.progressEventCount as number) ||
    ((terminal.progressEventCount as number) === 0 &&
      terminal.progressEvidenceHash !== EMPTY_PROGRESS_EVIDENCE_HASH) ||
    ((terminal.tokenUsageEventCount as number) === 0 &&
      terminal.tokenUsageEvidenceHash !== EMPTY_TOKEN_USAGE_EVIDENCE_HASH) ||
    terminal.recognizedCostMinorUnits !== 0 ||
    terminal.recognizedComputeUnits !== 0 ||
    terminal.usageAccountingState !== usageAccountingState
  )
    throw new CodexValidationCancellationError('CANCELLATION_MISMATCH');
  return freeze({
    threadId: reference(terminal.threadId),
    turnId: reference(terminal.turnId),
    status: 'interrupted',
    messageHash: digest(terminal.messageHash),
    interruptRequestId: requestId(terminal.interruptRequestId),
    interruptResponseHash: digest(terminal.interruptResponseHash),
    runtimeConnection: 'NOT_CONFIGURED',
    progressEventCount: terminal.progressEventCount as number,
    progressEvidenceHash: digest(terminal.progressEvidenceHash),
    tokenUsageEventCount: terminal.tokenUsageEventCount as number,
    tokenUsageEvidenceHash: digest(terminal.tokenUsageEvidenceHash),
    usageAccountingState,
    recognizedCostMinorUnits: 0,
    recognizedComputeUnits: 0,
  });
}

function envelope(input: unknown): BridgeEnvelope {
  try {
    validateBridgeEnvelope(input);
    return input;
  } catch {
    throw new CodexValidationCancellationError('INVALID_EVIDENCE');
  }
}

export function createCodexValidationCancellationCandidate(input: {
  readonly dispatch: Readonly<CodexValidationDispatchCandidate>;
  readonly bridge: Readonly<AuthenticatedJsonlSessionContext>;
  readonly terminal: Readonly<
    CodexCancellationTerminalEvidence & CodexValidationUsageObservationEvidence
  >;
  readonly cancellationEnvelope: Readonly<BridgeEnvelope>;
}): Readonly<CodexValidationCancellationCandidate> {
  const dispatch = validateCodexValidationDispatchCandidate(input.dispatch);
  const bridge = bridgeIdentity(input.bridge);
  const terminal = terminalEvidence(input.terminal);
  const cancellationEnvelope = envelope(input.cancellationEnvelope);
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
    ) ||
    Object.entries(identity).some(
      ([key, value]) => cancellationEnvelope[key as keyof typeof identity] !== value,
    )
  )
    throw new CodexValidationCancellationError('BRIDGE_IDENTITY_MISMATCH');
  if (cancellationEnvelope.type !== 'CANCELLED' || cancellationEnvelope.sequence !== 2)
    throw new CodexValidationCancellationError('CANCELLATION_MISMATCH');
  const payload = exact(cancellationEnvelope.payload, [
    'challengeCode',
    'dispatchId',
    'interruptRequestId',
    'interruptResponseHash',
    'progressEventCount',
    'progressEvidenceHash',
    'recognizedComputeUnits',
    'recognizedCostMinorUnits',
    'resultCode',
    'runId',
    'taskId',
    'terminalMessageHash',
    'terminalStatus',
    'terminalThreadId',
    'terminalTurnId',
    'tokenUsageEventCount',
    'tokenUsageEvidenceHash',
    'usageAccountingState',
  ]);
  if (
    payload.challengeCode !== CODEX_VALIDATION_CHALLENGE ||
    payload.dispatchId !== dispatch.dispatchId ||
    payload.taskId !== dispatch.taskId ||
    payload.runId !== dispatch.runId ||
    payload.resultCode !== CODEX_VALIDATION_CANCELLATION_RESULT_CODE ||
    payload.interruptRequestId !== terminal.interruptRequestId ||
    payload.interruptResponseHash !== terminal.interruptResponseHash ||
    payload.terminalStatus !== 'interrupted' ||
    payload.terminalThreadId !== terminal.threadId ||
    payload.terminalTurnId !== terminal.turnId ||
    payload.terminalMessageHash !== terminal.messageHash ||
    payload.progressEventCount !== terminal.progressEventCount ||
    payload.progressEvidenceHash !== terminal.progressEvidenceHash ||
    payload.tokenUsageEventCount !== terminal.tokenUsageEventCount ||
    payload.tokenUsageEvidenceHash !== terminal.tokenUsageEvidenceHash ||
    payload.usageAccountingState !== terminal.usageAccountingState ||
    payload.recognizedCostMinorUnits !== 0 ||
    payload.recognizedComputeUnits !== 0
  )
    throw new CodexValidationCancellationError('CANCELLATION_MISMATCH');
  const cancellationIssuedAt = timestamp(cancellationEnvelope.issuedAt);
  const cancellationExpiresAt = timestamp(cancellationEnvelope.expiresAt);
  if (
    Date.parse(cancellationIssuedAt) < Date.parse(dispatch.issuedAt) ||
    Date.parse(cancellationIssuedAt) >= Date.parse(dispatch.expiresAt) ||
    Date.parse(cancellationExpiresAt) <= Date.parse(cancellationIssuedAt) ||
    Date.parse(cancellationExpiresAt) > Date.parse(dispatch.expiresAt) ||
    Date.parse(cancellationExpiresAt) > Date.parse(bridge.expiresAt)
  )
    throw new CodexValidationCancellationError('EVIDENCE_EXPIRED');
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
    progressEventCount: terminal.progressEventCount,
    progressEvidenceHash: terminal.progressEvidenceHash,
    tokenUsageEventCount: terminal.tokenUsageEventCount,
    tokenUsageEvidenceHash: terminal.tokenUsageEvidenceHash,
    usageAccountingState: terminal.usageAccountingState,
    recognizedCostMinorUnits: 0 as const,
    recognizedComputeUnits: 0 as const,
    cancellationSequence: 2 as const,
    cancellationMessageId: reference(cancellationEnvelope.messageId),
    interruptRequestId: terminal.interruptRequestId,
    interruptResponseHash: terminal.interruptResponseHash,
    terminalThreadId: terminal.threadId,
    terminalTurnId: terminal.turnId,
    terminalMessageHash: terminal.messageHash,
    cancellationPayloadDigest: digest(cancellationEnvelope.payloadDigest),
    cancellationEnvelopeDigest: sha256(unsigned(cancellationEnvelope)),
    cancellationAuthenticationTagDigest: hashText(cancellationEnvelope.mac),
    cancellationIssuedAt,
    cancellationExpiresAt,
    resultCode: CODEX_VALIDATION_CANCELLATION_RESULT_CODE,
    terminalState: 'INTERRUPTED' as const,
    providerAccess: 'NOT_CONFIGURED' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
    connectionTransition: 'NOT_APPLIED' as const,
  };
  return freeze({ ...normalized, cancellationCandidateHash: sha256(normalized) });
}

export function validateCodexValidationCancellationCandidate(
  input: unknown,
): Readonly<CodexValidationCancellationCandidate> {
  const candidate = exact(input, [
    'adapterKind',
    'agentId',
    'authGeneration',
    'authorityLevel',
    'cancellationAuthenticationTagDigest',
    'cancellationCandidateHash',
    'cancellationEnvelopeDigest',
    'cancellationExpiresAt',
    'cancellationIssuedAt',
    'cancellationMessageId',
    'cancellationPayloadDigest',
    'cancellationSequence',
    'connectionId',
    'connectionTransition',
    'dispatchId',
    'heartbeatCandidateHash',
    'interruptRequestId',
    'interruptResponseHash',
    'maximumCostMinorUnits',
    'principalReference',
    'progressEventCount',
    'progressEvidenceHash',
    'providerAccess',
    'recognizedComputeUnits',
    'recognizedCostMinorUnits',
    'resultCode',
    'runId',
    'runtimeConnection',
    'runtimeId',
    'schemaVersion',
    'sessionId',
    'taskId',
    'taskPolicyHash',
    'terminalMessageHash',
    'terminalState',
    'terminalThreadId',
    'terminalTurnId',
    'tokenUsageEventCount',
    'tokenUsageEvidenceHash',
    'usageAccountingState',
    'validationDispatchCandidateHash',
    'workspaceId',
  ]);
  const legacyUsage = candidate.usageAccountingState === 'LEGACY_NOT_CAPTURED';
  const usageAccountingState: 'LEGACY_NOT_CAPTURED' | 'NOT_OBSERVED' | 'OBSERVED_UNMAPPED' =
    legacyUsage
      ? 'LEGACY_NOT_CAPTURED'
      : (candidate.tokenUsageEventCount as number) === 0
        ? 'NOT_OBSERVED'
        : 'OBSERVED_UNMAPPED';
  if (
    candidate.schemaVersion !== 1 ||
    candidate.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
    candidate.maximumCostMinorUnits !== 0 ||
    candidate.recognizedCostMinorUnits !== 0 ||
    candidate.recognizedComputeUnits !== 0 ||
    !Number.isSafeInteger(candidate.progressEventCount) ||
    (candidate.progressEventCount as number) < 0 ||
    (candidate.progressEventCount as number) > 128 ||
    !Number.isSafeInteger(candidate.tokenUsageEventCount) ||
    (candidate.tokenUsageEventCount as number) < 0 ||
    (candidate.tokenUsageEventCount as number) > (candidate.progressEventCount as number) ||
    (legacyUsage &&
      (candidate.progressEventCount !== 0 ||
        candidate.tokenUsageEventCount !== 0 ||
        candidate.progressEvidenceHash !== LEGACY_USAGE_EVIDENCE_HASH ||
        candidate.tokenUsageEvidenceHash !== LEGACY_USAGE_EVIDENCE_HASH)) ||
    (!legacyUsage &&
      candidate.progressEventCount === 0 &&
      candidate.progressEvidenceHash !== EMPTY_PROGRESS_EVIDENCE_HASH) ||
    (!legacyUsage &&
      candidate.tokenUsageEventCount === 0 &&
      candidate.tokenUsageEvidenceHash !== EMPTY_TOKEN_USAGE_EVIDENCE_HASH) ||
    candidate.usageAccountingState !== usageAccountingState ||
    candidate.cancellationSequence !== 2 ||
    candidate.resultCode !== CODEX_VALIDATION_CANCELLATION_RESULT_CODE ||
    candidate.terminalState !== 'INTERRUPTED' ||
    candidate.providerAccess !== 'NOT_CONFIGURED' ||
    candidate.runtimeConnection !== 'NOT_CONFIGURED' ||
    candidate.connectionTransition !== 'NOT_APPLIED' ||
    !Number.isSafeInteger(candidate.authGeneration) ||
    !Number.isSafeInteger(candidate.authorityLevel) ||
    (candidate.authorityLevel as number) < 0 ||
    (candidate.authorityLevel as number) > 3
  )
    throw new CodexValidationCancellationError('INVALID_EVIDENCE');
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
    progressEventCount: candidate.progressEventCount as number,
    progressEvidenceHash: digest(candidate.progressEvidenceHash),
    tokenUsageEventCount: candidate.tokenUsageEventCount as number,
    tokenUsageEvidenceHash: digest(candidate.tokenUsageEvidenceHash),
    usageAccountingState,
    recognizedCostMinorUnits: 0 as const,
    recognizedComputeUnits: 0 as const,
    cancellationSequence: 2 as const,
    cancellationMessageId: reference(candidate.cancellationMessageId),
    interruptRequestId: requestId(candidate.interruptRequestId),
    interruptResponseHash: digest(candidate.interruptResponseHash),
    terminalThreadId: reference(candidate.terminalThreadId),
    terminalTurnId: reference(candidate.terminalTurnId),
    terminalMessageHash: digest(candidate.terminalMessageHash),
    cancellationPayloadDigest: digest(candidate.cancellationPayloadDigest),
    cancellationEnvelopeDigest: digest(candidate.cancellationEnvelopeDigest),
    cancellationAuthenticationTagDigest: digest(candidate.cancellationAuthenticationTagDigest),
    cancellationIssuedAt: timestamp(candidate.cancellationIssuedAt),
    cancellationExpiresAt: timestamp(candidate.cancellationExpiresAt),
    resultCode: CODEX_VALIDATION_CANCELLATION_RESULT_CODE,
    terminalState: 'INTERRUPTED' as const,
    providerAccess: 'NOT_CONFIGURED' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
    connectionTransition: 'NOT_APPLIED' as const,
  };
  if (Date.parse(normalized.cancellationExpiresAt) <= Date.parse(normalized.cancellationIssuedAt))
    throw new CodexValidationCancellationError('INVALID_EVIDENCE');
  const expectedHash = normalizedCandidateHash(normalized, legacyUsage);
  if (digest(candidate.cancellationCandidateHash) !== expectedHash)
    throw new CodexValidationCancellationError('INVALID_EVIDENCE');
  return freeze({ ...normalized, cancellationCandidateHash: expectedHash });
}
