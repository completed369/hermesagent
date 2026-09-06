import { createHash, createPublicKey, type KeyObject, verify } from 'node:crypto';

import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  DenyRetainedNativeSupervisorTopologyObservationCarrier,
  DenyRetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator,
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  type AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler,
  type ClosableRetainedNativeSupervisorTopologyObservationCarrier,
  type RetainedNativeSupervisorTopologyObservationCarrierBinding,
  type RetainedNativeSupervisorTopologyObservationCarrierDelivery,
  type RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator,
} from './retained-native-supervisor-topology-observation-carrier';

const SHA256 = /^[a-f0-9]{64}$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const MAX_ROOT_LIFETIME_MS = 5 * 366 * 24 * 60 * 60 * 1_000;
export const MAX_RETAINED_NATIVE_TOPOLOGY_SIGNED_DELIVERY_BYTES = 64 * 1_024;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 4_096;

const ROOT_KEYS = [
  'algorithm',
  'bindingHash',
  'principalReference',
  'principalRole',
  'publicKeySpkiBase64',
  'publicKeySpkiSha256',
  'purpose',
  'revokedAt',
  'rootRecordId',
  'rootRecordVersion',
  'schemaVersion',
  'signerKeyId',
  'testOnly',
  'validFrom',
  'validUntil',
] as const;
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
const PROOF_KEYS = ['algorithm', 'payloadHash', 'signature', 'signerKeyId'] as const;
const ENVELOPE_KEYS = ['delivery', 'message', 'proof'] as const;
const PAYLOAD_KEYS = ['delivery', 'message', 'purpose', 'schemaVersion'] as const;

export interface RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord {
  readonly schemaVersion: 1;
  readonly rootRecordId: string;
  readonly rootRecordVersion: number;
  readonly signerKeyId: string;
  readonly algorithm: 'ED25519';
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY';
  readonly principalRole: 'API_COORDINATOR' | 'WORKER_CLIENT';
  readonly principalReference: string;
  readonly bindingHash: string;
  readonly publicKeySpkiBase64: string;
  readonly publicKeySpkiSha256: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revokedAt: string | null;
  readonly testOnly: false;
}

export interface RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner {
  sign(input: unknown, signal: AbortSignal): Promise<unknown>;
}

