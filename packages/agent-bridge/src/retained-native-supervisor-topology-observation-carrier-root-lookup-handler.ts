import { createHash } from 'node:crypto';

import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  type RetainedNativeSupervisorTopologyObservationCarrierBinding,
} from './retained-native-supervisor-topology-observation-carrier';
import {
  DenyRetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
} from './retained-native-supervisor-topology-observation-carrier-composition';
import {
  MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_REQUEST_BYTES,
  MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_RESPONSE_BYTES,
} from './retained-native-supervisor-topology-observation-carrier-root-lookup';
import {
  validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
} from './retained-native-supervisor-topology-observation-carrier-signature';

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const AUTHORIZATION_KEYS = [
  'authenticatedAt',
  'authority',
  'bindingHash',
  'carrierId',
  'localPrincipalReference',
  'localPrincipalRole',
  'notAfter',
  'peerPrincipalReference',
  'peerPrincipalRole',
  'runtimeConnection',
] as const;
const REQUEST_KEYS = [
  'binding',
  'bindingHash',
  'carrierId',
  'challenge',
  'protocolVersion',
  'purpose',
  'requestedPrincipalReference',
  'requestedPrincipalRole',
  'requesterPrincipalReference',
  'requesterPrincipalRole',
  'runtimeConnection',
] as const;

/** Trusted sideband identity produced by the independently authenticated API listener. */
export interface RetainedNativeSupervisorTopologyObservationCarrierRootLookupInboundAuthorization {
  readonly authority: 'INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT';
  readonly localPrincipalRole: 'API_COORDINATOR';
  readonly localPrincipalReference: string;
  readonly peerPrincipalRole: 'WORKER_CLIENT';
  readonly peerPrincipalReference: string;
  readonly carrierId: string;
  readonly bindingHash: string;
  readonly authenticatedAt: string;
  readonly notAfter: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

function deny(
  code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION' | 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function clockValue(clock: () => number): number {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_DATE_MS) deny('INVALID_AUTHORIZATION');
  return now;
}

function timeout(input: unknown): number {
  if (
    !Number.isSafeInteger(input) ||
    (input as number) < MIN_TIMEOUT_MS ||
    (input as number) > MAX_TIMEOUT_MS
  )
    deny('NOT_CONFIGURED');
  return input as number;
}

function exactRecord(
  input: unknown,
  keys: readonly string[],
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) deny(code);
    const value = input as Record<string, unknown>;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    const own = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      own.length !== actual.length ||
      own.some((key) => typeof key !== 'string') ||
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index]) ||
      actual.some(
        (key) => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key]!, 'value'),
      )
    )
      deny(code);
    return value;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny(code);
  }
}

function decodeRequest(input: unknown): Record<string, unknown> {
  try {
    if (!(input instanceof Uint8Array) || Object.getPrototypeOf(input) !== Uint8Array.prototype)
      deny('INVALID_ATTESTATION');
    if (
      input.byteLength < 2 ||
      input.byteLength > MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_REQUEST_BYTES
    )
      deny('INVALID_ATTESTATION');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    const value = JSON.parse(text) as unknown;
    if (canonicalJson(value) !== text) deny('INVALID_ATTESTATION');
    return exactRecord(value, REQUEST_KEYS, 'INVALID_ATTESTATION');
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_ATTESTATION');
  }
}

