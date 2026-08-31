import { createHash } from 'node:crypto';

import type { AuthenticatedJsonlSessionContext } from './authenticated-jsonl-session';
import { canonicalJson } from './codec';
import {
  CODEX_APP_SERVER_ADAPTER_KIND,
  type ValidatedCodexAppServerManifest,
  validateCodexAppServerManifest,
} from './codex-app-server-policy';
import type { CodexAppServerSessionSnapshot } from './codex-app-server-session';

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CODEX_RUNTIME = /^codex(?:[._:-]|$)/u;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

export type CodexAuthenticatedRegistrationErrorCode =
  | 'INVALID_EVIDENCE'
  | 'ADAPTER_MISMATCH'
  | 'PROTOCOL_NOT_READY'
  | 'BRIDGE_IDENTITY_MISMATCH'
  | 'ACCOUNT_NOT_AUTHENTICATED'
  | 'EVIDENCE_EXPIRED';

export class CodexAuthenticatedRegistrationError extends Error {
  constructor(readonly code: CodexAuthenticatedRegistrationErrorCode) {
    super(`Codex authenticated registration denied: ${code}`);
  }
}

export interface CodexAccountReadEvidence {
  readonly request: unknown;
  readonly response: unknown;
  readonly observedAt: string;
}

export interface CodexAuthenticatedRegistrationCandidate {
  readonly schemaVersion: 1;
  readonly adapterKind: typeof CODEX_APP_SERVER_ADAPTER_KIND;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly authGeneration: number;
  readonly accountAuthMode: 'KEY' | 'CHATGPT';
  readonly manifestHash: string;
  readonly adapterPolicyHash: string;
  readonly bridgeIdentityHash: string;
  readonly accountEvidenceHash: string;
  readonly registrationCandidateHash: string;
  readonly observedAt: string;
  readonly registrationAuthorization: 'NOT_CONFIGURED';
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CodexAuthenticatedRegistrationError('INVALID_EVIDENCE');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new CodexAuthenticatedRegistrationError('INVALID_EVIDENCE');
  return value as JsonRecord;
}

function exact(value: unknown, keys: readonly string[]): JsonRecord {
  const result = record(value);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new CodexAuthenticatedRegistrationError('INVALID_EVIDENCE');
  return result;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value) || CONTROL.test(value))
    throw new CodexAuthenticatedRegistrationError('INVALID_EVIDENCE');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new CodexAuthenticatedRegistrationError('INVALID_EVIDENCE');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new CodexAuthenticatedRegistrationError('INVALID_EVIDENCE');
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

function accountMode(evidence: CodexAccountReadEvidence): {
  readonly mode: 'KEY' | 'CHATGPT';
  readonly requestId: number;
} {
  const request = exact(evidence.request, ['id', 'method', 'params']);
  if (
    !Number.isSafeInteger(request.id) ||
    (request.id as number) < 1 ||
    request.method !== 'account/read'
  )
    throw new CodexAuthenticatedRegistrationError('INVALID_EVIDENCE');
  const params = exact(request.params, ['refreshToken']);
  if (params.refreshToken !== false)
    throw new CodexAuthenticatedRegistrationError('INVALID_EVIDENCE');

  const response = exact(evidence.response, ['id', 'result']);
  if (response.id !== request.id) throw new CodexAuthenticatedRegistrationError('INVALID_EVIDENCE');
  const result = exact(response.result, ['account', 'requiresOpenaiAuth']);
  if (result.requiresOpenaiAuth !== true || result.account === null)
    throw new CodexAuthenticatedRegistrationError('ACCOUNT_NOT_AUTHENTICATED');
  const account = record(result.account);
  if (account.type === 'apiKey') {
    exact(account, ['type']);
    return { mode: 'KEY', requestId: request.id as number };
  }
  if (account.type === 'chatgpt') {
    const managed = exact(account, ['email', 'planType', 'type']);
    if (
      (managed.email !== null &&
        (typeof managed.email !== 'string' ||
          managed.email.length > 320 ||
          CONTROL.test(managed.email))) ||
      (managed.planType !== null &&
        (typeof managed.planType !== 'string' ||
          managed.planType.length > 64 ||
          CONTROL.test(managed.planType)))
    )
      throw new CodexAuthenticatedRegistrationError('INVALID_EVIDENCE');
    return { mode: 'CHATGPT', requestId: request.id as number };
  }
  throw new CodexAuthenticatedRegistrationError('ACCOUNT_NOT_AUTHENTICATED');
}

/**
 * Joins inert, already-observed evidence. This grants no provisioning,
 * registration, process, transport, provider, secret, or runtime authority.
 */