export class DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner implements RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner {
  async sign(_input: unknown, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

interface ParsedRoot {
  readonly record: Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord>;
  readonly publicKey: KeyObject;
}

function deny(
  code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION' | 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(
  input: unknown,
  keys: readonly string[],
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
) {
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

function reference(input: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): string {
  if (typeof input !== 'string' || !SAFE_REFERENCE.test(input) || PRIVATE_TEXT.test(input))
    deny(code);
  return input;
}

function digest(input: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): string {
  if (typeof input !== 'string' || !SHA256.test(input)) deny(code);
  return input;
}

function timestamp(input: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): string {
  if (typeof input !== 'string') deny(code);
  const parsed = new Date(input);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== input) deny(code);
  return input;
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
    for (const item of input) assertInertJson(item, seen, state, depth + 1);
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

function canonicalBytes(
  input: unknown,
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
): Buffer {
  try {
    assertInertJson(input);
    const encoded = Buffer.from(canonicalJson(input));
    if (encoded.byteLength > MAX_RETAINED_NATIVE_TOPOLOGY_SIGNED_DELIVERY_BYTES) deny(code);
    return encoded;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny(code);
  }
}

function hash(input: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): string {
  return createHash('sha256').update(canonicalBytes(input, code)).digest('hex');
}

function parseRoot(input: unknown): ParsedRoot {
  const value = plainRecord(input, ROOT_KEYS, 'INVALID_AUTHORIZATION');
  if (
    value.schemaVersion !== 1 ||
    value.algorithm !== 'ED25519' ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY' ||
    (value.principalRole !== 'API_COORDINATOR' && value.principalRole !== 'WORKER_CLIENT') ||
    value.testOnly !== false ||
    (value.revokedAt !== null && typeof value.revokedAt !== 'string') ||
    !Number.isSafeInteger(value.rootRecordVersion) ||
    (value.rootRecordVersion as number) < 1
  )
    deny('INVALID_AUTHORIZATION');
  const validFrom = timestamp(value.validFrom, 'INVALID_AUTHORIZATION');
  const validUntil = timestamp(value.validUntil, 'INVALID_AUTHORIZATION');
  const revokedAt =
    value.revokedAt === null ? null : timestamp(value.revokedAt, 'INVALID_AUTHORIZATION');
  const from = Date.parse(validFrom);
  const until = Date.parse(validUntil);
  if (
    until <= from ||
    until - from > MAX_ROOT_LIFETIME_MS ||
    (revokedAt !== null && (Date.parse(revokedAt) < from || Date.parse(revokedAt) > until)) ||
    typeof value.publicKeySpkiBase64 !== 'string' ||
    value.publicKeySpkiBase64.length > 256 ||
    !BASE64.test(value.publicKeySpkiBase64)
  )
    deny('INVALID_AUTHORIZATION');
  const encoded = Buffer.from(value.publicKeySpkiBase64, 'base64');
  const keyHash = digest(value.publicKeySpkiSha256, 'INVALID_AUTHORIZATION');
  if (
    encoded.length === 0 ||
    encoded.toString('base64') !== value.publicKeySpkiBase64 ||
    createHash('sha256').update(encoded).digest('hex') !== keyHash
  )
    deny('INVALID_AUTHORIZATION');
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: encoded, format: 'der', type: 'spki' });
  } catch {
    return deny('INVALID_AUTHORIZATION');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    record: Object.freeze({
      schemaVersion: 1,
      rootRecordId: reference(value.rootRecordId, 'INVALID_AUTHORIZATION'),
      rootRecordVersion: value.rootRecordVersion as number,
      signerKeyId: reference(value.signerKeyId, 'INVALID_AUTHORIZATION'),
      algorithm: 'ED25519',
      purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY',
      principalRole: value.principalRole,
      principalReference: reference(value.principalReference, 'INVALID_AUTHORIZATION'),
      bindingHash: digest(value.bindingHash, 'INVALID_AUTHORIZATION'),
      publicKeySpkiBase64: value.publicKeySpkiBase64,
      publicKeySpkiSha256: keyHash,
      validFrom,
      validUntil,
      revokedAt,
      testOnly: false,
    }) as Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord>,
    publicKey,
  });
}

export function validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord(
  input: unknown,
): Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord> {
  return parseRoot(input).record;
}

function messageDirection(input: unknown): 'COORDINATOR_TO_WORKER' | 'WORKER_TO_COORDINATOR' {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    deny('INVALID_ATTESTATION');
  const direction = (input as Record<string, unknown>).direction;
  if (direction !== 'COORDINATOR_TO_WORKER' && direction !== 'WORKER_TO_COORDINATOR')
    deny('INVALID_ATTESTATION');
  return direction;
}

function delivery(
  input: unknown,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
  principalReference: string,
  message: unknown,
  now: number,
): Readonly<RetainedNativeSupervisorTopologyObservationCarrierDelivery> {
  const value = plainRecord(input, DELIVERY_KEYS, 'INVALID_ATTESTATION');
  const deliveredAt = timestamp(value.deliveredAt, 'INVALID_ATTESTATION');
  if (
    value.schemaVersion !== 1 ||
    value.authority !== 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' ||
    value.carrierId !== binding.carrierId ||
    value.bindingHash !== retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding) ||
    value.peerPrincipalReference !== principalReference ||
    value.messageHash !== hash(message, 'INVALID_ATTESTATION') ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    Date.parse(deliveredAt) > now ||
    Date.parse(deliveredAt) < Date.parse(binding.issuedAt) ||
    Date.parse(deliveredAt) >= Date.parse(binding.expiresAt)
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze({
    ...value,
  }) as Readonly<RetainedNativeSupervisorTopologyObservationCarrierDelivery>;
}

function signaturePayload(deliveryEvidence: unknown, message: unknown) {
  const payload = {
    schemaVersion: 1 as const,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY' as const,
    delivery: deliveryEvidence,
    message,
  };
  plainRecord(payload, PAYLOAD_KEYS, 'INVALID_ATTESTATION');
  return Object.freeze(payload);
}

