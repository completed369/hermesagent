import { MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES } from './retained-native-supervisor-local-ipc';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import type {
  LinuxRetainedNativeSupervisorListenerCreationRequest,
  LinuxRetainedNativeSupervisorListenerLifecycleBinding,
  LinuxRetainedNativeSupervisorOwnedListener,
} from './retained-native-supervisor-listener-lifecycle';
import type { LinuxRetainedNativeSupervisorAcceptedSession } from './retained-native-supervisor-linux-session';

export interface LinuxRetainedNativeSupervisorListenerNativeModule {
  readonly abiVersion: 1;
  readonly platform: 'LINUX';
  createOwnedListener(
    request: Readonly<LinuxRetainedNativeSupervisorListenerCreationRequest>,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorListenerNativeModule implements LinuxRetainedNativeSupervisorListenerNativeModule {
  readonly abiVersion = 1 as const;
  readonly platform = 'LINUX' as const;

  async createOwnedListener(
    _request: Readonly<LinuxRetainedNativeSupervisorListenerCreationRequest>,
    _signal: AbortSignal,
  ): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

const MODULE_KEYS = ['abiVersion', 'createOwnedListener', 'platform'] as const;
const REQUEST_KEYS = [
  'listenBacklog',
  'pathDisposition',
  'platform',
  'schemaVersion',
  'socketMode',
  'socketPath',
] as const;

function deny(code: 'NOT_CONFIGURED' | 'EXCHANGE_DENIED'): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function exactDataObject(
  input: unknown,
  expected: readonly string[],
  code: 'NOT_CONFIGURED' | 'EXCHANGE_DENIED',
): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) deny(code);
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) deny(code);
    const record = input as Record<string, unknown>;
    const actual = Object.keys(record).sort();
    const keys = [...expected].sort();
    const ownKeys = Reflect.ownKeys(record);
    const descriptors = Object.getOwnPropertyDescriptors(record);
    if (
      actual.length !== keys.length ||
      ownKeys.length !== actual.length ||
      ownKeys.some((key) => typeof key !== 'string') ||
      actual.some((key, index) => key !== keys[index]) ||
      actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value'))
    )
      deny(code);
    return record;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny(code);
  }
}

function validSocketPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\/[A-Za-z0-9._/-]+\.sock$/u.test(value) &&
    !value.includes('//') &&
    !value.split('/').some((segment) => segment === '.' || segment === '..') &&
    Buffer.byteLength(value, 'utf8') <= 107
  );
}

function cleanupMalformedOwnedListener(input: unknown): void {
  try {
    const result = ownMethod(input, 'closeAndUnlinkOwned')();
    if (result instanceof Promise) void result.catch(() => undefined);
  } catch {
    // A malformed allocation cannot be trusted further; the public failure remains redacted.
  }
}

function request(input: unknown): Readonly<LinuxRetainedNativeSupervisorListenerCreationRequest> {
  const value = exactDataObject(input, REQUEST_KEYS, 'EXCHANGE_DENIED');
  if (
    value.schemaVersion !== 1 ||
    value.platform !== 'LINUX' ||
    !validSocketPath(value.socketPath) ||
    value.socketMode !== 0o600 ||
    value.listenBacklog !== 1 ||
    value.pathDisposition !== 'FAIL_IF_PRESENT'
  )
    deny('EXCHANGE_DENIED');
  return Object.freeze({
    schemaVersion: 1,
    platform: 'LINUX',
    socketPath: value.socketPath,
    socketMode: 0o600,
    listenBacklog: 1,
    pathDisposition: 'FAIL_IF_PRESENT',
  });
}

