import { TextDecoder } from 'node:util';

import { canonicalJson } from './codec';
import {
  authenticateRetainedNativeSupervisorLocalIpcAuthorization,
  authenticateRetainedNativeSupervisorLocalIpcClientExchange,
  authenticateRetainedNativeSupervisorLocalIpcInboundExchange,
  DenyRetainedNativeSupervisorLocalIpcClient,
  MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES,
  RetainedNativeSupervisorLocalIpcError,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
  type RetainedNativeSupervisorLocalIpcAuthorization,
} from './retained-native-supervisor-local-ipc';
import {
  DenyLinuxRetainedNativeSupervisorTopologyObservationPort,
  linuxRetainedNativeSupervisorTopologyObservationRequestHash,
  validateLinuxRetainedNativeSupervisorTopologyObservation,
  validateLinuxRetainedNativeSupervisorTopologyObservationRequest,
  type LinuxRetainedNativeSupervisorTopologyObservation,
  type LinuxRetainedNativeSupervisorTopologyObservationPort,
  type LinuxRetainedNativeSupervisorTopologyObservationRequest,
  type LinuxRetainedNativeSupervisorTopologyObserverRole,
} from './retained-native-supervisor-shared-runtime-topology';

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const FRAME_KEYS = [
  'direction',
  'message',
  'observerRole',
  'protocol',
  'requestHash',
  'runtimeConnection',
  'schemaVersion',
] as const;

type Direction = 'COORDINATOR_TO_OBSERVER' | 'OBSERVER_TO_COORDINATOR';

function deny(
  code:
    | 'NOT_CONFIGURED'
    | 'INVALID_AUTHORIZATION'
    | 'INVALID_ATTESTATION'
    | 'INVALID_FRAME'
    | 'LIMIT_EXCEEDED'
    | 'CONCURRENT_EXCHANGE'
    | 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(input: unknown): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) deny('INVALID_FRAME');
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) deny('INVALID_FRAME');
    const value = input as Record<string, unknown>;
    const actual = Object.keys(value).sort();
    const expected = [...FRAME_KEYS].sort();
    const own = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      actual.length !== expected.length ||
      own.length !== actual.length ||
      own.some((key) => typeof key !== 'string') ||
      actual.some((key, index) => key !== expected[index]) ||
      actual.some((key) => {
        const descriptor = descriptors[key];
        return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
      })
    )
      deny('INVALID_FRAME');
    return value;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_FRAME');
  }
}

function role(input: unknown): LinuxRetainedNativeSupervisorTopologyObserverRole {
  if (input !== 'API_LISTENER' && input !== 'WORKER_CLIENT') deny('INVALID_AUTHORIZATION');
  return input;
}

function timeout(input: unknown): number {
  if (
    !Number.isSafeInteger(input) ||
    (input as number) < MIN_TIMEOUT_MS ||
    (input as number) > MAX_TIMEOUT_MS
  )
    deny('NOT_CONFIGURED');
  return input as number;
}

function now(clock: () => number, signal: AbortSignal): number {
  if (signal.aborted) deny('EXCHANGE_DENIED');
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) deny('INVALID_ATTESTATION');
  return value;
}

function encode(
  direction: Direction,
  observerRole: LinuxRetainedNativeSupervisorTopologyObserverRole,
  requestHash: string,
  message: unknown,
): Uint8Array {
  let result: Uint8Array;
  try {
    result = new TextEncoder().encode(
      `${canonicalJson({
        schemaVersion: 1,
        protocol: 'VENTUREOS_RETAINED_NATIVE_TOPOLOGY_OBSERVATION_IPC',
        direction,
        observerRole,
        requestHash,
        message,
        runtimeConnection: 'NOT_CONFIGURED',
      })}\n`,
    );
  } catch {
    return deny('INVALID_FRAME');
  }
  if (result.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES) deny('LIMIT_EXCEEDED');
  return result;
}

