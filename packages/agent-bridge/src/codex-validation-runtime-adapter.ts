import { createHash, timingSafeEqual } from 'node:crypto';

import {
  deriveBridgeKeys,
  digestBridgePayload,
  signBridgeEnvelope,
  verifyBridgeEnvelope,
} from './auth';
import type { AuthenticatedJsonlSessionContext } from './authenticated-jsonl-session';
import { canonicalJson, encodeBridgeLine, validateBridgeEnvelope } from './codec';
import type { CodexTerminalEvidence } from './codex-app-server-session';
import {
  CODEX_VALIDATION_CHALLENGE,
  codexValidationDispatchPayload,
  validateCodexValidationDispatchCandidate,
  type CodexValidationDispatchCandidate,
} from './codex-validation-dispatch';
import type { CodexValidationProtocolRunOptions } from './codex-validation-protocol-runner';
import {
  CODEX_VALIDATION_RESULT_CODE,
  createCodexValidationRoundTripCandidate,
  type CodexValidationRoundTripCandidate,
} from './codex-validation-round-trip';
import {
  DenyBridgeEgressTransport,
  type BridgeEgressTransport,
  type BridgeEgressWriteResult,
} from './egress-controller';
import { BRIDGE_PROTOCOL_VERSION, type BridgeEnvelope } from './protocol';
import {
  BridgeSecretLeaseError,
  DenyBridgeSecretLeaseResolver,
  type BridgeSecretLeaseResolver,
} from './secret-lease';

const MAX_WRITE_MS = 5_000;
const MAX_TRACKED_DISPATCHES = 1_024;
const MAX_FRAME_NODES = 1_024;
const MAX_FRAME_DEPTH = 8;
const SHA256 = /^[a-f0-9]{64}$/u;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;

export interface CodexValidationRuntimeProtocolRunner {
  run(
    dispatch: unknown,
    options?: Readonly<CodexValidationProtocolRunOptions>,
  ): Promise<Readonly<CodexTerminalEvidence>>;
}

export interface CodexValidationRuntimeAdapterInput {
  readonly dispatch: Readonly<CodexValidationDispatchCandidate>;
  readonly bridge: Readonly<AuthenticatedJsonlSessionContext>;
  readonly dispatchEnvelope: Readonly<BridgeEnvelope>;
}

export interface CodexValidationRuntimeAdapterOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export type CodexValidationRuntimeAdapterErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_FRAME'
  | 'AUTHORITY_EXPIRED'
  | 'CONCURRENT_DISPATCH'
  | 'USED_DISPATCH'
  | 'LIMIT_EXCEEDED'
  | 'CANCELLED'
  | 'SECRET_LEASE_DENIED'
  | 'WRITE_TIMEOUT'
  | 'TRANSPORT_DENIED'
  | 'TRANSPORT_MUTATED_FRAME';

export class CodexValidationRuntimeAdapterError extends Error {
  constructor(readonly code: CodexValidationRuntimeAdapterErrorCode) {
    super(`Codex validation runtime adapter denied: ${code}`);
  }
}

type ValidatedBridge = Readonly<AuthenticatedJsonlSessionContext>;

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
  return record;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value))
    throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
  return value;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function equalDigest(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function validateBridge(input: unknown): ValidatedBridge {
  const bridge = exactRecord(input, [
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
    bridge.schemaVersion !== 1 ||
    !Number.isSafeInteger(bridge.authGeneration) ||
    (bridge.authGeneration as number) < 1
  )
    throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
  const authenticatedAt = timestamp(bridge.authenticatedAt);
  const expiresAt = timestamp(bridge.expiresAt);
  if (
    Date.parse(expiresAt) <= Date.parse(authenticatedAt) ||
    Date.parse(expiresAt) - Date.parse(authenticatedAt) > 15 * 60_000
  )
    throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: reference(bridge.workspaceId),
    runtimeId: reference(bridge.runtimeId),
    connectionId: reference(bridge.connectionId),
    sessionId: reference(bridge.sessionId),
    principalReference: reference(bridge.principalReference),
    parentNonce: reference(bridge.parentNonce),
    runtimeNonce: reference(bridge.runtimeNonce),
    secretReference: reference(bridge.secretReference),
    expectedSecretDigest: digest(bridge.expectedSecretDigest),
    authGeneration: bridge.authGeneration as number,
    authenticatedAt,
    expiresAt,
  });
}

