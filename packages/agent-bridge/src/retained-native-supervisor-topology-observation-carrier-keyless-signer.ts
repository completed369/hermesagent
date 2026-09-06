import { createHash } from 'node:crypto';

import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  type RetainedNativeSupervisorTopologyObservationCarrierBinding,
} from './retained-native-supervisor-topology-observation-carrier';
import type { RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner } from './retained-native-supervisor-topology-observation-carrier-signature';

const SHA256 = /^[a-f0-9]{64}$/u;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 4_096;
export const MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_SIGNING_REQUEST_BYTES = 72 * 1_024;
export const MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_SIGNING_RESPONSE_BYTES = 2 * 1_024;

const PAYLOAD_KEYS = ['delivery', 'message', 'purpose', 'schemaVersion'] as const;
const DELIVERY_KEYS = [
  'authority',
  'bindingHash',
  'carrierId',
  'deliveredAt',
  'messageHash',
  'peerPrincipalReference',
  'runtimeConnection',
  'schemaVersion',
] as const;
const REQUEST_KEYS = [
  'bindingHash',
  'carrierId',
  'payload',
  'payloadHash',
  'principalReference',
  'principalRole',
  'protocolVersion',
  'purpose',
  'runtimeConnection',
  'signerKeyId',
  'signingRequestHash',
] as const;
const RESPONSE_KEYS = [
  'bindingHash',
  'carrierId',
  'payloadHash',
  'principalReference',
  'principalRole',
  'protocolVersion',
  'purpose',
  'runtimeConnection',
  'signature',
  'signerKeyId',
  'signingRequestHash',
] as const;

type PrincipalRole = 'API_COORDINATOR' | 'WORKER_CLIENT';

interface SigningRequestEnvelope {
  readonly protocolVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY_SIGNING_REQUEST';
  readonly principalRole: PrincipalRole;
  readonly principalReference: string;
  readonly signerKeyId: string;
  readonly carrierId: string;
  readonly bindingHash: string;
  readonly payloadHash: string;
  readonly signingRequestHash: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface RetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport {
  exchange(request: Uint8Array, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export class DenyRetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport implements RetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport {
  async exchange(_request: Uint8Array, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }

  async close(): Promise<void> {}
}

function deny(
  code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION' | 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function reference(input: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): string {
  if (typeof input !== 'string' || !SAFE_REFERENCE.test(input) || PRIVATE_TEXT.test(input))
    deny(code);
  return input;
}

function digest(input: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): string {
  if (typeof input !== 'string' || !SHA256.test(input)) deny(code);
  return input;
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
      actual.length !== expected.length ||
      own.length !== actual.length ||
      own.some((key) => typeof key !== 'string') ||
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

function assertInertJson(
  input: unknown,
  seen = new WeakSet<object>(),
  state = { nodes: 0 },
  depth = 0,
): void {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) deny('INVALID_ATTESTATION');
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return;
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) deny('INVALID_ATTESTATION');
    return;
  }
  if (typeof input !== 'object' || seen.has(input)) deny('INVALID_ATTESTATION');
  seen.add(input);
  if (Array.isArray(input)) {
    if (Object.getPrototypeOf(input) !== Array.prototype || input.length > 512)
      deny('INVALID_ATTESTATION');
    const expected = Array.from({ length: input.length }, (_, index) => String(index));
    const own = Reflect.ownKeys(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (
      own.length !== expected.length + 1 ||
      own.some((key) => typeof key !== 'string' || (key !== 'length' && !expected.includes(key))) ||
      expected.some(
        (key) => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key]!, 'value'),
      )
    )
      deny('INVALID_ATTESTATION');
    for (const value of input) assertInertJson(value, seen, state, depth + 1);
    return;
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny('INVALID_ATTESTATION');
  const keys = Object.keys(input);
  const own = Reflect.ownKeys(input);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    keys.length > 256 ||
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string') ||
    keys.some((key) => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key]!, 'value'))
  )
    deny('INVALID_ATTESTATION');
  for (const key of keys)
    assertInertJson((input as Record<string, unknown>)[key], seen, state, depth + 1);
}

function canonicalBytes(input: unknown): Uint8Array {
  assertInertJson(input);
  try {
    return new TextEncoder().encode(canonicalJson(input));
  } catch {
    return deny('INVALID_ATTESTATION');
  }
}

