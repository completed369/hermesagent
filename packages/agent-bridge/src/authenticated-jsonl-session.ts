import { deriveBridgeKeys, verifyBridgeEnvelope } from './auth';
import { decodeBridgeLine } from './codec';
import type { BridgeEnvelope } from './protocol';
import {
  type BridgeSecretLeaseResolver,
  type BridgeSecretLeaseRequest,
  BridgeSecretLeaseError,
} from './secret-lease';

export const MAX_AUTHENTICATED_SESSION_FRAMES = 256;
export const MAX_AUTHENTICATED_INGEST_BYTES = 131_072;
export const MAX_AUTHENTICATED_BUFFER_BYTES = 131_072;
export const MAX_AUTHENTICATED_BATCH_FRAMES = 32;
export const MAX_AUTHENTICATED_SESSION_BYTES = 8 * 1_024 * 1_024;

const MAX_SESSION_LIFETIME_MS = 15 * 60_000;
const MAX_PAYLOAD_DEPTH = 8;
const MAX_PAYLOAD_NODES = 1_024;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SENSITIVE =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+|\b(?:sk|gh[opusr]|github_pat|glpat|xox[baprs]|AKIA)[_-]?[A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/iu;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const FORBIDDEN_PAYLOAD_KEYS = new Set(['constructor', 'prototype', '__proto__']);
const POST_AUTH_TYPES = new Set([
  'CAPABILITIES',
  'HEARTBEAT',
  'DISPATCH_ACCEPTED',
  'PROGRESS',
  'ARTIFACT',
  'USAGE',
  'CANCELLED',
  'RESULT',
  'FAILED',
]);

export type AuthenticatedJsonlSessionErrorCode =
  | 'INVALID_CONTEXT'
  | 'INVALID_INGEST'
  | 'SESSION_EXPIRED'
  | 'SESSION_LIMIT'
  | 'FRAME_INVALID'
  | 'AUTHENTICATION_DENIED'
  | 'SEQUENCE_MISMATCH'
  | 'PROTOCOL_STATE'
  | 'FORBIDDEN_MESSAGE'
  | 'CONCURRENT_INGEST'
  | 'TERMINAL';

export class AuthenticatedJsonlSessionError extends Error {
  constructor(readonly code: AuthenticatedJsonlSessionErrorCode) {
    super(`Authenticated runtime session denied: ${code}`);
  }
}

export interface AuthenticatedJsonlSessionContext {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly parentNonce: string;
  readonly runtimeNonce: string;
  readonly secretReference: string;
  readonly expectedSecretDigest: string;
  readonly authGeneration: number;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
}

export interface AuthenticatedJsonlSessionSnapshot {
  readonly state: 'ACTIVE' | 'FAILED';
  readonly nextSequence: number;
  readonly acceptedFrames: number;
  readonly ingestedBytes: number;
  readonly bufferedBytes: number;
  readonly capabilitiesAccepted: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new AuthenticatedJsonlSessionError('INVALID_CONTEXT');
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new AuthenticatedJsonlSessionError('INVALID_CONTEXT');
  return value;
}

function reference(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !SAFE_REFERENCE.test(value) ||
    SENSITIVE.test(value) ||
    CONTROL.test(value)
  )
    throw new AuthenticatedJsonlSessionError('INVALID_CONTEXT');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new AuthenticatedJsonlSessionError('INVALID_CONTEXT');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new AuthenticatedJsonlSessionError('INVALID_CONTEXT');
  return value;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value as Readonly<T>;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateContext(input: unknown): Readonly<AuthenticatedJsonlSessionContext> {
  const record = exactObject(input, [
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
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.authGeneration) ||
    (record.authGeneration as number) < 1 ||
    typeof record.expectedSecretDigest !== 'string' ||
    !SHA256.test(record.expectedSecretDigest)
  )
    throw new AuthenticatedJsonlSessionError('INVALID_CONTEXT');
  const context = deepFreeze({
    schemaVersion: 1 as const,
    workspaceId: reference(record.workspaceId),
    runtimeId: reference(record.runtimeId),
    connectionId: reference(record.connectionId),
    sessionId: reference(record.sessionId),
    principalReference: reference(record.principalReference),
    parentNonce: reference(record.parentNonce),
    runtimeNonce: reference(record.runtimeNonce),
    secretReference: reference(record.secretReference),
    expectedSecretDigest: record.expectedSecretDigest,
    authGeneration: record.authGeneration as number,
    authenticatedAt: timestamp(record.authenticatedAt),
    expiresAt: timestamp(record.expiresAt),
  });
  const now = Date.now();
  const authenticatedAt = Date.parse(context.authenticatedAt);
  const expiresAt = Date.parse(context.expiresAt);
  if (
    authenticatedAt > now + 30_000 ||
    expiresAt <= now ||
    expiresAt <= authenticatedAt ||
    expiresAt - authenticatedAt > MAX_SESSION_LIFETIME_MS
  )
    throw new AuthenticatedJsonlSessionError('INVALID_CONTEXT');
  return context;
}

function sanitizedContext(input: unknown): Readonly<AuthenticatedJsonlSessionContext> {
  try {
    return validateContext(input);
  } catch (error) {
    if (error instanceof AuthenticatedJsonlSessionError) throw error;
    throw new AuthenticatedJsonlSessionError('INVALID_CONTEXT');
  }
}

function validatePayload(payload: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_PAYLOAD_NODES || current.depth > MAX_PAYLOAD_DEPTH)
      throw new AuthenticatedJsonlSessionError('FRAME_INVALID');
    if (typeof current.value === 'string') {
      if (CONTROL.test(current.value) || SENSITIVE.test(current.value))
        throw new AuthenticatedJsonlSessionError('FRAME_INVALID');
      continue;
    }
    if (
      current.value === null ||
      typeof current.value === 'boolean' ||
      (typeof current.value === 'number' && Number.isSafeInteger(current.value))
    )
      continue;
    if (Array.isArray(current.value)) {
      for (const value of current.value) pending.push({ value, depth: current.depth + 1 });
      continue;
    }
    if (!isPlainRecord(current.value)) throw new AuthenticatedJsonlSessionError('FRAME_INVALID');
    for (const [key, value] of Object.entries(current.value)) {
      if (FORBIDDEN_PAYLOAD_KEYS.has(key) || CONTROL.test(key) || SENSITIVE.test(key))
        throw new AuthenticatedJsonlSessionError('FRAME_INVALID');
      pending.push({ value, depth: current.depth + 1 });
    }
  }
}

