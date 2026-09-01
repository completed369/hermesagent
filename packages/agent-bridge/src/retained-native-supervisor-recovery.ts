import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  type KeyObject,
  verify,
} from 'node:crypto';

import { canonicalJson } from './codec';
import {
  createCodexValidationProcessSessionRecoveryExitEvidenceHash,
  type CodexValidationProcessSessionRecoveryEvidenceSource,
  type CodexValidationProcessSessionRecoveryExitEvidence,
} from './codex-validation-process-session-recovery-evidence';
import type { CodexValidationProcessSessionRecoveryWorkItem } from './codex-validation-process-session-owner';
import { validateCodexValidationProcessSessionRecoveryWorkItem } from './codex-validation-process-session-recovery';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const SIGNAL = /^SIG[A-Z0-9]{1,31}$/u;
const REQUEST_LIFETIME_MS = 2_000;
const MAX_TRUST_LIFETIME_MS = 366 * 24 * 60 * 60 * 1_000;

export type RetainedNativeSupervisorRecoveryErrorCode =
  'NOT_CONFIGURED' | 'INVALID_REQUEST' | 'EXCHANGE_DENIED' | 'INVALID_RESPONSE';

export class RetainedNativeSupervisorRecoveryError extends Error {
  constructor(readonly code: RetainedNativeSupervisorRecoveryErrorCode) {
    super(`Retained native supervisor recovery denied: ${code}`);
  }
}

export interface RetainedNativeSupervisorRecoveryRequest {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly challengeNonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly recoveryLeaseId: string;
  readonly recoveryGeneration: number;
  readonly claimId: string;
  readonly handoffAttemptId: string;
  readonly supervisionId: string;
  readonly launchNonce: string;
  readonly platform: 'LINUX';
  readonly testOnly: false;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly runId: string;
  readonly validationDispatchCandidateHash: string;
  readonly manifestHash: string;
  readonly admissionEvidenceHash: string;
  readonly admissionBindingHash: string;
  readonly processClaimedAt: string;
  readonly processExpiresAt: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly requestHash: string;
}

export interface RetainedNativeSupervisorRecoveryResponse {
  readonly schemaVersion: 1;
  readonly responseId: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly supervisorInstanceId: string;
  readonly supervisorKeyId: string;
  readonly identityEstablishedAt: string;
  readonly identityVerifiedAt: string;
  readonly exitedAt: string;
  readonly observedAt: string;
  readonly processState: 'EXITED';
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly identityAuthority: 'RETAINED_NATIVE_IDENTITY';
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly signature: string;
}

export type RetainedNativeSupervisorRecoveryResponsePayload = Omit<
  RetainedNativeSupervisorRecoveryResponse,
  'signature'
>;

export interface RetainedNativeSupervisorTrustRecord {
  readonly schemaVersion: 1;
  readonly trustRecordId: string;
  readonly trustRecordVersion: number;
  readonly supervisorInstanceId: string;
  readonly supervisorKeyId: string;
  readonly algorithm: 'ED25519';
  readonly purpose: 'RETAINED_NATIVE_RECOVERY_OBSERVATION';
  readonly publicKeySpkiBase64: string;
  readonly publicKeySpkiSha256: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revokedAt: string | null;
  readonly testOnly: false;
}

