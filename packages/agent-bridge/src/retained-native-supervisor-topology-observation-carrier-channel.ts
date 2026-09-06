import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import type { ClosableRetainedNativeSupervisorTopologyObservationCarrier } from './retained-native-supervisor-topology-observation-carrier';

export const MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_CHANNEL_FRAME_BYTES = 64 * 1_024;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 4_096;

export interface RetainedNativeSupervisorTopologyObservationCarrierByteChannel {
  exchange(request: Uint8Array, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export interface RetainedNativeSupervisorTopologyObservationCarrierMessageHandler {
  handle(input: unknown, signal: AbortSignal): Promise<unknown>;
}

export class DenyRetainedNativeSupervisorTopologyObservationCarrierByteChannel implements RetainedNativeSupervisorTopologyObservationCarrierByteChannel {
  async exchange(_request: Uint8Array, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }

  async close(): Promise<void> {}
}

export class DenyRetainedNativeSupervisorTopologyObservationCarrierMessageHandler implements RetainedNativeSupervisorTopologyObservationCarrierMessageHandler {
  async handle(_input: unknown, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

function deny(
  code:
    | 'NOT_CONFIGURED'
    | 'INVALID_AUTHORIZATION'
    | 'INVALID_ATTESTATION'
    | 'CONCURRENT_EXCHANGE'
    | 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function timeout(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < MIN_TIMEOUT_MS ||
    (value as number) > MAX_TIMEOUT_MS
  )
    deny('NOT_CONFIGURED');
  return value as number;
}

function assertInertJson(
  input: unknown,
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
  seen = new WeakSet<object>(),
  state = { nodes: 0 },
  depth = 0,
): void {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) deny(code);
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return;
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) deny(code);
    return;
  }
  if (typeof input !== 'object' || seen.has(input)) deny(code);
  seen.add(input);
  if (Array.isArray(input)) {
    if (Object.getPrototypeOf(input) !== Array.prototype || input.length > 256) deny(code);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const expected = Array.from({ length: input.length }, (_, index) => String(index));
    const own = Reflect.ownKeys(input);
    if (
      own.length !== expected.length + 1 ||
      own.some((key) => typeof key !== 'string' || (key !== 'length' && !expected.includes(key))) ||
      expected.some((key) => {
        const descriptor = descriptors[key];
        return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
      })
    )
      deny(code);
    for (const item of input) assertInertJson(item, code, seen, state, depth + 1);
    return;
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny(code);
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  const own = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    keys.length > 64 ||
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string') ||
    keys.some((key) => {
      const descriptor = descriptors[key];
      return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
    })
  )
    deny(code);
  for (const key of keys) assertInertJson(value[key], code, seen, state, depth + 1);
}

function encode(input: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): Uint8Array {
  try {
    assertInertJson(input, code);
    const frame = new TextEncoder().encode(canonicalJson(input));
    if (
      frame.byteLength < 2 ||
      frame.byteLength > MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_CHANNEL_FRAME_BYTES
    )
      deny(code);
    return frame;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny(code);
  }
}

function decode(input: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): unknown {
  try {
    if (!(input instanceof Uint8Array) || Object.getPrototypeOf(input) !== Uint8Array.prototype)
      deny(code);
    if (
      input.byteLength < 2 ||
      input.byteLength > MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_CHANNEL_FRAME_BYTES
    )
      deny(code);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    const value = JSON.parse(text) as unknown;
    assertInertJson(value, code);
    if (canonicalJson(value) !== text) deny(code);
    return value;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny(code);
  }
}

function bindChannel(channel: RetainedNativeSupervisorTopologyObservationCarrierByteChannel) {
  try {
    if (
      channel instanceof DenyRetainedNativeSupervisorTopologyObservationCarrierByteChannel ||
      typeof channel?.exchange !== 'function' ||
      typeof channel?.close !== 'function'
    )
      deny('NOT_CONFIGURED');
    return Object.freeze({
      exchange: channel.exchange.bind(channel),
      close: channel.close.bind(channel),
    });
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

function bindHandler(handler: RetainedNativeSupervisorTopologyObservationCarrierMessageHandler) {
  try {
    if (
      handler instanceof DenyRetainedNativeSupervisorTopologyObservationCarrierMessageHandler ||
      typeof handler?.handle !== 'function'
    )
      deny('NOT_CONFIGURED');
    return handler.handle.bind(handler);
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

function interruptible<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
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
    timer = setTimeout(interrupt, timeoutMs);
    timer.unref?.();
  });
  if (signal.aborted) interrupt();
  const pending = Promise.resolve().then(() => operation(attempt.signal));
  return Promise.race([pending, interruption]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    attempt.abort();
    signal.removeEventListener('abort', interrupt);
    rejectInterruption = undefined;
  });
}

/** One canonical request/response frame over an injected, otherwise untrusted byte channel. */
export class BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel implements ClosableRetainedNativeSupervisorTopologyObservationCarrier {
  readonly #exchange: RetainedNativeSupervisorTopologyObservationCarrierByteChannel['exchange'];
  readonly #close: RetainedNativeSupervisorTopologyObservationCarrierByteChannel['close'];
  readonly #timeoutMs: number;
  #attempted = false;
  #closePromise: Promise<void> | undefined;

  constructor(
    channel: RetainedNativeSupervisorTopologyObservationCarrierByteChannel,
    timeoutMs = 5_000,
  ) {
    const bound = bindChannel(channel);
    this.#exchange = bound.exchange;
    this.#close = bound.close;
    this.#timeoutMs = timeout(timeoutMs);
  }

  async exchange(input: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.#attempted || this.#closePromise !== undefined) deny('CONCURRENT_EXCHANGE');
    this.#attempted = true;
    let failure: unknown;
    let result: unknown;
    try {
      const request = encode(input, 'INVALID_AUTHORIZATION');
      const response = await interruptible(
        (attemptSignal) => this.#exchange(request, attemptSignal),
        signal,
        this.#timeoutMs,
      );
      result = decode(response, 'INVALID_ATTESTATION');
    } catch (error) {
      failure = error;
    } finally {
      try {
        await this.close();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) {
      if (failure instanceof RetainedNativeSupervisorLocalIpcError) throw failure;
      deny('EXCHANGE_DENIED');
    }
    return result;
  }

  close(): Promise<void> {
    this.#closePromise ??= this.closeBounded();
    return this.#closePromise;
  }

  private async closeBounded(): Promise<void> {
    try {
      await interruptible(
        (_signal) => this.#close(),
        new AbortController().signal,
        this.#timeoutMs,
      );
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      deny('EXCHANGE_DENIED');
    }
  }
}

/** One canonical worker-side frame around an injected signed message handler. */
export class BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint {
  readonly #handle: RetainedNativeSupervisorTopologyObservationCarrierMessageHandler['handle'];
  readonly #timeoutMs: number;
  #attempted = false;

  constructor(
    handler: RetainedNativeSupervisorTopologyObservationCarrierMessageHandler,
    timeoutMs = 5_000,
  ) {
    this.#handle = bindHandler(handler);
    this.#timeoutMs = timeout(timeoutMs);
  }

  async handle(input: unknown, signal: AbortSignal): Promise<Uint8Array> {
    if (this.#attempted) deny('CONCURRENT_EXCHANGE');
    this.#attempted = true;
    try {
      const request = decode(input, 'INVALID_AUTHORIZATION');
      const response = await interruptible(
        (attemptSignal) => this.#handle(request, attemptSignal),
        signal,
        this.#timeoutMs,
      );
      return encode(response, 'INVALID_ATTESTATION');
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('EXCHANGE_DENIED');
    }
  }
}
