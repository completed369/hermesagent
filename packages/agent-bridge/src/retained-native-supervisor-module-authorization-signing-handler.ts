import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

import { canonicalJson } from './codec';
import {
  authenticateRetainedNativeSupervisorLocalIpcAuthorization,
  authenticateRetainedNativeSupervisorLocalIpcInboundExchange,
  RetainedNativeSupervisorLocalIpcError,
  type RetainedNativeSupervisorLocalIpcAuthorization,
} from './retained-native-supervisor-local-ipc';
import {
  MAX_RETAINED_NATIVE_MODULE_SIGNING_REQUEST_BYTES,
  MAX_RETAINED_NATIVE_MODULE_SIGNING_RESPONSE_BYTES,
} from './retained-native-supervisor-module-authorization-keyless-signer';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 2_048;

const REQUEST_KEYS = [
  'payload',
  'protocolVersion',
  'purpose',
  'runtimeConnection',
  'signerKeyId',
  'signingRequestHash',
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

interface AuthenticatedSigningRequest {
  readonly signerKeyId: string;
  readonly snapshotPayloadHash: string;
  readonly signingRequestHash: string;
  readonly payloadBytes: Uint8Array;
}

/** One-use, abortable private-key custody session supplied by the retained supervisor. */
export interface RetainedNativeSupervisorModuleAuthorizationSigningCustodySession {
  sign(payload: Readonly<Uint8Array>, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export class DenyRetainedNativeSupervisorModuleAuthorizationSigningCustodySession implements RetainedNativeSupervisorModuleAuthorizationSigningCustodySession {
  async sign(_payload: Readonly<Uint8Array>, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }

  async close(): Promise<void> {}
}

function deny(
  code:
    | 'NOT_CONFIGURED'
    | 'INVALID_FRAME'
    | 'LIMIT_EXCEEDED'
    | 'CONCURRENT_EXCHANGE'
    | 'EXCHANGE_DENIED' = 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index]))
    deny('INVALID_FRAME');
}

function assertInertJson(
  input: unknown,
  seen = new WeakSet<object>(),
  state = { nodes: 0 },
  depth = 0,
): asserts input is
  null | boolean | number | string | readonly unknown[] | Record<string, unknown> {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) deny('INVALID_FRAME');
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return;
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) deny('INVALID_FRAME');
    return;
  }
  if (typeof input !== 'object' || seen.has(input)) deny('INVALID_FRAME');
  seen.add(input);
  if (Array.isArray(input)) {
    if (Object.getPrototypeOf(input) !== Array.prototype || input.length > 256)
      deny('INVALID_FRAME');
    for (const item of input) assertInertJson(item, seen, state, depth + 1);
    return;
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny('INVALID_FRAME');
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
    deny('INVALID_FRAME');
  for (const key of keys) assertInertJson(record[key], seen, state, depth + 1);
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value))
    deny('INVALID_FRAME');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) deny('INVALID_FRAME');
  return value;
}

function parseRequest(input: unknown, expectedSignerKeyId: string): AuthenticatedSigningRequest {
  if (!(input instanceof Uint8Array) || input.byteLength < 2) deny('INVALID_FRAME');
  if (input.byteLength > MAX_RETAINED_NATIVE_MODULE_SIGNING_REQUEST_BYTES) deny('LIMIT_EXCEEDED');
  const encoded = Uint8Array.from(input);
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(encoded);
    value = JSON.parse(text) as unknown;
  } catch {
    return deny('INVALID_FRAME');
  } finally {
    encoded.fill(0);
  }
  assertInertJson(value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) deny('INVALID_FRAME');
  const request = value as Record<string, unknown>;
  exactKeys(request, REQUEST_KEYS);
  if (
    canonicalJson(request) !== text ||
    request.protocolVersion !== 1 ||
    request.purpose !==
      'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_REQUEST' ||
    request.runtimeConnection !== 'NOT_CONFIGURED' ||
    request.signerKeyId !== expectedSignerKeyId
  )
    deny('INVALID_FRAME');
  const snapshotPayloadHash = digest(request.snapshotPayloadHash);
  const signingRequestHash = digest(request.signingRequestHash);
  if (
    typeof request.payload !== 'object' ||
    request.payload === null ||
    Array.isArray(request.payload)
  )
    deny('INVALID_FRAME');
  const payload = request.payload as Record<string, unknown>;
  exactKeys(payload, SNAPSHOT_PAYLOAD_KEYS);
  if (
    payload.schemaVersion !== 1 ||
    payload.purpose !== 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION' ||
    payload.algorithm !== 'ED25519' ||
    payload.signerKeyId !== expectedSignerKeyId
  )
    deny('INVALID_FRAME');
  const payloadText = canonicalJson(payload);
  if (createHash('sha256').update(payloadText).digest('hex') !== snapshotPayloadHash)
    deny('INVALID_FRAME');
  const requestBinding = {
    protocolVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_REQUEST',
    signerKeyId: expectedSignerKeyId,
    snapshotPayloadHash,
    payload,
    runtimeConnection: 'NOT_CONFIGURED',
  };
  if (
    createHash('sha256').update(canonicalJson(requestBinding)).digest('hex') !== signingRequestHash
  )
    deny('INVALID_FRAME');
  return Object.freeze({
    signerKeyId: expectedSignerKeyId,
    snapshotPayloadHash,
    signingRequestHash,
    payloadBytes: new TextEncoder().encode(payloadText),
  });
}

