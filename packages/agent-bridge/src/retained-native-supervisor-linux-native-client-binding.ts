import {
  MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES,
  RetainedNativeSupervisorLocalIpcError,
} from './retained-native-supervisor-local-ipc';
import type {
  LinuxRetainedNativeSupervisorBinding,
  LinuxRetainedNativeSupervisorConnection,
} from './retained-native-supervisor-linux-client';

export interface LinuxRetainedNativeSupervisorClientNativeModule {
  readonly abiVersion: 1;
  readonly platform: 'LINUX';
  lstatUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown>;
  connectUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorClientNativeModule implements LinuxRetainedNativeSupervisorClientNativeModule {
  readonly abiVersion = 1 as const;
  readonly platform = 'LINUX' as const;

  async lstatUnixSocket(_socketPath: string, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }

  async connectUnixSocket(_socketPath: string, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

const MODULE_KEYS = ['abiVersion', 'connectUnixSocket', 'lstatUnixSocket', 'platform'] as const;
const CONNECTION_KEYS = ['close', 'peerCredentials', 'readToEof', 'writeAndShutdown'] as const;
const clearUint8Array = Uint8Array.prototype.fill;

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

function validSocketPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\/[A-Za-z0-9._/-]+\.sock$/u.test(value) &&
    !value.includes('//') &&
    !value.split('/').some((segment) => segment === '.' || segment === '..') &&
    Buffer.byteLength(value, 'utf8') <= 107
  );
}

function clearNativeBytes(input: Uint8Array): boolean {
  try {
    clearUint8Array.call(input, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanupMalformedConnection(input: unknown): void {
  try {
    const result = ownMethod(input, 'close')();
    if (result instanceof Promise) void result.catch(() => undefined);
  } catch {
    // A malformed allocation cannot be trusted further; the public failure remains redacted.
  }
}

class BoundedNativeClientConnection implements LinuxRetainedNativeSupervisorConnection {
  #state: 'OPEN' | 'PEER_OBSERVED' | 'REQUEST_WRITTEN' | 'RESPONSE_READ' | 'CLOSED' = 'OPEN';
  readonly #peerCredentials: (...args: unknown[]) => unknown;
  readonly #writeAndShutdown: (...args: unknown[]) => unknown;
  readonly #readToEof: (...args: unknown[]) => unknown;
  readonly #close: (...args: unknown[]) => unknown;
  #deliveredResponse?: Buffer;

  constructor(
    native: unknown,
    private readonly responseRead: () => void,
  ) {
    const value = exactDataObject(native, CONNECTION_KEYS, 'NOT_CONFIGURED');
    this.#peerCredentials = ownMethod(value, 'peerCredentials');
    this.#writeAndShutdown = ownMethod(value, 'writeAndShutdown');
    this.#readToEof = ownMethod(value, 'readToEof');
    this.#close = ownMethod(value, 'close');
  }

  async peerCredentials(signal: AbortSignal): Promise<unknown> {
    if (this.#state !== 'OPEN' || !(signal instanceof AbortSignal) || signal.aborted)
      deny('EXCHANGE_DENIED');
    this.#state = 'PEER_OBSERVED';
    const evidence = await this.callAsync(this.#peerCredentials, signal);
    if (signal.aborted) deny('EXCHANGE_DENIED');
    return evidence;
  }

  async writeAndShutdown(requestFrame: Readonly<Uint8Array>, signal: AbortSignal): Promise<void> {
    if (
      this.#state !== 'PEER_OBSERVED' ||
      !(requestFrame instanceof Uint8Array) ||
      requestFrame.byteLength < 3 ||
      requestFrame.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES ||
      !(signal instanceof AbortSignal) ||
      signal.aborted
    )
      deny('EXCHANGE_DENIED');
    this.#state = 'REQUEST_WRITTEN';
    const ownedFrame = Buffer.from(requestFrame);
    try {
      await this.#writeAndShutdown(ownedFrame, signal);
      if (signal.aborted) deny('EXCHANGE_DENIED');
    } catch {
      return deny('EXCHANGE_DENIED');
    } finally {
      ownedFrame.fill(0);
    }
  }

  async readToEof(maximumBytes: number, signal: AbortSignal): Promise<unknown> {
    if (
      this.#state !== 'REQUEST_WRITTEN' ||
      maximumBytes !== MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES ||
      !(signal instanceof AbortSignal) ||
      signal.aborted
    )
      deny('EXCHANGE_DENIED');
    this.#state = 'RESPONSE_READ';
    let candidate: Uint8Array | undefined;
    let owned: Buffer | undefined;
    try {
      const input = await this.#readToEof(maximumBytes, signal);
      if (
        signal.aborted ||
        !(input instanceof Uint8Array) ||
        input.byteLength < 3 ||
        input.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES
      )
        deny('EXCHANGE_DENIED');
      candidate = input;
      owned = Buffer.from(candidate);
      if (!clearNativeBytes(candidate)) deny('EXCHANGE_DENIED');
      candidate = undefined;
      this.#deliveredResponse = owned;
      this.responseRead();
      return owned;
    } catch {
      owned?.fill(0);
      return deny('EXCHANGE_DENIED');
    } finally {
      if (candidate !== undefined) clearNativeBytes(candidate);
    }
  }

  async close(): Promise<void> {
    if (this.#state === 'CLOSED') deny('EXCHANGE_DENIED');
    this.#state = 'CLOSED';
    this.clearDeliveredResponse();
    try {
      await this.#close();
    } catch {
      return deny('EXCHANGE_DENIED');
    }
  }

  clearDeliveredResponse(): void {
    this.#deliveredResponse?.fill(0);
    this.#deliveredResponse = undefined;
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
 * Strict production-facing ABI adapter for one injected Linux native client module.
 * It never loads a binary or discovers a path and is consumed by one exact exchange sequence.
 */
export class BoundedLinuxRetainedNativeSupervisorNativeClientBinding implements LinuxRetainedNativeSupervisorBinding {
  readonly platform = 'LINUX' as const;
  readonly #lstatUnixSocket: (...args: unknown[]) => unknown;
  readonly #connectUnixSocket: (...args: unknown[]) => unknown;
  #socketPath?: string;
  #lstatCount = 0;
  #connected = false;
  #responseRead = false;
  #connection?: BoundedNativeClientConnection;

  constructor(native: unknown) {
    const value = exactDataObject(native, MODULE_KEYS, 'NOT_CONFIGURED');
    if (
      value.abiVersion !== 1 ||
      value.platform !== 'LINUX' ||
      typeof value.lstatUnixSocket !== 'function' ||
      typeof value.connectUnixSocket !== 'function'
    )
      deny('NOT_CONFIGURED');
    this.#lstatUnixSocket = (value.lstatUnixSocket as (...args: unknown[]) => unknown).bind(native);
    this.#connectUnixSocket = (value.connectUnixSocket as (...args: unknown[]) => unknown).bind(
      native,
    );
  }

  async lstatUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown> {
    if (!validSocketPath(socketPath) || !(signal instanceof AbortSignal) || signal.aborted)
      deny('EXCHANGE_DENIED');
    if (this.#lstatCount === 0) {
      this.#socketPath = socketPath;
    } else if (
      this.#lstatCount !== 1 ||
      !this.#connected ||
      !this.#responseRead ||
      socketPath !== this.#socketPath
    ) {
      deny('EXCHANGE_DENIED');
    }
    this.#lstatCount += 1;
    try {
      const evidence = await this.#lstatUnixSocket(socketPath, signal);
      if (signal.aborted) deny('EXCHANGE_DENIED');
      return evidence;
    } catch {
      return deny('EXCHANGE_DENIED');
    } finally {
      if (this.#lstatCount === 2) this.#connection?.clearDeliveredResponse();
    }
  }

  async connectUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown> {
    if (
      this.#lstatCount !== 1 ||
      this.#connected ||
      socketPath !== this.#socketPath ||
      !(signal instanceof AbortSignal) ||
      signal.aborted
    )
      deny('EXCHANGE_DENIED');
    this.#connected = true;
    let connection: BoundedNativeClientConnection | undefined;
    try {
      const native = await this.#connectUnixSocket(socketPath, signal);
      try {
        connection = new BoundedNativeClientConnection(native, () => {
          this.#responseRead = true;
        });
        this.#connection = connection;
      } catch {
        cleanupMalformedConnection(native);
        deny('NOT_CONFIGURED');
      }
      if (signal.aborted) {
        void connection.close().catch(() => undefined);
        deny('EXCHANGE_DENIED');
      }
      return connection;
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('EXCHANGE_DENIED');
    }
  }
}
