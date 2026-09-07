import { createHash, randomBytes } from 'node:crypto';

import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  type RetainedNativeSupervisorTopologyObservationCarrierBinding,
} from './retained-native-supervisor-topology-observation-carrier';
import type { RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource } from './retained-native-supervisor-topology-observation-carrier-composition';
import {
  validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
} from './retained-native-supervisor-topology-observation-carrier-signature';

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
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
const RESPONSE_KEYS = [
  'bindingHash',
  'carrierId',
  'challenge',
  'protocolVersion',
  'purpose',
  'requestHash',
  'requestedPrincipalReference',
  'requestedPrincipalRole',
  'requesterPrincipalReference',
  'requesterPrincipalRole',
  'root',
  'runtimeConnection',
] as const;

export const MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_REQUEST_BYTES = 2 * 1_024;
export const MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_RESPONSE_BYTES = 4 * 1_024;

export interface RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransportAuthorization {
  readonly authority: 'INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT';
  readonly localPrincipalRole: 'WORKER_CLIENT';
  readonly localPrincipalReference: string;
  readonly peerPrincipalRole: 'API_COORDINATOR';
  readonly peerPrincipalReference: string;
  readonly carrierId: string;
  readonly bindingHash: string;
  readonly notAfter: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

/** A privileged port whose implementation must authenticate both peers independently of the root being fetched. */
export interface RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport {
  exchange(
    request: Uint8Array,
    authorization: Readonly<RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransportAuthorization>,
    signal: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export class DenyRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport implements RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport {
  async exchange(
    _request: Uint8Array,
    _authorization: Readonly<RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransportAuthorization>,
    _signal: AbortSignal,
  ): Promise<never> {
    return deny('NOT_CONFIGURED');
  }

  async close(): Promise<void> {}
}

function deny(
  code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION' | 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
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

function clockValue(clock: () => number): number {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_DATE_MS) deny('INVALID_AUTHORIZATION');
  return now;
}

function exactRecord(input: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
      deny('INVALID_ATTESTATION');
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
      deny('INVALID_ATTESTATION');
    return value;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_ATTESTATION');
  }
}

function encode(input: unknown): Uint8Array {
  try {
    const bytes = new TextEncoder().encode(canonicalJson(input));
    if (
      bytes.byteLength < 2 ||
      bytes.byteLength > MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_REQUEST_BYTES
    )
      deny('INVALID_AUTHORIZATION');
    return bytes;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_AUTHORIZATION');
  }
}

function decode(input: unknown): Record<string, unknown> {
  try {
    if (!(input instanceof Uint8Array) || Object.getPrototypeOf(input) !== Uint8Array.prototype)
      deny('INVALID_ATTESTATION');
    if (
      input.byteLength < 2 ||
      input.byteLength > MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_RESPONSE_BYTES
    )
      deny('INVALID_ATTESTATION');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    const value = JSON.parse(text) as unknown;
    if (canonicalJson(value) !== text) deny('INVALID_ATTESTATION');
    return exactRecord(value, RESPONSE_KEYS);
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_ATTESTATION');
  }
}

function bindTransport(
  transport: RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport,
) {
  try {
    if (
      transport instanceof
        DenyRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport ||
      typeof transport?.exchange !== 'function' ||
      typeof transport?.close !== 'function'
    )
      deny('NOT_CONFIGURED');
    return Object.freeze({
      exchange: transport.exchange.bind(transport),
      close: transport.close.bind(transport),
    });
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

function challenge(factory: () => Uint8Array): string {
  try {
    const value = factory();
    if (!(value instanceof Uint8Array) || value.byteLength !== 32) deny('NOT_CONFIGURED');
    const encoded = Buffer.from(value).toString('base64url');
    if (!CHALLENGE.test(encoded)) deny('NOT_CONFIGURED');
    return encoded;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

function hash(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

/** One-use worker source for the coordinator root over an independently authenticated transport. */
export class BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource implements RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #bindingHash: string;
  readonly #exchange: RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport['exchange'];
  readonly #close: RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport['close'];
  readonly #timeoutMs: number;
  #attempted = false;

  constructor(
    binding: unknown,
    transport: RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport,
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
    this.#timeoutMs = timeout(timeoutMs);
    const bound = bindTransport(transport);
    this.#exchange = bound.exchange;
    this.#close = bound.close;
  }

  async read(
    binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
    principalRole: 'API_COORDINATOR' | 'WORKER_CLIENT',
    signal: AbortSignal,
  ): Promise<Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    const attempt = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectInterruption: ((error: RetainedNativeSupervisorLocalIpcError) => void) | undefined;
    const interrupt = () => {
      attempt.abort();
      rejectInterruption?.(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED'));
    };
    let request: Readonly<Record<string, unknown>> | undefined;
    let response: unknown;
    let failure: unknown;
    try {
      if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
      const now = clockValue(this.clock);
      const candidate = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
        binding,
        now,
      );
      if (
        principalRole !== 'API_COORDINATOR' ||
        canonicalJson(candidate) !== canonicalJson(this.#binding) ||
        retainedNativeSupervisorTopologyObservationCarrierBindingHash(candidate) !==
          this.#bindingHash
      )
        deny('INVALID_AUTHORIZATION');
      const remaining = Date.parse(this.#binding.expiresAt) - now;
      if (!Number.isSafeInteger(remaining) || remaining < 1) deny('INVALID_AUTHORIZATION');
      const requestBinding = Object.freeze({
        protocolVersion: 1 as const,
        purpose:
          'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_ROOT_LOOKUP_REQUEST' as const,
        requesterPrincipalRole: 'WORKER_CLIENT' as const,
        requesterPrincipalReference: this.#binding.workerPrincipalReference,
        requestedPrincipalRole: 'API_COORDINATOR' as const,
        requestedPrincipalReference: this.#binding.coordinatorPrincipalReference,
        carrierId: this.#binding.carrierId,
        binding: this.#binding,
        bindingHash: this.#bindingHash,
        challenge: challenge(() => randomBytes(32)),
        runtimeConnection: 'NOT_CONFIGURED' as const,
      });
      exactRecord(requestBinding, REQUEST_KEYS);
      request = requestBinding;
      const authorization = Object.freeze({
        authority: 'INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT' as const,
        localPrincipalRole: 'WORKER_CLIENT' as const,
        localPrincipalReference: this.#binding.workerPrincipalReference,
        peerPrincipalRole: 'API_COORDINATOR' as const,
        peerPrincipalReference: this.#binding.coordinatorPrincipalReference,
        carrierId: this.#binding.carrierId,
        bindingHash: this.#bindingHash,
        notAfter: this.#binding.expiresAt,
        runtimeConnection: 'NOT_CONFIGURED' as const,
      });
      signal.addEventListener('abort', interrupt, { once: true });
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
      response = await Promise.race([
        Promise.resolve().then(() =>
          this.#exchange(encode(requestBinding), authorization, attempt.signal),
        ),
        interruption,
      ]);
      if (signal.aborted || attempt.signal.aborted) deny('EXCHANGE_DENIED');
    } catch (error) {
      failure = error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      attempt.abort();
      signal?.removeEventListener?.('abort', interrupt);
      rejectInterruption = undefined;
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(() => this.#close()),
          new Promise<never>((_resolve, reject) => {
            closeTimer = setTimeout(
              () => reject(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED')),
              this.#timeoutMs,
            );
            closeTimer.unref?.();
          }),
        ]);
      } catch (error) {
        failure ??= error;
      } finally {
        if (closeTimer !== undefined) clearTimeout(closeTimer);
      }
    }
    if (failure !== undefined) {
      if (failure instanceof RetainedNativeSupervisorLocalIpcError) throw failure;
      return deny('EXCHANGE_DENIED');
    }
    if (request === undefined || signal.aborted) deny('EXCHANGE_DENIED');
    validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      this.#binding,
      clockValue(this.clock),
    );
    const value = decode(response);
    if (
      value.protocolVersion !== 1 ||
      value.purpose !==
        'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_ROOT_LOOKUP_RESPONSE' ||
      value.requesterPrincipalRole !== request.requesterPrincipalRole ||
      value.requesterPrincipalReference !== request.requesterPrincipalReference ||
      value.requestedPrincipalRole !== request.requestedPrincipalRole ||
      value.requestedPrincipalReference !== request.requestedPrincipalReference ||
      value.carrierId !== request.carrierId ||
      value.bindingHash !== request.bindingHash ||
      value.challenge !== request.challenge ||
      typeof value.requestHash !== 'string' ||
      !SHA256.test(value.requestHash) ||
      value.requestHash !== hash(request) ||
      value.runtimeConnection !== 'NOT_CONFIGURED'
    )
      deny('INVALID_ATTESTATION');
    let root: Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord>;
    try {
      root = validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord(
        value.root,
      );
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
    if (signal.aborted) deny('EXCHANGE_DENIED');
    validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      this.#binding,
      clockValue(this.clock),
    );
    return root;
  }
}
