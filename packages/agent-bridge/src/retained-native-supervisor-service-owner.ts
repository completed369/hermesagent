import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  BoundedLinuxRetainedNativeSupervisorListenerLifecycle,
  DenyLinuxRetainedNativeSupervisorListenerLifecycleBinding,
  DenyLinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyFactory,
  type LinuxRetainedNativeSupervisorListenerLifecycleBinding,
  type LinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyFactory,
} from './retained-native-supervisor-listener-lifecycle';
import {
  DenyRetainedNativeSupervisorRecoveryTransport,
  type RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';
import { authenticateRetainedNativeSupervisorModuleAuthorizationSignerKeyId } from './retained-native-supervisor-module-authorization-signing-handler';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_SOCKET_PATH = /^\/[A-Za-z0-9._/-]+\.sock$/u;
const SAFE_DIRECTORY_PATH = /^\/[A-Za-z0-9._/-]+$/u;
const LINUX_IDENTITY = /^linux:dev-([a-f0-9]+):ino-([a-f0-9]+)$/u;
const MAX_AUTHORIZATION_LIFETIME_MS = 60_000;
const MIN_SESSION_DURATION_MS = 100;
const MAX_SESSION_DURATION_MS = 5_000;

export type LinuxRetainedNativeSupervisorServiceKind = 'RECOVERY' | 'MODULE_AUTHORIZATION_SIGNING';

export interface LinuxRetainedNativeSupervisorServiceRequest {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_ONE_SESSION_SERVICE';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly serviceKind: LinuxRetainedNativeSupervisorServiceKind;
  readonly provisioningId: string;
  readonly pathProvisionRequestHash: string;
  readonly pathApprovalEvidenceHash: string;
  readonly socketDirectory: string;
  readonly socketDirectoryIdentityReference: string;
  readonly socketDirectoryOwnerUid: number;
  readonly socketDirectoryOwnerGid: number;
  readonly socketDirectoryMode: 448;
  readonly socketPath: string;
  readonly expectedWorkerPid: number;
  readonly expectedWorkerUid: number;
  readonly expectedWorkerGid: number;
  readonly maximumSessionDurationMs: number;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface LinuxRetainedNativeSupervisorServiceGrant extends LinuxRetainedNativeSupervisorServiceRequest {
  readonly serviceRunId: string;
  readonly requestHash: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly authorizedByReference: string;
  readonly authorityLevel: 3;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface LinuxRetainedNativeSupervisorServiceAuthority {
  authorize(request: Readonly<LinuxRetainedNativeSupervisorServiceRequest>): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorServiceAuthority implements LinuxRetainedNativeSupervisorServiceAuthority {
  async authorize(_request: Readonly<LinuxRetainedNativeSupervisorServiceRequest>): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

const REQUEST_KEYS = [
  'expectedWorkerGid',
  'expectedWorkerPid',
  'expectedWorkerUid',
  'maximumSessionDurationMs',
  'pathApprovalEvidenceHash',
  'pathProvisionRequestHash',
  'provisioningId',
  'purpose',
  'runtimeConnection',
  'schemaVersion',
  'serviceKind',
  'socketDirectory',
  'socketDirectoryIdentityReference',
  'socketDirectoryMode',
  'socketDirectoryOwnerGid',
  'socketDirectoryOwnerUid',
  'socketPath',
  'supervisorInstanceId',
  'workspaceId',
] as const;
const GRANT_KEYS = [
  ...REQUEST_KEYS,
  'approvalEvidenceHash',
  'approvalId',
  'authorityLevel',
  'authorizedByReference',
  'requestHash',
  'serviceRunId',
  'validFrom',
  'validUntil',
] as const;

function deny(code: ConstructorParameters<typeof RetainedNativeSupervisorLocalIpcError>[0]): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(
  input: unknown,
  expected: readonly string[],
  code: ConstructorParameters<typeof RetainedNativeSupervisorLocalIpcError>[0],
): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) deny(code);
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) deny(code);
    const value = input as Record<string, unknown>;
    const actual = Object.keys(value).sort();
    const keys = [...expected].sort();
    const ownKeys = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      actual.length !== keys.length ||
      ownKeys.length !== actual.length ||
      ownKeys.some((key) => typeof key !== 'string') ||
      actual.some((key, index) => key !== keys[index]) ||
      actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value'))
    )
      deny(code);
    return value;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny(code);
  }
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value)) deny('INVALID_AUTHORIZATION');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) deny('INVALID_AUTHORIZATION');
  return value;
}

