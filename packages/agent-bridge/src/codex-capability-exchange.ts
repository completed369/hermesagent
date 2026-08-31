import { createHash } from 'node:crypto';

import { canonicalJson } from './codec';
import { CODEX_APP_SERVER_ADAPTER_KIND } from './codex-app-server-policy';
import {
  validateCodexAuthenticatedRegistrationCandidate,
  type CodexAuthenticatedRegistrationCandidate,
} from './codex-authenticated-registration';

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SAFE_CODE = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const MAX_MODELS = 100;
const MAX_EVIDENCE_AGE_MS = 5 * 60_000;
const REASONING_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);
const INPUT_MODALITIES = new Set(['text', 'image', 'audio']);
const MULTI_AGENT_VERSIONS = new Set(['disabled', 'v1', 'v2']);

export type CodexCapabilityExchangeErrorCode =
  | 'INVALID_EVIDENCE'
  | 'REGISTRATION_MISMATCH'
  | 'INCOMPLETE_CATALOG'
  | 'UNSUPPORTED_CAPABILITY'
  | 'EVIDENCE_EXPIRED'
  | 'CAPABILITY_EXCHANGE_NOT_AUTHORIZED';

export class CodexCapabilityExchangeError extends Error {
  constructor(readonly code: CodexCapabilityExchangeErrorCode) {
    super(`Codex capability exchange denied: ${code}`);
  }
}

export interface CodexModelListEvidence {
  readonly request: unknown;
  readonly response: unknown;
  readonly observedAt: string;
}

export interface CodexCapabilityExchangeCandidate {
  readonly schemaVersion: 1;
  readonly adapterKind: typeof CODEX_APP_SERVER_ADAPTER_KIND;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly authGeneration: number;
  readonly registrationCandidateHash: string;
  readonly bridgeIdentityHash: string;
  readonly accountEvidenceHash: string;
  readonly modelCatalogHash: string;
  readonly capabilityCodes: readonly string[];
  readonly capabilityDigest: string;
  readonly modelCount: number;
  readonly observedAt: string;
  readonly capabilityAuthorization: 'NOT_CONFIGURED';
  readonly providerAccess: 'NOT_CONFIGURED';
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly capabilityCandidateHash: string;
}

export interface CodexCapabilityExchangeAuthorizationRequest {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly principalReference: string;
  readonly registrationCandidateHash: string;
  readonly capabilityCandidateHash: string;
  readonly capabilityPolicyHash: string;
  readonly idempotencyKey: string;
}

export interface CodexCapabilityExchangeAuthorizationDecision {
  readonly schemaVersion: 1;
  readonly authorizationId: string;
  readonly requestHash: string;
  readonly authorizedByReference: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface CodexCapabilityExchangeAuthorizationSource {
  read(request: Readonly<CodexCapabilityExchangeAuthorizationRequest>): Promise<unknown>;
}

export const CODEX_CAPABILITY_EXCHANGE_AUTHORIZATION_SOURCE = Symbol(
  'CODEX_CAPABILITY_EXCHANGE_AUTHORIZATION_SOURCE',
);

export class DenyCodexCapabilityExchangeAuthorizationSource implements CodexCapabilityExchangeAuthorizationSource {
  async read(_request: Readonly<CodexCapabilityExchangeAuthorizationRequest>): Promise<never> {
    throw new CodexCapabilityExchangeError('CAPABILITY_EXCHANGE_NOT_AUTHORIZED');
  }
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  return value as JsonRecord;
}

function exact(value: unknown, keys: readonly string[]): JsonRecord {
  const result = record(value);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  return result;
}

function permitted(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): JsonRecord {
  const result = record(value);
  const actual = Object.keys(result);
  const permittedKeys = new Set([...requiredKeys, ...optionalKeys]);
  if (
    requiredKeys.some((key) => !Object.hasOwn(result, key)) ||
    actual.some((key) => !permittedKeys.has(key))
  )
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  return result;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value) || CONTROL.test(value))
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  return value;
}

function safeCode(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_CODE.test(value) || CONTROL.test(value))
    throw new CodexCapabilityExchangeError('UNSUPPORTED_CAPABILITY');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  return value;
}

function boundedText(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    CONTROL.test(value)
  )
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  return value;
}

