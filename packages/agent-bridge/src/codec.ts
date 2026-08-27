import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_BRIDGE_BATCH_FRAMES,
  MAX_BRIDGE_BUFFER_BYTES,
  MAX_BRIDGE_LINE_BYTES,
  type BridgeEnvelope,
} from './protocol';

export class BridgeProtocolError extends Error {}

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAC = /^[A-Za-z0-9_-]{43}$/u;
const SENSITIVE =
  /(?:chain.?of.?thought|private.?reasoning|password|credential|api.?key|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+|\b(?:sk|gh[opusr]|github_pat|glpat|xox[baprs])[_-][A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/iu;
const TYPES = new Set([
  'CHALLENGE',
  'AUTHENTICATE',
  'CAPABILITIES',
  'HEARTBEAT',
  'DISPATCH',
  'DISPATCH_ACCEPTED',
  'PROGRESS',
  'ARTIFACT',
  'USAGE',
  'CANCELLED',
  'RESULT',
  'FAILED',
]);
const ENVELOPE_KEYS = [
  'connectionId',
  'expiresAt',
  'issuedAt',
  'mac',
  'messageId',
  'payload',
  'payloadDigest',
  'principalReference',
  'protocolVersion',
  'runtimeId',
  'sequence',
  'sessionId',
  'type',
  'workspaceId',
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 2_048 || SENSITIVE.test(value)) {
      throw new BridgeProtocolError('Sensitive or oversized payload text is forbidden');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new BridgeProtocolError('Numbers must be safe integers');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw new BridgeProtocolError('Arrays are bounded');
    return value.map(canonicalize);
  }
  if (!isPlainRecord(value)) throw new BridgeProtocolError('Only plain JSON records are allowed');
  const entries = Object.entries(value);
  if (entries.length > 64) throw new BridgeProtocolError('Objects are bounded');
  return Object.fromEntries(
    entries
      .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
      .map(([key, nested]) => {
        if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(key) || SENSITIVE.test(key)) {
          throw new BridgeProtocolError('Unsafe payload field');
        }
        return [key, canonicalize(nested)];
      }),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function safeReference(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || SENSITIVE.test(value)) {
    throw new BridgeProtocolError(`${field} is not a safe reference`);
  }
}

export function validateBridgeEnvelope(value: unknown): asserts value is BridgeEnvelope {
  if (!isPlainRecord(value)) throw new BridgeProtocolError('Envelope must be a plain record');
  const keys = Object.keys(value).sort();
  if (
    keys.length !== ENVELOPE_KEYS.length ||
    keys.some((key, index) => key !== ENVELOPE_KEYS[index])
  ) {
    throw new BridgeProtocolError('Envelope fields must match the protocol exactly');
  }
  if (value.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    throw new BridgeProtocolError('Unsupported protocol version');
  }
  for (const field of [
    'workspaceId',
    'runtimeId',
    'connectionId',
    'sessionId',
    'principalReference',
    'messageId',
  ] as const) {
    safeReference(value[field], field);
  }
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) {
    throw new BridgeProtocolError('Sequence must be a positive safe integer');
  }
  if (typeof value.type !== 'string' || !TYPES.has(value.type)) {
    throw new BridgeProtocolError('Unknown message type');
  }
  for (const field of ['issuedAt', 'expiresAt'] as const) {
    const timestamp = value[field];
    if (typeof timestamp !== 'string')
      throw new BridgeProtocolError(`${field} must be a canonical UTC timestamp`);
    const parsed = new Date(timestamp);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
      throw new BridgeProtocolError(`${field} must be a canonical UTC timestamp`);
    }
  }
  const issuedAt = Date.parse(value.issuedAt as string);
  const expiresAt = Date.parse(value.expiresAt as string);
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 5 * 60_000) {
    throw new BridgeProtocolError('Frame expiry must follow issuance by at most five minutes');
  }
  if (typeof value.payloadDigest !== 'string' || !SHA256.test(value.payloadDigest)) {
    throw new BridgeProtocolError('Invalid payload digest');
  }
  if (typeof value.mac !== 'string' || !MAC.test(value.mac)) {
    throw new BridgeProtocolError('Invalid message authenticator');
  }
  canonicalize(value.payload);
}