function verifyEnvelope(
  input: unknown,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
  root: ParsedRoot,
  expectedRole: 'API_COORDINATOR' | 'WORKER_CLIENT',
  expectedPrincipal: string,
  now: number,
) {
  const envelope = plainRecord(input, ENVELOPE_KEYS, 'INVALID_ATTESTATION');
  const evidence = delivery(envelope.delivery, binding, expectedPrincipal, envelope.message, now);
  const proof = plainRecord(envelope.proof, PROOF_KEYS, 'INVALID_ATTESTATION');
  const payload = signaturePayload(evidence, envelope.message);
  const payloadHash = hash(payload, 'INVALID_ATTESTATION');
  const record = root.record;
  if (
    proof.algorithm !== 'ED25519' ||
    proof.signerKeyId !== record.signerKeyId ||
    proof.payloadHash !== payloadHash ||
    typeof proof.signature !== 'string' ||
    !ED25519_SIGNATURE.test(proof.signature) ||
    record.principalRole !== expectedRole ||
    record.principalReference !== expectedPrincipal ||
    record.bindingHash !== retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding) ||
    record.revokedAt !== null ||
    Date.parse(record.validFrom) > Date.parse(evidence.deliveredAt) ||
    Date.parse(record.validUntil) <= Date.parse(evidence.deliveredAt) ||
    Date.parse(record.validFrom) > Date.parse(binding.issuedAt) ||
    Date.parse(record.validUntil) < Date.parse(binding.expiresAt)
  )
    deny('INVALID_ATTESTATION');
  const signature = Buffer.from(proof.signature, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== proof.signature)
    deny('INVALID_ATTESTATION');
  try {
    if (!verify(null, canonicalBytes(payload, 'INVALID_ATTESTATION'), root.publicKey, signature))
      deny('INVALID_ATTESTATION');
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_ATTESTATION');
  }
  return Object.freeze({ delivery: evidence, message: envelope.message });
}

function assertRootScope(
  root: ParsedRoot,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
  role: 'API_COORDINATOR' | 'WORKER_CLIENT',
  principal: string,
): void {
  const record = root.record;
  if (
    record.principalRole !== role ||
    record.principalReference !== principal ||
    record.bindingHash !== retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding) ||
    record.revokedAt !== null ||
    Date.parse(record.validFrom) > Date.parse(binding.issuedAt) ||
    Date.parse(record.validUntil) < Date.parse(binding.expiresAt)
  )
    deny('INVALID_AUTHORIZATION');
}

function bindSigner(signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner) {
  if (signer instanceof DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner)
    deny('NOT_CONFIGURED');
  const sign = signer?.sign;
  if (typeof sign !== 'function') deny('NOT_CONFIGURED');
  return sign.bind(signer);
}

function bindCarrier(carrier: ClosableRetainedNativeSupervisorTopologyObservationCarrier) {
  if (carrier instanceof DenyRetainedNativeSupervisorTopologyObservationCarrier)
    deny('NOT_CONFIGURED');
  if (typeof carrier?.exchange !== 'function' || typeof carrier?.close !== 'function')
    deny('NOT_CONFIGURED');
  return Object.freeze({
    exchange: carrier.exchange.bind(carrier),
    close: carrier.close.bind(carrier),
  });
}

async function signedEnvelope(
  message: unknown,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
  principalReference: string,
  sign: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner['sign'],
  signal: AbortSignal,
  now: number,
) {
  if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
  const deliveryEvidence = Object.freeze({
    schemaVersion: 1 as const,
    authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' as const,
    carrierId: binding.carrierId,
    bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
    peerPrincipalReference: principalReference,
    messageHash: hash(message, 'INVALID_ATTESTATION'),
    deliveredAt: new Date(now).toISOString(),
    runtimeConnection: 'NOT_CONFIGURED' as const,
  });
  delivery(deliveryEvidence, binding, principalReference, message, now);
  const payload = signaturePayload(deliveryEvidence, message);
  const candidate = plainRecord(await sign(payload, signal), PROOF_KEYS, 'INVALID_ATTESTATION');
  const payloadHash = hash(payload, 'INVALID_ATTESTATION');
  if (
    candidate.algorithm !== 'ED25519' ||
    candidate.payloadHash !== payloadHash ||
    typeof candidate.signature !== 'string' ||
    !ED25519_SIGNATURE.test(candidate.signature)
  )
    deny('INVALID_ATTESTATION');
  reference(candidate.signerKeyId, 'INVALID_ATTESTATION');
  return Object.freeze({
    delivery: deliveryEvidence,
    message,
    proof: Object.freeze({ ...candidate }),
  });
}