function ownMethod(input: unknown, method: string): (...args: unknown[]) => unknown {
  try {
    if (typeof input !== 'object' || input === null) deny('NOT_CONFIGURED');
    const descriptor = Object.getOwnPropertyDescriptor(input, method);
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    )
      deny('NOT_CONFIGURED');
    return (descriptor.value as (...args: unknown[]) => unknown).bind(input);
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

class BoundedNativeAcceptedSession implements LinuxRetainedNativeSupervisorAcceptedSession {
  #state: 'OPEN' | 'PEER_OBSERVED' | 'REQUEST_READ' | 'RESPONSE_WRITTEN' | 'CLOSED' = 'OPEN';
  readonly #peerCredentials: (...args: unknown[]) => unknown;
  readonly #readToEof: (...args: unknown[]) => unknown;
  readonly #writeAndShutdown: (...args: unknown[]) => unknown;
  readonly #close: (...args: unknown[]) => unknown;

  constructor(native: unknown) {
    this.#peerCredentials = ownMethod(native, 'peerCredentials');
    this.#readToEof = ownMethod(native, 'readToEof');
    this.#writeAndShutdown = ownMethod(native, 'writeAndShutdown');
    this.#close = ownMethod(native, 'close');
  }

  async peerCredentials(signal: AbortSignal): Promise<unknown> {
    if (this.#state !== 'OPEN' || !(signal instanceof AbortSignal) || signal.aborted)
      deny('EXCHANGE_DENIED');
    this.#state = 'PEER_OBSERVED';
    try {
      return await this.#peerCredentials(signal);
    } catch {
      return deny('EXCHANGE_DENIED');
    }
  }

  async readToEof(maximumBytes: number, signal: AbortSignal): Promise<unknown> {
    if (
      this.#state !== 'PEER_OBSERVED' ||
      maximumBytes !== MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES ||
      !(signal instanceof AbortSignal) ||
      signal.aborted
    )
      deny('EXCHANGE_DENIED');
    this.#state = 'REQUEST_READ';
    try {
      return await this.#readToEof(maximumBytes, signal);
    } catch {
      return deny('EXCHANGE_DENIED');
    }
  }

  async writeAndShutdown(responseFrame: Readonly<Uint8Array>, signal: AbortSignal): Promise<void> {
    if (
      this.#state !== 'REQUEST_READ' ||
      !(responseFrame instanceof Uint8Array) ||
      responseFrame.byteLength < 3 ||
      responseFrame.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES ||
      !(signal instanceof AbortSignal) ||
      signal.aborted
    )
      deny('EXCHANGE_DENIED');
    this.#state = 'RESPONSE_WRITTEN';
    const ownedFrame = Buffer.from(responseFrame);
    try {
      await this.#writeAndShutdown(ownedFrame, signal);
    } catch {
      return deny('EXCHANGE_DENIED');
    } finally {
      ownedFrame.fill(0);
    }
  }

  async close(): Promise<void> {
    if (this.#state === 'CLOSED') deny('EXCHANGE_DENIED');
    this.#state = 'CLOSED';
    try {
      await this.#close();
    } catch {
      return deny('EXCHANGE_DENIED');
    }
  }
}

class BoundedNativeOwnedListener implements LinuxRetainedNativeSupervisorOwnedListener {
  readonly platform = 'LINUX' as const;
  #creationObserved = false;
  #accepted = false;
  #cleaned = false;
  readonly #creationEvidence: (...args: unknown[]) => unknown;
  readonly #lstatUnixSocket: (...args: unknown[]) => unknown;
  readonly #acceptAuthorizedUnixSocket: (...args: unknown[]) => unknown;
  readonly #closeAndUnlinkOwned: (...args: unknown[]) => unknown;

  constructor(
    native: unknown,
    private readonly socketPath: string,
  ) {
    this.#creationEvidence = ownMethod(native, 'creationEvidence');
    this.#lstatUnixSocket = ownMethod(native, 'lstatUnixSocket');
    this.#acceptAuthorizedUnixSocket = ownMethod(native, 'acceptAuthorizedUnixSocket');
    this.#closeAndUnlinkOwned = ownMethod(native, 'closeAndUnlinkOwned');
  }

  async creationEvidence(signal: AbortSignal): Promise<unknown> {
    if (
      this.#creationObserved ||
      this.#cleaned ||
      !(signal instanceof AbortSignal) ||
      signal.aborted
    )
      deny('EXCHANGE_DENIED');
    this.#creationObserved = true;
    return this.callAsync(this.#creationEvidence, signal);
  }

  async lstatUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown> {
    if (
      !this.#creationObserved ||
      this.#cleaned ||
      socketPath !== this.socketPath ||
      !(signal instanceof AbortSignal) ||
      signal.aborted
    )
      deny('EXCHANGE_DENIED');
    return this.callAsync(this.#lstatUnixSocket, socketPath, signal);
  }

  async acceptAuthorizedUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown> {
    if (
      !this.#creationObserved ||
      this.#accepted ||
      this.#cleaned ||
      socketPath !== this.socketPath ||
      !(signal instanceof AbortSignal) ||
      signal.aborted
    )
      deny('EXCHANGE_DENIED');
    this.#accepted = true;
    const accepted = await this.callAsync(this.#acceptAuthorizedUnixSocket, socketPath, signal);
    return new BoundedNativeAcceptedSession(accepted);
  }

  closeAndUnlinkOwned(): unknown {
    if (this.#cleaned) deny('EXCHANGE_DENIED');
    this.#cleaned = true;
    try {
      const result = this.#closeAndUnlinkOwned();
      if (result instanceof Promise) deny('EXCHANGE_DENIED');
      return result;
    } catch {
      return deny('EXCHANGE_DENIED');
    }
  }

  private async callAsync(
    method: (...args: unknown[]) => unknown,
    ...args: unknown[]
  ): Promise<unknown> {
    try {
      return await method(...args);
    } catch {
      return deny('EXCHANGE_DENIED');
    }
  }
}

/**
 * Strict production-facing ABI adapter for one injected Linux native listener factory.
 * It neither loads a module nor selects a path and is consumed by its first create attempt.
 */
export class BoundedLinuxRetainedNativeSupervisorNativeListenerBinding implements LinuxRetainedNativeSupervisorListenerLifecycleBinding {
  readonly platform = 'LINUX' as const;
  readonly #createOwnedListener: (...args: unknown[]) => unknown;
  #consumed = false;

  constructor(native: unknown) {
    const value = exactDataObject(native, MODULE_KEYS, 'NOT_CONFIGURED');
    if (
      value.abiVersion !== 1 ||
      value.platform !== 'LINUX' ||
      typeof value.createOwnedListener !== 'function'
    )
      deny('NOT_CONFIGURED');
    this.#createOwnedListener = (value.createOwnedListener as (...args: unknown[]) => unknown).bind(
      native,
    );
  }

  async createOwnedListener(
    candidate: Readonly<LinuxRetainedNativeSupervisorListenerCreationRequest>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.#consumed || !(signal instanceof AbortSignal) || signal.aborted)
      deny('EXCHANGE_DENIED');
    this.#consumed = true;
    const trustedRequest = request(candidate);
    try {
      const native = await this.#createOwnedListener(trustedRequest, signal);
      let listener: BoundedNativeOwnedListener;
      try {
        listener = new BoundedNativeOwnedListener(native, trustedRequest.socketPath);
      } catch {
        cleanupMalformedOwnedListener(native);
        deny('NOT_CONFIGURED');
      }
      if (signal.aborted) {
        listener.closeAndUnlinkOwned();
        deny('EXCHANGE_DENIED');
      }
      return listener;
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('EXCHANGE_DENIED');
    }
  }
}