function optionalBoundedText(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined || value === null) return value;
  return boundedText(value, maximum);
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

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function normalizeCatalog(evidence: Readonly<CodexModelListEvidence>): {
  readonly requestId: number;
  readonly models: readonly Readonly<{
    readonly id: string;
    readonly reasoningEfforts: readonly string[];
    readonly inputModalities: readonly string[];
    readonly supportsPersonality: boolean;
    readonly isDefault: boolean;
  }>[];
  readonly capabilityCodes: readonly string[];
} {
  const request = exact(evidence.request, ['id', 'method', 'params']);
  if (
    !Number.isSafeInteger(request.id) ||
    (request.id as number) < 1 ||
    request.method !== 'model/list'
  )
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  const params = exact(request.params, ['includeHidden', 'limit']);
  if (
    params.includeHidden !== false ||
    !Number.isSafeInteger(params.limit) ||
    (params.limit as number) < 1 ||
    (params.limit as number) > MAX_MODELS
  )
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  const limit = params.limit as number;

  const response = exact(evidence.response, ['id', 'result']);
  if (response.id !== request.id) throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  const result = exact(response.result, ['data', 'nextCursor']);
  if (result.nextCursor !== null) throw new CodexCapabilityExchangeError('INCOMPLETE_CATALOG');
  if (!Array.isArray(result.data) || result.data.length === 0 || result.data.length > limit)
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');

  const seenIds = new Set<string>();
  const models = result.data.map((rawModel) => {
    const model = permitted(
      rawModel,
      [
        'defaultReasoningEffort',
        'displayName',
        'hidden',
        'id',
        'inputModalities',
        'isDefault',
        'model',
        'supportedReasoningEfforts',
        'supportsPersonality',
      ],
      [
        'additionalSpeedTiers',
        'availabilityNux',
        'defaultServiceTier',
        'description',
        'modelSpecialty',
        'multiAgentVersion',
        'serviceTiers',
        'upgrade',
        'upgradeInfo',
      ],
    );
    const id = safeCode(model.id);
    if (model.model !== id || seenIds.has(id) || model.hidden !== false)
      throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
    seenIds.add(id);
    boundedText(model.displayName, 128);
    if (model.description !== undefined) boundedText(model.description, 1024);
    optionalBoundedText(model.defaultServiceTier, 128);
    optionalBoundedText(model.modelSpecialty, 128);
    optionalBoundedText(model.upgrade, 128);
    if (
      model.multiAgentVersion !== undefined &&
      model.multiAgentVersion !== null &&
      (typeof model.multiAgentVersion !== 'string' ||
        !MULTI_AGENT_VERSIONS.has(model.multiAgentVersion))
    )
      throw new CodexCapabilityExchangeError('UNSUPPORTED_CAPABILITY');
    if (model.additionalSpeedTiers !== undefined) {
      if (!Array.isArray(model.additionalSpeedTiers) || model.additionalSpeedTiers.length > 16)
        throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
      model.additionalSpeedTiers.forEach((tier) => boundedText(tier, 128));
    }
    if (model.serviceTiers !== undefined) {
      if (!Array.isArray(model.serviceTiers) || model.serviceTiers.length > 16)
        throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
      model.serviceTiers.forEach((rawTier) => {
        const tier = exact(rawTier, ['description', 'id', 'name']);
        safeCode(tier.id);
        boundedText(tier.name, 128);
        boundedText(tier.description, 512);
      });
    }
    if (model.availabilityNux !== undefined && model.availabilityNux !== null) {
      const availabilityNux = exact(model.availabilityNux, ['message']);
      boundedText(availabilityNux.message, 1024);
    }
    if (model.upgradeInfo !== undefined && model.upgradeInfo !== null) {
      const upgradeInfo = permitted(
        model.upgradeInfo,
        ['model'],
        ['migrationMarkdown', 'modelLink', 'upgradeCopy'],
      );
      safeCode(upgradeInfo.model);
      optionalBoundedText(upgradeInfo.migrationMarkdown, 4096);
      optionalBoundedText(upgradeInfo.modelLink, 2048);
      optionalBoundedText(upgradeInfo.upgradeCopy, 1024);
    }
    if (
      typeof model.supportsPersonality !== 'boolean' ||
      typeof model.isDefault !== 'boolean' ||
      !Array.isArray(model.supportedReasoningEfforts) ||
      model.supportedReasoningEfforts.length === 0 ||
      model.supportedReasoningEfforts.length > REASONING_EFFORTS.size ||
      !Array.isArray(model.inputModalities) ||
      model.inputModalities.length === 0 ||
      model.inputModalities.length > INPUT_MODALITIES.size
    )
      throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
    const reasoningEfforts = sortedUnique(
      model.supportedReasoningEfforts.map((rawEffort) => {
        const effort = exact(rawEffort, ['description', 'reasoningEffort']);
        boundedText(effort.description, 512);
        const code = safeCode(effort.reasoningEffort);
        if (!REASONING_EFFORTS.has(code))
          throw new CodexCapabilityExchangeError('UNSUPPORTED_CAPABILITY');
        return code;
      }),
    );
    if (reasoningEfforts.length !== model.supportedReasoningEfforts.length)
      throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
    const defaultReasoningEffort = safeCode(model.defaultReasoningEffort);
    if (!reasoningEfforts.includes(defaultReasoningEffort))
      throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
    const inputModalities = sortedUnique(
      model.inputModalities.map((rawModality) => {
        const modality = safeCode(rawModality);
        if (!INPUT_MODALITIES.has(modality))
          throw new CodexCapabilityExchangeError('UNSUPPORTED_CAPABILITY');
        return modality;
      }),
    );
    if (inputModalities.length !== model.inputModalities.length)
      throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
    return freeze({
      id,
      reasoningEfforts,
      inputModalities,
      supportsPersonality: model.supportsPersonality,
      isDefault: model.isDefault,
    });
  });
  if (models.filter((model) => model.isDefault).length !== 1)
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  models.sort((left, right) => left.id.localeCompare(right.id));
  const capabilityCodes = sortedUnique([
    'codex.catalog.model-list',
    ...models.flatMap((model) => [
      ...model.inputModalities.map((modality) => `codex.catalog.input.${modality}`),
      ...model.reasoningEfforts.map((effort) => `codex.catalog.reasoning.${effort}`),
      ...(model.supportsPersonality ? ['codex.catalog.personality'] : []),
    ]),
  ]);
  return freeze({ requestId: request.id as number, models, capabilityCodes });
}

