import { createHash } from 'node:crypto';

import type { AuthenticatedJsonlSessionContext } from './authenticated-jsonl-session';
import { canonicalJson, validateBridgeEnvelope } from './codec';
import { CODEX_APP_SERVER_ADAPTER_KIND } from './codex-app-server-policy';
import {
  validateCodexAuthenticatedRegistrationCandidate,
  type CodexAuthenticatedRegistrationCandidate,
} from './codex-authenticated-registration';
import {
  validateCodexCapabilityExchangeCandidate,
  type CodexCapabilityExchangeCandidate,
} from './codex-capability-exchange';
import type { BridgeEnvelope } from './protocol';

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_HEARTBEAT_WINDOW_MS = 5 * 60_000;

export type CodexHeartbeatHealth = 'HEALTHY' | 'DEGRADED';

export type CodexHeartbeatEvidenceErrorCode =
  | 'INVALID_EVIDENCE'
  | 'REGISTRATION_MISMATCH'
  | 'CAPABILITY_MISMATCH'
  | 'BRIDGE_IDENTITY_MISMATCH'
  | 'EVIDENCE_EXPIRED';

export class CodexHeartbeatEvidenceError extends Error {
  constructor(readonly code: CodexHeartbeatEvidenceErrorCode) {
    super(`Codex heartbeat evidence denied: ${code}`);
  }
}

export interface CodexHeartbeatEvidenceCandidate {
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
  readonly capabilityDigest: string;
  readonly bridgeIdentityHash: string;
  readonly secretBindingHash: string;
  readonly sequence: 1;
  readonly messageId: string;
  readonly health: CodexHeartbeatHealth;
  readonly payloadDigest: string;
  readonly envelopeDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly heartbeatCandidateHash: string;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  return value as JsonRecord;
}

function exact(value: unknown, keys: readonly string[]): JsonRecord {
  const result = record(value);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  return result;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value))
    throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  return value;
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

function normalizedBridge(input: unknown) {
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
  if (
    bridge.schemaVersion !== 1 ||
    !Number.isSafeInteger(bridge.authGeneration) ||
    (bridge.authGeneration as number) < 1
  )
    throw new CodexHeartbeatEvidenceError('BRIDGE_IDENTITY_MISMATCH');
  return {
    workspaceId: reference(bridge.workspaceId),
    runtimeId: reference(bridge.runtimeId),
    connectionId: reference(bridge.connectionId),
    sessionId: reference(bridge.sessionId),
    principalReference: reference(bridge.principalReference),
    parentNonce: reference(bridge.parentNonce),
    runtimeNonce: reference(bridge.runtimeNonce),
    secretReference: reference(bridge.secretReference),
    expectedSecretDigest: digest(bridge.expectedSecretDigest),
    authGeneration: bridge.authGeneration as number,
    authenticatedAt: timestamp(bridge.authenticatedAt),
    expiresAt: timestamp(bridge.expiresAt),
  };
}

function unsignedEnvelope(envelope: BridgeEnvelope): Omit<BridgeEnvelope, 'mac'> {
  const { mac: _mac, ...unsigned } = envelope;
  return unsigned;
}

/**
 * Normalizes an already-observed runtime-to-parent heartbeat. MAC validation and
 * secret access remain the responsibility of the durable admission boundary.
 */