function preflightPayload(line: Uint8Array): void {
  const raw = Buffer.from(line).toString('utf8');
  if (raw.includes('\uFFFD') || !raw.endsWith('\n'))
    throw new AuthenticatedJsonlSessionError('FRAME_INVALID');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(0, -1));
  } catch {
    throw new AuthenticatedJsonlSessionError('FRAME_INVALID');
  }
  if (!isPlainRecord(parsed) || !Object.hasOwn(parsed, 'payload'))
    throw new AuthenticatedJsonlSessionError('FRAME_INVALID');
  validatePayload(parsed.payload);
}

export class AuthenticatedRuntimeJsonlSession {
  readonly #context: Readonly<AuthenticatedJsonlSessionContext>;
  #state: 'ACTIVE' | 'FAILED' = 'ACTIVE';
  #buffer = Buffer.alloc(0);
  #nextSequence = 1;
  #acceptedFrames = 0;
  #ingestedBytes = 0;
  #capabilitiesAccepted = false;
  #ingesting = false;

  constructor(
    context: unknown,
    private readonly secretLeaseResolver: BridgeSecretLeaseResolver,
  ) {
    this.#context = sanitizedContext(context);
  }

  context(): Readonly<AuthenticatedJsonlSessionContext> {
    return this.#context;
  }

  snapshot(): Readonly<AuthenticatedJsonlSessionSnapshot> {
    return Object.freeze({
      state: this.#state,
      nextSequence: this.#nextSequence,
      acceptedFrames: this.#acceptedFrames,
      ingestedBytes: this.#ingestedBytes,
      bufferedBytes: this.#buffer.byteLength,
      capabilitiesAccepted: this.#capabilitiesAccepted,
    });
  }

