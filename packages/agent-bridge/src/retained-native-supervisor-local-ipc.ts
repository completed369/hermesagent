import { TextDecoder } from 'node:util';

import { canonicalJson } from './codec';
import {
  DenyRetainedNativeSupervisorRecoveryTransport,
  type RetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';

export const MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES = 32_768;

export type RetainedNativeSupervisorLocalIpcErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_AUTHORIZATION'
  | 'INVALID_ATTESTATION'
  | 'INVALID_FRAME'
  | 'LIMIT_EXCEEDED'
  | 'CONCURRENT_EXCHANGE'
  | 'EXCHANGE_DENIED';

export class RetainedNativeSupervisorLocalIpcError extends Error {
  constructor(readonly code: RetainedNativeSupervisorLocalIpcErrorCode) {
    super(`Retained native supervisor local IPC denied: ${code}`);
  }
}

export interface RetainedNativeSupervisorLocalIpcEndpointIdentity {
  readonly schemaVersion: 1;
  readonly platform: 'LINUX';
  readonly authority: 'LINUX_LSTAT_UNIX_SOCKET';
  readonly fileType: 'SOCKET';
  readonly socketPath: string;
  readonly socketDevice: number;
  readonly socketInode: number;
  readonly socketOwnerUid: number;
  readonly socketOwnerGid: number;
  readonly socketMode: number;
}

export interface RetainedNativeSupervisorLocalIpcPeerCredentials {
  readonly schemaVersion: 1;
  readonly platform: 'LINUX';
  readonly authority: 'LINUX_SO_PEERCRED';
  readonly peerPid: number;
  readonly peerUid: number;
  readonly peerGid: number;
}

export interface RetainedNativeSupervisorLocalIpcAuthorization {
  readonly schemaVersion: 1;
  readonly platform: 'LINUX';
  readonly socketPath: string;
  readonly socketDevice: number;
  readonly socketInode: number;
  readonly socketOwnerUid: number;
  readonly socketOwnerGid: number;
  readonly socketMode: number;
  readonly expectedPeerPid: number;
  readonly expectedPeerUid: number;
  readonly expectedPeerGid: number;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface RetainedNativeSupervisorLocalIpcClientExchangeResult {
  readonly endpointBefore: unknown;
  readonly peerCredentials: unknown;
  readonly endpointAfter: unknown;
  readonly responseFrame: unknown;
}

/**
 * Native implementations must derive both endpoint identities with lstat(2)
 * and the connected peer identity with SO_PEERCRED. This port does not grant
 * authority from caller-provided metadata.
 */
export interface RetainedNativeSupervisorLocalIpcClient {
  exchange(
    socketPath: string,
    requestFrame: Readonly<Uint8Array>,
    signal: AbortSignal,
  ): Promise<unknown>;
}

/** A client whose active OS connection can be closed independently of exchange completion. */
export interface ClosableRetainedNativeSupervisorLocalIpcClient extends RetainedNativeSupervisorLocalIpcClient {
  close(): Promise<void>;
}

export class DenyRetainedNativeSupervisorLocalIpcClient implements ClosableRetainedNativeSupervisorLocalIpcClient {
  async exchange(
    _socketPath: string,
    _requestFrame: Readonly<Uint8Array>,
    _signal: AbortSignal,
  ): Promise<never> {
    deny('NOT_CONFIGURED');
  }

  async close(): Promise<void> {}
}

export interface AuthenticatedRetainedNativeSupervisorLocalIpcInboundExchange {
  readonly endpointIdentity: unknown;
  readonly peerCredentials: unknown;
  readonly requestFrame: unknown;
}

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
const INBOUND_KEYS = ['endpointIdentity', 'peerCredentials', 'requestFrame'] as const;
const FRAME_KEYS = ['direction', 'message', 'protocol', 'schemaVersion'] as const;

function deny(code: RetainedNativeSupervisorLocalIpcErrorCode): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(
  input: unknown,
  expected: readonly string[],
  code: RetainedNativeSupervisorLocalIpcErrorCode,
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

function positiveInteger(value: unknown, code: RetainedNativeSupervisorLocalIpcErrorCode): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) deny(code);
  return value as number;
}

function nonnegativeInteger(
  value: unknown,
  code: RetainedNativeSupervisorLocalIpcErrorCode,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) deny(code);
  return value as number;
}

function socketPath(value: unknown, code: RetainedNativeSupervisorLocalIpcErrorCode): string {
  if (
    typeof value !== 'string' ||
    value.length < 2 ||
    value.length > 107 ||
    Buffer.byteLength(value, 'utf8') > 107 ||
    !/^\/[A-Za-z0-9._/-]+\.sock$/u.test(value) ||
    value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..') ||
    value.includes('\0')
  )
    deny(code);
  return value;
}

