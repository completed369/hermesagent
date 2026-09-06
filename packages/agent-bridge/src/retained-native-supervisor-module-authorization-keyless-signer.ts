import { createHash } from 'node:crypto';

import { canonicalJson } from './codec';
import type {
  RetainedNativeSupervisorModuleAuthorizationSnapshotSigner,
  RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest,
} from './retained-native-supervisor-module-authorization-controller';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';

const SHA256 = /^[a-f0-9]{64}$/u;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const MAX_REQUEST_BYTES = 32 * 1_024;
const MAX_RESPONSE_BYTES = 1_024;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 2_048;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;

const SIGNING_REQUEST_KEYS = [
  'payload',
  'purpose',
  'schemaVersion',
  'signerKeyId',
  'snapshotPayloadHash',
] as const;
const SNAPSHOT_PAYLOAD_KEYS = [
  'algorithm',
  'authorizations',
  'issuedAt',
  'previousSnapshotHash',
  'purpose',
  'schemaVersion',
  'signerKeyId',
  'snapshotId',
  'snapshotVersion',
  'supervisorInstanceId',
  'validUntil',
] as const;
const SIGNING_RESPONSE_KEYS = [
  'protocolVersion',
  'purpose',
  'runtimeConnection',
  'signature',
  'signerKeyId',
  'signingRequestHash',
  'snapshotPayloadHash',
] as const;

interface KeylessSigningRequestEnvelope {
  readonly protocolVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_REQUEST';
  readonly signerKeyId: string;
  readonly snapshotPayloadHash: string;
  readonly signingRequestHash: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface RetainedNativeSupervisorModuleAuthorizationKeylessSigningTransport {
  exchange(request: Uint8Array, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export class DenyRetainedNativeSupervisorModuleAuthorizationKeylessSigningTransport implements RetainedNativeSupervisorModuleAuthorizationKeylessSigningTransport {
  async exchange(_request: Uint8Array, _signal: AbortSignal): Promise<never> {
    return deny();
  }

  async close(): Promise<void> {}
}

function deny(): never {
  throw new RetainedNativeSupervisorLocalIpcError('NOT_CONFIGURED');
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) deny();
}

function assertInertJson(
  input: unknown,
  seen = new WeakSet<object>(),
  state = { nodes: 0 },
  depth = 0,
): asserts input is
  null | boolean | number | string | readonly unknown[] | Record<string, unknown> {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) deny();
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return;
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) deny();
    return;
  }
  if (typeof input !== 'object' || seen.has(input)) deny();
  seen.add(input);
  if (Array.isArray(input)) {
    if (Object.getPrototypeOf(input) !== Array.prototype || input.length > 256) deny();
    const expected = Array.from({ length: input.length }, (_, index) => String(index));
    const ownKeys = Reflect.ownKeys(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (
      ownKeys.length !== expected.length + 1 ||
      ownKeys.some(
        (key) => typeof key !== 'string' || (key !== 'length' && !expected.includes(key)),
      ) ||
      expected.some((key) => {
        const descriptor = descriptors[key];
        return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
      })
    )
      deny();
    for (const item of input) assertInertJson(item, seen, state, depth + 1);
    return;
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny();
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  const ownKeys = Reflect.ownKeys(record);
  const descriptors = Object.getOwnPropertyDescriptors(record);
  if (
    keys.length > 64 ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string') ||
    keys.some((key) => {
      const descriptor = descriptors[key];
      return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
    })
  )
    deny();
  for (const key of keys) assertInertJson(record[key], seen, state, depth + 1);
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value)) deny();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) deny();
  return value;
}

function parseRequest(
  input: unknown,
  expectedSignerKeyId: string,
): Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest> {
  assertInertJson(input);
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deny();
  const request = input as Record<string, unknown>;
  exactKeys(request, SIGNING_REQUEST_KEYS);
  if (
    request.schemaVersion !== 1 ||
    request.purpose !== 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT' ||
    request.signerKeyId !== expectedSignerKeyId
  )
    deny();
  const snapshotPayloadHash = digest(request.snapshotPayloadHash);
  const payload = request.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) deny();
  const payloadRecord = payload as Record<string, unknown>;
  exactKeys(payloadRecord, SNAPSHOT_PAYLOAD_KEYS);
  if (
    payloadRecord.schemaVersion !== 1 ||
    payloadRecord.purpose !== 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION' ||
    payloadRecord.algorithm !== 'ED25519' ||
    payloadRecord.signerKeyId !== expectedSignerKeyId ||
    createHash('sha256').update(canonicalJson(payloadRecord)).digest('hex') !== snapshotPayloadHash
  )
    deny();
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT',
    signerKeyId: expectedSignerKeyId,
    snapshotPayloadHash,
    payload: Object.freeze(structuredClone(payloadRecord)),
  }) as Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest>;
}