  async ingest(chunk: unknown): Promise<readonly Readonly<BridgeEnvelope>[]> {
    if (this.#state !== 'ACTIVE') throw new AuthenticatedJsonlSessionError('TERMINAL');
    if (this.#ingesting) {
      this.#state = 'FAILED';
      this.#buffer = Buffer.alloc(0);
      throw new AuthenticatedJsonlSessionError('CONCURRENT_INGEST');
    }
    this.#ingesting = true;
    try {
      return await this.#ingestActive(chunk);
    } catch (error) {
      this.#state = 'FAILED';
      this.#buffer = Buffer.alloc(0);
      if (error instanceof AuthenticatedJsonlSessionError) throw error;
      if (error instanceof BridgeSecretLeaseError)
        throw new AuthenticatedJsonlSessionError('AUTHENTICATION_DENIED');
      throw new AuthenticatedJsonlSessionError('FRAME_INVALID');
    } finally {
      this.#ingesting = false;
    }
  }

  async #ingestActive(chunk: unknown): Promise<readonly Readonly<BridgeEnvelope>[]> {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0)
      throw new AuthenticatedJsonlSessionError('INVALID_INGEST');
    if (
      chunk.byteLength > MAX_AUTHENTICATED_INGEST_BYTES ||
      this.#ingestedBytes + chunk.byteLength > MAX_AUTHENTICATED_SESSION_BYTES ||
      chunk.byteLength > MAX_AUTHENTICATED_BUFFER_BYTES - this.#buffer.byteLength
    )
      throw new AuthenticatedJsonlSessionError('SESSION_LIMIT');
    if (Date.now() >= Date.parse(this.#context.expiresAt))
      throw new AuthenticatedJsonlSessionError('SESSION_EXPIRED');

    const ownedChunk = Uint8Array.from(chunk);
    const candidate = Buffer.concat([this.#buffer, ownedChunk]);
    const lines: Uint8Array[] = [];
    let cursor = 0;
    let newline = candidate.indexOf(10, cursor);
    while (newline >= 0) {
      lines.push(candidate.subarray(cursor, newline + 1));
      if (lines.length > MAX_AUTHENTICATED_BATCH_FRAMES)
        throw new AuthenticatedJsonlSessionError('SESSION_LIMIT');
      cursor = newline + 1;
      newline = candidate.indexOf(10, cursor);
    }
    const remainder = candidate.subarray(cursor);
    if (remainder.byteLength >= 65_536) throw new AuthenticatedJsonlSessionError('SESSION_LIMIT');
    if (lines.length === 0) {
      this.#buffer = Buffer.from(remainder);
      this.#ingestedBytes += ownedChunk.byteLength;
      return Object.freeze([]);
    }
    if (this.#acceptedFrames + lines.length > MAX_AUTHENTICATED_SESSION_FRAMES)
      throw new AuthenticatedJsonlSessionError('SESSION_LIMIT');

    const envelopes: BridgeEnvelope[] = [];
    let expectedSequence = this.#nextSequence;
    let capabilitiesAccepted = this.#capabilitiesAccepted;
    try {
      for (const line of lines) {
        preflightPayload(line);
        const envelope = decodeBridgeLine(line);
        if (!POST_AUTH_TYPES.has(envelope.type))
          throw new AuthenticatedJsonlSessionError('FORBIDDEN_MESSAGE');
        if (envelope.sequence !== expectedSequence)
          throw new AuthenticatedJsonlSessionError('SEQUENCE_MISMATCH');
        if (!capabilitiesAccepted) {
          if (envelope.type !== 'CAPABILITIES')
            throw new AuthenticatedJsonlSessionError('PROTOCOL_STATE');
          capabilitiesAccepted = true;
        } else if (envelope.type === 'CAPABILITIES') {
          throw new AuthenticatedJsonlSessionError('PROTOCOL_STATE');
        }
        validatePayload(envelope.payload);
        envelopes.push(envelope);
        expectedSequence += 1;
      }
    } catch (error) {
      if (error instanceof AuthenticatedJsonlSessionError) throw error;
      throw new AuthenticatedJsonlSessionError('FRAME_INVALID');
    }

    const leaseRequest: Readonly<BridgeSecretLeaseRequest> = Object.freeze({
      workspaceId: this.#context.workspaceId,
      runtimeId: this.#context.runtimeId,
      connectionId: this.#context.connectionId,
      secretReference: this.#context.secretReference,
      expectedDigest: this.#context.expectedSecretDigest,
      authGeneration: this.#context.authGeneration,
      purpose: 'VERIFY_FRAME',
    });
    await this.secretLeaseResolver.withSecret(leaseRequest, (secret) => {
      const keys = deriveBridgeKeys(secret, {
        workspaceId: this.#context.workspaceId,
        runtimeId: this.#context.runtimeId,
        connectionId: this.#context.connectionId,
        sessionId: this.#context.sessionId,
        principalReference: this.#context.principalReference,
        parentNonce: this.#context.parentNonce,
        runtimeNonce: this.#context.runtimeNonce,
      });
      try {
        const observedAt = new Date();
        if (observedAt.getTime() >= Date.parse(this.#context.expiresAt))
          throw new AuthenticatedJsonlSessionError('SESSION_EXPIRED');
        for (const envelope of envelopes) {
          if (
            Date.parse(envelope.issuedAt) < Date.parse(this.#context.authenticatedAt) ||
            Date.parse(envelope.expiresAt) > Date.parse(this.#context.expiresAt)
          )
            throw new AuthenticatedJsonlSessionError('FRAME_INVALID');
          verifyBridgeEnvelope(envelope, keys.runtimeToParent, this.#context, observedAt);
        }
      } finally {
        keys.parentToRuntime.fill(0);
        keys.runtimeToParent.fill(0);
      }
    });
    if (this.#state !== 'ACTIVE') throw new AuthenticatedJsonlSessionError('TERMINAL');
    const commitObservedAt = Date.now();
    if (commitObservedAt >= Date.parse(this.#context.expiresAt))
      throw new AuthenticatedJsonlSessionError('SESSION_EXPIRED');
    if (envelopes.some((envelope) => commitObservedAt >= Date.parse(envelope.expiresAt)))
      throw new AuthenticatedJsonlSessionError('FRAME_INVALID');

    const frozen = Object.freeze(envelopes.map((envelope) => deepFreeze(envelope)));
    this.#buffer = Buffer.from(remainder);
    this.#ingestedBytes += ownedChunk.byteLength;
    this.#acceptedFrames += frozen.length;
    this.#nextSequence = expectedSequence;
    this.#capabilitiesAccepted = capabilitiesAccepted;
    return frozen;
  }
}