function hash(input: unknown): string {
  return createHash('sha256').update(canonicalBytes(input)).digest('hex');
}

function timestamp(input: unknown): string {
  if (typeof input !== 'string') deny('INVALID_ATTESTATION');
  const parsed = new Date(input);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== input)
    deny('INVALID_ATTESTATION');
  return input;
}

function timeout(input: unknown): number {
  if (
    !Number.isSafeInteger(input) ||
    (input as number) < MIN_TIMEOUT_MS ||
    (input as number) > MAX_TIMEOUT_MS
  )
    deny('INVALID_AUTHORIZATION');
  return input as number;
}

function clockValue(clock: () => number): number {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_DATE_MS) deny('INVALID_AUTHORIZATION');
  return now;
}

function parsePayload(
  input: unknown,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
  role: PrincipalRole,
  now: number,
): Readonly<Record<string, unknown>> {
  assertInertJson(input);
  const payload = exactRecord(input, PAYLOAD_KEYS, 'INVALID_ATTESTATION');
  if (
    payload.schemaVersion !== 1 ||
    payload.purpose !== 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY'
  )
    deny('INVALID_ATTESTATION');
  const delivery = exactRecord(payload.delivery, DELIVERY_KEYS, 'INVALID_ATTESTATION');
  const bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding);
  const principalReference =
    role === 'API_COORDINATOR'
      ? binding.coordinatorPrincipalReference
      : binding.workerPrincipalReference;
  const expectedDirection =
    role === 'API_COORDINATOR' ? 'COORDINATOR_TO_WORKER' : 'WORKER_TO_COORDINATOR';
  if (
    typeof payload.message !== 'object' ||
    payload.message === null ||
    Array.isArray(payload.message)
  )
    deny('INVALID_ATTESTATION');
  const message = payload.message as Record<string, unknown>;
  const deliveredAt = timestamp(delivery.deliveredAt);
  if (
    delivery.schemaVersion !== 1 ||
    delivery.authority !== 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' ||
    delivery.carrierId !== binding.carrierId ||
    delivery.bindingHash !== bindingHash ||
    delivery.peerPrincipalReference !== principalReference ||
    delivery.messageHash !== hash(payload.message) ||
    delivery.runtimeConnection !== 'NOT_CONFIGURED' ||
    message.direction !== expectedDirection ||
    Date.parse(deliveredAt) > now ||
    Date.parse(deliveredAt) < Date.parse(binding.issuedAt) ||
    Date.parse(deliveredAt) >= Date.parse(binding.expiresAt)
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze(structuredClone(payload));
}

function responseBytes(input: unknown): Uint8Array {
  if (!(input instanceof Uint8Array) || Object.getPrototypeOf(input) !== Uint8Array.prototype)
    deny('INVALID_ATTESTATION');
  if (
    input.byteLength < 2 ||
    input.byteLength > MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_SIGNING_RESPONSE_BYTES
  )
    deny('INVALID_ATTESTATION');
  return input;
}

function parseResponse(input: unknown, request: Readonly<SigningRequestEnvelope>) {
  let text: string;
  let candidate: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(responseBytes(input));
    candidate = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_ATTESTATION');
  }
  assertInertJson(candidate);
  const value = exactRecord(candidate, RESPONSE_KEYS, 'INVALID_ATTESTATION');
  let canonical: string;
  try {
    canonical = canonicalJson(value);
  } catch {
    return deny('INVALID_ATTESTATION');
  }
  if (
    canonical !== text ||
    value.protocolVersion !== 1 ||
    value.purpose !==
      'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY_SIGNING_RESPONSE' ||
    value.principalRole !== request.principalRole ||
    value.principalReference !== request.principalReference ||
    value.signerKeyId !== request.signerKeyId ||
    value.carrierId !== request.carrierId ||
    value.bindingHash !== request.bindingHash ||
    value.payloadHash !== request.payloadHash ||
    value.signingRequestHash !== request.signingRequestHash ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    typeof value.signature !== 'string' ||
    !ED25519_SIGNATURE.test(value.signature) ||
    Buffer.from(value.signature, 'base64').length !== 64 ||
    Buffer.from(value.signature, 'base64').toString('base64') !== value.signature
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze({
    algorithm: 'ED25519' as const,
    signerKeyId: request.signerKeyId,
    payloadHash: request.payloadHash,
    signature: value.signature,
  });
}