function nonnegative(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) deny('INVALID_AUTHORIZATION');
  return value as number;
}

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) deny('INVALID_AUTHORIZATION');
  return value as number;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') deny('INVALID_AUTHORIZATION');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    deny('INVALID_AUTHORIZATION');
  return value;
}

function socketPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !SAFE_SOCKET_PATH.test(value) ||
    value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..') ||
    Buffer.byteLength(value, 'utf8') > 107
  )
    deny('INVALID_AUTHORIZATION');
  return value;
}

function directoryPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !SAFE_DIRECTORY_PATH.test(value) ||
    value === '/' ||
    value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..') ||
    Buffer.byteLength(value, 'utf8') > 4_096
  )
    deny('INVALID_AUTHORIZATION');
  return value;
}

function identity(value: unknown): { readonly device: number; readonly inode: number } {
  if (typeof value !== 'string') deny('INVALID_AUTHORIZATION');
  const match = LINUX_IDENTITY.exec(value);
  if (!match) deny('INVALID_AUTHORIZATION');
  const device = Number.parseInt(match[1]!, 16);
  const inode = Number.parseInt(match[2]!, 16);
  if (!Number.isSafeInteger(device) || device < 1 || !Number.isSafeInteger(inode) || inode < 1)
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({ device, inode });
}

