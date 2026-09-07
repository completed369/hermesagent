import {
  authenticateRetainedNativeSupervisorLocalIpcAuthorization,
  RetainedNativeSupervisorLocalIpcError,
  type RetainedNativeSupervisorLocalIpcAuthorization,
} from './retained-native-supervisor-local-ipc';
import {
  DenyLinuxRetainedNativeSupervisorSessionBinding,
  type LinuxRetainedNativeSupervisorAcceptedSession,
  type LinuxRetainedNativeSupervisorSessionBinding,
} from './retained-native-supervisor-linux-session';
import { BoundedRetainedNativeSupervisorTopologyObservationCarrierAcceptedWorkerSession } from './retained-native-supervisor-topology-observation-carrier-channel';

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const STAT_KEYS = ['device', 'fileType', 'inode', 'mode', 'ownerGid', 'ownerUid'] as const;
const CREDENTIAL_KEYS = ['gid', 'pid', 'uid'] as const;

type BoundSession = Readonly<{
  peerCredentials: LinuxRetainedNativeSupervisorAcceptedSession['peerCredentials'];
  readToEof: LinuxRetainedNativeSupervisorAcceptedSession['readToEof'];
  writeAndShutdown: LinuxRetainedNativeSupervisorAcceptedSession['writeAndShutdown'];
  close: LinuxRetainedNativeSupervisorAcceptedSession['close'];
}>;

function deny(code: ConstructorParameters<typeof RetainedNativeSupervisorLocalIpcError>[0]): never {
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

function authenticateAuthorization(
  input: unknown,
): Readonly<RetainedNativeSupervisorLocalIpcAuthorization> {
  try {
    return authenticateRetainedNativeSupervisorLocalIpcAuthorization(input);
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_AUTHORIZATION');
  }
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

function authenticateStat(
  input: unknown,
  authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>,
): Readonly<Record<string, number | 'SOCKET'>> {
  const value = plainRecord(input, STAT_KEYS);
  if (
    value.fileType !== 'SOCKET' ||
    positive(value.device) !== authorization.socketDevice ||
    positive(value.inode) !== authorization.socketInode ||
    nonnegative(value.ownerUid) !== authorization.socketOwnerUid ||
    nonnegative(value.ownerGid) !== authorization.socketOwnerGid ||
    value.mode !== authorization.socketMode
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze({
    fileType: 'SOCKET',
    device: authorization.socketDevice,
    inode: authorization.socketInode,
    ownerUid: authorization.socketOwnerUid,
    ownerGid: authorization.socketOwnerGid,
    mode: authorization.socketMode,
  });
}

function authenticatePeer(
  input: unknown,
  authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>,
): void {
  const value = plainRecord(input, CREDENTIAL_KEYS);
  if (
    positive(value.pid) !== authorization.expectedPeerPid ||
    nonnegative(value.uid) !== authorization.expectedPeerUid ||
    nonnegative(value.gid) !== authorization.expectedPeerGid
  )
    deny('INVALID_ATTESTATION');
}

function bindSession(input: unknown): BoundSession {
  try {
    if (typeof input !== 'object' || input === null) deny('NOT_CONFIGURED');
    const session = input as LinuxRetainedNativeSupervisorAcceptedSession;
    const peerCredentials = session.peerCredentials;
    const readToEof = session.readToEof;
    const writeAndShutdown = session.writeAndShutdown;
    const close = session.close;
    if (
      typeof peerCredentials !== 'function' ||
      typeof readToEof !== 'function' ||
      typeof writeAndShutdown !== 'function' ||
      typeof close !== 'function'
    )
      deny('NOT_CONFIGURED');
    return Object.freeze({
      peerCredentials: peerCredentials.bind(session),
      readToEof: readToEof.bind(session),
      writeAndShutdown: writeAndShutdown.bind(session),
      close: close.bind(session),
    });
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

function bindNative(binding: LinuxRetainedNativeSupervisorSessionBinding) {
  try {
    if (
      binding instanceof DenyLinuxRetainedNativeSupervisorSessionBinding ||
      typeof binding !== 'object' ||
      binding === null ||
      binding.platform !== 'LINUX'
    )
      deny('NOT_CONFIGURED');
    const lstatUnixSocket = binding.lstatUnixSocket;
    const acceptAuthorizedUnixSocket = binding.acceptAuthorizedUnixSocket;
    if (typeof lstatUnixSocket !== 'function' || typeof acceptAuthorizedUnixSocket !== 'function')
      deny('NOT_CONFIGURED');
    return Object.freeze({
      lstatUnixSocket: lstatUnixSocket.bind(binding),
      acceptAuthorizedUnixSocket: acceptAuthorizedUnixSocket.bind(binding),
    });
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

async function closeBounded(close: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(close),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Carrier session close timed out')), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Authenticates and transfers one session accepted from an injected, already-created Linux listener.
 * It cannot create, discover, replace, retry, expose, or loop that listener.
 */
export class BoundedAuthenticatedLinuxRetainedNativeSupervisorTopologyObservationCarrierWorkerAdmission {
  readonly #authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>;
  readonly #native: ReturnType<typeof bindNative>;
  readonly #timeoutMs: number;
  #state: 'READY' | 'IN_FLIGHT' | 'ATTEMPTED' = 'READY';

  constructor(
    binding: LinuxRetainedNativeSupervisorSessionBinding,
    authorizationInput: unknown,
    timeoutMs = 5_000,
  ) {
    this.#timeoutMs = timeout(timeoutMs);
    this.#authorization = authenticateAuthorization(authorizationInput);
    this.#native = bindNative(binding);
  }

  async acceptOne(
    signal: AbortSignal,
  ): Promise<BoundedRetainedNativeSupervisorTopologyObservationCarrierAcceptedWorkerSession> {
    if (this.#state === 'IN_FLIGHT') deny('CONCURRENT_EXCHANGE');
    if (this.#state !== 'READY' || !(signal instanceof AbortSignal) || signal.aborted)
      deny('EXCHANGE_DENIED');
    this.#state = 'IN_FLIGHT';
    let opened: BoundSession | undefined;
    let accepted:
      BoundedRetainedNativeSupervisorTopologyObservationCarrierAcceptedWorkerSession | undefined;
    let failure: unknown;
    try {
      authenticateStat(
        await this.#native.lstatUnixSocket(this.#authorization.socketPath, signal),
        this.#authorization,
      );
      if (signal.aborted) deny('EXCHANGE_DENIED');
      opened = bindSession(
        await this.#native.acceptAuthorizedUnixSocket(this.#authorization.socketPath, signal),
      );
      if (signal.aborted) deny('EXCHANGE_DENIED');
      authenticatePeer(await opened.peerCredentials(signal), this.#authorization);
      if (signal.aborted) deny('EXCHANGE_DENIED');
      authenticateStat(
        await this.#native.lstatUnixSocket(this.#authorization.socketPath, signal),
        this.#authorization,
      );
      if (signal.aborted) deny('EXCHANGE_DENIED');
      accepted = new BoundedRetainedNativeSupervisorTopologyObservationCarrierAcceptedWorkerSession(
        opened,
        this.#timeoutMs,
      );
      opened = undefined;
    } catch (error) {
      failure =
        error instanceof RetainedNativeSupervisorLocalIpcError
          ? error
          : new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED');
    } finally {
      this.#state = 'ATTEMPTED';
      if (failure !== undefined) {
        try {
          if (accepted) await accepted.close();
          else if (opened) await closeBounded(opened.close, this.#timeoutMs);
        } catch {
          failure = new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED');
        }
      }
    }
    if (failure !== undefined) throw failure;
    return accepted!;
  }
}