export interface RetainedNativeSupervisorRecoveryTransport {
  exchange(
    request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class DenyRetainedNativeSupervisorRecoveryTransport implements RetainedNativeSupervisorRecoveryTransport {
  async exchange(
    _request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    _signal: AbortSignal,
  ): Promise<never> {
    throw new RetainedNativeSupervisorRecoveryError('NOT_CONFIGURED');
  }
}

export interface RetainedNativeSupervisorRecoveryResponseVerifier {
  verify(
    response: unknown,
    request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    observedAt: Date,
  ): Readonly<RetainedNativeSupervisorRecoveryResponse>;
}

export class DenyRetainedNativeSupervisorRecoveryResponseVerifier implements RetainedNativeSupervisorRecoveryResponseVerifier {
  verify(): never {
    throw new RetainedNativeSupervisorRecoveryError('NOT_CONFIGURED');
  }
}

function deny(code: RetainedNativeSupervisorRecoveryErrorCode): never {
  throw new RetainedNativeSupervisorRecoveryError(code);
}

function plainRecord(
  input: unknown,
  expected: readonly string[],
  code: RetainedNativeSupervisorRecoveryErrorCode,
): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deny(code);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny(code);
  const record = input as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const keys = [...expected].sort();
  const ownKeys = Reflect.ownKeys(record);
  const descriptors = Object.getOwnPropertyDescriptors(record);
  if (
    actual.length !== keys.length ||
    ownKeys.length !== actual.length ||
    ownKeys.some((key) => typeof key !== 'string') ||
    actual.some((key, index) => key !== keys[index]) ||
    actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value'))
  )
    deny(code);
  return record;
}

function reference(value: unknown, code: RetainedNativeSupervisorRecoveryErrorCode): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value))
    deny(code);
  return value;
}

function timestamp(value: unknown, code: RetainedNativeSupervisorRecoveryErrorCode): string {
  if (typeof value !== 'string') deny(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) deny(code);
  return value;
}

function digest(value: unknown, code: RetainedNativeSupervisorRecoveryErrorCode): string {
  if (typeof value !== 'string' || !SHA256.test(value)) deny(code);
  return value;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value as Readonly<T>;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requestHash(
  request: Omit<RetainedNativeSupervisorRecoveryRequest, 'requestHash'>,
): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        domain: 'ventureos.retained-native-supervisor.recovery-request.v1',
        request,
      }),
    )
    .digest('hex');
}

export function retainedNativeSupervisorRecoveryResponsePayload(
  response: RetainedNativeSupervisorRecoveryResponse,
): RetainedNativeSupervisorRecoveryResponsePayload {
  const { signature: _signature, ...payload } = response;
  return payload;
}

export function createRetainedNativeSupervisorRecoveryRequest(
  workItemInput: unknown,
  observedAt: Date = new Date(),
): Readonly<RetainedNativeSupervisorRecoveryRequest> {
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime()))
    deny('INVALID_REQUEST');
  const workItem = validateCodexValidationProcessSessionRecoveryWorkItem(workItemInput, observedAt);
  if (workItem.binding.platform !== 'LINUX' || workItem.binding.testOnly) deny('INVALID_REQUEST');
  const expiresAtMilliseconds = Math.min(
    observedAt.getTime() + REQUEST_LIFETIME_MS,
    Date.parse(workItem.leaseExpiresAt),
  );
  if (expiresAtMilliseconds <= observedAt.getTime()) deny('INVALID_REQUEST');
  const request = {
    schemaVersion: 1 as const,
    requestId: `recovery-observation-${randomUUID()}`,
    challengeNonce: randomBytes(32).toString('base64url'),
    issuedAt: observedAt.toISOString(),
    expiresAt: new Date(expiresAtMilliseconds).toISOString(),
    workspaceId: workItem.binding.workspaceId,
    runtimeId: workItem.binding.runtimeId,
    connectionId: workItem.binding.connectionId,
    recoveryLeaseId: workItem.recoveryLeaseId,
    recoveryGeneration: workItem.recoveryGeneration,
    claimId: workItem.claimId,
    handoffAttemptId: workItem.handoffAttemptId,
    supervisionId: workItem.binding.supervisionId,
    launchNonce: workItem.binding.launchNonce,
    platform: 'LINUX' as const,
    testOnly: false as const,
    sessionId: workItem.sessionId,
    dispatchId: workItem.dispatchId,
    runId: workItem.runId,
    validationDispatchCandidateHash: workItem.validationDispatchCandidateHash,
    manifestHash: workItem.binding.manifestHash,
    admissionEvidenceHash: workItem.binding.admissionEvidenceHash,
    admissionBindingHash: workItem.binding.admissionBindingHash,
    processClaimedAt: workItem.processClaimedAt,
    processExpiresAt: workItem.processExpiresAt,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  return deepFreeze({ ...request, requestHash: requestHash(request) });
}