function validateTerminal(input: unknown): Readonly<CodexTerminalEvidence> {
  const terminal = exactRecord(input, [
    'messageHash',
    'runtimeConnection',
    'status',
    'threadId',
    'turnId',
  ]);
  if (terminal.status !== 'completed' || terminal.runtimeConnection !== 'NOT_CONFIGURED')
    throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
  return Object.freeze({
    threadId: reference(terminal.threadId),
    turnId: reference(terminal.turnId),
    status: 'completed',
    messageHash: digest(terminal.messageHash),
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function validateBinding(
  dispatch: Readonly<CodexValidationDispatchCandidate>,
  bridge: ValidatedBridge,
): void {
  for (const field of [
    'workspaceId',
    'runtimeId',
    'connectionId',
    'sessionId',
    'principalReference',
  ] as const) {
    if (dispatch[field] !== bridge[field])
      throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
  }
  const bridgeIdentityHash = hash({
    authGeneration: bridge.authGeneration,
    authenticatedAt: bridge.authenticatedAt,
    connectionId: bridge.connectionId,
    expectedSecretDigest: bridge.expectedSecretDigest,
    expiresAt: bridge.expiresAt,
    parentNonce: bridge.parentNonce,
    principalReference: bridge.principalReference,
    runtimeNonce: bridge.runtimeNonce,
    runtimeId: bridge.runtimeId,
    secretReference: bridge.secretReference,
    sessionId: bridge.sessionId,
    workspaceId: bridge.workspaceId,
  });
  const secretBindingHash = hash({
    expectedSecretDigest: bridge.expectedSecretDigest,
    secretReference: bridge.secretReference,
  });
  if (
    dispatch.authGeneration !== bridge.authGeneration ||
    !equalDigest(dispatch.bridgeIdentityHash, bridgeIdentityHash) ||
    !equalDigest(dispatch.secretBindingHash, secretBindingHash) ||
    Date.parse(dispatch.expiresAt) > Date.parse(bridge.expiresAt)
  )
    throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
}

function unsigned(envelope: Readonly<BridgeEnvelope>): Omit<BridgeEnvelope, 'mac'> {
  const { mac: _mac, ...value } = envelope;
  return value;
}

function enforceFrameBounds(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_FRAME_NODES || current.depth > MAX_FRAME_DEPTH)
      throw new CodexValidationRuntimeAdapterError('LIMIT_EXCEEDED');
    if (current.value === null || ['string', 'boolean', 'number'].includes(typeof current.value))
      continue;
    if (Array.isArray(current.value)) {
      if (current.value.length > 256)
        throw new CodexValidationRuntimeAdapterError('LIMIT_EXCEEDED');
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (!current.value || typeof current.value !== 'object')
      throw new CodexValidationRuntimeAdapterError('INVALID_FRAME');
    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new CodexValidationRuntimeAdapterError('INVALID_FRAME');
    const entries = Object.entries(current.value);
    if (entries.length > 64) throw new CodexValidationRuntimeAdapterError('LIMIT_EXCEEDED');
    for (const [, child] of entries) pending.push({ value: child, depth: current.depth + 1 });
  }
}

function validateDispatchFrame(
  dispatch: Readonly<CodexValidationDispatchCandidate>,
  envelope: Readonly<BridgeEnvelope>,
): void {
  try {
    enforceFrameBounds(envelope);
    validateBridgeEnvelope(envelope);
  } catch (error) {
    if (error instanceof CodexValidationRuntimeAdapterError) throw error;
    throw new CodexValidationRuntimeAdapterError('INVALID_FRAME');
  }
  if (
    envelope.protocolVersion !== BRIDGE_PROTOCOL_VERSION ||
    envelope.type !== 'DISPATCH' ||
    envelope.sequence !== 1 ||
    envelope.messageId !== dispatch.messageId ||
    envelope.issuedAt !== dispatch.issuedAt ||
    envelope.expiresAt !== dispatch.expiresAt ||
    !equalDigest(envelope.payloadDigest, dispatch.payloadDigest) ||
    !equalDigest(hash(unsigned(envelope)), dispatch.unsignedEnvelopeDigest) ||
    canonicalJson(envelope.payload) !== canonicalJson(codexValidationDispatchPayload(dispatch))
  )
    throw new CodexValidationRuntimeAdapterError('INVALID_FRAME');
}

function createUnsignedRuntimeEnvelope(
  dispatch: Readonly<CodexValidationDispatchCandidate>,
  bridge: ValidatedBridge,
  terminal: Readonly<CodexTerminalEvidence>,
  sequence: 2 | 3,
  issuedAt: string,
  expiresAt: string,
): Omit<BridgeEnvelope, 'mac'> {
  const statusPayload = {
    challengeCode: CODEX_VALIDATION_CHALLENGE,
    dispatchId: dispatch.dispatchId,
    taskId: dispatch.taskId,
    runId: dispatch.runId,
  };
  const payload =
    sequence === 2
      ? statusPayload
      : {
          ...statusPayload,
          resultCode: CODEX_VALIDATION_RESULT_CODE,
          terminalThreadId: terminal.threadId,
          terminalTurnId: terminal.turnId,
          terminalMessageHash: terminal.messageHash,
          terminalStatus: 'completed',
        };
  return Object.freeze({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    workspaceId: bridge.workspaceId,
    runtimeId: bridge.runtimeId,
    connectionId: bridge.connectionId,
    sessionId: bridge.sessionId,
    principalReference: bridge.principalReference,
    sequence,
    messageId: `${sequence === 2 ? 'validation-status' : 'validation-result'}:${hash(dispatch.dispatchId).slice(0, 32)}`,
    type: sequence === 2 ? 'DISPATCH_ACCEPTED' : 'RESULT',
    issuedAt,
    expiresAt,
    payloadDigest: digestBridgePayload(payload),
    payload: Object.freeze(payload),
  });
}

/**
 * Runtime-side boundary for one authenticated, zero-cost Codex validation.
 * It cannot launch a process, resolve provider credentials, or promote runtime truth.
 */
export class BoundedCodexValidationRuntimeAdapter {
  readonly #active = new Set<string>();
  readonly #used = new Map<string, number>();

  constructor(
    private readonly runner: CodexValidationRuntimeProtocolRunner,
    private readonly secretLeaseResolver: BridgeSecretLeaseResolver = new DenyBridgeSecretLeaseResolver(),
    private readonly transport: BridgeEgressTransport = new DenyBridgeEgressTransport(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    input: Readonly<CodexValidationRuntimeAdapterInput>,
    options: Readonly<CodexValidationRuntimeAdapterOptions> = {},
  ): Promise<Readonly<CodexValidationRoundTripCandidate>> {
    let dispatch: Readonly<CodexValidationDispatchCandidate>;
    let bridge: ValidatedBridge;
    try {
      dispatch = validateCodexValidationDispatchCandidate(input.dispatch);
      bridge = validateBridge(input.bridge);
      validateBinding(dispatch, bridge);
      validateDispatchFrame(dispatch, input.dispatchEnvelope);
    } catch (error) {
      if (error instanceof CodexValidationRuntimeAdapterError) throw error;
      throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
    }
    const now = this.validClock();
    if (
      now.getTime() < Date.parse(dispatch.issuedAt) ||
      now.getTime() >= Date.parse(dispatch.expiresAt) ||
      now.getTime() >= Date.parse(bridge.expiresAt)
    )
      throw new CodexValidationRuntimeAdapterError('AUTHORITY_EXPIRED');
    if (options.signal?.aborted) throw new CodexValidationRuntimeAdapterError('CANCELLED');
    const deadline = Math.min(
      now.getTime() + dispatch.maximumDurationMs,
      Date.parse(dispatch.expiresAt),
      Date.parse(bridge.expiresAt),
    );
    for (const [id, expiresAt] of this.#used) if (expiresAt <= now.getTime()) this.#used.delete(id);
    const id = `${bridge.sessionId}:${dispatch.dispatchId}`;
    if (this.#active.has(id)) throw new CodexValidationRuntimeAdapterError('CONCURRENT_DISPATCH');
    if (this.#used.has(id)) throw new CodexValidationRuntimeAdapterError('USED_DISPATCH');
    if (this.#used.size >= MAX_TRACKED_DISPATCHES)
      throw new CodexValidationRuntimeAdapterError('LIMIT_EXCEEDED');
    this.#active.add(id);
    this.#used.set(id, deadline);
    try {
      await this.withSecret(bridge, 'VERIFY_FRAME', (secret) => {
        const keys = deriveBridgeKeys(secret, bridge);
        try {
          verifyBridgeEnvelope(input.dispatchEnvelope, keys.parentToRuntime, bridge, now);
        } catch {
          throw new CodexValidationRuntimeAdapterError('INVALID_FRAME');
        } finally {
          keys.parentToRuntime.fill(0);
          keys.runtimeToParent.fill(0);
        }
      });
      const runRemaining = deadline - this.validClock().getTime();
      if (runRemaining < 1) throw new CodexValidationRuntimeAdapterError('AUTHORITY_EXPIRED');
      const terminal = validateTerminal(
        await this.runner.run(dispatch, {
          ...options,
          timeoutMs: Math.min(options.timeoutMs ?? runRemaining, runRemaining),
        }),
      );
      const statusAt = this.authorizedTimestamp(deadline);
      const terminalAt = this.authorizedTimestamp(deadline, statusAt);
      const evidenceExpiresAt = new Date(deadline).toISOString();
      const [statusEnvelope, terminalEnvelope] = await this.withSecret(
        bridge,
        'SIGN_FRAME',
        (secret) => {
          const keys = deriveBridgeKeys(secret, bridge);
          try {
            return Object.freeze([
              signBridgeEnvelope(
                createUnsignedRuntimeEnvelope(
                  dispatch,
                  bridge,
                  terminal,
                  2,
                  statusAt,
                  evidenceExpiresAt,
                ),
                keys.runtimeToParent,
              ),
              signBridgeEnvelope(
                createUnsignedRuntimeEnvelope(
                  dispatch,
                  bridge,
                  terminal,
                  3,
                  terminalAt,
                  evidenceExpiresAt,
                ),
                keys.runtimeToParent,
              ),
            ] as const);
          } finally {
            keys.parentToRuntime.fill(0);
            keys.runtimeToParent.fill(0);
          }
        },
      );
      await this.write(dispatch, statusEnvelope, deadline, options.signal);
      await this.write(dispatch, terminalEnvelope, deadline, options.signal);
      return createCodexValidationRoundTripCandidate({
        dispatch,
        bridge,
        terminal,
        statusEnvelope,
        terminalEnvelope,
      });
    } finally {
      this.#active.delete(id);
    }
  }

  private validClock(): Date {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
      throw new CodexValidationRuntimeAdapterError('INVALID_INPUT');
    return now;
  }

  private authorizedTimestamp(deadline: number, floor?: string): string {
    const now = this.validClock();
    const value = Math.max(now.getTime(), floor === undefined ? 0 : Date.parse(floor));
    if (value >= deadline) throw new CodexValidationRuntimeAdapterError('AUTHORITY_EXPIRED');
    return new Date(value).toISOString();
  }

  private async withSecret<T>(
    bridge: ValidatedBridge,
    purpose: 'VERIFY_FRAME' | 'SIGN_FRAME',
    consumer: (secret: Uint8Array) => Promise<T> | T,
  ): Promise<T> {
    try {
      return await this.secretLeaseResolver.withSecret(
        {
          workspaceId: bridge.workspaceId,
          runtimeId: bridge.runtimeId,
          connectionId: bridge.connectionId,
          secretReference: bridge.secretReference,
          expectedDigest: bridge.expectedSecretDigest,
          authGeneration: bridge.authGeneration,
          purpose,
        },
        consumer,
      );
    } catch (error) {
      if (error instanceof CodexValidationRuntimeAdapterError) throw error;
      if (error instanceof BridgeSecretLeaseError)
        throw new CodexValidationRuntimeAdapterError('SECRET_LEASE_DENIED');
      throw new CodexValidationRuntimeAdapterError('SECRET_LEASE_DENIED');
    }
  }

  private async write(
    dispatch: Readonly<CodexValidationDispatchCandidate>,
    envelope: Readonly<BridgeEnvelope>,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<Readonly<BridgeEgressWriteResult>> {
    let encoded: Uint8Array;
    try {
      encoded = encodeBridgeLine(envelope);
    } catch {
      throw new CodexValidationRuntimeAdapterError('INVALID_FRAME');
    }
    const line = Uint8Array.from(encoded);
    const expected = Uint8Array.from(line);
    const controller = new AbortController();
    const remaining = deadline - this.validClock().getTime();
    if (remaining < 1) {
      encoded.fill(0);
      line.fill(0);
      expected.fill(0);
      throw new CodexValidationRuntimeAdapterError('AUTHORITY_EXPIRED');
    }
    const timeoutMs = Math.min(MAX_WRITE_MS, remaining);
    const attemptId = `runtime-${envelope.sequence}:${hash(dispatch.dispatchId).slice(0, 32)}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeAbort = () => {};
    try {
      const interrupted = new Promise<never>((_resolve, reject) => {
        const fail = (code: 'CANCELLED' | 'WRITE_TIMEOUT') => {
          controller.abort();
          reject(new CodexValidationRuntimeAdapterError(code));
        };
        timer = setTimeout(() => fail('WRITE_TIMEOUT'), timeoutMs);
        if (signal) {
          const abort = () => fail('CANCELLED');
          signal.addEventListener('abort', abort, { once: true });
          removeAbort = () => signal.removeEventListener('abort', abort);
        }
      });
      try {
        await Promise.race([
          this.transport.write(
            Object.freeze({
              schemaVersion: 1 as const,
              attemptId,
              workspaceId: envelope.workspaceId,
              runtimeId: envelope.runtimeId,
              connectionId: envelope.connectionId,
              sessionId: envelope.sessionId,
              dispatchId: dispatch.dispatchId,
              messageId: envelope.messageId,
              sequence: envelope.sequence,
              line,
              signal: controller.signal,
            }),
          ),
          interrupted,
        ]);
      } catch (error) {
        if (error instanceof CodexValidationRuntimeAdapterError) throw error;
        throw new CodexValidationRuntimeAdapterError('TRANSPORT_DENIED');
      }
      if (!timingSafeEqual(Buffer.from(line), Buffer.from(expected)))
        throw new CodexValidationRuntimeAdapterError('TRANSPORT_MUTATED_FRAME');
      const completedAt = this.validClock();
      if (completedAt.getTime() >= deadline)
        throw new CodexValidationRuntimeAdapterError('AUTHORITY_EXPIRED');
      return Object.freeze({
        schemaVersion: 1,
        attemptId,
        workspaceId: envelope.workspaceId,
        runtimeId: envelope.runtimeId,
        connectionId: envelope.connectionId,
        sessionId: envelope.sessionId,
        dispatchId: dispatch.dispatchId,
        messageId: envelope.messageId,
        sequence: envelope.sequence,
        acceptedBytes: line.byteLength,
        completedAt: completedAt.toISOString(),
      });
    } finally {
      if (timer) clearTimeout(timer);
      removeAbort();
      controller.abort();
      encoded.fill(0);
      line.fill(0);
      expected.fill(0);
    }
  }
}