/** Verifies one API-coordinator delivery before the worker parses its message or trusts metadata. */
export class Ed25519RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator implements RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator {
  readonly #root: ParsedRoot;
  #attempted = false;
  constructor(
    root: unknown,
    private readonly clock: () => number = Date.now,
  ) {
    if (typeof clock !== 'function') deny('NOT_CONFIGURED');
    this.#root = parseRoot(root);
  }

  async authenticate(
    input: unknown,
    bindingInput: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
    expectedPeer: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
    const now = this.clock();
    const binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      bindingInput,
      now,
    );
    assertRootScope(this.#root, binding, 'API_COORDINATOR', expectedPeer);
    return verifyEnvelope(input, binding, this.#root, 'API_COORDINATOR', expectedPeer, now);
  }
}

/** Coordinator carrier adapter: signs its request and verifies the worker response over an untrusted carrier. */
export class Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationCarrier implements ClosableRetainedNativeSupervisorTopologyObservationCarrier {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #root: ParsedRoot;
  readonly #sign: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner['sign'];
  readonly #exchange: ClosableRetainedNativeSupervisorTopologyObservationCarrier['exchange'];
  readonly #close: ClosableRetainedNativeSupervisorTopologyObservationCarrier['close'];
  #attempted = false;

  constructor(
    carrier: ClosableRetainedNativeSupervisorTopologyObservationCarrier,
    signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
    workerRoot: unknown,
    binding: unknown,
    private readonly clock: () => number = Date.now,
  ) {
    if (typeof clock !== 'function') deny('NOT_CONFIGURED');
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      binding,
      clock(),
    );
    this.#root = parseRoot(workerRoot);
    assertRootScope(
      this.#root,
      this.#binding,
      'WORKER_CLIENT',
      this.#binding.workerPrincipalReference,
    );
    this.#sign = bindSigner(signer);
    const bound = bindCarrier(carrier);
    this.#exchange = bound.exchange;
    this.#close = bound.close;
  }

  async exchange(message: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.#attempted) deny('EXCHANGE_DENIED');
    this.#attempted = true;
    const now = this.clock();
    const outbound = await signedEnvelope(
      message,
      this.#binding,
      this.#binding.coordinatorPrincipalReference,
      this.#sign,
      signal,
      now,
    );
    const raw = await this.#exchange(outbound, signal);
    const completedAt = this.clock();
    return verifyEnvelope(
      raw,
      this.#binding,
      this.#root,
      'WORKER_CLIENT',
      this.#binding.workerPrincipalReference,
      completedAt,
    );
  }

  async close(): Promise<void> {
    await this.#close();
  }
}

/** Worker endpoint: authenticates through its handler, then signs the response for the coordinator. */
export class Ed25519RetainedNativeSupervisorTopologyObservationWorkerEndpoint {
  readonly #handle: AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler['handle'];
  readonly #sign: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner['sign'];
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  #attempted = false;

  constructor(
    handler: AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler,
    signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
    binding: unknown,
    private readonly clock: () => number = Date.now,
  ) {
    if (typeof handler?.handle !== 'function' || typeof clock !== 'function')
      deny('NOT_CONFIGURED');
    this.#handle = handler.handle.bind(handler);
    this.#sign = bindSigner(signer);
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      binding,
      clock(),
    );
  }

  async handle(input: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.#attempted) deny('EXCHANGE_DENIED');
    this.#attempted = true;
    const response = await this.#handle(input, signal);
    if (messageDirection(response) !== 'WORKER_TO_COORDINATOR') deny('INVALID_ATTESTATION');
    return signedEnvelope(
      response,
      this.#binding,
      this.#binding.workerPrincipalReference,
      this.#sign,
      signal,
      this.clock(),
    );
  }
}

/** Explicit fail-closed helper for composition sites that have no public root provisioned. */
export function denyUnconfiguredTopologyObservationCarrierAuthenticator(): RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator {
  return new DenyRetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator();
}
