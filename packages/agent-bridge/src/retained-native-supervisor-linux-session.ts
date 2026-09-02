import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler,
  MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES,
  RetainedNativeSupervisorLocalIpcError,
  type RetainedNativeSupervisorLocalIpcEndpointIdentity,
  type RetainedNativeSupervisorLocalIpcPeerCredentials,
} from './retained-native-supervisor-local-ipc';

export interface LinuxRetainedNativeSupervisorListenerSocketStat {
  readonly fileType: 'SOCKET';
  readonly device: number;
  readonly inode: number;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly mode: number;
}

export interface LinuxRetainedNativeSupervisorWorkerCredentials {
  readonly pid: number;
  readonly uid: number;
  readonly gid: number;
}

export interface LinuxRetainedNativeSupervisorAcceptedSession {
  peerCredentials(signal: AbortSignal): Promise<unknown>;
  readToEof(maximumBytes: number, signal: AbortSignal): Promise<unknown>;
  writeAndShutdown(responseFrame: Readonly<Uint8Array>, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

/** Native implementations may accept only from an already-created, authorized listener. */
export interface LinuxRetainedNativeSupervisorSessionBinding {
  readonly platform: 'LINUX';
  lstatUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown>;
  acceptAuthorizedUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorSessionBinding implements LinuxRetainedNativeSupervisorSessionBinding {
  readonly platform = 'LINUX' as const;

  async lstatUnixSocket(_socketPath: string, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }

  async acceptAuthorizedUnixSocket(_socketPath: string, _signal: AbortSignal): Promise<never> {
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

function parseStat(input: unknown): Readonly<LinuxRetainedNativeSupervisorListenerSocketStat> {
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

function parseCredentials(
  input: unknown,
): Readonly<LinuxRetainedNativeSupervisorWorkerCredentials> {
  const value = plainRecord(input, CREDENTIAL_KEYS);
  return Object.freeze({
    pid: positive(value.pid),
    uid: nonnegative(value.uid),
    gid: nonnegative(value.gid),
  });
}

function sameStat(
  left: Readonly<LinuxRetainedNativeSupervisorListenerSocketStat>,
  right: Readonly<LinuxRetainedNativeSupervisorListenerSocketStat>,
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
  stat: Readonly<LinuxRetainedNativeSupervisorListenerSocketStat>,
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
  credentials: Readonly<LinuxRetainedNativeSupervisorWorkerCredentials>,
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

function acceptedSession(input: unknown): LinuxRetainedNativeSupervisorAcceptedSession {
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof (input as LinuxRetainedNativeSupervisorAcceptedSession).peerCredentials !== 'function' ||
    typeof (input as LinuxRetainedNativeSupervisorAcceptedSession).readToEof !== 'function' ||
    typeof (input as LinuxRetainedNativeSupervisorAcceptedSession).writeAndShutdown !==
      'function' ||
    typeof (input as LinuxRetainedNativeSupervisorAcceptedSession).close !== 'function'
  )
    deny('NOT_CONFIGURED');
  return input as LinuxRetainedNativeSupervisorAcceptedSession;
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

/**
 * Owns one session accepted from an already-authorized Linux listener.
 * It cannot create, bind, discover, retry, loop, unlink, or expose that listener.
 */
export class BoundedLinuxRetainedNativeSupervisorSession {
  #inFlight = false;

  constructor(
    private readonly binding: LinuxRetainedNativeSupervisorSessionBinding,
    private readonly handler: AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler,
  ) {
    if (
      binding instanceof DenyLinuxRetainedNativeSupervisorSessionBinding ||
      !binding ||
      binding.platform !== 'LINUX' ||
      typeof binding.lstatUnixSocket !== 'function' ||
      typeof binding.acceptAuthorizedUnixSocket !== 'function' ||
      !(handler instanceof AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler)
    )
      deny('NOT_CONFIGURED');
  }

  async handleOne(socketPath: string, signal: AbortSignal): Promise<void> {
    if (!(signal instanceof AbortSignal) || signal.aborted || !validSocketPath(socketPath))
      deny('EXCHANGE_DENIED');
    if (this.#inFlight) deny('CONCURRENT_EXCHANGE');
    this.#inFlight = true;
    let opened: LinuxRetainedNativeSupervisorAcceptedSession | undefined;
    let nativeRequestFrame: Uint8Array | undefined;
    let requestFrame: Buffer | undefined;
    let handlerResponseFrame: Uint8Array | undefined;
    let responseFrame: Buffer | undefined;
    let closeFailed = false;
    try {
      const beforeAccept = parseStat(await this.binding.lstatUnixSocket(socketPath, signal));
      if (signal.aborted) deny('EXCHANGE_DENIED');
      opened = acceptedSession(await this.binding.acceptAuthorizedUnixSocket(socketPath, signal));
      if (signal.aborted) deny('EXCHANGE_DENIED');
      const credentials = parseCredentials(await opened.peerCredentials(signal));
      if (signal.aborted) deny('EXCHANGE_DENIED');
      const afterAccept = parseStat(await this.binding.lstatUnixSocket(socketPath, signal));
      if (signal.aborted || !sameStat(beforeAccept, afterAccept)) deny('INVALID_ATTESTATION');
      const candidate = await opened.readToEof(
        MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES,
        signal,
      );
      if (
        signal.aborted ||
        !(candidate instanceof Uint8Array) ||
        candidate.byteLength < 3 ||
        candidate.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES
      )
        deny('EXCHANGE_DENIED');
      nativeRequestFrame = candidate;
      requestFrame = Buffer.from(candidate);
      const response = await this.handler.handle(
        {
          endpointIdentity: endpoint(socketPath, afterAccept),
          peerCredentials: peer(credentials),
          requestFrame,
        },
        signal,
      );
      if (
        signal.aborted ||
        !(response instanceof Uint8Array) ||
        response.byteLength < 3 ||
        response.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES
      )
        deny('EXCHANGE_DENIED');
      handlerResponseFrame = response;
      responseFrame = Buffer.from(response);
      const beforeResponse = parseStat(await this.binding.lstatUnixSocket(socketPath, signal));
      if (signal.aborted || !sameStat(afterAccept, beforeResponse)) deny('INVALID_ATTESTATION');
      await opened.writeAndShutdown(responseFrame, signal);
      if (signal.aborted) deny('EXCHANGE_DENIED');
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      deny('EXCHANGE_DENIED');
    } finally {
      nativeRequestFrame?.fill(0);
      requestFrame?.fill(0);
      handlerResponseFrame?.fill(0);
      responseFrame?.fill(0);
      if (opened) {
        try {
          await opened.close();
        } catch {
          closeFailed = true;
        }
      }
      this.#inFlight = false;
      if (closeFailed) deny('EXCHANGE_DENIED');
    }
  }
}