function bindCustody(session: RetainedNativeSupervisorModuleAuthorizationSigningCustodySession) {
  try {
    if (session instanceof DenyRetainedNativeSupervisorModuleAuthorizationSigningCustodySession)
      deny('NOT_CONFIGURED');
    const sign = session.sign;
    const close = session.close;
    if (typeof sign !== 'function' || typeof close !== 'function') deny('NOT_CONFIGURED');
    return Object.freeze({ sign: sign.bind(session), close: close.bind(session) });
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

/**
 * Authenticated, one-use supervisor-side handler for a keyless signing exchange. It validates the
 * exact local endpoint, peer, canonical protocol binding, payload digest, and signer identity before
 * passing only canonical public snapshot bytes to an injected custody session. No key is loaded here.
 */
export class AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler {
  readonly #authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>;
  readonly #signerKeyId: string;
  readonly #timeoutMs: number;
  readonly #sign: (payload: Readonly<Uint8Array>, signal: AbortSignal) => Promise<unknown>;
  readonly #close: () => Promise<void>;
  #attempted = false;

  constructor(
    signerKeyId: string,
    session: RetainedNativeSupervisorModuleAuthorizationSigningCustodySession,
    authorization: unknown,
    timeoutMs = 2_000,
  ) {
    this.#signerKeyId = reference(signerKeyId);
    this.#authorization = authenticateRetainedNativeSupervisorLocalIpcAuthorization(authorization);
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < MIN_TIMEOUT_MS ||
      timeoutMs > MAX_TIMEOUT_MS
    )
      deny('NOT_CONFIGURED');
    this.#timeoutMs = timeoutMs;
    const bound = bindCustody(session);
    this.#sign = bound.sign;
    this.#close = bound.close;
  }

  async handle(inboundInput: unknown, signal: AbortSignal): Promise<Readonly<Uint8Array>> {
    if (this.#attempted) deny('CONCURRENT_EXCHANGE');
    this.#attempted = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const validSignal = signal instanceof AbortSignal;
    if (validSignal) signal.addEventListener('abort', abort, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let closeTimeout: ReturnType<typeof setTimeout> | undefined;
    let request: AuthenticatedSigningRequest | undefined;
    let signature: Uint8Array | undefined;
    let failure: unknown;
    let closeFailed = false;
    try {
      if (!validSignal || signal.aborted) deny();
      const frame = authenticateRetainedNativeSupervisorLocalIpcInboundExchange(
        inboundInput,
        this.#authorization,
      );
      request = parseRequest(frame, this.#signerKeyId);
      const abortPromise = new Promise<never>((_resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new Error('Signing custody session aborted'));
          return;
        }
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error('Signing custody session aborted')),
          { once: true },
        );
      });
      timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      timeout.unref?.();
      const candidate = await Promise.race([
        this.#sign(request.payloadBytes, controller.signal),
        abortPromise,
      ]);
      if (
        controller.signal.aborted ||
        !(candidate instanceof Uint8Array) ||
        candidate.byteLength !== 64
      )
        deny();
      signature = Uint8Array.from(candidate);
    } catch (error) {
      failure = error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      controller.abort();
      try {
        await Promise.race([
          this.#close(),
          new Promise<never>((_resolve, reject) => {
            closeTimeout = setTimeout(
              () => reject(new Error('Signing custody close timed out')),
              this.#timeoutMs,
            );
            closeTimeout.unref?.();
          }),
        ]);
      } catch {
        closeFailed = true;
      } finally {
        if (closeTimeout !== undefined) clearTimeout(closeTimeout);
        if (validSignal) signal.removeEventListener('abort', abort);
        request?.payloadBytes.fill(0);
      }
    }
    if (failure !== undefined) {
      if (failure instanceof RetainedNativeSupervisorLocalIpcError) throw failure;
      deny();
    }
    if (closeFailed || signal.aborted || request === undefined || signature === undefined) deny();
    const response = new TextEncoder().encode(
      canonicalJson({
        protocolVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_RESPONSE',
        runtimeConnection: 'NOT_CONFIGURED',
        signature: Buffer.from(signature).toString('base64'),
        signerKeyId: request.signerKeyId,
        signingRequestHash: request.signingRequestHash,
        snapshotPayloadHash: request.snapshotPayloadHash,
      }),
    );
    signature.fill(0);
    if (response.byteLength > MAX_RETAINED_NATIVE_MODULE_SIGNING_RESPONSE_BYTES)
      deny('LIMIT_EXCEEDED');
    return response;
  }
}