interface ParsedTrustRecord {
  readonly record: Readonly<RetainedNativeSupervisorTrustRecord>;
  readonly publicKey: KeyObject;
}

function parseTrustRecord(input: unknown): Readonly<ParsedTrustRecord> {
  const value = plainRecord(
    input,
    [
      'algorithm',
      'publicKeySpkiBase64',
      'publicKeySpkiSha256',
      'purpose',
      'revokedAt',
      'schemaVersion',
      'supervisorInstanceId',
      'supervisorKeyId',
      'testOnly',
      'trustRecordId',
      'trustRecordVersion',
      'validFrom',
      'validUntil',
    ],
    'NOT_CONFIGURED',
  );
  const validFrom = timestamp(value.validFrom, 'NOT_CONFIGURED');
  const validUntil = timestamp(value.validUntil, 'NOT_CONFIGURED');
  if (
    value.schemaVersion !== 1 ||
    value.algorithm !== 'ED25519' ||
    value.purpose !== 'RETAINED_NATIVE_RECOVERY_OBSERVATION' ||
    value.revokedAt !== null ||
    value.testOnly !== false ||
    !Number.isSafeInteger(value.trustRecordVersion) ||
    (value.trustRecordVersion as number) < 1 ||
    Date.parse(validUntil) <= Date.parse(validFrom) ||
    Date.parse(validUntil) - Date.parse(validFrom) > MAX_TRUST_LIFETIME_MS ||
    typeof value.publicKeySpkiBase64 !== 'string' ||
    value.publicKeySpkiBase64.length > 256 ||
    !BASE64.test(value.publicKeySpkiBase64) ||
    typeof value.publicKeySpkiSha256 !== 'string' ||
    !SHA256.test(value.publicKeySpkiSha256)
  )
    deny('NOT_CONFIGURED');
  const encoded = Buffer.from(value.publicKeySpkiBase64, 'base64');
  if (
    encoded.length === 0 ||
    encoded.toString('base64') !== value.publicKeySpkiBase64 ||
    !timingSafeEqual(
      createHash('sha256').update(encoded).digest(),
      Buffer.from(value.publicKeySpkiSha256, 'hex'),
    )
  )
    deny('NOT_CONFIGURED');
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: encoded, format: 'der', type: 'spki' });
  } catch {
    deny('NOT_CONFIGURED');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') deny('NOT_CONFIGURED');
  const record = deepFreeze({
    schemaVersion: 1 as const,
    trustRecordId: reference(value.trustRecordId, 'NOT_CONFIGURED'),
    trustRecordVersion: value.trustRecordVersion as number,
    supervisorInstanceId: reference(value.supervisorInstanceId, 'NOT_CONFIGURED'),
    supervisorKeyId: reference(value.supervisorKeyId, 'NOT_CONFIGURED'),
    algorithm: 'ED25519' as const,
    purpose: 'RETAINED_NATIVE_RECOVERY_OBSERVATION' as const,
    publicKeySpkiBase64: value.publicKeySpkiBase64,
    publicKeySpkiSha256: value.publicKeySpkiSha256,
    validFrom,
    validUntil,
    revokedAt: null,
    testOnly: false as const,
  });
  return Object.freeze({ record, publicKey });
}

export class BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier implements RetainedNativeSupervisorRecoveryResponseVerifier {
  readonly #trust: Readonly<ParsedTrustRecord>;

  constructor(trustRecord: unknown) {
    try {
      this.#trust = parseTrustRecord(trustRecord);
    } catch {
      throw new RetainedNativeSupervisorRecoveryError('NOT_CONFIGURED');
    }
  }

