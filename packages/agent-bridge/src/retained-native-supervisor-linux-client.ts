import {
  MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES,
  RetainedNativeSupervisorLocalIpcError,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
  type RetainedNativeSupervisorLocalIpcEndpointIdentity,
  type RetainedNativeSupervisorLocalIpcPeerCredentials,
} from './retained-native-supervisor-local-ipc';

export interface LinuxRetainedNativeSupervisorSocketStat {
  readonly fileType: 'SOCKET';
  readonly device: number;
  readonly inode: number;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly mode: number;
}

export interface LinuxRetainedNativeSupervisorPeerCredentials {
  readonly pid: number;
  readonly uid: number;
  readonly gid: number;
}

export interface LinuxRetainedNativeSupervisorConnection {
  peerCredentials(signal: AbortSignal): Promise<unknown>;
  writeAndShutdown(requestFrame: Readonly<Uint8Array>, signal: AbortSignal): Promise<void>;
  readToEof(maximumBytes: number, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

/** Native implementations must call lstat(2), connect(2), and SO_PEERCRED directly. */
export interface LinuxRetainedNativeSupervisorBinding {
  readonly platform: 'LINUX';
  lstatUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown>;
  connectUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorBinding implements LinuxRetainedNativeSupervisorBinding {
  readonly platform = 'LINUX' as const;

  async lstatUnixSocket(_socketPath: string, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }

  async connectUnixSocket(_socketPath: string, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

const STAT_KEYS = ['device', 'fileType', 'inode', 'mode', 'ownerGid', 'ownerUid'] as const;
const CREDENTIAL_KEYS = ['gid', 'pid', 'uid'] as const;

function deny(code: ConstructorParameters<typeof RetainedNativeSupervisorLocalIpcError>[0]): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(input: unknown, expected: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    deny('INVALID_ATTESTATION');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny('INVALID_ATTESTATION');
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
    deny('INVALID_ATTESTATION');
  return record;
}

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) deny('INVALID_ATTESTATION');
  return value as number;
}

function nonnegative(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) deny('INVALID_ATTESTATION');
  return value as number;
}

function parseStat(input: unknown): Readonly<LinuxRetainedNativeSupervisorSocketStat> {
  const value = plainRecord(input, STAT_KEYS);
  if (value.fileType !== 'SOCKET' || value.mode !== 0o600) deny('INVALID_ATTESTATION');
  return Object.freeze({
    fileType: 'SOCKET',
    device: positive(value.device),
    inode: positive(value.inode),
    ownerUid: nonnegative(value.ownerUid),
    ownerGid: nonnegative(value.ownerGid),
    mode: 0o600,
  });
}

function parseCredentials(input: unknown): Readonly<LinuxRetainedNativeSupervisorPeerCredentials> {
  const value = plainRecord(input, CREDENTIAL_KEYS);
  return Object.freeze({
    pid: positive(value.pid),
    uid: nonnegative(value.uid),
    gid: nonnegative(value.gid),
  });
}

function sameStat(
  left: Readonly<LinuxRetainedNativeSupervisorSocketStat>,
  right: Readonly<LinuxRetainedNativeSupervisorSocketStat>,
): boolean {
  return (
    left.fileType === right.fileType &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.ownerUid === right.ownerUid &&
    left.ownerGid === right.ownerGid &&
    left.mode === right.mode
  );
}

function endpoint(
  socketPath: string,
  stat: Readonly<LinuxRetainedNativeSupervisorSocketStat>,
): Readonly<RetainedNativeSupervisorLocalIpcEndpointIdentity> {
  return Object.freeze({
    schemaVersion: 1,
    platform: 'LINUX',
    authority: 'LINUX_LSTAT_UNIX_SOCKET',
    fileType: 'SOCKET',
    socketPath,
    socketDevice: stat.device,
    socketInode: stat.inode,
    socketOwnerUid: stat.ownerUid,
    socketOwnerGid: stat.ownerGid,
    socketMode: 0o600,
  });
}

function peer(
  credentials: Readonly<LinuxRetainedNativeSupervisorPeerCredentials>,
): Readonly<RetainedNativeSupervisorLocalIpcPeerCredentials> {
  return Object.freeze({
    schemaVersion: 1,
    platform: 'LINUX',
    authority: 'LINUX_SO_PEERCRED',
    peerPid: credentials.pid,
    peerUid: credentials.uid,
    peerGid: credentials.gid,
  });
}

function connection(input: unknown): LinuxRetainedNativeSupervisorConnection {
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof (input as LinuxRetainedNativeSupervisorConnection).peerCredentials !== 'function' ||
    typeof (input as LinuxRetainedNativeSupervisorConnection).writeAndShutdown !== 'function' ||
    typeof (input as LinuxRetainedNativeSupervisorConnection).readToEof !== 'function' ||
    typeof (input as LinuxRetainedNativeSupervisorConnection).close !== 'function'
  )
    deny('NOT_CONFIGURED');
  return input as LinuxRetainedNativeSupervisorConnection;
}

/**
 * Owns one already-authorized Linux client connection from lstat through EOF and close.
 * It cannot create a listener, discover a path, retry, or promote runtime truth.
 */
export class BoundedLinuxRetainedNativeSupervisorLocalIpcClient implements ClosableRetainedNativeSupervisorLocalIpcClient {
  #inFlight = false;
  #closed = false;
  #activeConnection?: LinuxRetainedNativeSupervisorConnection;
  #connectionClose?: Promise<void>;