function decode(
  input: unknown,
  direction: Direction,
  expectedRole: LinuxRetainedNativeSupervisorTopologyObserverRole,
  expectedRequestHash?: string,
): Readonly<{ readonly message: unknown; readonly requestHash: string }> {
  if (!(input instanceof Uint8Array) || input.byteLength < 3) deny('INVALID_FRAME');
  if (input.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES) deny('LIMIT_EXCEEDED');
  const bytes = Uint8Array.from(input);
  try {
    if (bytes[bytes.byteLength - 1] !== 10) deny('INVALID_FRAME');
    const full = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const text = full.slice(0, -1);
    if (text.includes('\r') || text.includes('\n')) deny('INVALID_FRAME');
    const value = plainRecord(JSON.parse(text));
    if (
      value.schemaVersion !== 1 ||
      value.protocol !== 'VENTUREOS_RETAINED_NATIVE_TOPOLOGY_OBSERVATION_IPC' ||
      value.direction !== direction ||
      value.observerRole !== expectedRole ||
      typeof value.requestHash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(value.requestHash) ||
      (expectedRequestHash !== undefined && value.requestHash !== expectedRequestHash) ||
      value.runtimeConnection !== 'NOT_CONFIGURED' ||
      `${canonicalJson(value)}\n` !== full
    )
      deny('INVALID_FRAME');
    return Object.freeze({ message: value.message, requestHash: value.requestHash });
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_FRAME');
  } finally {
    bytes.fill(0);
  }
}

