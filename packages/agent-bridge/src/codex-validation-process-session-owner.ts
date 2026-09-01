import { createHash } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';

import { canonicalJson } from './codec';
import { BoundedCodexAppServerStdioTransport } from './codex-app-server-stdio-transport';
import type { CodexValidationCancellationCandidate } from './codex-validation-cancellation';
import {
  validateCodexValidationDispatchCandidate,
  type CodexValidationDispatchCandidate,
} from './codex-validation-dispatch';
import {
  BoundedCodexValidationProtocolRunner,
  type CodexValidationProtocolEvidence,
} from './codex-validation-protocol-runner';
import type { CodexValidationRoundTripCandidate } from './codex-validation-round-trip';
import {
  BoundedCodexValidationRuntimeAdapter,
  type CodexValidationRuntimeAdapterInput,
  type CodexValidationRuntimeAdapterOptions,
  type CodexValidationRuntimeProtocolRunner,
} from './codex-validation-runtime-adapter';
import { DenyBridgeEgressTransport, type BridgeEgressTransport } from './egress-controller';
import { DenyBridgeSecretLeaseResolver, type BridgeSecretLeaseResolver } from './secret-lease';
import {
  validateSupervisorProcessBinding,
  type SupervisorProcessBinding,
} from './supervision-lifecycle';

const MAX_CLEANUP_TIMEOUT_MS = 5_000;
const MAX_TRACKED_DISPATCHES = 1_024;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export type CodexValidationProcessSessionErrorCode =
  | 'INVALID_INPUT'
  | 'OWNER_DENIED'
  | 'INVALID_SESSION'
  | 'CLEANUP_FAILED'
  | 'CLEANUP_TIMEOUT'
  | 'CONCURRENT_DISPATCH'
  | 'USED_DISPATCH'
  | 'LIMIT_EXCEEDED';

export class CodexValidationProcessSessionError extends Error {
  constructor(readonly code: CodexValidationProcessSessionErrorCode) {
    super(`Codex validation process session denied: ${code}`);
  }
}

export interface CodexValidationProcessOpenRequest {
  readonly schemaVersion: 1;
  readonly binding: Readonly<SupervisorProcessBinding>;
  readonly dispatchId: string;
  readonly validationDispatchCandidateHash: string;
  readonly sessionId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface CodexValidationProcessCloseRequest extends CodexValidationProcessOpenRequest {
  readonly reason: 'COMPLETED' | 'CANCELLED' | 'FAILED';
}

export interface CodexValidationProcessCloseResult {
  readonly schemaVersion: 1;
  readonly binding: Readonly<SupervisorProcessBinding>;
  readonly dispatchId: string;
  readonly validationDispatchCandidateHash: string;
  readonly sessionId: string;
  readonly processState: 'EXITED';
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly closedAt: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface CodexValidationOwnedProcessSession {
  readonly binding: unknown;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly close: (request: Readonly<CodexValidationProcessCloseRequest>) => Promise<unknown>;
}

export interface CodexValidationProcessSessionOwner {
  open(request: Readonly<CodexValidationProcessOpenRequest>): Promise<unknown>;
}

export class DenyCodexValidationProcessSessionOwner implements CodexValidationProcessSessionOwner {
  async open(_request: Readonly<CodexValidationProcessOpenRequest>): Promise<never> {
    throw new CodexValidationProcessSessionError('OWNER_DENIED');
  }
}

export interface CodexValidationProcessCleanupEvidence extends CodexValidationProcessCloseResult {
  readonly reason: 'COMPLETED' | 'CANCELLED';
  readonly cleanupEvidenceHash: string;
}

export interface CodexValidationOwnedProcessResult {
  readonly terminal: Readonly<
    CodexValidationRoundTripCandidate | CodexValidationCancellationCandidate
  >;
  readonly cleanup: Readonly<CodexValidationProcessCleanupEvidence>;
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly connectionTransition: 'NOT_APPLIED';
}

export interface CodexValidationOwnedProcessInput extends CodexValidationRuntimeAdapterInput {
  readonly binding: Readonly<SupervisorProcessBinding>;
}

export interface CodexValidationOwnedProcessOptions extends CodexValidationRuntimeAdapterOptions {
  readonly cleanupTimeoutMs?: number;
}

function exact(
  value: unknown,
  keys: readonly string[],
  code: CodexValidationProcessSessionErrorCode,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CodexValidationProcessSessionError(code);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new CodexValidationProcessSessionError(code);
  return record;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value))
    throw new CodexValidationProcessSessionError('INVALID_SESSION');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new CodexValidationProcessSessionError('INVALID_SESSION');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new CodexValidationProcessSessionError('INVALID_SESSION');
  return value;
}