export function encodeBridgeLine(envelope: BridgeEnvelope): Uint8Array {
  validateBridgeEnvelope(envelope);
  const encoded = Buffer.from(`${canonicalJson(envelope)}\n`, 'utf8');
  if (encoded.byteLength > MAX_BRIDGE_LINE_BYTES)
    throw new BridgeProtocolError('Frame is too large');
  return encoded;
}

export function decodeBridgeLine(input: Uint8Array): BridgeEnvelope {
  if (input.byteLength === 0 || input.byteLength > MAX_BRIDGE_LINE_BYTES) {
    throw new BridgeProtocolError('Frame length is invalid');
  }
  const raw = Buffer.from(input).toString('utf8');
  if (raw.includes('\uFFFD')) throw new BridgeProtocolError('Frame is not valid UTF-8');
  if (!raw.endsWith('\n') || raw.slice(0, -1).includes('\n')) {
    throw new BridgeProtocolError('Frame must contain exactly one JSON line');
  }
  const json = raw.slice(0, -1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BridgeProtocolError('Frame is not valid JSON');
  }
  validateBridgeEnvelope(parsed);
  if (canonicalJson(parsed) !== json) {
    throw new BridgeProtocolError('Frame must use canonical JSON without duplicate fields');
  }
  return parsed;
}

/**
 * Decodes one complete, bounded JSONL batch. This helper deliberately retains
 * no partial line between calls: a missing final newline is a malformed batch,
 * not streaming state.
 */
export function decodeBridgeBatch(input: Uint8Array): readonly BridgeEnvelope[] {
  if (!(input instanceof Uint8Array) || input.byteLength === 0) {
    throw new BridgeProtocolError('Bridge batch is empty');
  }
  if (input.byteLength > MAX_BRIDGE_BUFFER_BYTES) {
    throw new BridgeProtocolError('Bridge batch exceeded its bound');
  }
  const bytes = Buffer.from(input);
  if (bytes[bytes.byteLength - 1] !== 10) {
    throw new BridgeProtocolError('Bridge batch must end with a complete JSON line');
  }
  const messages: BridgeEnvelope[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const newline = bytes.indexOf(10, offset);
    if (newline < 0) throw new BridgeProtocolError('Bridge batch contains a partial line');
    const line = bytes.subarray(offset, newline + 1);
    messages.push(decodeBridgeLine(line));
    if (messages.length > MAX_BRIDGE_BATCH_FRAMES) {
      throw new BridgeProtocolError('Bridge batch contains too many frames');
    }
    offset = newline + 1;
  }
  return Object.freeze(messages);
}

export class BoundedBridgeLineBuffer {
  private buffered = Buffer.alloc(0);

  push(chunk: Uint8Array): BridgeEnvelope[] {
    if (chunk.byteLength > MAX_BRIDGE_BUFFER_BYTES - this.buffered.byteLength) {
      this.buffered = Buffer.alloc(0);
      throw new BridgeProtocolError('Bridge buffer exceeded its bound');
    }
    this.buffered = Buffer.concat([this.buffered, Buffer.from(chunk)]);
    const messages: BridgeEnvelope[] = [];
    while (true) {
      const newline = this.buffered.indexOf(10);
      if (newline < 0) break;
      const line = this.buffered.subarray(0, newline + 1);
      this.buffered = this.buffered.subarray(newline + 1);
      messages.push(decodeBridgeLine(line));
    }
    if (this.buffered.byteLength >= MAX_BRIDGE_LINE_BYTES) {
      this.buffered = Buffer.alloc(0);
      throw new BridgeProtocolError('Bridge line exceeded its bound');
    }
    return messages;
  }
}