function bindClient(client: ClosableRetainedNativeSupervisorLocalIpcClient) {
  try {
    if (client instanceof DenyRetainedNativeSupervisorLocalIpcClient) deny('NOT_CONFIGURED');
    const exchange = client.exchange;
    const close = client.close;
    if (typeof exchange !== 'function' || typeof close !== 'function') deny('NOT_CONFIGURED');
    return Object.freeze({ exchange: exchange.bind(client), close: close.bind(client) });
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

function bindObserver(port: LinuxRetainedNativeSupervisorTopologyObservationPort) {
  try {
    if (port instanceof DenyLinuxRetainedNativeSupervisorTopologyObservationPort)
      deny('NOT_CONFIGURED');
    const observe = port.observe;
    if (typeof observe !== 'function') deny('NOT_CONFIGURED');
    return observe.bind(port);
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

/**
 * One-use coordinator-side role-local observation port over the existing kernel-authenticated local
 * IPC client. It owns no socket, listener, shared mount, distributed carrier, or runtime state.
 */
export class AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationTransport implements LinuxRetainedNativeSupervisorTopologyObservationPort {
  readonly #authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>;
  readonly #observerRole: LinuxRetainedNativeSupervisorTopologyObserverRole;
  readonly #exchange: ClosableRetainedNativeSupervisorLocalIpcClient['exchange'];
  readonly #close: ClosableRetainedNativeSupervisorLocalIpcClient['close'];
  readonly #timeoutMs: number;
  #attempted = false;
  #closePromise: Promise<void> | undefined;

  constructor(
    client: ClosableRetainedNativeSupervisorLocalIpcClient,
    authorization: unknown,
    observerRole: LinuxRetainedNativeSupervisorTopologyObserverRole,
    private readonly clock: () => number = Date.now,
    timeoutMs = MAX_TIMEOUT_MS,
  ) {
    this.#authorization = authenticateRetainedNativeSupervisorLocalIpcAuthorization(authorization);
    this.#observerRole = role(observerRole);
    if (typeof clock !== 'function') deny('NOT_CONFIGURED');
    this.#timeoutMs = timeout(timeoutMs);
    const bound = bindClient(client);
    this.#exchange = bound.exchange;
    this.#close = bound.close;
  }

  async observe(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<LinuxRetainedNativeSupervisorTopologyObservation>> {
    if (this.#attempted) deny('CONCURRENT_EXCHANGE');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
    const request = validateLinuxRetainedNativeSupervisorTopologyObservationRequest(input);
    if (request.observerRole !== this.#observerRole) deny('INVALID_AUTHORIZATION');
    const requestHash = linuxRetainedNativeSupervisorTopologyObservationRequestHash(request);
    const requestFrame = encode(
      'COORDINATOR_TO_OBSERVER',
      this.#observerRole,
      requestHash,
      request,
    );
    const attempt = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectInterruption: ((error: RetainedNativeSupervisorLocalIpcError) => void) | undefined;
    const interrupt = () => {
      attempt.abort();
      void this.closeClient();
      rejectInterruption?.(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED'));
    };
    signal.addEventListener('abort', interrupt, { once: true });
    const interruption = new Promise<never>((_resolve, reject) => {
      rejectInterruption = reject;
      timer = setTimeout(() => {
        attempt.abort();
        void this.closeClient();
        reject(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED'));
      }, this.#timeoutMs);
      timer.unref?.();
    });
    if (signal.aborted) interrupt();
    let result: Readonly<LinuxRetainedNativeSupervisorTopologyObservation> | undefined;
    let failure: unknown;
    try {
      const candidate = await Promise.race([
        this.#exchange(this.#authorization.socketPath, requestFrame, attempt.signal),
        interruption,
      ]);
      const frame = decode(
        authenticateRetainedNativeSupervisorLocalIpcClientExchange(candidate, this.#authorization),
        'OBSERVER_TO_COORDINATOR',
        this.#observerRole,
        requestHash,
      );
      result = validateLinuxRetainedNativeSupervisorTopologyObservation(
        frame.message,
        request,
        now(this.clock, signal),
      );
    } catch (error) {
      failure = error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      attempt.abort();
      signal.removeEventListener('abort', interrupt);
      rejectInterruption = undefined;
      requestFrame.fill(0);
      try {
        await this.closeClient();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) {
      if (failure instanceof RetainedNativeSupervisorLocalIpcError) throw failure;
      deny('EXCHANGE_DENIED');
    }
    if (result === undefined || signal.aborted) deny('EXCHANGE_DENIED');
    return result;
  }

  private closeClient(): Promise<void> {
    this.#closePromise ??= this.closeBounded();
    return this.#closePromise;
  }

  private async closeBounded(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#close(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED')),
            this.#timeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/** Role-local handler for one already-accepted, kernel-authenticated observation exchange. */
export class AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationHandler {
  readonly #authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>;
  readonly #observerRole: LinuxRetainedNativeSupervisorTopologyObserverRole;
  readonly #observe: LinuxRetainedNativeSupervisorTopologyObservationPort['observe'];
  readonly #timeoutMs: number;
  #attempted = false;

  constructor(
    observer: LinuxRetainedNativeSupervisorTopologyObservationPort,
    authorization: unknown,
    observerRole: LinuxRetainedNativeSupervisorTopologyObserverRole,
    private readonly clock: () => number = Date.now,
    timeoutMs = MAX_TIMEOUT_MS,
  ) {
    this.#authorization = authenticateRetainedNativeSupervisorLocalIpcAuthorization(authorization);
    this.#observerRole = role(observerRole);
    if (typeof clock !== 'function') deny('NOT_CONFIGURED');
    this.#timeoutMs = timeout(timeoutMs);
    this.#observe = bindObserver(observer);
  }

  async handle(inboundInput: unknown, signal: AbortSignal): Promise<Readonly<Uint8Array>> {
    if (this.#attempted) deny('CONCURRENT_EXCHANGE');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
    const envelope = decode(
      authenticateRetainedNativeSupervisorLocalIpcInboundExchange(
        inboundInput,
        this.#authorization,
      ),
      'COORDINATOR_TO_OBSERVER',
      this.#observerRole,
    );
    const request = validateLinuxRetainedNativeSupervisorTopologyObservationRequest(
      envelope.message,
    );
    if (
      request.observerRole !== this.#observerRole ||
      linuxRetainedNativeSupervisorTopologyObservationRequestHash(request) !== envelope.requestHash
    )
      deny('INVALID_AUTHORIZATION');
    const attempt = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectInterruption: ((error: RetainedNativeSupervisorLocalIpcError) => void) | undefined;
    const interrupt = () => {
      attempt.abort();
      rejectInterruption?.(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED'));
    };
    signal.addEventListener('abort', interrupt, { once: true });
    const interruption = new Promise<never>((_resolve, reject) => {
      rejectInterruption = reject;
      timer = setTimeout(() => {
        attempt.abort();
        reject(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED'));
      }, this.#timeoutMs);
      timer.unref?.();
    });
    if (signal.aborted) interrupt();
    try {
      const candidate = await Promise.race([this.#observe(request, attempt.signal), interruption]);
      const observation = validateLinuxRetainedNativeSupervisorTopologyObservation(
        candidate,
        request,
        now(this.clock, signal),
      );
      return encode(
        'OBSERVER_TO_COORDINATOR',
        this.#observerRole,
        envelope.requestHash,
        observation,
      );
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('EXCHANGE_DENIED');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      attempt.abort();
      signal.removeEventListener('abort', interrupt);
      rejectInterruption = undefined;
    }
  }
}