  constructor(private readonly binding: LinuxRetainedNativeSupervisorBinding) {
    if (
      binding instanceof DenyLinuxRetainedNativeSupervisorBinding ||
      !binding ||
      binding.platform !== 'LINUX' ||
      typeof binding.lstatUnixSocket !== 'function' ||
      typeof binding.connectUnixSocket !== 'function'
    )
      deny('NOT_CONFIGURED');
  }

  async exchange(
    socketPath: string,
    requestFrameInput: Readonly<Uint8Array>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (
      !(signal instanceof AbortSignal) ||
      signal.aborted ||
      this.#closed ||
      typeof socketPath !== 'string' ||
      !/^\/[A-Za-z0-9._/-]+\.sock$/u.test(socketPath) ||
      socketPath.includes('//') ||
      socketPath.split('/').some((segment) => segment === '.' || segment === '..') ||
      Buffer.byteLength(socketPath, 'utf8') > 107 ||
      !(requestFrameInput instanceof Uint8Array) ||
      requestFrameInput.byteLength < 3 ||
      requestFrameInput.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES
    )
      deny('EXCHANGE_DENIED');
    if (this.#inFlight) deny('CONCURRENT_EXCHANGE');
    this.#inFlight = true;
    const requestFrame = Buffer.from(requestFrameInput);
    let opened: LinuxRetainedNativeSupervisorConnection | undefined;
    let ownedResponse: Buffer | undefined;
    let completed = false;
    let closeFailed = false;
    try {
      const before = parseStat(await this.binding.lstatUnixSocket(socketPath, signal));
      if (signal.aborted || this.#closed) deny('EXCHANGE_DENIED');
      opened = connection(await this.binding.connectUnixSocket(socketPath, signal));
      this.#activeConnection = opened;
      if (signal.aborted || this.#closed) deny('EXCHANGE_DENIED');
      const credentials = parseCredentials(await opened.peerCredentials(signal));
      if (signal.aborted || this.#closed) deny('EXCHANGE_DENIED');
      await opened.writeAndShutdown(requestFrame, signal);
      if (signal.aborted || this.#closed) deny('EXCHANGE_DENIED');
      const candidate = await opened.readToEof(
        MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES,
        signal,
      );
      if (
        signal.aborted ||
        this.#closed ||
        !(candidate instanceof Uint8Array) ||
        candidate.byteLength < 3 ||
        candidate.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES
      )
        deny('EXCHANGE_DENIED');
      ownedResponse = Buffer.from(candidate);
      const after = parseStat(await this.binding.lstatUnixSocket(socketPath, signal));
      if (signal.aborted || this.#closed || !sameStat(before, after)) {
        deny('INVALID_ATTESTATION');
      }
      completed = true;
      return Object.freeze({
        endpointBefore: endpoint(socketPath, before),
        peerCredentials: peer(credentials),
        endpointAfter: endpoint(socketPath, after),
        responseFrame: ownedResponse,
      });
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      deny('EXCHANGE_DENIED');
    } finally {
      requestFrame.fill(0);
      if (opened) {
        try {
          await this.closeConnection(opened);
        } catch {
          closeFailed = true;
        }
      }
      if ((!completed || closeFailed) && ownedResponse) ownedResponse.fill(0);
      this.#inFlight = false;
      if (closeFailed) deny('EXCHANGE_DENIED');
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    const active = this.#activeConnection;
    if (active) await this.closeConnection(active);
  }

  private async closeConnection(
    connection: LinuxRetainedNativeSupervisorConnection,
  ): Promise<void> {
    if (this.#activeConnection !== connection) return;
    let pending = this.#connectionClose;
    if (!pending) {
      try {
        pending = Promise.resolve(connection.close());
        this.#connectionClose = pending;
      } catch {
        deny('EXCHANGE_DENIED');
      }
    }
    try {
      await pending;
    } catch {
      deny('EXCHANGE_DENIED');
    } finally {
      if (this.#activeConnection === connection) this.#activeConnection = undefined;
      if (this.#connectionClose === pending) this.#connectionClose = undefined;
    }
  }
}
