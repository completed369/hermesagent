import { createHash } from 'node:crypto';

import { canonicalJson } from './codec';
import {
  CodexAppServerProtocolSession,
  type CodexCancellationTerminalEvidence,
  type CodexInterruptEvidence,
  type CodexTerminalEvidence,
} from './codex-app-server-session';
import type { CodexAppServerStdioTransportOptions } from './codex-app-server-stdio-transport';
import {
  CODEX_VALIDATION_CHALLENGE,
  type CodexValidationDispatchCandidate,
  validateCodexValidationDispatchCandidate,
} from './codex-validation-dispatch';

const MAX_PROGRESS_EVENTS = 128;
const MAX_RUN_MS = 15_000;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SAFE_PROGRESS_METHODS = new Set([
  'turn/started',
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'thread/tokenUsage/updated',
]);
const SAFE_ITEM_TYPES = new Set(['userMessage', 'agentMessage', 'reasoning']);

type JsonRecord = Record<string, unknown>;

export interface CodexValidationProtocolTransport {
  write(message: unknown, options?: Readonly<CodexAppServerStdioTransportOptions>): Promise<void>;
  read(
    options?: Readonly<CodexAppServerStdioTransportOptions>,
  ): Promise<Readonly<Record<string, unknown>>>;
}

export interface CodexValidationProtocolRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface CodexValidationUsageObservationEvidence {
  readonly progressEventCount: number;
  readonly progressEvidenceHash: string;
  readonly tokenUsageEventCount: number;
  readonly tokenUsageEvidenceHash: string;
  readonly usageAccountingState: 'NOT_OBSERVED' | 'OBSERVED_UNMAPPED';
  readonly recognizedCostMinorUnits: 0;
  readonly recognizedComputeUnits: 0;
}

export type CodexValidationProtocolEvidence =
  | (CodexTerminalEvidence & CodexValidationUsageObservationEvidence)
  | (CodexCancellationTerminalEvidence & CodexValidationUsageObservationEvidence);

export type CodexValidationProtocolRunnerErrorCode =
  | 'INVALID_DISPATCH'
  | 'INVALID_TIMEOUT'
  | 'CANCELLED'
  | 'UNEXPECTED_MESSAGE'
  | 'UNSAFE_ACTIVITY'
  | 'CORRELATION_MISMATCH'
  | 'RESULT_MISMATCH'
  | 'LIMIT_EXCEEDED';

export class CodexValidationProtocolRunnerError extends Error {
  constructor(readonly code: CodexValidationProtocolRunnerErrorCode) {
    super(`Codex validation protocol run denied: ${code}`);
  }
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CodexValidationProtocolRunnerError('UNEXPECTED_MESSAGE');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new CodexValidationProtocolRunnerError('UNEXPECTED_MESSAGE');
  return value as JsonRecord;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value))
    throw new CodexValidationProtocolRunnerError('CORRELATION_MISMATCH');
  return value;
}

function challengeText(dispatchId: string): string {
  return [
    `VentureOS validation ${CODEX_VALIDATION_CHALLENGE}.`,
    'Do not call tools, commands, apps, network resources, or modify files.',
    `Reply with exactly this token and nothing else: ventureos-validation:${dispatchId}`,
  ].join(' ');
}

function terminalToken(dispatchId: string): string {
  return `ventureos-validation:${dispatchId}`;
}

