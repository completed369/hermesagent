import { createHash, createPublicKey, KeyObject, randomUUID, sign } from 'node:crypto';

import { canonicalJson } from './codec';
import {
  type RetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorRecoveryResponse,
  type RetainedNativeSupervisorRecoveryResponsePayload,
  type RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const REQUEST_ID =
  /^recovery-observation-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SIGNAL = /^SIG[A-Z0-9]{1,31}$/u;
const REQUEST_LIFETIME_MS = 2_000;

export type RetainedNativeSupervisorPeerErrorCode =
  'NOT_CONFIGURED' | 'INVALID_REQUEST' | 'NATIVE_AUTHORITY_DENIED' | 'INVALID_NATIVE_OBSERVATION';

export class RetainedNativeSupervisorPeerError extends Error {
  constructor(readonly code: RetainedNativeSupervisorPeerErrorCode) {
    super(`Retained native supervisor peer denied: ${code}`);
  }
}

export interface RetainedNativeSupervisorPeerIdentity {
  readonly schemaVersion: 1;
  readonly supervisorInstanceId: string;
  readonly supervisorKeyId: string;
  readonly algorithm: 'ED25519';
  readonly purpose: 'RETAINED_NATIVE_RECOVERY_OBSERVATION';
  readonly privateKey: KeyObject;
  readonly publicKeySpkiSha256: string;
  readonly testOnly: false;
}

export interface RetainedNativeRecoveryNativeObservation {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly requestHash: string;
  readonly challengeNonce: string;
  readonly supervisionId: string;
  readonly launchNonce: string;
  readonly identityEstablishedAt: string;
  readonly identityVerifiedAt: string;
  readonly exitedAt: string;
  readonly observedAt: string;
  readonly cleanupCompletedAt: string;
  readonly processState: 'EXITED';
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly identityAuthority: 'RETAINED_NATIVE_IDENTITY';
  readonly retainedIdentityKind: 'PIDFD';
  readonly cleanupState: 'PROCESS_GROUP_GONE';
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

/**
 * Native implementations own the retained identity and resolve it exclusively
 * from the complete launch binding in the request. No reusable process locator
 * or native handle crosses this port.
 */
export interface RetainedNativeRecoveryNativeAuthority {
  observeAndCleanup(
    request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class DenyRetainedNativeRecoveryNativeAuthority implements RetainedNativeRecoveryNativeAuthority {
  async observeAndCleanup(): Promise<never> {
    throw new RetainedNativeSupervisorPeerError('NOT_CONFIGURED');
  }
}

function deny(code: RetainedNativeSupervisorPeerErrorCode): never {
  throw new RetainedNativeSupervisorPeerError(code);
}

function plainRecord(input: unknown, expected: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deny('INVALID_REQUEST');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny('INVALID_REQUEST');
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
    deny('INVALID_REQUEST');
  return record;
}

function nativeRecord(input: unknown, expected: readonly string[]): Record<string, unknown> {
  try {
    return plainRecord(input, expected);
  } catch {
    deny('INVALID_NATIVE_OBSERVATION');
  }
}

function reference(value: unknown, code: RetainedNativeSupervisorPeerErrorCode): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value))
    deny(code);
  return value;
}

function digest(value: unknown, code: RetainedNativeSupervisorPeerErrorCode): string {
  if (typeof value !== 'string' || !SHA256.test(value)) deny(code);
  return value;
}

function timestamp(value: unknown, code: RetainedNativeSupervisorPeerErrorCode): string {
  if (typeof value !== 'string') deny(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) deny(code);
  return value;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value as Readonly<T>;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const REQUEST_KEYS = [
  'admissionBindingHash',
  'admissionEvidenceHash',
  'challengeNonce',
  'claimId',
  'connectionId',
  'dispatchId',
  'expiresAt',
  'handoffAttemptId',
  'issuedAt',
  'launchNonce',
  'manifestHash',
  'platform',
  'processClaimedAt',
  'processExpiresAt',
  'recoveryGeneration',
  'recoveryLeaseId',
  'requestHash',
  'requestId',
  'runId',
  'runtimeConnection',
  'runtimeId',
  'schemaVersion',
  'sessionId',
  'supervisionId',
  'testOnly',
  'validationDispatchCandidateHash',
  'workspaceId',
] as const;

function validateRequest(
  input: unknown,
  observedAt: Date,
): Readonly<RetainedNativeSupervisorRecoveryRequest> {
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime()))
    deny('INVALID_REQUEST');
  const value = plainRecord(input, REQUEST_KEYS);
  const issuedAt = timestamp(value.issuedAt, 'INVALID_REQUEST');
  const expiresAt = timestamp(value.expiresAt, 'INVALID_REQUEST');
  const processClaimedAt = timestamp(value.processClaimedAt, 'INVALID_REQUEST');
  const processExpiresAt = timestamp(value.processExpiresAt, 'INVALID_REQUEST');
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  if (
    value.schemaVersion !== 1 ||
    value.platform !== 'LINUX' ||
    value.testOnly !== false ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    typeof value.requestId !== 'string' ||
    !REQUEST_ID.test(value.requestId) ||
    typeof value.challengeNonce !== 'string' ||
    !CHALLENGE.test(value.challengeNonce) ||
    !Number.isSafeInteger(value.recoveryGeneration) ||
    (value.recoveryGeneration as number) < 1 ||
    issued > observedAt.getTime() ||
    observedAt.getTime() >= expires ||
    expires <= issued ||
    expires - issued > REQUEST_LIFETIME_MS ||
    Date.parse(processExpiresAt) <= Date.parse(processClaimedAt)
  )
    deny('INVALID_REQUEST');
  const requestWithoutHash = {
    schemaVersion: 1 as const,
    requestId: value.requestId,
    challengeNonce: value.challengeNonce,
    issuedAt,
    expiresAt,
    workspaceId: reference(value.workspaceId, 'INVALID_REQUEST'),
    runtimeId: reference(value.runtimeId, 'INVALID_REQUEST'),
    connectionId: reference(value.connectionId, 'INVALID_REQUEST'),
    recoveryLeaseId: reference(value.recoveryLeaseId, 'INVALID_REQUEST'),
    recoveryGeneration: value.recoveryGeneration as number,
    claimId: reference(value.claimId, 'INVALID_REQUEST'),
    handoffAttemptId: reference(value.handoffAttemptId, 'INVALID_REQUEST'),
    supervisionId: reference(value.supervisionId, 'INVALID_REQUEST'),
    launchNonce: reference(value.launchNonce, 'INVALID_REQUEST'),
    platform: 'LINUX' as const,
    testOnly: false as const,
    sessionId: reference(value.sessionId, 'INVALID_REQUEST'),
    dispatchId: reference(value.dispatchId, 'INVALID_REQUEST'),
    runId: reference(value.runId, 'INVALID_REQUEST'),
    validationDispatchCandidateHash: digest(
      value.validationDispatchCandidateHash,
      'INVALID_REQUEST',
    ),
    manifestHash: digest(value.manifestHash, 'INVALID_REQUEST'),
    admissionEvidenceHash: digest(value.admissionEvidenceHash, 'INVALID_REQUEST'),
    admissionBindingHash: digest(value.admissionBindingHash, 'INVALID_REQUEST'),
    processClaimedAt,
    processExpiresAt,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  const expectedHash = createHash('sha256')
    .update(
      canonicalJson({
        domain: 'ventureos.retained-native-supervisor.recovery-request.v1',
        request: requestWithoutHash,
      }),
    )
    .digest('hex');
  if (digest(value.requestHash, 'INVALID_REQUEST') !== expectedHash) deny('INVALID_REQUEST');
  return deepFreeze({ ...requestWithoutHash, requestHash: expectedHash });
}

const NATIVE_OBSERVATION_KEYS = [
  'challengeNonce',
  'cleanupCompletedAt',
  'cleanupState',
  'exitCode',
  'exitedAt',
  'identityAuthority',
  'identityEstablishedAt',
  'identityVerifiedAt',
  'launchNonce',
  'observedAt',
  'processState',
  'requestHash',
  'requestId',
  'retainedIdentityKind',
  'runtimeConnection',
  'schemaVersion',
  'signal',
  'supervisionId',
] as const;

function validateNativeObservation(
  input: unknown,
  request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
  finishedAt: Date,
): Readonly<RetainedNativeRecoveryNativeObservation> {
  const value = nativeRecord(input, NATIVE_OBSERVATION_KEYS);
  const identityEstablishedAt = timestamp(
    value.identityEstablishedAt,
    'INVALID_NATIVE_OBSERVATION',
  );
  const identityVerifiedAt = timestamp(value.identityVerifiedAt, 'INVALID_NATIVE_OBSERVATION');
  const exitedAt = timestamp(value.exitedAt, 'INVALID_NATIVE_OBSERVATION');
  const observedAt = timestamp(value.observedAt, 'INVALID_NATIVE_OBSERVATION');
  const cleanupCompletedAt = timestamp(value.cleanupCompletedAt, 'INVALID_NATIVE_OBSERVATION');
  const exitCode = value.exitCode;
  const exitSignal = value.signal;
  if (
    value.schemaVersion !== 1 ||
    value.requestId !== request.requestId ||
    value.requestHash !== request.requestHash ||
    value.challengeNonce !== request.challengeNonce ||
    value.supervisionId !== request.supervisionId ||
    value.launchNonce !== request.launchNonce ||
    value.processState !== 'EXITED' ||
    value.identityAuthority !== 'RETAINED_NATIVE_IDENTITY' ||
    value.retainedIdentityKind !== 'PIDFD' ||
    value.cleanupState !== 'PROCESS_GROUP_GONE' ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    (exitCode !== null &&
      (!Number.isSafeInteger(exitCode) ||
        (exitCode as number) < 0 ||
        (exitCode as number) > 255)) ||
    (exitSignal !== null && (typeof exitSignal !== 'string' || !SIGNAL.test(exitSignal))) ||
    (exitCode === null) === (exitSignal === null) ||
    Date.parse(identityEstablishedAt) < Date.parse(request.processClaimedAt) ||
    Date.parse(identityEstablishedAt) > Date.parse(exitedAt) ||
    Date.parse(exitedAt) > Date.parse(request.processExpiresAt) ||
    Date.parse(identityVerifiedAt) < Date.parse(request.issuedAt) ||
    Date.parse(identityVerifiedAt) < Date.parse(exitedAt) ||
    Date.parse(identityVerifiedAt) > Date.parse(observedAt) ||
    Date.parse(observedAt) > Date.parse(cleanupCompletedAt) ||
    Date.parse(cleanupCompletedAt) > finishedAt.getTime() ||
    Date.parse(cleanupCompletedAt) >= Date.parse(request.expiresAt)
  )
    deny('INVALID_NATIVE_OBSERVATION');
  return deepFreeze({
    schemaVersion: 1 as const,
    requestId: request.requestId,
    requestHash: request.requestHash,
    challengeNonce: request.challengeNonce,
    supervisionId: request.supervisionId,
    launchNonce: request.launchNonce,
    identityEstablishedAt,
    identityVerifiedAt,
    exitedAt,
    observedAt,
    cleanupCompletedAt,
    processState: 'EXITED' as const,
    exitCode: exitCode as number | null,
    signal: exitSignal as string | null,
    identityAuthority: 'RETAINED_NATIVE_IDENTITY' as const,
    retainedIdentityKind: 'PIDFD' as const,
    cleanupState: 'PROCESS_GROUP_GONE' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  });
}

interface ParsedPeerIdentity {
  readonly supervisorInstanceId: string;
  readonly supervisorKeyId: string;
  readonly privateKey: KeyObject;
}

function parseIdentity(input: unknown): Readonly<ParsedPeerIdentity> {
  let identity: Record<string, unknown>;
  try {
    identity = plainRecord(input, [
      'algorithm',
      'privateKey',
      'publicKeySpkiSha256',
      'purpose',
      'schemaVersion',
      'supervisorInstanceId',
      'supervisorKeyId',
      'testOnly',
    ]);
  } catch {
    deny('NOT_CONFIGURED');
  }
  if (
    identity.schemaVersion !== 1 ||
    identity.algorithm !== 'ED25519' ||
    identity.purpose !== 'RETAINED_NATIVE_RECOVERY_OBSERVATION' ||
    identity.testOnly !== false ||
    !(identity.privateKey instanceof KeyObject) ||
    identity.privateKey.type !== 'private' ||
    identity.privateKey.asymmetricKeyType !== 'ed25519'
  )
    deny('NOT_CONFIGURED');
  const publicKey = createPublicKey(identity.privateKey).export({ format: 'der', type: 'spki' });
  if (
    digest(identity.publicKeySpkiSha256, 'NOT_CONFIGURED') !==
    createHash('sha256').update(publicKey).digest('hex')
  )
    deny('NOT_CONFIGURED');
  return Object.freeze({
    supervisorInstanceId: reference(identity.supervisorInstanceId, 'NOT_CONFIGURED'),
    supervisorKeyId: reference(identity.supervisorKeyId, 'NOT_CONFIGURED'),
    privateKey: identity.privateKey,
  });
}

/**
 * Authenticated controller for one local native-supervisor peer. It signs only
 * after native retained-identity revalidation and bounded process-group cleanup.
 * No production authority or key provisioning is composed here.
 */
export class AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer implements RetainedNativeSupervisorRecoveryTransport {
  readonly #identity: Readonly<ParsedPeerIdentity>;

  constructor(
    private readonly authority: RetainedNativeRecoveryNativeAuthority,
    identity: unknown,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (authority instanceof DenyRetainedNativeRecoveryNativeAuthority) deny('NOT_CONFIGURED');
    this.#identity = parseIdentity(identity);
  }

  async exchange(
    requestInput: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    signal: AbortSignal,
  ): Promise<Readonly<RetainedNativeSupervisorRecoveryResponse>> {
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('INVALID_REQUEST');
    const startedAt = this.clock();
    const request = validateRequest(requestInput, startedAt);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(
      abort,
      Math.max(1, Date.parse(request.expiresAt) - startedAt.getTime()),
    );
    let candidate: unknown;
    try {
      candidate = await Promise.race([
        this.authority.observeAndCleanup(request, controller.signal),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new RetainedNativeSupervisorPeerError('NATIVE_AUTHORITY_DENIED')),
            { once: true },
          );
        }),
      ]);
    } catch {
      throw new RetainedNativeSupervisorPeerError('NATIVE_AUTHORITY_DENIED');
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      controller.abort();
    }
    if (signal.aborted) deny('NATIVE_AUTHORITY_DENIED');
    const finishedAt = this.clock();
    if (
      !(finishedAt instanceof Date) ||
      !Number.isFinite(finishedAt.getTime()) ||
      finishedAt.getTime() < startedAt.getTime() ||
      finishedAt.getTime() >= Date.parse(request.expiresAt)
    )
      deny('NATIVE_AUTHORITY_DENIED');
    const observation = validateNativeObservation(candidate, request, finishedAt);
    const payload: RetainedNativeSupervisorRecoveryResponsePayload = deepFreeze({
      schemaVersion: 1,
      responseId: `native-recovery-observation-${randomUUID()}`,
      requestId: request.requestId,
      requestHash: request.requestHash,
      supervisorInstanceId: this.#identity.supervisorInstanceId,
      supervisorKeyId: this.#identity.supervisorKeyId,
      identityEstablishedAt: observation.identityEstablishedAt,
      identityVerifiedAt: observation.identityVerifiedAt,
      exitedAt: observation.exitedAt,
      observedAt: observation.cleanupCompletedAt,
      processState: 'EXITED',
      exitCode: observation.exitCode,
      signal: observation.signal,
      identityAuthority: 'RETAINED_NATIVE_IDENTITY',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    const signature = sign(
      null,
      Buffer.from(canonicalJson(payload)),
      this.#identity.privateKey,
    ).toString('base64');
    return deepFreeze({ ...payload, signature });
  }
}
