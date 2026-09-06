import {
  DenyRetainedNativeSupervisorLocalIpcClient,
  RetainedNativeSupervisorLocalIpcError,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
  type RetainedNativeSupervisorLocalIpcAuthorization,
} from './retained-native-supervisor-local-ipc';
import {
  MAX_RETAINED_NATIVE_MODULE_SIGNING_REQUEST_BYTES,
  MAX_RETAINED_NATIVE_MODULE_SIGNING_RESPONSE_BYTES,
  type RetainedNativeSupervisorModuleAuthorizationKeylessSigningTransport,
} from './retained-native-supervisor-module-authorization-keyless-signer';

const AUTHORIZATION_KEYS = [
  'expectedPeerGid',
  'expectedPeerPid',
  'expectedPeerUid',
  'platform',
  'runtimeConnection',
  'schemaVersion',
  'socketDevice',
  'socketInode',
  'socketMode',
  'socketOwnerGid',
  'socketOwnerUid',
  'socketPath',
] as const;
const ENDPOINT_KEYS = [
  'authority',
  'fileType',
  'platform',
  'schemaVersion',
  'socketDevice',
  'socketInode',
  'socketMode',
  'socketOwnerGid',
  'socketOwnerUid',
  'socketPath',
] as const;
const PEER_KEYS = [
  'authority',
  'peerGid',
  'peerPid',
  'peerUid',
  'platform',
  'schemaVersion',
] as const;
const RESULT_KEYS = [
  'endpointAfter',
  'endpointBefore',
  'peerCredentials',
  'responseFrame',
] as const;

function deny(
  code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION' | 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function exactRecord(
  input: unknown,
  expected: readonly string[],
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
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
      actual.some((key) => {
        const descriptor = descriptors[key];
        return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
      })
    )
      deny(code);
    return record;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny(code);
  }
}

function positive(value: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) deny(code);
  return value as number;
}

function nonnegative(
  value: unknown,
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) deny(code);
  return value as number;
}

function socketPath(value: unknown, code: 'INVALID_AUTHORIZATION'): string {
  if (
    typeof value !== 'string' ||
    !/^\/[A-Za-z0-9._/-]+\.sock$/u.test(value) ||
    value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..') ||
    Buffer.byteLength(value, 'utf8') > 107
  )
    deny(code);
  return value;
}