function finalText(input: unknown): string {
  const message = record(input);
  const params = record(message.params);
  const turn = record(params.turn);
  if (!Array.isArray(turn.items)) throw new CodexValidationProtocolRunnerError('RESULT_MISMATCH');
  const admittedItems = turn.items.map((item) => record(item));
  if (
    admittedItems.some((item) => typeof item.type !== 'string' || !SAFE_ITEM_TYPES.has(item.type))
  )
    throw new CodexValidationProtocolRunnerError('UNSAFE_ACTIVITY');
  const agentMessages = admittedItems.filter((item) => {
    return item.type === 'agentMessage';
  });
  if (agentMessages.length !== 1) throw new CodexValidationProtocolRunnerError('RESULT_MISMATCH');
  const agentMessage = record(agentMessages[0]);
  if (typeof agentMessage.text !== 'string')
    throw new CodexValidationProtocolRunnerError('RESULT_MISMATCH');
  return agentMessage.text;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function admitProgress(
  input: unknown,
  threadId: string,
  turnId: string,
): Readonly<{ method: string; eventHash: string }> {
  const message = record(input);
  if (Object.hasOwn(message, 'id')) throw new CodexValidationProtocolRunnerError('UNSAFE_ACTIVITY');
  if (typeof message.method !== 'string' || !SAFE_PROGRESS_METHODS.has(message.method))
    throw new CodexValidationProtocolRunnerError('UNSAFE_ACTIVITY');
  const params = record(message.params);
  if (!Object.hasOwn(params, 'threadId') || reference(params.threadId) !== threadId)
    throw new CodexValidationProtocolRunnerError('CORRELATION_MISMATCH');
  if (
    message.method !== 'thread/tokenUsage/updated' &&
    message.method !== 'turn/started' &&
    (!Object.hasOwn(params, 'turnId') || reference(params.turnId) !== turnId)
  )
    throw new CodexValidationProtocolRunnerError('CORRELATION_MISMATCH');
  if (message.method === 'turn/started') {
    const turn = record(params.turn);
    if (reference(turn.id) !== turnId || turn.status !== 'inProgress')
      throw new CodexValidationProtocolRunnerError('CORRELATION_MISMATCH');
  }
  if (message.method === 'item/started' || message.method === 'item/completed') {
    const item = record(params.item);
    if (typeof item.type !== 'string' || !SAFE_ITEM_TYPES.has(item.type))
      throw new CodexValidationProtocolRunnerError('UNSAFE_ACTIVITY');
  }
  const pending: Array<{ value: unknown; depth: number }> = [{ value: message, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > 1_024 || current.depth > 8)
      throw new CodexValidationProtocolRunnerError('LIMIT_EXCEEDED');
    if (current.value === null || ['string', 'boolean', 'number'].includes(typeof current.value))
      continue;
    if (Array.isArray(current.value)) {
      if (current.value.length > 256)
        throw new CodexValidationProtocolRunnerError('LIMIT_EXCEEDED');
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    const entries = Object.entries(record(current.value));
    if (entries.length > 64) throw new CodexValidationProtocolRunnerError('LIMIT_EXCEEDED');
    for (const [, child] of entries) pending.push({ value: child, depth: current.depth + 1 });
  }
  // Bound and canonicalize every admitted event without retaining its content.
  const bytes = new TextEncoder().encode(canonicalJson(message)).byteLength;
  if (bytes > 65_536) throw new CodexValidationProtocolRunnerError('LIMIT_EXCEEDED');
  return Object.freeze({ method: message.method, eventHash: sha256(message) });
}

function usageObservation(
  progressEventHashes: readonly string[],
  tokenUsageEventHashes: readonly string[],
): Readonly<CodexValidationUsageObservationEvidence> {
  return Object.freeze({
    progressEventCount: progressEventHashes.length,
    progressEvidenceHash: sha256({
      domain: 'ventureos.codex-validation.progress.v1',
      eventHashes: progressEventHashes,
    }),
    tokenUsageEventCount: tokenUsageEventHashes.length,
    tokenUsageEvidenceHash: sha256({
      domain: 'ventureos.codex-validation.token-usage.v1',
      eventHashes: tokenUsageEventHashes,
    }),
    usageAccountingState: tokenUsageEventHashes.length === 0 ? 'NOT_OBSERVED' : 'OBSERVED_UNMAPPED',
    recognizedCostMinorUnits: 0,
    recognizedComputeUnits: 0,
  });
}

/**
 * Drives one zero-cost validation over an already-open, separately authorized
 * app-server transport. It never starts a process, resolves credentials,
 * grants provider access, or promotes runtime truth.
 */
export class BoundedCodexValidationProtocolRunner {
  constructor(
    private readonly transport: CodexValidationProtocolTransport,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async run(
    dispatchInput: unknown,
    options: Readonly<CodexValidationProtocolRunOptions> = {},
  ): Promise<Readonly<CodexValidationProtocolEvidence>> {
    let dispatch: Readonly<CodexValidationDispatchCandidate>;
    try {
      dispatch = validateCodexValidationDispatchCandidate(dispatchInput);
    } catch {
      throw new CodexValidationProtocolRunnerError('INVALID_DISPATCH');
    }
    const startedAt = this.clock().getTime();
    if (!Number.isFinite(startedAt))
      throw new CodexValidationProtocolRunnerError('INVALID_TIMEOUT');
    const authorityRemaining = Date.parse(dispatch.expiresAt) - startedAt;
    if (startedAt < Date.parse(dispatch.issuedAt) || authorityRemaining < 1)
      throw new CodexValidationProtocolRunnerError('INVALID_DISPATCH');
    const maximumTimeout = Math.min(MAX_RUN_MS, dispatch.maximumDurationMs, authorityRemaining);
    const timeoutMs = options.timeoutMs ?? maximumTimeout;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maximumTimeout)
      throw new CodexValidationProtocolRunnerError('INVALID_TIMEOUT');
    if (options.signal?.aborted) throw new CodexValidationProtocolRunnerError('CANCELLED');
    const deadline = startedAt + timeoutMs;
    const session = new CodexAppServerProtocolSession();
    const ioOptions = (includeSignal = true) => {
      const remaining = deadline - this.clock().getTime();
      if (!Number.isFinite(remaining) || remaining < 1)
        throw new CodexValidationProtocolRunnerError('INVALID_TIMEOUT');
      return {
        timeoutMs: Math.min(5_000, remaining),
        signal: includeSignal ? options.signal : undefined,
      };
    };
    const exchange = async (request: Readonly<JsonRecord>): Promise<Readonly<JsonRecord>> => {
      await this.transport.write(request, ioOptions());
      const response = await this.transport.read(ioOptions());
      if (response.id !== request.id)
        throw new CodexValidationProtocolRunnerError('CORRELATION_MISMATCH');
      return response;
    };

    session.acceptInitializeResponse(await exchange(session.initialize()));
    await this.transport.write(session.initialized(), ioOptions());
    session.acceptThreadResponse(await exchange(session.startThread()));
    if (!session.validationRestrictionsAccepted())
      throw new CodexValidationProtocolRunnerError('UNSAFE_ACTIVITY');
    session.acceptTurnResponse(
      await exchange(session.startTurn(challengeText(dispatch.dispatchId))),
    );
    const snapshot = session.snapshot();
    if (!snapshot.threadId || !snapshot.turnId)
      throw new CodexValidationProtocolRunnerError('CORRELATION_MISMATCH');

    let interruptRequestId: number | undefined;
    let interruptWrite: Promise<void> | undefined;
    let interruptAcknowledged = false;
    let interruptEvidence: Readonly<CodexInterruptEvidence> | undefined;
    let rejectInterruptFailure!: (reason?: unknown) => void;
    const interruptFailure = new Promise<never>((_resolve, reject) => {
      rejectInterruptFailure = reject;
    });
    const requestInterrupt = () => {
      if (interruptRequestId !== undefined) return;
      try {
        const request = session.interrupt();
        interruptRequestId = request.id as number;
        interruptWrite = this.transport.write(request, ioOptions(false));
        void interruptWrite.catch(rejectInterruptFailure);
      } catch (error) {
        rejectInterruptFailure(error);
      }
    };
    options.signal?.addEventListener('abort', requestInterrupt, { once: true });
    if (options.signal?.aborted) requestInterrupt();
    const progressEventHashes: string[] = [];
    const tokenUsageEventHashes: string[] = [];
    try {
      for (let count = 0; count <= MAX_PROGRESS_EVENTS; count += 1) {
        if (count === MAX_PROGRESS_EVENTS)
          throw new CodexValidationProtocolRunnerError('LIMIT_EXCEEDED');
        const message = await Promise.race([
          this.transport.read(ioOptions(false)),
          interruptFailure,
        ]);
        if (interruptRequestId !== undefined && Object.hasOwn(message, 'id')) {
          if (message.id !== interruptRequestId)
            throw new CodexValidationProtocolRunnerError('CORRELATION_MISMATCH');
          await interruptWrite;
          interruptEvidence = session.acceptInterruptResponse(message);
          interruptAcknowledged = true;
          continue;
        }
        if (message.method === 'turn/completed') {
          if (interruptRequestId !== undefined && !interruptAcknowledged)
            throw new CodexValidationProtocolRunnerError('RESULT_MISMATCH');
          if (
            interruptRequestId === undefined &&
            finalText(message) !== terminalToken(dispatch.dispatchId)
          )
            throw new CodexValidationProtocolRunnerError('RESULT_MISMATCH');
          const evidence = session.acceptTurnCompleted(message);
          if (
            (interruptRequestId === undefined && evidence.status !== 'completed') ||
            (interruptRequestId !== undefined && evidence.status !== 'interrupted')
          )
            throw new CodexValidationProtocolRunnerError('RESULT_MISMATCH');
          if (evidence.status === 'interrupted') {
            if (!interruptEvidence) throw new CodexValidationProtocolRunnerError('RESULT_MISMATCH');
            return Object.freeze({
              ...evidence,
              ...interruptEvidence,
              ...usageObservation(progressEventHashes, tokenUsageEventHashes),
            });
          }
          return Object.freeze({
            ...evidence,
            ...usageObservation(progressEventHashes, tokenUsageEventHashes),
          });
        }
        const admitted = admitProgress(message, snapshot.threadId, snapshot.turnId);
        progressEventHashes.push(admitted.eventHash);
        if (admitted.method === 'thread/tokenUsage/updated')
          tokenUsageEventHashes.push(admitted.eventHash);
      }
      throw new CodexValidationProtocolRunnerError('LIMIT_EXCEEDED');
    } finally {
      options.signal?.removeEventListener('abort', requestInterrupt);
    }
  }
}

export function codexValidationTerminalTokenHash(dispatchId: string): string {
  return createHash('sha256')
    .update(terminalToken(reference(dispatchId)))
    .digest('hex');
}