function responseBytes(input: unknown): Uint8Array {
  if (!(input instanceof Uint8Array) || Object.getPrototypeOf(input) !== Uint8Array.prototype)
    deny();
  if (input.byteLength < 2 || input.byteLength > MAX_RESPONSE_BYTES) deny();
  return input;
}

function signingResponse(input: unknown, expected: Readonly<KeylessSigningRequestEnvelope>) {
  const bytes = responseBytes(input);
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch {
    return deny();
  }
  assertInertJson(value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) deny();
  const record = value as Record<string, unknown>;
  exactKeys(record, SIGNING_RESPONSE_KEYS);
  if (
    canonicalJson(record) !== text ||
    record.protocolVersion !== 1 ||
    record.purpose !==
      'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_RESPONSE' ||
    record.runtimeConnection !== 'NOT_CONFIGURED' ||
    record.signerKeyId !== expected.signerKeyId ||
    record.snapshotPayloadHash !== expected.snapshotPayloadHash ||
    record.signingRequestHash !== expected.signingRequestHash ||
    typeof record.signature !== 'string' ||
    !ED25519_SIGNATURE.test(record.signature) ||
    Buffer.from(record.signature, 'base64').length !== 64 ||
    Buffer.from(record.signature, 'base64').toString('base64') !== record.signature
  )
    deny();
  return Object.freeze({
    schemaVersion: 1 as const,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT' as const,
    signerKeyId: expected.signerKeyId,
    snapshotPayloadHash: expected.snapshotPayloadHash,
    signature: record.signature,
  });
}

function bindTransport(
  transport: RetainedNativeSupervisorModuleAuthorizationKeylessSigningTransport,
): Readonly<{
  exchange: (request: Uint8Array, signal: AbortSignal) => Promise<unknown>;
  close: () => Promise<void>;
}> {
  try {
    const candidateExchange = transport.exchange;
    const candidateClose = transport.close;
    if (typeof candidateExchange !== 'function' || typeof candidateClose !== 'function') deny();
    return Object.freeze({
      exchange: candidateExchange.bind(transport),
      close: candidateClose.bind(transport),
    });
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny();
  }
}

/**
 * One-use, keyless client for an injected signing channel. The channel receives only the exact
 * canonical snapshot payload already admitted by the issuance controller and is closed before a
 * signature can escape. This class never resolves, imports, or retains private key material.
 */
export class BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner implements RetainedNativeSupervisorModuleAuthorizationSnapshotSigner {
  readonly #signerKeyId: string;
  readonly #timeoutMs: number;
  readonly #exchange: (request: Uint8Array, signal: AbortSignal) => Promise<unknown>;
  readonly #close: () => Promise<void>;
  #attempted = false;

  constructor(
    signerKeyId: string,
    transport: RetainedNativeSupervisorModuleAuthorizationKeylessSigningTransport,
    timeoutMs = 2_000,
  ) {
    this.#signerKeyId = reference(signerKeyId);
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < MIN_TIMEOUT_MS ||
      timeoutMs > MAX_TIMEOUT_MS
    )
      deny();
    this.#timeoutMs = timeoutMs;
    const bound = bindTransport(transport);
    this.#exchange = bound.exchange;
    this.#close = bound.close;
  }

  async sign(input: unknown): Promise<unknown> {
    if (this.#attempted) deny();
    this.#attempted = true;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let envelope: Readonly<KeylessSigningRequestEnvelope> | undefined;
    let response: unknown;
    let exchangeFailed = false;
    let closeFailed = false;
    try {
      const request = parseRequest(input, this.#signerKeyId);
      const requestBinding = Object.freeze({
        protocolVersion: 1 as const,
        purpose:
          'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_REQUEST' as const,
        signerKeyId: request.signerKeyId,
        snapshotPayloadHash: request.snapshotPayloadHash,
        payload: request.payload as Readonly<Record<string, unknown>>,
        runtimeConnection: 'NOT_CONFIGURED' as const,
      });
      const signingRequestHash = createHash('sha256')
        .update(canonicalJson(requestBinding))
        .digest('hex');
      envelope = Object.freeze({
        ...requestBinding,
        signingRequestHash,
      });
      const encoded = new TextEncoder().encode(canonicalJson(envelope));
      if (encoded.byteLength > MAX_REQUEST_BYTES) deny();
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('Signing exchange timed out'));
        }, this.#timeoutMs);
        timeout.unref?.();
      });
      response = await Promise.race([this.#exchange(encoded, controller.signal), timeoutPromise]);
    } catch {
      exchangeFailed = true;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      controller.abort();
      let closeTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.#close(),
          new Promise<never>((_resolve, reject) => {
            closeTimeout = setTimeout(
              () => reject(new Error('Signing transport close timed out')),
              this.#timeoutMs,
            );
            closeTimeout.unref?.();
          }),
        ]);
      } catch {
        closeFailed = true;
      } finally {
        if (closeTimeout !== undefined) clearTimeout(closeTimeout);
      }
    }
    if (exchangeFailed || closeFailed || envelope === undefined) deny();
    return signingResponse(response, envelope);
  }
}