export function validateLinuxRetainedNativeSupervisorServiceRequest(
  input: unknown,
): Readonly<LinuxRetainedNativeSupervisorServiceRequest> {
  const value = plainRecord(input, REQUEST_KEYS, 'INVALID_AUTHORIZATION');
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_ONE_SESSION_SERVICE' ||
    (value.serviceKind !== 'RECOVERY' && value.serviceKind !== 'MODULE_AUTHORIZATION_SIGNING') ||
    value.socketDirectoryMode !== 0o700 ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    deny('INVALID_AUTHORIZATION');
  const maximumSessionDurationMs = positive(value.maximumSessionDurationMs);
  if (
    maximumSessionDurationMs < MIN_SESSION_DURATION_MS ||
    maximumSessionDurationMs > MAX_SESSION_DURATION_MS
  )
    deny('INVALID_AUTHORIZATION');
  const socketDirectoryIdentityReference = reference(value.socketDirectoryIdentityReference);
  identity(socketDirectoryIdentityReference);
  const validatedSocketPath = socketPath(value.socketPath);
  const socketDirectory = directoryPath(value.socketDirectory);
  if (posix.dirname(validatedSocketPath) !== socketDirectory) deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_ONE_SESSION_SERVICE',
    workspaceId: reference(value.workspaceId),
    supervisorInstanceId: reference(value.supervisorInstanceId),
    serviceKind: value.serviceKind,
    provisioningId: reference(value.provisioningId),
    pathProvisionRequestHash: digest(value.pathProvisionRequestHash),
    pathApprovalEvidenceHash: digest(value.pathApprovalEvidenceHash),
    socketDirectory,
    socketDirectoryIdentityReference,
    socketDirectoryOwnerUid: nonnegative(value.socketDirectoryOwnerUid),
    socketDirectoryOwnerGid: nonnegative(value.socketDirectoryOwnerGid),
    socketDirectoryMode: 0o700,
    socketPath: validatedSocketPath,
    expectedWorkerPid: positive(value.expectedWorkerPid),
    expectedWorkerUid: nonnegative(value.expectedWorkerUid),
    expectedWorkerGid: nonnegative(value.expectedWorkerGid),
    maximumSessionDurationMs,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

export function linuxRetainedNativeSupervisorServiceRequestHash(
  request: Readonly<LinuxRetainedNativeSupervisorServiceRequest>,
): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

function validateGrant(input: unknown): Readonly<LinuxRetainedNativeSupervisorServiceGrant> {
  const value = plainRecord(input, GRANT_KEYS, 'INVALID_AUTHORIZATION');
  const request = validateLinuxRetainedNativeSupervisorServiceRequest(
    Object.fromEntries(REQUEST_KEYS.map((key) => [key, value[key]])),
  );
  return Object.freeze({
    ...request,
    serviceRunId: reference(value.serviceRunId),
    requestHash: digest(value.requestHash),
    approvalId: reference(value.approvalId),
    approvalEvidenceHash: digest(value.approvalEvidenceHash),
    authorizedByReference: reference(value.authorizedByReference),
    authorityLevel: value.authorityLevel === 3 ? 3 : deny('INVALID_AUTHORIZATION'),
    validFrom: timestamp(value.validFrom),
    validUntil: timestamp(value.validUntil),
  });
}

function sameRequest(
  request: Readonly<LinuxRetainedNativeSupervisorServiceRequest>,
  grant: Readonly<LinuxRetainedNativeSupervisorServiceGrant>,
): boolean {
  return REQUEST_KEYS.every((key) => request[key] === grant[key]);
}

/**
 * Owns exactly one authorized listener attempt. It adds no retry, daemon loop, discovery, key
 * custody, module loading, path provisioning, or runtime-state transition.
 */
export class BoundedLinuxRetainedNativeSupervisorServiceOwner {
  #attempted = false;

  constructor(
    private readonly binding: LinuxRetainedNativeSupervisorListenerLifecycleBinding = new DenyLinuxRetainedNativeSupervisorListenerLifecycleBinding(),
    private readonly authority: LinuxRetainedNativeSupervisorServiceAuthority = new DenyLinuxRetainedNativeSupervisorServiceAuthority(),
    private readonly clock: () => number = Date.now,
  ) {
    if (
      binding instanceof DenyLinuxRetainedNativeSupervisorListenerLifecycleBinding ||
      !binding ||
      binding.platform !== 'LINUX' ||
      typeof binding.createOwnedListener !== 'function'
    )
      deny('NOT_CONFIGURED');
  }

  async runRecoveryOne(
    input: unknown,
    peer: RetainedNativeSupervisorRecoveryTransport,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      peer instanceof DenyRetainedNativeSupervisorRecoveryTransport ||
      !peer ||
      typeof peer.exchange !== 'function'
    )
      deny('NOT_CONFIGURED');
    const lifecycle = await this.authorizeOne(input, 'RECOVERY', signal);
    return this.runBounded(lifecycle.grant, signal, (ownedSignal) =>
      lifecycle.owner.runOne(peer, ownedSignal),
    );
  }

  async runSigningOne(
    input: unknown,
    signerKeyId: unknown,
    custodyFactory: LinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyFactory,
    signal: AbortSignal,
  ): Promise<void> {
    let authenticatedSignerKeyId: string;
    try {
      authenticatedSignerKeyId =
        authenticateRetainedNativeSupervisorModuleAuthorizationSignerKeyId(signerKeyId);
    } catch {
      return deny('NOT_CONFIGURED');
    }
    if (
      custodyFactory instanceof
        DenyLinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyFactory ||
      !custodyFactory ||
      custodyFactory.platform !== 'LINUX' ||
      typeof custodyFactory.createOne !== 'function'
    )
      deny('NOT_CONFIGURED');
    const lifecycle = await this.authorizeOne(input, 'MODULE_AUTHORIZATION_SIGNING', signal);
    return this.runBounded(lifecycle.grant, signal, (ownedSignal) =>
      lifecycle.owner.runSigningOne(
        authenticatedSignerKeyId,
        custodyFactory,
        ownedSignal,
        lifecycle.grant.maximumSessionDurationMs,
      ),
    );
  }

  private async authorizeOne(
    input: unknown,
    serviceKind: LinuxRetainedNativeSupervisorServiceKind,
    signal: AbortSignal,
  ): Promise<{
    readonly grant: Readonly<LinuxRetainedNativeSupervisorServiceGrant>;
    readonly owner: BoundedLinuxRetainedNativeSupervisorListenerLifecycle;
  }> {
    if (this.#attempted) deny('EXCHANGE_DENIED');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
    const request = validateLinuxRetainedNativeSupervisorServiceRequest(input);
    if (request.serviceKind !== serviceKind) deny('INVALID_AUTHORIZATION');
    let grant: Readonly<LinuxRetainedNativeSupervisorServiceGrant>;
    try {
      grant = validateGrant(await this.authority.authorize(request));
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError && error.code === 'NOT_CONFIGURED')
        throw error;
      return deny('INVALID_AUTHORIZATION');
    }
    const now = this.validNow();
    const validFrom = Date.parse(grant.validFrom);
    const validUntil = Date.parse(grant.validUntil);
    if (
      !sameRequest(request, grant) ||
      grant.requestHash !== linuxRetainedNativeSupervisorServiceRequestHash(request) ||
      validFrom > now ||
      validUntil <= now ||
      validUntil <= validFrom ||
      validUntil - validFrom > MAX_AUTHORIZATION_LIFETIME_MS ||
      signal.aborted
    )
      deny('INVALID_AUTHORIZATION');
    const parent = identity(grant.socketDirectoryIdentityReference);
    return Object.freeze({
      grant,
      owner: new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(this.binding, {
        schemaVersion: 1,
        platform: 'LINUX',
        socketPath: grant.socketPath,
        parentDevice: parent.device,
        parentInode: parent.inode,
        parentOwnerUid: grant.socketDirectoryOwnerUid,
        parentOwnerGid: grant.socketDirectoryOwnerGid,
        parentMode: 0o700,
        socketOwnerUid: grant.socketDirectoryOwnerUid,
        socketOwnerGid: grant.socketDirectoryOwnerGid,
        socketMode: 0o600,
        expectedWorkerPid: grant.expectedWorkerPid,
        expectedWorkerUid: grant.expectedWorkerUid,
        expectedWorkerGid: grant.expectedWorkerGid,
        listenBacklog: 1,
        runtimeConnection: 'NOT_CONFIGURED',
      }),
    });
  }

  private async runBounded(
    grant: Readonly<LinuxRetainedNativeSupervisorServiceGrant>,
    externalSignal: AbortSignal,
    run: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const startedAt = this.validNow();
    const remainingAuthorizationMs = Date.parse(grant.validUntil) - startedAt;
    if (remainingAuthorizationMs < 1) deny('INVALID_AUTHORIZATION');
    const controller = new AbortController();
    const abort = () => controller.abort();
    externalSignal.addEventListener('abort', abort, { once: true });
    if (externalSignal.aborted) abort();
    const timeoutMs = Math.min(grant.maximumSessionDurationMs, remainingAuthorizationMs);
    const timer = setTimeout(abort, timeoutMs);
    timer.unref?.();
    try {
      await run(controller.signal);
      const completedAt = this.validNow();
      if (
        controller.signal.aborted ||
        completedAt < startedAt ||
        completedAt >= Date.parse(grant.validUntil)
      )
        deny('EXCHANGE_DENIED');
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('EXCHANGE_DENIED');
    } finally {
      clearTimeout(timer);
      externalSignal.removeEventListener('abort', abort);
      controller.abort();
    }
  }

  private validNow(): number {
    const now = this.clock();
    if (!Number.isFinite(now)) deny('INVALID_AUTHORIZATION');
    return now;
  }
}