function socketMode(value: unknown, code: RetainedNativeSupervisorLocalIpcErrorCode): number {
  const mode = nonnegativeInteger(value, code);
  if (mode !== 0o600) deny(code);
  return mode;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value as Readonly<T>;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function authenticateRetainedNativeSupervisorLocalIpcAuthorization(
  input: unknown,
): Readonly<RetainedNativeSupervisorLocalIpcAuthorization> {
  const value = plainRecord(input, AUTHORIZATION_KEYS, 'INVALID_AUTHORIZATION');
  if (
    value.schemaVersion !== 1 ||
    value.platform !== 'LINUX' ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1,
    platform: 'LINUX',
    socketPath: socketPath(value.socketPath, 'INVALID_AUTHORIZATION'),
    socketDevice: positiveInteger(value.socketDevice, 'INVALID_AUTHORIZATION'),
    socketInode: positiveInteger(value.socketInode, 'INVALID_AUTHORIZATION'),
    socketOwnerUid: nonnegativeInteger(value.socketOwnerUid, 'INVALID_AUTHORIZATION'),
    socketOwnerGid: nonnegativeInteger(value.socketOwnerGid, 'INVALID_AUTHORIZATION'),
    socketMode: socketMode(value.socketMode, 'INVALID_AUTHORIZATION'),
    expectedPeerPid: positiveInteger(value.expectedPeerPid, 'INVALID_AUTHORIZATION'),
    expectedPeerUid: nonnegativeInteger(value.expectedPeerUid, 'INVALID_AUTHORIZATION'),
    expectedPeerGid: nonnegativeInteger(value.expectedPeerGid, 'INVALID_AUTHORIZATION'),
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

/**
 * Authenticates the exact listener endpoint and SO_PEERCRED principal for one already-accepted
 * inbound exchange. The returned frame remains untrusted protocol input for the caller to parse.
 */
export function authenticateRetainedNativeSupervisorLocalIpcInboundExchange(
  inboundInput: unknown,
  authorizationInput: unknown,
): unknown {
  const authorization =
    authenticateRetainedNativeSupervisorLocalIpcAuthorization(authorizationInput);
  const inbound = plainRecord(inboundInput, INBOUND_KEYS, 'INVALID_ATTESTATION');
  assertEndpoint(inbound.endpointIdentity, authorization);
  assertPeer(inbound.peerCredentials, authorization);
  return inbound.requestFrame;
}

function assertEndpoint(
  input: unknown,
  authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>,
): void {
  const value = plainRecord(input, ENDPOINT_KEYS, 'INVALID_ATTESTATION');
  if (
    value.schemaVersion !== 1 ||
    value.platform !== 'LINUX' ||
    value.authority !== 'LINUX_LSTAT_UNIX_SOCKET' ||
    value.fileType !== 'SOCKET' ||
    socketPath(value.socketPath, 'INVALID_ATTESTATION') !== authorization.socketPath ||
    positiveInteger(value.socketDevice, 'INVALID_ATTESTATION') !== authorization.socketDevice ||
    positiveInteger(value.socketInode, 'INVALID_ATTESTATION') !== authorization.socketInode ||
    nonnegativeInteger(value.socketOwnerUid, 'INVALID_ATTESTATION') !==
      authorization.socketOwnerUid ||
    nonnegativeInteger(value.socketOwnerGid, 'INVALID_ATTESTATION') !==
      authorization.socketOwnerGid ||
    socketMode(value.socketMode, 'INVALID_ATTESTATION') !== authorization.socketMode
  )
    deny('INVALID_ATTESTATION');
}

function assertPeer(
  input: unknown,
  authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>,
): void {
  const value = plainRecord(input, PEER_KEYS, 'INVALID_ATTESTATION');
  if (
    value.schemaVersion !== 1 ||
    value.platform !== 'LINUX' ||
    value.authority !== 'LINUX_SO_PEERCRED' ||
    positiveInteger(value.peerPid, 'INVALID_ATTESTATION') !== authorization.expectedPeerPid ||
    nonnegativeInteger(value.peerUid, 'INVALID_ATTESTATION') !== authorization.expectedPeerUid ||
    nonnegativeInteger(value.peerGid, 'INVALID_ATTESTATION') !== authorization.expectedPeerGid
  )
    deny('INVALID_ATTESTATION');
}

function bytes(input: unknown): Buffer {
  if (!(input instanceof Uint8Array) || input.byteLength < 3) deny('INVALID_FRAME');
  if (input.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES) deny('LIMIT_EXCEEDED');
  return Buffer.from(input);
}

function encode(
  direction: 'WORKER_TO_SUPERVISOR' | 'SUPERVISOR_TO_WORKER',
  message: unknown,
): Buffer {
  const frame = {
    schemaVersion: 1,
    protocol: 'VENTUREOS_RETAINED_NATIVE_RECOVERY_IPC',
    direction,
    message,
  };
  let encoded: Buffer;
  try {
    encoded = Buffer.from(`${canonicalJson(frame)}\n`, 'utf8');
  } catch {
    deny('INVALID_FRAME');
  }
  if (encoded.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES) deny('LIMIT_EXCEEDED');
  return encoded;
}

function decode(
  input: unknown,
  direction: 'WORKER_TO_SUPERVISOR' | 'SUPERVISOR_TO_WORKER',
): unknown {
  const encoded = bytes(input);
  try {
    if (encoded[encoded.byteLength - 1] !== 10) deny('INVALID_FRAME');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(encoded.subarray(0, -1));
    if (text.includes('\r') || text.includes('\n')) deny('INVALID_FRAME');
    const frame = plainRecord(JSON.parse(text), FRAME_KEYS, 'INVALID_FRAME');
    if (
      frame.schemaVersion !== 1 ||
      frame.protocol !== 'VENTUREOS_RETAINED_NATIVE_RECOVERY_IPC' ||
      frame.direction !== direction ||
      `${canonicalJson(frame)}\n` !== new TextDecoder().decode(encoded)
    )
      deny('INVALID_FRAME');
    return deepFreeze(frame.message);
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    deny('INVALID_FRAME');
  } finally {
    encoded.fill(0);
  }
}

/** Worker-side one-request/one-response transport over an OS-authenticated native port. */
export class AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport implements RetainedNativeSupervisorRecoveryTransport {
  readonly #authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>;
  #inFlight = false;

  constructor(
    private readonly client: RetainedNativeSupervisorLocalIpcClient,
    authorization: unknown,
  ) {
    if (
      client instanceof DenyRetainedNativeSupervisorLocalIpcClient ||
      !client ||
      typeof client.exchange !== 'function'
    )
      deny('NOT_CONFIGURED');
    this.#authorization = authenticateRetainedNativeSupervisorLocalIpcAuthorization(authorization);
  }

  async exchange(
    request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
    if (this.#inFlight) deny('CONCURRENT_EXCHANGE');
    this.#inFlight = true;
    const requestFrame = encode('WORKER_TO_SUPERVISOR', request);
    try {
      const candidate = await this.client.exchange(
        this.#authorization.socketPath,
        requestFrame,
        signal,
      );
      if (signal.aborted) deny('EXCHANGE_DENIED');
      const result = plainRecord(candidate, RESULT_KEYS, 'INVALID_ATTESTATION');
      assertEndpoint(result.endpointBefore, this.#authorization);
      assertPeer(result.peerCredentials, this.#authorization);
      assertEndpoint(result.endpointAfter, this.#authorization);
      return decode(result.responseFrame, 'SUPERVISOR_TO_WORKER');
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      deny('EXCHANGE_DENIED');
    } finally {
      requestFrame.fill(0);
      this.#inFlight = false;
    }
  }
}

/** Supervisor-side handler for one already-accepted SO_PEERCRED-authenticated exchange. */
export class AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler {
  readonly #authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>;

  constructor(
    private readonly peer: RetainedNativeSupervisorRecoveryTransport,
    authorization: unknown,
  ) {
    if (
      peer instanceof DenyRetainedNativeSupervisorRecoveryTransport ||
      !peer ||
      typeof peer.exchange !== 'function'
    )
      deny('NOT_CONFIGURED');
    this.#authorization = authenticateRetainedNativeSupervisorLocalIpcAuthorization(authorization);
  }

  async handle(inboundInput: unknown, signal: AbortSignal): Promise<Readonly<Uint8Array>> {
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
    const request = decode(
      authenticateRetainedNativeSupervisorLocalIpcInboundExchange(
        inboundInput,
        this.#authorization,
      ),
      'WORKER_TO_SUPERVISOR',
    ) as Readonly<RetainedNativeSupervisorRecoveryRequest>;
    try {
      const response = await this.peer.exchange(request, signal);
      if (signal.aborted) deny('EXCHANGE_DENIED');
      return encode('SUPERVISOR_TO_WORKER', response);
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      deny('EXCHANGE_DENIED');
    }
  }
}