function bindTransport(
  transport: RetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport,
) {
  try {
    if (
      transport instanceof
        DenyRetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport ||
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

/**
 * One-use, role-bound signer over an injected byte transport. Only the exact canonical carrier
 * payload crosses the transport, and close must finish before a proof can escape. Private key
 * material, key lookup, endpoint selection, and transport identity remain outside this boundary.
 */
export class BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner implements RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #bindingHash: string;
  readonly #role: PrincipalRole;
  readonly #principalReference: string;
  readonly #signerKeyId: string;
  readonly #timeoutMs: number;
  readonly #exchange: (request: Uint8Array, signal: AbortSignal) => Promise<unknown>;
  readonly #close: () => Promise<void>;
  #attempted = false;

  constructor(
    binding: unknown,
    principalRole: PrincipalRole,
    signerKeyId: string,
    transport: RetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport,
    private readonly clock: () => number = Date.now,
    timeoutMs = 2_000,
  ) {
    if (typeof clock !== 'function') deny('NOT_CONFIGURED');
    const now = clockValue(clock);
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(binding, now);
    if (principalRole !== 'API_COORDINATOR' && principalRole !== 'WORKER_CLIENT')
      deny('INVALID_AUTHORIZATION');
    this.#role = principalRole;
    this.#principalReference =
      principalRole === 'API_COORDINATOR'
        ? this.#binding.coordinatorPrincipalReference
        : this.#binding.workerPrincipalReference;
    this.#signerKeyId = reference(signerKeyId, 'INVALID_AUTHORIZATION');
    this.#bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(
      this.#binding,
    );
    this.#timeoutMs = timeout(timeoutMs);
    const bound = bindTransport(transport);
    this.#exchange = bound.exchange;
    this.#close = bound.close;
  }

  async sign(input: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    const attempt = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectInterruption: ((error: RetainedNativeSupervisorLocalIpcError) => void) | undefined;
    let listening = false;
    let request: Readonly<SigningRequestEnvelope> | undefined;
    const interrupt = () => {
      attempt.abort();
      rejectInterruption?.(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED'));
    };
    let response: unknown;
    let failure: unknown;
    try {
      if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
      signal.addEventListener('abort', interrupt, { once: true });
      listening = true;
      const now = clockValue(this.clock);
      const binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
        this.#binding,
        now,
      );
      const payload = parsePayload(input, binding, this.#role, now);
      const payloadHash = hash(payload);
      const requestBinding = Object.freeze({
        protocolVersion: 1 as const,
        purpose:
          'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY_SIGNING_REQUEST' as const,
        principalRole: this.#role,
        principalReference: this.#principalReference,
        signerKeyId: this.#signerKeyId,
        carrierId: binding.carrierId,
        bindingHash: this.#bindingHash,
        payloadHash,
        payload,
        runtimeConnection: 'NOT_CONFIGURED' as const,
      });
      request = Object.freeze({
        ...requestBinding,
        signingRequestHash: hash(requestBinding),
      });
      exactRecord(request, REQUEST_KEYS, 'INVALID_ATTESTATION');
      const encoded = canonicalBytes(request);
      if (encoded.byteLength > MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_SIGNING_REQUEST_BYTES)
        deny('INVALID_ATTESTATION');
      const interruption = new Promise<never>((_resolve, reject) => {
        rejectInterruption = reject;
        timer = setTimeout(interrupt, this.#timeoutMs);
        timer.unref?.();
      });
      if (signal.aborted) interrupt();
      response = await Promise.race([
        Promise.resolve().then(() => this.#exchange(encoded, attempt.signal)),
        interruption,
      ]);
      if (signal.aborted || attempt.signal.aborted) deny('EXCHANGE_DENIED');
    } catch (error) {
      failure = error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      attempt.abort();
      if (listening) signal.removeEventListener('abort', interrupt);
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
      deny('EXCHANGE_DENIED');
    }
    if (request === undefined) deny('EXCHANGE_DENIED');
    if (signal.aborted) deny('EXCHANGE_DENIED');
    validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      this.#binding,
      clockValue(this.clock),
    );
    return parseResponse(response, request);
  }
}