function sameBinding(
  expected: Readonly<SupervisorProcessBinding>,
  observed: Readonly<SupervisorProcessBinding>,
): boolean {
  return canonicalJson(expected) === canonicalJson(observed);
}

function openRequest(
  binding: Readonly<SupervisorProcessBinding>,
  dispatch: Readonly<CodexValidationDispatchCandidate>,
): Readonly<CodexValidationProcessOpenRequest> {
  return Object.freeze({
    schemaVersion: 1,
    binding,
    dispatchId: dispatch.dispatchId,
    validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
    sessionId: dispatch.sessionId,
    issuedAt: dispatch.issuedAt,
    expiresAt: dispatch.expiresAt,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function validateSession(
  input: unknown,
  binding: Readonly<SupervisorProcessBinding>,
): Readonly<CodexValidationOwnedProcessSession> {
  const session = exact(input, ['binding', 'close', 'stdin', 'stdout'], 'INVALID_SESSION');
  let observedBinding: Readonly<SupervisorProcessBinding>;
  try {
    observedBinding = validateSupervisorProcessBinding(session.binding);
  } catch {
    throw new CodexValidationProcessSessionError('INVALID_SESSION');
  }
  const stdin = session.stdin as Writable;
  const stdout = session.stdout as Readable;
  if (
    !sameBinding(binding, observedBinding) ||
    !stdin ||
    typeof stdin.write !== 'function' ||
    typeof stdin.destroy !== 'function' ||
    !stdout ||
    typeof stdout.on !== 'function' ||
    typeof stdout.destroy !== 'function' ||
    typeof session.close !== 'function'
  )
    throw new CodexValidationProcessSessionError('INVALID_SESSION');
  return Object.freeze({
    binding: observedBinding,
    stdin,
    stdout,
    close: session.close as CodexValidationOwnedProcessSession['close'],
  });
}

function validateCloseResult(
  input: unknown,
  request: Readonly<CodexValidationProcessCloseRequest>,
  observedAtMs: number,
): Readonly<CodexValidationProcessCloseResult> {
  const result = exact(
    input,
    [
      'binding',
      'closedAt',
      'dispatchId',
      'exitCode',
      'processState',
      'runtimeConnection',
      'schemaVersion',
      'sessionId',
      'signal',
      'validationDispatchCandidateHash',
    ],
    'INVALID_SESSION',
  );
  let binding: Readonly<SupervisorProcessBinding>;
  try {
    binding = validateSupervisorProcessBinding(result.binding);
  } catch {
    throw new CodexValidationProcessSessionError('INVALID_SESSION');
  }
  const closedAt = timestamp(result.closedAt);
  if (
    result.schemaVersion !== 1 ||
    !sameBinding(request.binding, binding) ||
    reference(result.dispatchId) !== request.dispatchId ||
    reference(result.validationDispatchCandidateHash) !== request.validationDispatchCandidateHash ||
    reference(result.sessionId) !== request.sessionId ||
    result.processState !== 'EXITED' ||
    result.runtimeConnection !== 'NOT_CONFIGURED' ||
    (result.exitCode !== null &&
      (!Number.isSafeInteger(result.exitCode) ||
        (result.exitCode as number) < 0 ||
        (result.exitCode as number) > 255)) ||
    (result.signal !== null && !REFERENCE.test(String(result.signal))) ||
    (result.exitCode === null) === (result.signal === null) ||
    Date.parse(closedAt) < Date.parse(request.issuedAt) ||
    Date.parse(closedAt) > Date.parse(request.expiresAt) ||
    Date.parse(closedAt) > observedAtMs
  )
    throw new CodexValidationProcessSessionError('INVALID_SESSION');
  return Object.freeze({
    schemaVersion: 1,
    binding,
    dispatchId: request.dispatchId,
    validationDispatchCandidateHash: request.validationDispatchCandidateHash,
    sessionId: request.sessionId,
    processState: 'EXITED',
    exitCode: result.exitCode as number | null,
    signal: result.signal as string | null,
    closedAt,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

class CapturedTerminalRunner implements CodexValidationRuntimeProtocolRunner {
  terminal?: Readonly<CodexValidationProtocolEvidence>;

  async run(): Promise<Readonly<CodexValidationProtocolEvidence>> {
    if (!this.terminal) throw new CodexValidationProcessSessionError('INVALID_SESSION');
    return this.terminal;
  }
}

function cleanupEvidence(
  result: Readonly<CodexValidationProcessCloseResult>,
  request: Readonly<CodexValidationProcessCloseRequest>,
  observedAt: Date,
): Readonly<CodexValidationProcessCleanupEvidence> {
  if (request.reason === 'FAILED') throw new CodexValidationProcessSessionError('INVALID_SESSION');
  const value = { ...result, reason: request.reason };
  return validateCodexValidationProcessCleanupEvidence(
    {
      ...value,
      cleanupEvidenceHash: createHash('sha256')
        .update(
          canonicalJson({
            domain: 'ventureos.codex-validation.process-cleanup.v1',
            evidence: value,
          }),
        )
        .digest('hex'),
    },
    request,
    observedAt,
  );
}

export function validateCodexValidationProcessCleanupEvidence(
  input: unknown,
  request: Readonly<CodexValidationProcessCloseRequest>,
  observedAt: Date = new Date(),
): Readonly<CodexValidationProcessCleanupEvidence> {
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime()))
    throw new CodexValidationProcessSessionError('INVALID_SESSION');
  const evidence = exact(
    input,
    [
      'binding',
      'cleanupEvidenceHash',
      'closedAt',
      'dispatchId',
      'exitCode',
      'processState',
      'reason',
      'runtimeConnection',
      'schemaVersion',
      'sessionId',
      'signal',
      'validationDispatchCandidateHash',
    ],
    'INVALID_SESSION',
  );
  const close = validateCloseResult(
    Object.fromEntries(
      Object.entries(evidence).filter(([key]) => key !== 'cleanupEvidenceHash' && key !== 'reason'),
    ),
    request,
    observedAt.getTime(),
  );
  if (
    request.reason === 'FAILED' ||
    evidence.reason !== request.reason ||
    typeof evidence.cleanupEvidenceHash !== 'string' ||
    !SHA256.test(evidence.cleanupEvidenceHash)
  )
    throw new CodexValidationProcessSessionError('INVALID_SESSION');
  const value = { ...close, reason: request.reason };
  const expected = createHash('sha256')
    .update(
      canonicalJson({
        domain: 'ventureos.codex-validation.process-cleanup.v1',
        evidence: value,
      }),
    )
    .digest('hex');
  if (evidence.cleanupEvidenceHash !== expected)
    throw new CodexValidationProcessSessionError('INVALID_SESSION');
  return Object.freeze({
    ...value,
    cleanupEvidenceHash: expected,
  });
}

/**
 * Owns one already-authorized Codex process session through an injected port.
 * Dispatch authentication happens before streams are opened; terminal bridge
 * evidence is signed and emitted only after the owner proves process exit.
 * The production owner remains deny-only and runtime truth stays unconfigured.
 */
export class BoundedCodexValidationProcessSessionCoordinator {
  readonly #active = new Set<string>();
  readonly #used = new Map<string, number>();

  constructor(
    private readonly owner: CodexValidationProcessSessionOwner = new DenyCodexValidationProcessSessionOwner(),
    private readonly secretLeaseResolver: BridgeSecretLeaseResolver = new DenyBridgeSecretLeaseResolver(),
    private readonly transport: BridgeEgressTransport = new DenyBridgeEgressTransport(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    input: Readonly<CodexValidationOwnedProcessInput>,
    options: Readonly<CodexValidationOwnedProcessOptions> = {},
  ): Promise<Readonly<CodexValidationOwnedProcessResult>> {
    let binding: Readonly<SupervisorProcessBinding>;
    let dispatch: Readonly<CodexValidationDispatchCandidate>;
    try {
      binding = validateSupervisorProcessBinding(input.binding);
      dispatch = validateCodexValidationDispatchCandidate(input.dispatch);
    } catch {
      throw new CodexValidationProcessSessionError('INVALID_INPUT');
    }
    if (
      binding.workspaceId !== dispatch.workspaceId ||
      binding.runtimeId !== dispatch.runtimeId ||
      binding.connectionId !== dispatch.connectionId
    )
      throw new CodexValidationProcessSessionError('INVALID_INPUT');
    const cleanupTimeoutMs = options.cleanupTimeoutMs ?? MAX_CLEANUP_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(cleanupTimeoutMs) ||
      cleanupTimeoutMs < 1 ||
      cleanupTimeoutMs > MAX_CLEANUP_TIMEOUT_MS
    )
      throw new CodexValidationProcessSessionError('LIMIT_EXCEEDED');
    const terminalRunner = new CapturedTerminalRunner();
    const adapter = new BoundedCodexValidationRuntimeAdapter(
      terminalRunner,
      this.secretLeaseResolver,
      this.transport,
      this.clock,
    );
    await adapter.authenticate(input, options);
    const id = `${binding.supervisionId}:${dispatch.sessionId}:${dispatch.dispatchId}`;
    const observedNow = this.clock();
    if (!(observedNow instanceof Date) || !Number.isFinite(observedNow.getTime()))
      throw new CodexValidationProcessSessionError('INVALID_INPUT');
    for (const [usedId, expiresAt] of this.#used)
      if (expiresAt <= observedNow.getTime()) this.#used.delete(usedId);
    if (this.#active.has(id)) throw new CodexValidationProcessSessionError('CONCURRENT_DISPATCH');
    if (this.#used.has(id)) throw new CodexValidationProcessSessionError('USED_DISPATCH');
    if (this.#used.size >= MAX_TRACKED_DISPATCHES)
      throw new CodexValidationProcessSessionError('LIMIT_EXCEEDED');
    this.#active.add(id);
    this.#used.set(id, Date.parse(dispatch.expiresAt));
    const opened = openRequest(binding, dispatch);
    let session: Readonly<CodexValidationOwnedProcessSession> | undefined;
    let terminal: Readonly<CodexValidationProtocolEvidence> | undefined;
    let reason: CodexValidationProcessCloseRequest['reason'] = 'FAILED';
    let closed: Readonly<CodexValidationProcessCloseResult> | undefined;
    let closeRequest: Readonly<CodexValidationProcessCloseRequest> | undefined;
    try {
      try {
        const owned = await this.owner.open(opened);
        try {
          session = validateSession(owned, binding);
        } catch (error) {
          this.destroyUnknownSession(owned);
          throw error;
        }
      } catch (error) {
        if (error instanceof CodexValidationProcessSessionError) throw error;
        throw new CodexValidationProcessSessionError('OWNER_DENIED');
      }
      const protocol = new BoundedCodexValidationProtocolRunner(
        new BoundedCodexAppServerStdioTransport(session.stdin, session.stdout),
        this.clock,
      );
      terminal = await protocol.run(dispatch, options);
      reason = terminal.status === 'interrupted' ? 'CANCELLED' : 'COMPLETED';
    } finally {
      if (session) {
        const request = Object.freeze({ ...opened, reason });
        closeRequest = request;
        try {
          const cleanupRemaining = Date.parse(request.expiresAt) - this.validNowMs();
          if (cleanupRemaining < 1) throw new CodexValidationProcessSessionError('CLEANUP_TIMEOUT');
          closed = validateCloseResult(
            await this.boundedClose(session, request, Math.min(cleanupTimeoutMs, cleanupRemaining)),
            request,
            this.validNowMs(),
          );
        } finally {
          if (!session.stdin.destroyed) session.stdin.destroy();
          if (!session.stdout.destroyed) session.stdout.destroy();
        }
      }
      this.#active.delete(id);
    }
    if (!terminal || !closed || !closeRequest)
      throw new CodexValidationProcessSessionError('CLEANUP_FAILED');
    const cleanup = cleanupEvidence(closed, closeRequest, this.clock());
    terminalRunner.terminal = terminal;
    const admitted = await adapter.execute(input, {
      timeoutMs: options.timeoutMs,
    });
    return Object.freeze({
      terminal: admitted,
      cleanup,
      runtimeConnection: 'NOT_CONFIGURED',
      connectionTransition: 'NOT_APPLIED',
    });
  }

  private async boundedClose(
    session: Readonly<CodexValidationOwnedProcessSession>,
    request: Readonly<CodexValidationProcessCloseRequest>,
    timeoutMs: number,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        session.close(request),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new CodexValidationProcessSessionError('CLEANUP_TIMEOUT')),
            timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      if (error instanceof CodexValidationProcessSessionError) throw error;
      throw new CodexValidationProcessSessionError('CLEANUP_FAILED');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private validNowMs(): number {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
      throw new CodexValidationProcessSessionError('INVALID_INPUT');
    return now.getTime();
  }

  private destroyUnknownSession(input: unknown): void {
    if (!input || typeof input !== 'object') return;
    const value = input as Record<string, unknown>;
    for (const stream of [value.stdin, value.stdout]) {
      if (
        stream &&
        typeof stream === 'object' &&
        typeof (stream as { destroy?: unknown }).destroy === 'function'
      ) {
        try {
          (stream as { destroy: () => void }).destroy();
        } catch {
          // The owner is already rejected; never trust a secondary cleanup error.
        }
      }
    }
  }
}