export function createCodexHeartbeatEvidenceCandidate(input: {
  readonly registration: Readonly<CodexAuthenticatedRegistrationCandidate>;
  readonly capability: Readonly<CodexCapabilityExchangeCandidate>;
  readonly bridge: Readonly<AuthenticatedJsonlSessionContext>;
  readonly envelope: Readonly<BridgeEnvelope>;
}): Readonly<CodexHeartbeatEvidenceCandidate> {
  const registration = validateCodexAuthenticatedRegistrationCandidate(input.registration);
  const capability = validateCodexCapabilityExchangeCandidate(input.capability);
  const bridge = normalizedBridge(input.bridge);
  try {
    validateBridgeEnvelope(input.envelope);
  } catch {
    throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  }
  const envelope = input.envelope;
  if (
    capability.registrationCandidateHash !== registration.registrationCandidateHash ||
    capability.workspaceId !== registration.workspaceId ||
    capability.runtimeId !== registration.runtimeId ||
    capability.connectionId !== registration.connectionId ||
    capability.sessionId !== registration.sessionId ||
    capability.principalReference !== registration.principalReference ||
    capability.authGeneration !== registration.authGeneration
  )
    throw new CodexHeartbeatEvidenceError('CAPABILITY_MISMATCH');
  const identity = {
    workspaceId: bridge.workspaceId,
    runtimeId: bridge.runtimeId,
    connectionId: bridge.connectionId,
    sessionId: bridge.sessionId,
    principalReference: bridge.principalReference,
  };
  if (
    Object.entries(identity).some(
      ([key, value]) => registration[key as keyof typeof identity] !== value,
    ) ||
    bridge.authGeneration !== registration.authGeneration
  )
    throw new CodexHeartbeatEvidenceError('REGISTRATION_MISMATCH');
  const bridgeIdentityHash = sha256({
    authGeneration: bridge.authGeneration,
    authenticatedAt: bridge.authenticatedAt,
    connectionId: bridge.connectionId,
    expectedSecretDigest: bridge.expectedSecretDigest,
    expiresAt: bridge.expiresAt,
    parentNonce: bridge.parentNonce,
    principalReference: bridge.principalReference,
    runtimeNonce: bridge.runtimeNonce,
    runtimeId: bridge.runtimeId,
    secretReference: bridge.secretReference,
    sessionId: bridge.sessionId,
    workspaceId: bridge.workspaceId,
  });
  const secretBindingHash = sha256({
    expectedSecretDigest: bridge.expectedSecretDigest,
    secretReference: bridge.secretReference,
  });
  if (
    registration.bridgeIdentityHash !== bridgeIdentityHash ||
    registration.secretBindingHash !== secretBindingHash ||
    capability.bridgeIdentityHash !== bridgeIdentityHash
  )
    throw new CodexHeartbeatEvidenceError('BRIDGE_IDENTITY_MISMATCH');
  if (
    Object.entries(identity).some(
      ([key, value]) => envelope[key as keyof typeof identity] !== value,
    ) ||
    envelope.type !== 'HEARTBEAT' ||
    envelope.sequence !== 1
  )
    throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  const payload = exact(envelope.payload, ['health']);
  if (payload.health !== 'HEALTHY' && payload.health !== 'DEGRADED')
    throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  const issuedAt = timestamp(envelope.issuedAt);
  const expiresAt = timestamp(envelope.expiresAt);
  if (
    Date.parse(expiresAt) - Date.parse(issuedAt) > MAX_HEARTBEAT_WINDOW_MS ||
    Date.parse(issuedAt) < Date.parse(capability.observedAt) ||
    Date.parse(issuedAt) < Date.parse(bridge.authenticatedAt) ||
    Date.parse(expiresAt) > Date.parse(bridge.expiresAt)
  )
    throw new CodexHeartbeatEvidenceError('EVIDENCE_EXPIRED');
  const candidate = {
    schemaVersion: 1 as const,
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND as typeof CODEX_APP_SERVER_ADAPTER_KIND,
    ...identity,
    authGeneration: bridge.authGeneration,
    registrationCandidateHash: registration.registrationCandidateHash,
    capabilityCandidateHash: capability.capabilityCandidateHash,
    capabilityDigest: capability.capabilityDigest,
    bridgeIdentityHash,
    secretBindingHash,
    sequence: 1 as const,
    messageId: reference(envelope.messageId),
    health: payload.health as CodexHeartbeatHealth,
    payloadDigest: digest(envelope.payloadDigest),
    envelopeDigest: sha256(unsignedEnvelope(envelope)),
    issuedAt,
    expiresAt,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  return freeze({ ...candidate, heartbeatCandidateHash: sha256(candidate) });
}

export function validateCodexHeartbeatEvidenceCandidate(
  input: unknown,
): Readonly<CodexHeartbeatEvidenceCandidate> {
  const candidate = exact(input, [
    'adapterKind',
    'authGeneration',
    'bridgeIdentityHash',
    'capabilityCandidateHash',
    'capabilityDigest',
    'connectionId',
    'envelopeDigest',
    'expiresAt',
    'health',
    'heartbeatCandidateHash',
    'issuedAt',
    'messageId',
    'payloadDigest',
    'principalReference',
    'registrationCandidateHash',
    'runtimeConnection',
    'runtimeId',
    'schemaVersion',
    'secretBindingHash',
    'sequence',
    'sessionId',
    'workspaceId',
  ]);
  if (
    candidate.schemaVersion !== 1 ||
    candidate.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
    candidate.runtimeConnection !== 'NOT_CONFIGURED' ||
    candidate.sequence !== 1 ||
    (candidate.health !== 'HEALTHY' && candidate.health !== 'DEGRADED') ||
    !Number.isSafeInteger(candidate.authGeneration) ||
    (candidate.authGeneration as number) < 1
  )
    throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  const issuedAt = timestamp(candidate.issuedAt);
  const expiresAt = timestamp(candidate.expiresAt);
  if (
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    Date.parse(expiresAt) - Date.parse(issuedAt) > MAX_HEARTBEAT_WINDOW_MS
  )
    throw new CodexHeartbeatEvidenceError('EVIDENCE_EXPIRED');
  const normalized = {
    schemaVersion: 1 as const,
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND as typeof CODEX_APP_SERVER_ADAPTER_KIND,
    workspaceId: reference(candidate.workspaceId),
    runtimeId: reference(candidate.runtimeId),
    connectionId: reference(candidate.connectionId),
    sessionId: reference(candidate.sessionId),
    principalReference: reference(candidate.principalReference),
    authGeneration: candidate.authGeneration as number,
    registrationCandidateHash: digest(candidate.registrationCandidateHash),
    capabilityCandidateHash: digest(candidate.capabilityCandidateHash),
    capabilityDigest: digest(candidate.capabilityDigest),
    bridgeIdentityHash: digest(candidate.bridgeIdentityHash),
    secretBindingHash: digest(candidate.secretBindingHash),
    sequence: 1 as const,
    messageId: reference(candidate.messageId),
    health: candidate.health as CodexHeartbeatHealth,
    payloadDigest: digest(candidate.payloadDigest),
    envelopeDigest: digest(candidate.envelopeDigest),
    issuedAt,
    expiresAt,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  const expectedHash = sha256(normalized);
  if (digest(candidate.heartbeatCandidateHash) !== expectedHash)
    throw new CodexHeartbeatEvidenceError('INVALID_EVIDENCE');
  return freeze({ ...normalized, heartbeatCandidateHash: expectedHash });
}