  verify(
    responseInput: unknown,
    request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    observedAt: Date,
  ): Readonly<RetainedNativeSupervisorRecoveryResponse> {
    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime()))
      deny('INVALID_RESPONSE');
    const value = plainRecord(
      responseInput,
      [
        'exitCode',
        'exitedAt',
        'identityAuthority',
        'identityEstablishedAt',
        'identityVerifiedAt',
        'observedAt',
        'processState',
        'requestHash',
        'requestId',
        'responseId',
        'runtimeConnection',
        'schemaVersion',
        'signal',
        'signature',
        'supervisorInstanceId',
        'supervisorKeyId',
      ],
      'INVALID_RESPONSE',
    );
    const identityEstablishedAt = timestamp(value.identityEstablishedAt, 'INVALID_RESPONSE');
    const identityVerifiedAt = timestamp(value.identityVerifiedAt, 'INVALID_RESPONSE');
    const exitedAt = timestamp(value.exitedAt, 'INVALID_RESPONSE');
    const responseObservedAt = timestamp(value.observedAt, 'INVALID_RESPONSE');
    const exitCode = value.exitCode;
    const signal = value.signal;
    if (
      value.schemaVersion !== 1 ||
      value.requestId !== request.requestId ||
      digest(value.requestHash, 'INVALID_RESPONSE') !== request.requestHash ||
      value.supervisorInstanceId !== this.#trust.record.supervisorInstanceId ||
      value.supervisorKeyId !== this.#trust.record.supervisorKeyId ||
      value.processState !== 'EXITED' ||
      value.identityAuthority !== 'RETAINED_NATIVE_IDENTITY' ||
      value.runtimeConnection !== 'NOT_CONFIGURED' ||
      (exitCode !== null &&
        (!Number.isSafeInteger(exitCode) ||
          (exitCode as number) < 0 ||
          (exitCode as number) > 255)) ||
      (signal !== null && (typeof signal !== 'string' || !SIGNAL.test(signal))) ||
      (exitCode === null) === (signal === null) ||
      Date.parse(identityEstablishedAt) < Date.parse(request.processClaimedAt) ||
      Date.parse(identityEstablishedAt) > Date.parse(exitedAt) ||
      Date.parse(exitedAt) > Date.parse(request.processExpiresAt) ||
      Date.parse(identityVerifiedAt) < Date.parse(request.issuedAt) ||
      Date.parse(identityVerifiedAt) < Date.parse(exitedAt) ||
      Date.parse(identityVerifiedAt) > Date.parse(responseObservedAt) ||
      Date.parse(responseObservedAt) < Date.parse(request.issuedAt) ||
      Date.parse(responseObservedAt) < Date.parse(exitedAt) ||
      Date.parse(responseObservedAt) > observedAt.getTime() ||
      observedAt.getTime() >= Date.parse(request.expiresAt) ||
      Date.parse(responseObservedAt) >= Date.parse(request.expiresAt) ||
      Date.parse(responseObservedAt) < Date.parse(this.#trust.record.validFrom) ||
      Date.parse(responseObservedAt) >= Date.parse(this.#trust.record.validUntil) ||
      observedAt.getTime() >= Date.parse(this.#trust.record.validUntil) ||
      typeof value.signature !== 'string' ||
      !ED25519_SIGNATURE.test(value.signature)
    )
      deny('INVALID_RESPONSE');
    const payload = deepFreeze({
      schemaVersion: 1 as const,
      responseId: reference(value.responseId, 'INVALID_RESPONSE'),
      requestId: request.requestId,
      requestHash: request.requestHash,
      supervisorInstanceId: this.#trust.record.supervisorInstanceId,
      supervisorKeyId: this.#trust.record.supervisorKeyId,
      identityEstablishedAt,
      identityVerifiedAt,
      exitedAt,
      observedAt: responseObservedAt,
      processState: 'EXITED' as const,
      exitCode: exitCode as number | null,
      signal: signal as string | null,
      identityAuthority: 'RETAINED_NATIVE_IDENTITY' as const,
      runtimeConnection: 'NOT_CONFIGURED' as const,
    });
    const signature = Buffer.from(value.signature, 'base64');
    if (
      signature.byteLength !== 64 ||
      !verify(null, Buffer.from(canonicalJson(payload)), this.#trust.publicKey, signature)
    )
      deny('INVALID_RESPONSE');
    return deepFreeze({ ...payload, signature: value.signature });
  }
}

/**
 * Queries one already-running external native supervisor with a fresh bounded
 * challenge. The transport must not expose its retained process identity; only
 * a signed exit observation crosses this boundary.
 */
export class AuthenticatedRetainedNativeSupervisorRecoveryEvidenceSource implements CodexValidationProcessSessionRecoveryEvidenceSource {
  constructor(
    private readonly transport: RetainedNativeSupervisorRecoveryTransport,
    private readonly verifier: RetainedNativeSupervisorRecoveryResponseVerifier,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (
      transport instanceof DenyRetainedNativeSupervisorRecoveryTransport ||
      verifier instanceof DenyRetainedNativeSupervisorRecoveryResponseVerifier
    )
      deny('NOT_CONFIGURED');
  }

  async observe(
    workItemInput: Readonly<CodexValidationProcessSessionRecoveryWorkItem>,
  ): Promise<Readonly<CodexValidationProcessSessionRecoveryExitEvidence>> {
    const startedAt = this.clock();
    const workItem = validateCodexValidationProcessSessionRecoveryWorkItem(
      workItemInput,
      startedAt,
    );
    const request = createRetainedNativeSupervisorRecoveryRequest(workItem, startedAt);
    const controller = new AbortController();
    const timeoutMilliseconds = Math.max(1, Date.parse(request.expiresAt) - startedAt.getTime());
    const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
    let candidate: unknown;
    try {
      candidate = await Promise.race([
        this.transport.exchange(request, controller.signal),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new RetainedNativeSupervisorRecoveryError('EXCHANGE_DENIED')),
            { once: true },
          );
        }),
      ]);
    } catch {
      throw new RetainedNativeSupervisorRecoveryError('EXCHANGE_DENIED');
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
    const finishedAt = this.clock();
    if (
      !(finishedAt instanceof Date) ||
      !Number.isFinite(finishedAt.getTime()) ||
      finishedAt.getTime() < startedAt.getTime()
    )
      deny('INVALID_RESPONSE');
    validateCodexValidationProcessSessionRecoveryWorkItem(workItem, finishedAt);
    let response: Readonly<RetainedNativeSupervisorRecoveryResponse>;
    try {
      response = this.verifier.verify(candidate, request, finishedAt);
    } catch {
      throw new RetainedNativeSupervisorRecoveryError('INVALID_RESPONSE');
    }
    const evidence = {
      schemaVersion: 1 as const,
      evidenceId: response.responseId,
      recoveryLeaseId: workItem.recoveryLeaseId,
      recoveryGeneration: workItem.recoveryGeneration,
      claimId: workItem.claimId,
      supervisionId: workItem.binding.supervisionId,
      launchNonce: workItem.binding.launchNonce,
      sessionId: workItem.sessionId,
      dispatchId: workItem.dispatchId,
      validationDispatchCandidateHash: workItem.validationDispatchCandidateHash,
      identityEstablishedAt: response.identityEstablishedAt,
      exitedAt: response.exitedAt,
      verifiedAt: response.observedAt,
      processState: 'EXITED' as const,
      exitCode: response.exitCode,
      signal: response.signal,
      identityAuthority: 'RETAINED_NATIVE_IDENTITY' as const,
      runtimeConnection: 'NOT_CONFIGURED' as const,
    };
    return deepFreeze({
      ...evidence,
      evidenceHash: createCodexValidationProcessSessionRecoveryExitEvidenceHash(evidence),
    });
  }
}