function bindRootSource(
  source: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
) {
  try {
    if (
      source instanceof DenyRetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource ||
      typeof source?.read !== 'function'
    )
      deny('NOT_CONFIGURED');
    return source.read.bind(source);
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

function hash(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

/**
 * One-use API-side protocol handler. Its authorization is trusted only when supplied out-of-band by
 * a transport that independently mutually authenticated both roles; the fetched root authenticates
 * neither its request nor its own delivery.
 */
export class BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #bindingHash: string;
  readonly #read: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource['read'];
  readonly #timeoutMs: number;
  #attempted = false;

  constructor(
    binding: unknown,
    source: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
    private readonly clock: () => number = Date.now,
    timeoutMs = 2_000,
  ) {
    if (typeof clock !== 'function') deny('NOT_CONFIGURED');
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      binding,
      clockValue(clock),
    );
    this.#bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(
      this.#binding,
    );
    this.#read = bindRootSource(source);
    this.#timeoutMs = timeout(timeoutMs);
  }

  async handle(
    input: unknown,
    inboundAuthorization: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<Uint8Array>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');

    const now = clockValue(this.clock);
    validateRetainedNativeSupervisorTopologyObservationCarrierBinding(this.#binding, now);
    const authorization = exactRecord(
      inboundAuthorization,
      AUTHORIZATION_KEYS,
      'INVALID_AUTHORIZATION',
    );
    const authenticatedAt =
      typeof authorization.authenticatedAt === 'string'
        ? Date.parse(authorization.authenticatedAt)
        : Number.NaN;
    const notAfter =
      typeof authorization.notAfter === 'string' ? Date.parse(authorization.notAfter) : Number.NaN;
    if (
      authorization.authority !== 'INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT' ||
      authorization.localPrincipalRole !== 'API_COORDINATOR' ||
      authorization.localPrincipalReference !== this.#binding.coordinatorPrincipalReference ||
      authorization.peerPrincipalRole !== 'WORKER_CLIENT' ||
      authorization.peerPrincipalReference !== this.#binding.workerPrincipalReference ||
      authorization.carrierId !== this.#binding.carrierId ||
      authorization.bindingHash !== this.#bindingHash ||
      authorization.notAfter !== this.#binding.expiresAt ||
      authorization.runtimeConnection !== 'NOT_CONFIGURED' ||
      !Number.isSafeInteger(authenticatedAt) ||
      new Date(authenticatedAt).toISOString() !== authorization.authenticatedAt ||
      authenticatedAt < Date.parse(this.#binding.issuedAt) ||
      authenticatedAt > now ||
      !Number.isSafeInteger(notAfter) ||
      notAfter <= now
    )
      deny('INVALID_AUTHORIZATION');

    const request = decodeRequest(input);
    let suppliedBinding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
    try {
      suppliedBinding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
        request.binding,
        now,
      );
    } catch {
      return deny('INVALID_ATTESTATION');
    }
    if (
      request.protocolVersion !== 1 ||
      request.purpose !==
        'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_ROOT_LOOKUP_REQUEST' ||
      request.requesterPrincipalRole !== 'WORKER_CLIENT' ||
      request.requesterPrincipalReference !== this.#binding.workerPrincipalReference ||
      request.requestedPrincipalRole !== 'API_COORDINATOR' ||
      request.requestedPrincipalReference !== this.#binding.coordinatorPrincipalReference ||
      request.carrierId !== this.#binding.carrierId ||
      request.bindingHash !== this.#bindingHash ||
      typeof request.challenge !== 'string' ||
      !CHALLENGE.test(request.challenge) ||
      request.runtimeConnection !== 'NOT_CONFIGURED' ||
      canonicalJson(suppliedBinding) !== canonicalJson(this.#binding) ||
      retainedNativeSupervisorTopologyObservationCarrierBindingHash(suppliedBinding) !==
        this.#bindingHash
    )
      deny('INVALID_ATTESTATION');

    const remaining = Date.parse(this.#binding.expiresAt) - now;
    if (!Number.isSafeInteger(remaining) || remaining < 1) deny('INVALID_AUTHORIZATION');
    const attempt = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectInterruption: ((error: RetainedNativeSupervisorLocalIpcError) => void) | undefined;
    const interrupt = () => {
      attempt.abort();
      rejectInterruption?.(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED'));
    };
    signal.addEventListener('abort', interrupt, { once: true });
    let candidate: unknown;
    try {
      const interruption = new Promise<never>((_resolve, reject) => {
        rejectInterruption = reject;
        timer = setTimeout(
          () => {
            attempt.abort();
            reject(
              new RetainedNativeSupervisorLocalIpcError(
                remaining <= this.#timeoutMs ? 'INVALID_AUTHORIZATION' : 'EXCHANGE_DENIED',
              ),
            );
          },
          Math.min(remaining, this.#timeoutMs),
        );
        timer.unref?.();
      });
      if (signal.aborted) interrupt();
      candidate = await Promise.race([
        Promise.resolve().then(() => this.#read(this.#binding, 'API_COORDINATOR', attempt.signal)),
        interruption,
      ]);
      if (signal.aborted || attempt.signal.aborted) deny('EXCHANGE_DENIED');
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('EXCHANGE_DENIED');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      attempt.abort();
      signal.removeEventListener('abort', interrupt);
      rejectInterruption = undefined;
    }

    if (signal.aborted) deny('EXCHANGE_DENIED');
    validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      this.#binding,
      clockValue(this.clock),
    );
    let root: Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord>;
    try {
      root =
        validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord(candidate);
    } catch {
      return deny('INVALID_ATTESTATION');
    }
    if (
      root.principalRole !== 'API_COORDINATOR' ||
      root.principalReference !== this.#binding.coordinatorPrincipalReference ||
      root.bindingHash !== this.#bindingHash ||
      root.revokedAt !== null ||
      Date.parse(root.validFrom) > Date.parse(this.#binding.issuedAt) ||
      Date.parse(root.validUntil) < Date.parse(this.#binding.expiresAt)
    )
      deny('INVALID_ATTESTATION');

    const response = new TextEncoder().encode(
      canonicalJson({
        protocolVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_ROOT_LOOKUP_RESPONSE',
        requesterPrincipalRole: request.requesterPrincipalRole,
        requesterPrincipalReference: request.requesterPrincipalReference,
        requestedPrincipalRole: request.requestedPrincipalRole,
        requestedPrincipalReference: request.requestedPrincipalReference,
        carrierId: request.carrierId,
        bindingHash: request.bindingHash,
        challenge: request.challenge,
        requestHash: hash(request),
        root,
        runtimeConnection: 'NOT_CONFIGURED',
      }),
    );
    if (response.byteLength > MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_RESPONSE_BYTES)
      deny('INVALID_ATTESTATION');
    return response;
  }
}