/**
 * Translates already-observed stable app-server catalog evidence. It performs
 * no I/O and grants no provider, transport, heartbeat, dispatch, or runtime authority.
 */
export function createCodexCapabilityExchangeCandidate(input: {
  readonly registration: Readonly<CodexAuthenticatedRegistrationCandidate>;
  readonly exchange: Readonly<CodexModelListEvidence>;
}): Readonly<CodexCapabilityExchangeCandidate> {
  const registration = validateCodexAuthenticatedRegistrationCandidate(input.registration);
  const exchange = exact(input.exchange, ['observedAt', 'request', 'response']);
  const observedAt = timestamp(exchange.observedAt);
  const observed = Date.parse(observedAt);
  const registeredAt = Date.parse(registration.observedAt);
  if (observed < registeredAt || observed - registeredAt > MAX_EVIDENCE_AGE_MS)
    throw new CodexCapabilityExchangeError('EVIDENCE_EXPIRED');
  const catalog = normalizeCatalog({
    request: exchange.request,
    response: exchange.response,
    observedAt,
  });
  const modelCatalogHash = sha256({
    method: 'model/list',
    requestId: catalog.requestId,
    models: catalog.models,
    observedAt,
  });
  const capabilityDigest = sha256(catalog.capabilityCodes);
  const candidate = {
    schemaVersion: 1 as const,
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND as typeof CODEX_APP_SERVER_ADAPTER_KIND,
    workspaceId: registration.workspaceId,
    runtimeId: registration.runtimeId,
    connectionId: registration.connectionId,
    sessionId: registration.sessionId,
    principalReference: registration.principalReference,
    authGeneration: registration.authGeneration,
    registrationCandidateHash: registration.registrationCandidateHash,
    bridgeIdentityHash: registration.bridgeIdentityHash,
    accountEvidenceHash: registration.accountEvidenceHash,
    modelCatalogHash,
    capabilityCodes: catalog.capabilityCodes,
    capabilityDigest,
    modelCount: catalog.models.length,
    observedAt,
    capabilityAuthorization: 'NOT_CONFIGURED' as const,
    providerAccess: 'NOT_CONFIGURED' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  return freeze({ ...candidate, capabilityCandidateHash: sha256(candidate) });
}

export function validateCodexCapabilityExchangeCandidate(
  input: unknown,
): Readonly<CodexCapabilityExchangeCandidate> {
  const candidate = exact(input, [
    'accountEvidenceHash',
    'adapterKind',
    'authGeneration',
    'bridgeIdentityHash',
    'capabilityAuthorization',
    'capabilityCandidateHash',
    'capabilityCodes',
    'capabilityDigest',
    'connectionId',
    'modelCatalogHash',
    'modelCount',
    'observedAt',
    'principalReference',
    'providerAccess',
    'registrationCandidateHash',
    'runtimeConnection',
    'runtimeId',
    'schemaVersion',
    'sessionId',
    'workspaceId',
  ]);
  if (
    candidate.schemaVersion !== 1 ||
    candidate.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
    candidate.capabilityAuthorization !== 'NOT_CONFIGURED' ||
    candidate.providerAccess !== 'NOT_CONFIGURED' ||
    candidate.runtimeConnection !== 'NOT_CONFIGURED' ||
    !Number.isSafeInteger(candidate.authGeneration) ||
    (candidate.authGeneration as number) < 1 ||
    !Number.isSafeInteger(candidate.modelCount) ||
    (candidate.modelCount as number) < 1 ||
    (candidate.modelCount as number) > MAX_MODELS ||
    !Array.isArray(candidate.capabilityCodes) ||
    candidate.capabilityCodes.length === 0 ||
    candidate.capabilityCodes.length > 32
  )
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  const rawCapabilityCodes = candidate.capabilityCodes as unknown[];
  const capabilityCodes = rawCapabilityCodes.map(safeCode);
  if (
    capabilityCodes.some((code, index) => code !== rawCapabilityCodes[index]) ||
    JSON.stringify(capabilityCodes) !== JSON.stringify(sortedUnique(capabilityCodes)) ||
    capabilityCodes.some((code) => !code.startsWith('codex.catalog.'))
  )
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
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
    bridgeIdentityHash: digest(candidate.bridgeIdentityHash),
    accountEvidenceHash: digest(candidate.accountEvidenceHash),
    modelCatalogHash: digest(candidate.modelCatalogHash),
    capabilityCodes: freeze([...capabilityCodes]),
    capabilityDigest: digest(candidate.capabilityDigest),
    modelCount: candidate.modelCount as number,
    observedAt: timestamp(candidate.observedAt),
    capabilityAuthorization: 'NOT_CONFIGURED' as const,
    providerAccess: 'NOT_CONFIGURED' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  if (normalized.capabilityDigest !== sha256(normalized.capabilityCodes))
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  const expectedHash = sha256(normalized);
  if (digest(candidate.capabilityCandidateHash) !== expectedHash)
    throw new CodexCapabilityExchangeError('INVALID_EVIDENCE');
  return freeze({ ...normalized, capabilityCandidateHash: expectedHash });
}

export function createCodexCapabilityExchangeAuthorizationRequest(
  candidateInput: unknown,
  capabilityPolicyHashInput: unknown,
  idempotencyKeyInput: unknown,
): Readonly<CodexCapabilityExchangeAuthorizationRequest> {
  const candidate = validateCodexCapabilityExchangeCandidate(candidateInput);
  return freeze({
    schemaVersion: 1 as const,
    workspaceId: candidate.workspaceId,
    runtimeId: candidate.runtimeId,
    connectionId: candidate.connectionId,
    principalReference: candidate.principalReference,
    registrationCandidateHash: candidate.registrationCandidateHash,
    capabilityCandidateHash: candidate.capabilityCandidateHash,
    capabilityPolicyHash: digest(capabilityPolicyHashInput),
    idempotencyKey: reference(idempotencyKeyInput),
  });
}

export function codexCapabilityExchangeAuthorizationRequestHash(
  request: Readonly<CodexCapabilityExchangeAuthorizationRequest>,
): string {
  return sha256(request);
}

export function validateCodexCapabilityExchangeAuthorizationDecision(
  input: unknown,
  expectedRequestHash: string,
): Readonly<CodexCapabilityExchangeAuthorizationDecision> {
  const decision = exact(input, [
    'authorizationId',
    'authorizedByReference',
    'expiresAt',
    'issuedAt',
    'requestHash',
    'schemaVersion',
  ]);
  if (decision.schemaVersion !== 1 || digest(decision.requestHash) !== expectedRequestHash)
    throw new CodexCapabilityExchangeError('CAPABILITY_EXCHANGE_NOT_AUTHORIZED');
  const issuedAt = timestamp(decision.issuedAt);
  const expiresAt = timestamp(decision.expiresAt);
  if (
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    Date.parse(expiresAt) - Date.parse(issuedAt) > MAX_EVIDENCE_AGE_MS
  )
    throw new CodexCapabilityExchangeError('CAPABILITY_EXCHANGE_NOT_AUTHORIZED');
  return freeze({
    schemaVersion: 1,
    authorizationId: reference(decision.authorizationId),
    requestHash: expectedRequestHash,
    authorizedByReference: reference(decision.authorizedByReference),
    issuedAt,
    expiresAt,
  });
}