export function createCodexAuthenticatedRegistrationCandidate(input: {
  readonly manifest: Readonly<ValidatedCodexAppServerManifest>;
  readonly protocol: Readonly<CodexAppServerSessionSnapshot>;
  readonly bridge: Readonly<AuthenticatedJsonlSessionContext>;
  readonly account: Readonly<CodexAccountReadEvidence>;
}): Readonly<CodexAuthenticatedRegistrationCandidate> {
  const { manifest, protocol, bridge, account } = input;
  let revalidatedManifest: Readonly<ValidatedCodexAppServerManifest>;
  try {
    revalidatedManifest = validateCodexAppServerManifest(manifest.manifest);
  } catch {
    throw new CodexAuthenticatedRegistrationError('ADAPTER_MISMATCH');
  }
  if (
    manifest.manifest.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
    manifest.launchAuthorization !== 'NOT_CONFIGURED' ||
    manifest.providerAccess !== 'NOT_CONFIGURED' ||
    !SHA256.test(manifest.manifestHash) ||
    !SHA256.test(manifest.adapterPolicyHash) ||
    revalidatedManifest.manifestHash !== manifest.manifestHash ||
    revalidatedManifest.adapterPolicyHash !== manifest.adapterPolicyHash
  )
    throw new CodexAuthenticatedRegistrationError('ADAPTER_MISMATCH');
  const protocolRecord = exact(protocol, [
    'acceptedBytes',
    'acceptedEvents',
    'runtimeConnection',
    'state',
    'terminalStatus',
    'threadId',
    'turnId',
  ]);
  if (
    protocolRecord.state !== 'INITIALIZED' ||
    protocolRecord.runtimeConnection !== 'NOT_CONFIGURED' ||
    protocolRecord.threadId !== null ||
    protocolRecord.turnId !== null ||
    protocolRecord.terminalStatus !== null ||
    protocolRecord.acceptedEvents !== 0 ||
    protocolRecord.acceptedBytes !== 0
  )
    throw new CodexAuthenticatedRegistrationError('PROTOCOL_NOT_READY');

  const bridgeRecord = exact(bridge, [
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
    bridgeRecord.schemaVersion !== 1 ||
    typeof bridgeRecord.expectedSecretDigest !== 'string' ||
    !SHA256.test(bridgeRecord.expectedSecretDigest) ||
    !Number.isSafeInteger(bridgeRecord.authGeneration) ||
    (bridgeRecord.authGeneration as number) < 1
  )
    throw new CodexAuthenticatedRegistrationError('BRIDGE_IDENTITY_MISMATCH');

  const workspaceId = reference(bridgeRecord.workspaceId);
  const runtimeId = reference(bridgeRecord.runtimeId);
  const connectionId = reference(bridgeRecord.connectionId);
  const sessionId = reference(bridgeRecord.sessionId);
  const principalReference = reference(bridgeRecord.principalReference);
  const parentNonce = reference(bridgeRecord.parentNonce);
  const runtimeNonce = reference(bridgeRecord.runtimeNonce);
  const secretReference = reference(bridgeRecord.secretReference);
  if (!CODEX_RUNTIME.test(runtimeId))
    throw new CodexAuthenticatedRegistrationError('BRIDGE_IDENTITY_MISMATCH');
  const authenticatedAt = timestamp(bridgeRecord.authenticatedAt);
  const expiresAt = timestamp(bridgeRecord.expiresAt);
  const authGeneration = bridgeRecord.authGeneration as number;

  const accountRecord = exact(account, ['observedAt', 'request', 'response']);
  const observedAt = timestamp(accountRecord.observedAt);
  const observed = Date.parse(observedAt);
  if (
    Date.parse(expiresAt) <= Date.parse(authenticatedAt) ||
    Date.parse(expiresAt) - Date.parse(authenticatedAt) > 15 * 60_000 ||
    observed < Date.parse(authenticatedAt) ||
    observed >= Date.parse(expiresAt)
  )
    throw new CodexAuthenticatedRegistrationError('EVIDENCE_EXPIRED');
  const accountState = accountMode({
    observedAt,
    request: accountRecord.request,
    response: accountRecord.response,
  });
  const accountAuthMode = accountState.mode;
  const accountEvidenceHash = sha256({
    accountAuthMode,
    observedAt,
    requestId: accountState.requestId,
    requiresOpenaiAuth: true,
  });
  const bridgeIdentityHash = sha256({
    authGeneration,
    authenticatedAt,
    connectionId,
    expectedSecretDigest: bridgeRecord.expectedSecretDigest,
    expiresAt,
    parentNonce,
    principalReference,
    runtimeNonce,
    runtimeId,
    secretReference,
    sessionId,
    workspaceId,
  });
  const candidate = {
    schemaVersion: 1 as const,
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND as typeof CODEX_APP_SERVER_ADAPTER_KIND,
    workspaceId,
    runtimeId,
    connectionId,
    sessionId,
    principalReference,
    authGeneration,
    accountAuthMode,
    manifestHash: manifest.manifestHash,
    adapterPolicyHash: manifest.adapterPolicyHash,
    bridgeIdentityHash,
    accountEvidenceHash,
    observedAt,
    registrationAuthorization: 'NOT_CONFIGURED' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  return freeze({ ...candidate, registrationCandidateHash: sha256(candidate) });
}
