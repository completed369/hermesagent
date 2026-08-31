import { createHash } from 'node:crypto';

import { canonicalJson } from './codec';

export const MAX_CODEX_TASK_TEXT_BYTES = 16_384;
export const MAX_CODEX_EVENT_BYTES = 65_536;
export const MAX_CODEX_SESSION_BYTES = 8 * 1_024 * 1_024;
export const MAX_CODEX_SESSION_EVENTS = 512;

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_VALUE_DEPTH = 8;
const MAX_VALUE_NODES = 1_024;

export type CodexAppServerSessionState =
  | 'NEW'
  | 'INITIALIZE_PENDING'
  | 'INITIALIZE_ACKNOWLEDGED'
  | 'INITIALIZED'
  | 'THREAD_PENDING'
  | 'THREAD_READY'
  | 'TURN_PENDING'
  | 'TURN_ACTIVE'
  | 'INTERRUPT_PENDING'
  | 'INTERRUPT_ACKNOWLEDGED'
  | 'TURN_TERMINAL'
  | 'FAILED';

export type CodexAppServerSessionErrorCode =
  'INVALID_STATE' | 'INVALID_MESSAGE' | 'CORRELATION_MISMATCH' | 'REMOTE_ERROR' | 'LIMIT_EXCEEDED';

export class CodexAppServerSessionError extends Error {
  constructor(readonly code: CodexAppServerSessionErrorCode) {
    super(`Codex app-server session denied: ${code}`);
  }
}

export interface CodexAppServerSessionSnapshot {
  readonly state: CodexAppServerSessionState;
  readonly threadId: string | null;
  readonly turnId: string | null;
  readonly terminalStatus: 'completed' | 'interrupted' | 'failed' | null;
  readonly acceptedEvents: number;
  readonly acceptedBytes: number;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface CodexTerminalEvidence {
  readonly threadId: string;
  readonly turnId: string;
  readonly status: 'completed' | 'interrupted' | 'failed';
  readonly messageHash: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CodexAppServerSessionError('INVALID_MESSAGE');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new CodexAppServerSessionError('INVALID_MESSAGE');
  return value as JsonRecord;
}

function exact(value: unknown, keys: readonly string[]): JsonRecord {
  const result = record(value);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new CodexAppServerSessionError('INVALID_MESSAGE');
  return result;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value))
    throw new CodexAppServerSessionError('INVALID_MESSAGE');
  return value;
}

function requestId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new CodexAppServerSessionError('INVALID_MESSAGE');
  return value as number;
}

function byteLength(value: unknown): number {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_VALUE_NODES || current.depth > MAX_VALUE_DEPTH)
      throw new CodexAppServerSessionError('LIMIT_EXCEEDED');
    if (current.value === null || ['string', 'boolean', 'number'].includes(typeof current.value))
      continue;
    if (Array.isArray(current.value)) {
      if (current.value.length > 256) throw new CodexAppServerSessionError('LIMIT_EXCEEDED');
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    const currentRecord = record(current.value);
    const entries = Object.entries(currentRecord);
    if (entries.length > 64 || entries.some(([key]) => FORBIDDEN_KEYS.has(key)))
      throw new CodexAppServerSessionError('LIMIT_EXCEEDED');
    for (const [, child] of entries) pending.push({ value: child, depth: current.depth + 1 });
  }
  return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

function freeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value as Readonly<T>;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export class CodexAppServerProtocolSession {
  #state: CodexAppServerSessionState = 'NEW';
  #nextId = 1;
  #pendingId: number | null = null;
  #threadId: string | null = null;
  #turnId: string | null = null;
  #terminalStatus: 'completed' | 'interrupted' | 'failed' | null = null;
  #acceptedEvents = 0;
  #acceptedBytes = 0;

  snapshot(): Readonly<CodexAppServerSessionSnapshot> {
    return freeze({
      state: this.#state,
      threadId: this.#threadId,
      turnId: this.#turnId,
      terminalStatus: this.#terminalStatus,
      acceptedEvents: this.#acceptedEvents,
      acceptedBytes: this.#acceptedBytes,
      runtimeConnection: 'NOT_CONFIGURED',
    });
  }

  initialize(): Readonly<JsonRecord> {
    this.#require('NEW');
    const message = {
      method: 'initialize',
      id: this.#allocateId(),
      params: { clientInfo: { name: 'ventureos', title: 'VentureOS', version: '1.0.0' } },
    };
    this.#state = 'INITIALIZE_PENDING';
    return freeze(message);
  }

  acceptInitializeResponse(input: unknown): void {
    this.#admit(() => {
      this.#require('INITIALIZE_PENDING');
      const response = this.#response(input);
      const result = exact(response.result, ['userAgent', 'platformFamily', 'platformOs']);
      if (
        typeof result.userAgent !== 'string' ||
        result.userAgent.length === 0 ||
        result.userAgent.length > 256 ||
        CONTROL.test(result.userAgent)
      )
        return this.#deny('INVALID_MESSAGE');
      reference(result.platformFamily);
      reference(result.platformOs);
      this.#pendingId = null;
      this.#state = 'INITIALIZE_ACKNOWLEDGED';
    });
  }

  initialized(): Readonly<JsonRecord> {
    this.#require('INITIALIZE_ACKNOWLEDGED');
    this.#state = 'INITIALIZED';
    return freeze({ method: 'initialized', params: {} });
  }

  startThread(): Readonly<JsonRecord> {
    this.#require('INITIALIZED');
    const message = { method: 'thread/start', id: this.#allocateId(), params: {} };
    this.#state = 'THREAD_PENDING';
    return freeze(message);
  }

  acceptThreadResponse(input: unknown): void {
    this.#admit(() => {
      this.#require('THREAD_PENDING');
      const response = this.#response(input);
      const result = exact(response.result, ['thread']);
      const thread = record(result.thread);
      this.#threadId = reference(thread.id);
      this.#pendingId = null;
      this.#state = 'THREAD_READY';
    });
  }

  startTurn(text: string): Readonly<JsonRecord> {
    this.#require('THREAD_READY');
    if (
      typeof text !== 'string' ||
      text.length === 0 ||
      new TextEncoder().encode(text).byteLength > MAX_CODEX_TASK_TEXT_BYTES ||
      CONTROL.test(text.replace(/[\t\n\r]/gu, ''))
    )
      return this.#deny('LIMIT_EXCEEDED');
    const message = {
      method: 'turn/start',
      id: this.#allocateId(),
      params: { threadId: this.#threadId, input: [{ type: 'text', text }] },
    };
    this.#state = 'TURN_PENDING';
    return freeze(message);
  }

  acceptTurnResponse(input: unknown): void {
    this.#admit(() => {
      this.#require('TURN_PENDING');
      const response = this.#response(input);
      const result = exact(response.result, ['turn']);
      const turn = exact(result.turn, ['id', 'status', 'items', 'error']);
      if (turn.status !== 'inProgress' || !Array.isArray(turn.items) || turn.items.length !== 0)
        return this.#deny('INVALID_MESSAGE');
      if (turn.error !== null) return this.#deny('REMOTE_ERROR');
      this.#turnId = reference(turn.id);
      this.#pendingId = null;
      this.#state = 'TURN_ACTIVE';
    });
  }

  interrupt(): Readonly<JsonRecord> {
    this.#require('TURN_ACTIVE');
    const message = {
      method: 'turn/interrupt',
      id: this.#allocateId(),
      params: { threadId: this.#threadId, turnId: this.#turnId },
    };
    this.#state = 'INTERRUPT_PENDING';
    return freeze(message);
  }

  acceptInterruptResponse(input: unknown): void {
    this.#admit(() => {
      this.#require('INTERRUPT_PENDING');
      const response = this.#response(input);
      exact(response.result, []);
      this.#pendingId = null;
      this.#state = 'INTERRUPT_ACKNOWLEDGED';
    });
  }

  acceptTurnCompleted(input: unknown): Readonly<CodexTerminalEvidence> {
    return this.#admit(() => {
      this.#requireOneOf(['TURN_ACTIVE', 'INTERRUPT_ACKNOWLEDGED']);
      const bytes = this.#admitEvent(input);
      const notification = exact(input, ['method', 'params']);
      if (notification.method !== 'turn/completed') return this.#deny('INVALID_MESSAGE');
      const params = exact(notification.params, ['threadId', 'turn']);
      if (reference(params.threadId) !== this.#threadId) return this.#deny('CORRELATION_MISMATCH');
      const turn = exact(params.turn, ['id', 'status', 'items', 'error']);
      if (reference(turn.id) !== this.#turnId) return this.#deny('CORRELATION_MISMATCH');
      if (!['completed', 'interrupted', 'failed'].includes(turn.status as string))
        return this.#deny('INVALID_MESSAGE');
      if (!Array.isArray(turn.items)) return this.#deny('INVALID_MESSAGE');
      if (turn.status !== 'failed' && turn.error !== null) return this.#deny('INVALID_MESSAGE');
      this.#terminalStatus = turn.status as 'completed' | 'interrupted' | 'failed';
      this.#acceptedEvents += 1;
      this.#acceptedBytes += bytes;
      this.#state = 'TURN_TERMINAL';
      return freeze({
        threadId: this.#threadId,
        turnId: this.#turnId,
        status: this.#terminalStatus,
        messageHash: createHash('sha256').update(canonicalJson(input)).digest('hex'),
        runtimeConnection: 'NOT_CONFIGURED',
      });
    });
  }

  #response(input: unknown): JsonRecord {
    const response = record(input);
    if (Object.hasOwn(response, 'error')) return this.#deny('REMOTE_ERROR');
    const exactResponse = exact(response, ['id', 'result']);
    if (requestId(exactResponse.id) !== this.#pendingId) return this.#deny('CORRELATION_MISMATCH');
    return exactResponse;
  }

  #admitEvent(input: unknown): number {
    const bytes = byteLength(input);
    if (
      bytes > MAX_CODEX_EVENT_BYTES ||
      this.#acceptedEvents >= MAX_CODEX_SESSION_EVENTS ||
      bytes > MAX_CODEX_SESSION_BYTES - this.#acceptedBytes
    )
      return this.#deny('LIMIT_EXCEEDED');
    return bytes;
  }

  #allocateId(): number {
    const id = this.#nextId++;
    this.#pendingId = id;
    return id;
  }

  #require(expected: CodexAppServerSessionState): void {
    if (this.#state !== expected) this.#deny('INVALID_STATE');
  }

  #requireOneOf(expected: readonly CodexAppServerSessionState[]): void {
    if (!expected.includes(this.#state)) this.#deny('INVALID_STATE');
  }

  #admit<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof CodexAppServerSessionError) return this.#deny(error.code);
      return this.#deny('INVALID_MESSAGE');
    }
  }

  #deny(code: CodexAppServerSessionErrorCode): never {
    this.#state = 'FAILED';
    throw new CodexAppServerSessionError(code);
  }
}
