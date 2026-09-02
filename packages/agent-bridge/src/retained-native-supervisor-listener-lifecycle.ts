import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler,
  RetainedNativeSupervisorLocalIpcError,
} from './retained-native-supervisor-local-ipc';
import {
  BoundedLinuxRetainedNativeSupervisorSession,
  type LinuxRetainedNativeSupervisorSessionBinding,
} from './retained-native-supervisor-linux-session';

export interface LinuxRetainedNativeSupervisorListenerAuthorization {
  readonly schemaVersion: 1;
  readonly platform: 'LINUX';
  readonly socketPath: string;
  readonly parentDevice: number;
  readonly parentInode: number;
  readonly parentOwnerUid: number;
  readonly parentOwnerGid: number;
  readonly parentMode: number;
  readonly socketOwnerUid: number;
  readonly socketOwnerGid: number;
  readonly socketMode: number;
  readonly listenBacklog: number;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface LinuxRetainedNativeSupervisorListenerCreationRequest {
  readonly schemaVersion: 1;
  readonly platform: 'LINUX';
  readonly socketPath: string;
  readonly socketMode: number;
  readonly listenBacklog: number;
  readonly pathDisposition: 'FAIL_IF_PRESENT';
}

export interface LinuxRetainedNativeSupervisorOwnedListener extends LinuxRetainedNativeSupervisorSessionBinding {
  creationEvidence(signal: AbortSignal): Promise<unknown>;
  closeAndUnlinkOwned(): unknown;
}

/** Native implementations must create without replacement and retain the exact created identity. */
export interface LinuxRetainedNativeSupervisorListenerLifecycleBinding {
  readonly platform: 'LINUX';
  createOwnedListener(
    request: Readonly<LinuxRetainedNativeSupervisorListenerCreationRequest>,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorListenerLifecycleBinding implements LinuxRetainedNativeSupervisorListenerLifecycleBinding {
  readonly platform = 'LINUX' as const;

  async createOwnedListener(
    _request: Readonly<LinuxRetainedNativeSupervisorListenerCreationRequest>,
    _signal: AbortSignal,
  ): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

const AUTHORIZATION_KEYS = [
  'listenBacklog',
  'parentDevice',
  'parentInode',
  'parentMode',
  'parentOwnerGid',
  'parentOwnerUid',
  'platform',
  'runtimeConnection',
  'schemaVersion',
  'socketMode',
  'socketOwnerGid',
  'socketOwnerUid',
  'socketPath',
] as const;
const CREATION_KEYS = [
  'bindDisposition',
  'listenerIdentity',
  'parentIdentity',
  'pathStateBefore',
  'schemaVersion',
] as const;
const DIRECTORY_KEYS = ['device', 'fileType', 'inode', 'mode', 'ownerGid', 'ownerUid'] as const;
const SOCKET_KEYS = ['device', 'fileType', 'inode', 'mode', 'ownerGid', 'ownerUid'] as const;
const CLEANUP_KEYS = [
  'disposition',
  'expectedDevice',
  'expectedInode',
  'listenerClosed',
  'schemaVersion',
] as const;

function deny(code: ConstructorParameters<typeof RetainedNativeSupervisorLocalIpcError>[0]): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(
  input: unknown,
  expected: readonly string[],
  code: ConstructorParameters<typeof RetainedNativeSupervisorLocalIpcError>[0],
): Record<string, unknown> {
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
}

function positive(
  value: unknown,
  code: ConstructorParameters<typeof RetainedNativeSupervisorLocalIpcError>[0],
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) deny(code);
  return value as number;
}

function nonnegative(
  value: unknown,
  code: ConstructorParameters<typeof RetainedNativeSupervisorLocalIpcError>[0],
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) deny(code);
  return value as number;
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

function parseAuthorization(
  input: unknown,
): Readonly<LinuxRetainedNativeSupervisorListenerAuthorization> {
  const value = plainRecord(input, AUTHORIZATION_KEYS, 'INVALID_AUTHORIZATION');
  if (
    value.schemaVersion !== 1 ||
    value.platform !== 'LINUX' ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    !validSocketPath(value.socketPath) ||
    value.parentMode !== 0o700 ||
    value.socketMode !== 0o600 ||
    value.listenBacklog !== 1
  )
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1,
    platform: 'LINUX',
    socketPath: value.socketPath,
    parentDevice: positive(value.parentDevice, 'INVALID_AUTHORIZATION'),
    parentInode: positive(value.parentInode, 'INVALID_AUTHORIZATION'),
    parentOwnerUid: nonnegative(value.parentOwnerUid, 'INVALID_AUTHORIZATION'),
    parentOwnerGid: nonnegative(value.parentOwnerGid, 'INVALID_AUTHORIZATION'),
    parentMode: 0o700,
    socketOwnerUid: nonnegative(value.socketOwnerUid, 'INVALID_AUTHORIZATION'),
    socketOwnerGid: nonnegative(value.socketOwnerGid, 'INVALID_AUTHORIZATION'),
    socketMode: 0o600,
    listenBacklog: 1,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function parseIdentity(
  input: unknown,
  fileType: 'DIRECTORY' | 'SOCKET',
): Readonly<Record<string, unknown>> {
  const value = plainRecord(
    input,
    fileType === 'DIRECTORY' ? DIRECTORY_KEYS : SOCKET_KEYS,
    'INVALID_ATTESTATION',
  );
  const requiredMode = fileType === 'DIRECTORY' ? 0o700 : 0o600;
  if (value.fileType !== fileType || value.mode !== requiredMode) deny('INVALID_ATTESTATION');
  return Object.freeze({
    fileType,
    device: positive(value.device, 'INVALID_ATTESTATION'),
    inode: positive(value.inode, 'INVALID_ATTESTATION'),
    ownerUid: nonnegative(value.ownerUid, 'INVALID_ATTESTATION'),
    ownerGid: nonnegative(value.ownerGid, 'INVALID_ATTESTATION'),
    mode: requiredMode,
  });
}

function sameIdentity(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
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

function assertAuthorizedCreation(
  input: unknown,
  authorization: Readonly<LinuxRetainedNativeSupervisorListenerAuthorization>,
): Readonly<Record<string, unknown>> {
  const evidence = plainRecord(input, CREATION_KEYS, 'INVALID_ATTESTATION');
  if (
    evidence.schemaVersion !== 1 ||
    evidence.pathStateBefore !== 'ABSENT' ||
    evidence.bindDisposition !== 'CREATED_WITHOUT_REPLACEMENT'
  )
    deny('INVALID_ATTESTATION');
  const parent = parseIdentity(evidence.parentIdentity, 'DIRECTORY');
  const listener = parseIdentity(evidence.listenerIdentity, 'SOCKET');
  if (
    parent.device !== authorization.parentDevice ||
    parent.inode !== authorization.parentInode ||
    parent.ownerUid !== authorization.parentOwnerUid ||
    parent.ownerGid !== authorization.parentOwnerGid ||
    parent.mode !== authorization.parentMode ||
    listener.ownerUid !== authorization.socketOwnerUid ||
    listener.ownerGid !== authorization.socketOwnerGid ||
    listener.mode !== authorization.socketMode
  )
    deny('INVALID_ATTESTATION');
  return listener;
}

function ownedListener(input: unknown): LinuxRetainedNativeSupervisorOwnedListener {
  if (
    typeof input !== 'object' ||
    input === null ||
    (input as LinuxRetainedNativeSupervisorOwnedListener).platform !== 'LINUX' ||
    typeof (input as LinuxRetainedNativeSupervisorOwnedListener).creationEvidence !== 'function' ||
    typeof (input as LinuxRetainedNativeSupervisorOwnedListener).lstatUnixSocket !== 'function' ||
    typeof (input as LinuxRetainedNativeSupervisorOwnedListener).acceptAuthorizedUnixSocket !==
      'function' ||
    typeof (input as LinuxRetainedNativeSupervisorOwnedListener).closeAndUnlinkOwned !== 'function'
  )
    deny('NOT_CONFIGURED');
  return input as LinuxRetainedNativeSupervisorOwnedListener;
}

function assertCleanup(
  input: unknown,
  identity: Readonly<Record<string, unknown>> | undefined,
): void {
  const evidence = plainRecord(input, CLEANUP_KEYS, 'EXCHANGE_DENIED');
  const expectedDevice = positive(evidence.expectedDevice, 'EXCHANGE_DENIED');
  const expectedInode = positive(evidence.expectedInode, 'EXCHANGE_DENIED');
  if (
    evidence.schemaVersion !== 1 ||
    evidence.listenerClosed !== true ||
    evidence.disposition !== 'OWNED_SOCKET_REMOVED' ||
    (identity !== undefined &&
      (expectedDevice !== identity.device || expectedInode !== identity.inode))
  )
    deny('EXCHANGE_DENIED');
}

/**
 * Owns one listener creation, one authenticated session, and exact-identity cleanup.
 * A lifecycle instance is consumed by its first attempt and cannot loop or retry.
 */
export class BoundedLinuxRetainedNativeSupervisorListenerLifecycle {
  readonly #authorization: Readonly<LinuxRetainedNativeSupervisorListenerAuthorization>;
  #consumed = false;

  constructor(
    private readonly binding: LinuxRetainedNativeSupervisorListenerLifecycleBinding,
    authorization: unknown,
  ) {
    if (
      binding instanceof DenyLinuxRetainedNativeSupervisorListenerLifecycleBinding ||
      !binding ||
      binding.platform !== 'LINUX' ||
      typeof binding.createOwnedListener !== 'function'
    )
      deny('NOT_CONFIGURED');
    this.#authorization = parseAuthorization(authorization);
  }

  async runOne(
    handler: AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      this.#consumed ||
      !(handler instanceof AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler) ||
      !(signal instanceof AbortSignal) ||
      signal.aborted
    )
      deny('EXCHANGE_DENIED');
    this.#consumed = true;
    let listener: LinuxRetainedNativeSupervisorOwnedListener | undefined;
    let identity: Readonly<Record<string, unknown>> | undefined;
    let cleanupFailed = false;
    try {
      const request = Object.freeze({
        schemaVersion: 1 as const,
        platform: 'LINUX' as const,
        socketPath: this.#authorization.socketPath,
        socketMode: 0o600,
        listenBacklog: 1,
        pathDisposition: 'FAIL_IF_PRESENT' as const,
      });
      listener = ownedListener(await this.binding.createOwnedListener(request, signal));
      if (signal.aborted) deny('EXCHANGE_DENIED');
      identity = assertAuthorizedCreation(
        await listener.creationEvidence(signal),
        this.#authorization,
      );
      if (signal.aborted) deny('EXCHANGE_DENIED');
      const current = parseIdentity(
        await listener.lstatUnixSocket(this.#authorization.socketPath, signal),
        'SOCKET',
      );
      if (signal.aborted || !sameIdentity(identity, current)) deny('INVALID_ATTESTATION');
      await new BoundedLinuxRetainedNativeSupervisorSession(listener, handler).handleOne(
        this.#authorization.socketPath,
        signal,
      );
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      deny('EXCHANGE_DENIED');
    } finally {
      if (listener) {
        try {
          assertCleanup(listener.closeAndUnlinkOwned(), identity);
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed) deny('EXCHANGE_DENIED');
    }
  }
}