function authorization(input: unknown): Readonly<RetainedNativeSupervisorLocalIpcAuthorization> {
  const value = exactRecord(input, AUTHORIZATION_KEYS, 'INVALID_AUTHORIZATION');
  if (
    value.schemaVersion !== 1 ||
    value.platform !== 'LINUX' ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    value.socketMode !== 0o600
  )
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1,
    platform: 'LINUX',
    socketPath: socketPath(value.socketPath, 'INVALID_AUTHORIZATION'),
    socketDevice: positive(value.socketDevice, 'INVALID_AUTHORIZATION'),
    socketInode: positive(value.socketInode, 'INVALID_AUTHORIZATION'),
    socketOwnerUid: nonnegative(value.socketOwnerUid, 'INVALID_AUTHORIZATION'),
    socketOwnerGid: nonnegative(value.socketOwnerGid, 'INVALID_AUTHORIZATION'),
    socketMode: 0o600,
    expectedPeerPid: positive(value.expectedPeerPid, 'INVALID_AUTHORIZATION'),
    expectedPeerUid: nonnegative(value.expectedPeerUid, 'INVALID_AUTHORIZATION'),
    expectedPeerGid: nonnegative(value.expectedPeerGid, 'INVALID_AUTHORIZATION'),
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function assertEndpoint(
  input: unknown,
  expected: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>,
): void {
  const value = exactRecord(input, ENDPOINT_KEYS, 'INVALID_ATTESTATION');
  if (
    value.schemaVersion !== 1 ||
    value.platform !== 'LINUX' ||
    value.authority !== 'LINUX_LSTAT_UNIX_SOCKET' ||
    value.fileType !== 'SOCKET' ||
    value.socketPath !== expected.socketPath ||
    positive(value.socketDevice, 'INVALID_ATTESTATION') !== expected.socketDevice ||
    positive(value.socketInode, 'INVALID_ATTESTATION') !== expected.socketInode ||
    nonnegative(value.socketOwnerUid, 'INVALID_ATTESTATION') !== expected.socketOwnerUid ||
    nonnegative(value.socketOwnerGid, 'INVALID_ATTESTATION') !== expected.socketOwnerGid ||
    value.socketMode !== expected.socketMode
  )
    deny('INVALID_ATTESTATION');
}

function assertPeer(
  input: unknown,
  expected: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>,
): void {
  const value = exactRecord(input, PEER_KEYS, 'INVALID_ATTESTATION');
  if (
    value.schemaVersion !== 1 ||
    value.platform !== 'LINUX' ||
    value.authority !== 'LINUX_SO_PEERCRED' ||
    positive(value.peerPid, 'INVALID_ATTESTATION') !== expected.expectedPeerPid ||
    nonnegative(value.peerUid, 'INVALID_ATTESTATION') !== expected.expectedPeerUid ||
    nonnegative(value.peerGid, 'INVALID_ATTESTATION') !== expected.expectedPeerGid
  )
    deny('INVALID_ATTESTATION');
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

/**
 * One-use signing transport over an already-authorized Linux local IPC client. It authenticates
 * the exact socket identity and SO_PEERCRED principal around the exchange, owns no key material,
 * discovers no path, and does not promote runtime connection state.
 */
export class AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport implements RetainedNativeSupervisorModuleAuthorizationKeylessSigningTransport {
  readonly #authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>;
  readonly #exchangeClient: (
    socketPath: string,
    requestFrame: Readonly<Uint8Array>,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly #closeClient: () => Promise<void>;
  #state: 'READY' | 'IN_FLIGHT' | 'ATTEMPTED' | 'CLOSED' = 'READY';

  constructor(client: ClosableRetainedNativeSupervisorLocalIpcClient, input: unknown) {
    this.#authorization = authorization(input);
    const bound = bindClient(client);
    this.#exchangeClient = bound.exchange;
    this.#closeClient = bound.close;
  }

  async exchange(request: Uint8Array, signal: AbortSignal): Promise<unknown> {
    if (this.#state !== 'READY') deny('EXCHANGE_DENIED');
    this.#state = 'IN_FLIGHT';
    try {
      if (
        !(signal instanceof AbortSignal) ||
        signal.aborted ||
        !(request instanceof Uint8Array) ||
        Object.getPrototypeOf(request) !== Uint8Array.prototype ||
        request.byteLength < 2 ||
        request.byteLength > MAX_RETAINED_NATIVE_MODULE_SIGNING_REQUEST_BYTES
      )
        deny('EXCHANGE_DENIED');
      const candidate = await this.#exchangeClient(this.#authorization.socketPath, request, signal);
      if (signal.aborted) deny('EXCHANGE_DENIED');
      const result = exactRecord(candidate, RESULT_KEYS, 'INVALID_ATTESTATION');
      assertEndpoint(result.endpointBefore, this.#authorization);
      assertPeer(result.peerCredentials, this.#authorization);
      assertEndpoint(result.endpointAfter, this.#authorization);
      if (
        !(result.responseFrame instanceof Uint8Array) ||
        result.responseFrame.byteLength < 2 ||
        result.responseFrame.byteLength > MAX_RETAINED_NATIVE_MODULE_SIGNING_RESPONSE_BYTES
      )
        deny('EXCHANGE_DENIED');
      return Uint8Array.from(result.responseFrame);
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('EXCHANGE_DENIED');
    } finally {
      if (this.#state === 'IN_FLIGHT') this.#state = 'ATTEMPTED';
    }
  }

  async close(): Promise<void> {
    if (this.#state !== 'ATTEMPTED' && this.#state !== 'IN_FLIGHT') deny('EXCHANGE_DENIED');
    this.#state = 'CLOSED';
    try {
      await this.#closeClient();
    } catch {
      deny('EXCHANGE_DENIED');
    }
  }
}
