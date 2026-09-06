import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmdirSync,
  type BigIntStats,
} from 'node:fs';
import { posix } from 'node:path';
import { arch, getegid, geteuid, platform } from 'node:process';

import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const LINUX_IDENTITY = /^linux:dev-[a-f0-9]+:ino-[a-f0-9]+$/u;
const SAFE_DIRECTORY_PATH = /^\/[A-Za-z0-9._/-]+$/u;
const MAX_PATH_BYTES = 4_096;
const MAX_GRANT_LIFETIME_MS = 5 * 60 * 1_000;
const LINUX_O_CLOEXEC = 0o2000000;
const OWNER_ONLY_DIRECTORY_MODE = 0o700;

export interface LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_PARENT_DIRECTORIES_PROVISION';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly platform: 'LINUX';
  readonly architecture: 'X64';
  readonly runtimeRoot: string;
  readonly runtimeRootIdentityReference: string;
  readonly runtimeRootProvisioningId: string;
  readonly runtimeRootProvisionRequestHash: string;
  readonly runtimeRootApprovalEvidenceHash: string;
  readonly runtimeRootOwnerUid: number;
  readonly runtimeRootOwnerGid: number;
  readonly runtimeRootMode: 448;
  readonly moduleDirectory: string;
  readonly socketDirectoryParent: string;
  readonly socketDirectory: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant extends LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest {
  readonly provisioningId: string;
  readonly requestHash: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly authorizedByReference: string;
  readonly authorityLevel: 3;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface ProvisionedLinuxRetainedNativeSupervisorParentDirectories {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_PARENT_DIRECTORIES_PROVISION';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly platform: 'LINUX';
  readonly architecture: 'X64';
  readonly provisioningId: string;
  readonly requestHash: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly authorizedByReference: string;
  readonly authorityLevel: 3;
  readonly authorizedFrom: string;
  readonly authorizedUntil: string;
  readonly moduleDirectory: string;
  readonly moduleDirectoryIdentityReference: string;
  readonly socketDirectoryParent: string;
  readonly socketDirectoryParentIdentityReference: string;
  readonly socketDirectory: string;
  readonly socketDirectoryIdentityReference: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly directoryMode: 448;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface LinuxRetainedNativeSupervisorParentDirectoryProvisionAuthority {
  authorize(
    request: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest>,
  ): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorParentDirectoryProvisionAuthority implements LinuxRetainedNativeSupervisorParentDirectoryProvisionAuthority {
  async authorize(
    _request: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest>,
  ): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

export interface LinuxRetainedNativeSupervisorParentDirectoryProvisionHost {
  readonly platform: 'LINUX';
  readonly architecture: 'X64';
  provision(
    grant: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant>,
  ): Readonly<ProvisionedLinuxRetainedNativeSupervisorParentDirectories>;
}

export class DenyLinuxRetainedNativeSupervisorParentDirectoryProvisionHost implements LinuxRetainedNativeSupervisorParentDirectoryProvisionHost {
  readonly platform = 'LINUX' as const;
  readonly architecture = 'X64' as const;

  provision(_grant: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant>): never {
    return deny('NOT_CONFIGURED');
  }
}

const REQUEST_KEYS = [
  'architecture',
  'moduleDirectory',
  'ownerGid',
  'ownerUid',
  'platform',
  'purpose',
  'runtimeConnection',
  'runtimeRoot',
  'runtimeRootApprovalEvidenceHash',
  'runtimeRootIdentityReference',
  'runtimeRootProvisioningId',
  'runtimeRootProvisionRequestHash',
  'runtimeRootMode',
  'runtimeRootOwnerGid',
  'runtimeRootOwnerUid',
  'schemaVersion',
  'socketDirectoryParent',
  'socketDirectory',
  'supervisorInstanceId',
  'workspaceId',
] as const;
const GRANT_KEYS = [
  ...REQUEST_KEYS,
  'approvalEvidenceHash',
  'approvalId',
  'authorityLevel',
  'authorizedByReference',
  'provisioningId',
  'requestHash',
  'validFrom',
  'validUntil',
] as const;
const RESULT_KEYS = [
  'approvalEvidenceHash',
  'approvalId',
  'architecture',
  'authorityLevel',
  'authorizedByReference',
  'authorizedFrom',
  'authorizedUntil',
  'directoryMode',
  'moduleDirectory',
  'moduleDirectoryIdentityReference',
  'ownerGid',
  'ownerUid',
  'platform',
  'provisioningId',
  'purpose',
  'requestHash',
  'runtimeConnection',
  'schemaVersion',
  'socketDirectoryParent',
  'socketDirectoryParentIdentityReference',
  'socketDirectory',
  'socketDirectoryIdentityReference',
  'supervisorInstanceId',
  'workspaceId',
] as const;

function deny(code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(input: unknown, expected: readonly string[]): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
      deny('INVALID_AUTHORIZATION');
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) deny('INVALID_AUTHORIZATION');
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
      deny('INVALID_AUTHORIZATION');
    return value;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_AUTHORIZATION');
  }
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value))
    deny('INVALID_AUTHORIZATION');
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

function timestamp(value: unknown): string {
  if (typeof value !== 'string') deny('INVALID_AUTHORIZATION');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
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
    Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES ||
    posix.normalize(value) !== value
  )
    deny('INVALID_AUTHORIZATION');
  return value;
}

function positiveIdentityReference(value: unknown): value is string {
  if (typeof value !== 'string' || !LINUX_IDENTITY.test(value)) return false;
  const match = /^linux:dev-([a-f0-9]+):ino-([a-f0-9]+)$/u.exec(value)!;
  const device = Number.parseInt(match[1]!, 16);
  const inode = Number.parseInt(match[2]!, 16);
  return Number.isSafeInteger(device) && device >= 1 && Number.isSafeInteger(inode) && inode >= 1;
}

function identityReference(value: unknown): string {
  if (!positiveIdentityReference(value)) deny('INVALID_AUTHORIZATION');
  return value;
}

export function validateLinuxRetainedNativeSupervisorParentDirectoryProvisionRequest(
  input: unknown,
): Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest> {
  const value = plainRecord(input, REQUEST_KEYS);
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_PARENT_DIRECTORIES_PROVISION' ||
    value.platform !== 'LINUX' ||
    value.architecture !== 'X64' ||
    value.runtimeRootMode !== OWNER_ONLY_DIRECTORY_MODE ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    deny('INVALID_AUTHORIZATION');
  const runtimeRoot = directoryPath(value.runtimeRoot);
  const moduleDirectory = directoryPath(value.moduleDirectory);
  const socketDirectoryParent = directoryPath(value.socketDirectoryParent);
  const socketDirectory = directoryPath(value.socketDirectory);
  if (
    moduleDirectory !== posix.join(runtimeRoot, 'native') ||
    socketDirectoryParent !== posix.join(runtimeRoot, 'run') ||
    socketDirectory !== posix.join(socketDirectoryParent, 'supervisor') ||
    value.runtimeRootOwnerUid !== value.ownerUid ||
    value.runtimeRootOwnerGid !== value.ownerGid
  )
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_PARENT_DIRECTORIES_PROVISION',
    workspaceId: reference(value.workspaceId),
    supervisorInstanceId: reference(value.supervisorInstanceId),
    platform: 'LINUX',
    architecture: 'X64',
    runtimeRoot,
    runtimeRootIdentityReference: identityReference(value.runtimeRootIdentityReference),
    runtimeRootProvisioningId: reference(value.runtimeRootProvisioningId),
    runtimeRootProvisionRequestHash: digest(value.runtimeRootProvisionRequestHash),
    runtimeRootApprovalEvidenceHash: digest(value.runtimeRootApprovalEvidenceHash),
    runtimeRootOwnerUid: nonnegative(value.runtimeRootOwnerUid),
    runtimeRootOwnerGid: nonnegative(value.runtimeRootOwnerGid),
    runtimeRootMode: OWNER_ONLY_DIRECTORY_MODE,
    moduleDirectory,
    socketDirectoryParent,
    socketDirectory,
    ownerUid: nonnegative(value.ownerUid),
    ownerGid: nonnegative(value.ownerGid),
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

export function linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash(
  request: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest>,
): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

function validateGrant(
  input: unknown,
): Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant> {
  const value = plainRecord(input, GRANT_KEYS);
  const request = validateLinuxRetainedNativeSupervisorParentDirectoryProvisionRequest(
    Object.fromEntries(REQUEST_KEYS.map((key) => [key, value[key]])),
  );
  return Object.freeze({
    ...request,
    provisioningId: reference(value.provisioningId),
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
  request: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest>,
  grant: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant>,
): boolean {
  return REQUEST_KEYS.every((key) => request[key] === grant[key]);
}

function validateResult(
  input: unknown,
  grant: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant>,
): Readonly<ProvisionedLinuxRetainedNativeSupervisorParentDirectories> {
  let value: Record<string, unknown>;
  try {
    value = plainRecord(input, RESULT_KEYS);
  } catch {
    return deny('INVALID_ATTESTATION');
  }
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== grant.purpose ||
    value.workspaceId !== grant.workspaceId ||
    value.supervisorInstanceId !== grant.supervisorInstanceId ||
    value.platform !== 'LINUX' ||
    value.architecture !== 'X64' ||
    value.provisioningId !== grant.provisioningId ||
    value.requestHash !== grant.requestHash ||
    value.approvalId !== grant.approvalId ||
    value.approvalEvidenceHash !== grant.approvalEvidenceHash ||
    value.authorizedByReference !== grant.authorizedByReference ||
    value.authorityLevel !== 3 ||
    value.authorizedFrom !== grant.validFrom ||
    value.authorizedUntil !== grant.validUntil ||
    value.moduleDirectory !== grant.moduleDirectory ||
    value.socketDirectoryParent !== grant.socketDirectoryParent ||
    value.socketDirectory !== grant.socketDirectory ||
    value.ownerUid !== grant.ownerUid ||
    value.ownerGid !== grant.ownerGid ||
    value.directoryMode !== OWNER_ONLY_DIRECTORY_MODE ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    !positiveIdentityReference(value.moduleDirectoryIdentityReference) ||
    !positiveIdentityReference(value.socketDirectoryParentIdentityReference) ||
    !positiveIdentityReference(value.socketDirectoryIdentityReference)
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze(
    value,
  ) as unknown as Readonly<ProvisionedLinuxRetainedNativeSupervisorParentDirectories>;
}

function identity(stat: { readonly dev: bigint; readonly ino: bigint }): string {
  return `linux:dev-${stat.dev.toString(16)}:ino-${stat.ino.toString(16)}`;
}

function mode(stat: { readonly mode: bigint }): number {
  return Number(stat.mode & 0o7777n);
}

function sameIdentity(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function verifyOwnedDirectory(descriptor: number, ownerUid: number, ownerGid: number): BigIntStats {
  const stat = fstatSync(descriptor, { bigint: true });
  if (
    !stat.isDirectory() ||
    Number(stat.uid) !== ownerUid ||
    Number(stat.gid) !== ownerGid ||
    mode(stat) !== OWNER_ONLY_DIRECTORY_MODE
  )
    deny('INVALID_ATTESTATION');
  return stat;
}

function safeClose(descriptor: number | undefined): void {
  if (descriptor === undefined) return;
  try {
    closeSync(descriptor);
  } catch {
    // Preserve the primary fail-closed result.
  }
}

function removeCreatedDirectoryIfRetained(
  rootDescriptor: number,
  name: string,
  createdDescriptor: number | undefined,
): void {
  if (createdDescriptor === undefined) return;
  try {
    const created = fstatSync(createdDescriptor, { bigint: true });
    const path = `/proc/self/fd/${rootDescriptor}/${name}`;
    const observed = lstatSync(path, { bigint: true });
    if (sameIdentity(created, observed)) rmdirSync(path);
  } catch {
    // Never broaden cleanup beyond the retained empty directory.
  }
}

class RetainedDescriptorLinuxParentDirectoryProvisionHost implements LinuxRetainedNativeSupervisorParentDirectoryProvisionHost {
  readonly platform = 'LINUX' as const;
  readonly architecture = 'X64' as const;

  constructor() {
    if (platform !== 'linux' || arch !== 'x64') deny('NOT_CONFIGURED');
    Object.freeze(this);
  }

  provision(
    grant: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant>,
  ): Readonly<ProvisionedLinuxRetainedNativeSupervisorParentDirectories> {
    let rootDescriptor: number | undefined;
    let moduleDescriptor: number | undefined;
    let socketParentDescriptor: number | undefined;
    let socketDirectoryDescriptor: number | undefined;
    let createdModule = false;
    let createdSocketParent = false;
    let createdSocketDirectory = false;
    try {
      if (
        typeof geteuid !== 'function' ||
        typeof getegid !== 'function' ||
        geteuid() !== grant.ownerUid ||
        getegid() !== grant.ownerGid ||
        grant.runtimeRootOwnerUid !== grant.ownerUid ||
        grant.runtimeRootOwnerGid !== grant.ownerGid
      )
        deny('INVALID_ATTESTATION');
      rootDescriptor = openSync(
        grant.runtimeRoot,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const rootStat = verifyOwnedDirectory(rootDescriptor, grant.ownerUid, grant.ownerGid);
      if (identity(rootStat) !== grant.runtimeRootIdentityReference) deny('INVALID_ATTESTATION');

      const moduleAtRoot = `/proc/self/fd/${rootDescriptor}/native`;
      mkdirSync(moduleAtRoot, { mode: OWNER_ONLY_DIRECTORY_MODE });
      createdModule = true;
      moduleDescriptor = openSync(
        moduleAtRoot,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const moduleStat = verifyOwnedDirectory(moduleDescriptor, grant.ownerUid, grant.ownerGid);

      const socketParentAtRoot = `/proc/self/fd/${rootDescriptor}/run`;
      mkdirSync(socketParentAtRoot, { mode: OWNER_ONLY_DIRECTORY_MODE });
      createdSocketParent = true;
      socketParentDescriptor = openSync(
        socketParentAtRoot,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const socketParentStat = verifyOwnedDirectory(
        socketParentDescriptor,
        grant.ownerUid,
        grant.ownerGid,
      );

      const socketDirectoryAtParent = `/proc/self/fd/${socketParentDescriptor}/supervisor`;
      mkdirSync(socketDirectoryAtParent, { mode: OWNER_ONLY_DIRECTORY_MODE });
      createdSocketDirectory = true;
      socketDirectoryDescriptor = openSync(
        socketDirectoryAtParent,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const socketDirectoryStat = verifyOwnedDirectory(
        socketDirectoryDescriptor,
        grant.ownerUid,
        grant.ownerGid,
      );

      const reopenedRoot = lstatSync(grant.runtimeRoot, { bigint: true });
      const reopenedModule = lstatSync(grant.moduleDirectory, { bigint: true });
      const reopenedSocketParent = lstatSync(grant.socketDirectoryParent, { bigint: true });
      const reopenedSocketDirectory = lstatSync(grant.socketDirectory, { bigint: true });
      if (
        !sameIdentity(rootStat, reopenedRoot) ||
        !sameIdentity(moduleStat, reopenedModule) ||
        !sameIdentity(socketParentStat, reopenedSocketParent) ||
        !sameIdentity(socketDirectoryStat, reopenedSocketDirectory)
      )
        deny('INVALID_ATTESTATION');
      return Object.freeze({
        schemaVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_PARENT_DIRECTORIES_PROVISION',
        workspaceId: grant.workspaceId,
        supervisorInstanceId: grant.supervisorInstanceId,
        platform: 'LINUX',
        architecture: 'X64',
        provisioningId: grant.provisioningId,
        requestHash: grant.requestHash,
        approvalId: grant.approvalId,
        approvalEvidenceHash: grant.approvalEvidenceHash,
        authorizedByReference: grant.authorizedByReference,
        authorityLevel: 3,
        authorizedFrom: grant.validFrom,
        authorizedUntil: grant.validUntil,
        moduleDirectory: grant.moduleDirectory,
        moduleDirectoryIdentityReference: identity(moduleStat),
        socketDirectoryParent: grant.socketDirectoryParent,
        socketDirectoryParentIdentityReference: identity(socketParentStat),
        socketDirectory: grant.socketDirectory,
        socketDirectoryIdentityReference: identity(socketDirectoryStat),
        ownerUid: grant.ownerUid,
        ownerGid: grant.ownerGid,
        directoryMode: OWNER_ONLY_DIRECTORY_MODE,
        runtimeConnection: 'NOT_CONFIGURED',
      });
    } catch (error) {
      if (createdSocketDirectory && socketParentDescriptor !== undefined)
        removeCreatedDirectoryIfRetained(
          socketParentDescriptor,
          'supervisor',
          socketDirectoryDescriptor,
        );
      if (createdSocketParent && rootDescriptor !== undefined)
        removeCreatedDirectoryIfRetained(rootDescriptor, 'run', socketParentDescriptor);
      if (createdModule && rootDescriptor !== undefined)
        removeCreatedDirectoryIfRetained(rootDescriptor, 'native', moduleDescriptor);
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_ATTESTATION');
    } finally {
      safeClose(socketDirectoryDescriptor);
      safeClose(socketParentDescriptor);
      safeClose(moduleDescriptor);
      safeClose(rootDescriptor);
    }
  }
}

export function createRetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner(
  authority: LinuxRetainedNativeSupervisorParentDirectoryProvisionAuthority = new DenyLinuxRetainedNativeSupervisorParentDirectoryProvisionAuthority(),
  clock: () => number = Date.now,
): BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner {
  return new BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner(
    authority,
    new RetainedDescriptorLinuxParentDirectoryProvisionHost(),
    clock,
  );
}

/** Creates only the fixed native/run/supervisor hierarchy under one retained owner-only root. */
export class BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner {
  #attempted = false;

  constructor(
    private readonly authority: LinuxRetainedNativeSupervisorParentDirectoryProvisionAuthority = new DenyLinuxRetainedNativeSupervisorParentDirectoryProvisionAuthority(),
    private readonly host: LinuxRetainedNativeSupervisorParentDirectoryProvisionHost = new DenyLinuxRetainedNativeSupervisorParentDirectoryProvisionHost(),
    private readonly clock: () => number = Date.now,
  ) {
    if (
      !host ||
      host instanceof DenyLinuxRetainedNativeSupervisorParentDirectoryProvisionHost ||
      host.platform !== 'LINUX' ||
      host.architecture !== 'X64' ||
      typeof host.provision !== 'function'
    )
      deny('NOT_CONFIGURED');
  }

  async provision(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<ProvisionedLinuxRetainedNativeSupervisorParentDirectories>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('INVALID_AUTHORIZATION');
    const request = validateLinuxRetainedNativeSupervisorParentDirectoryProvisionRequest(input);
    let grant: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant>;
    try {
      grant = validateGrant(await this.authority.authorize(request));
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError && error.code === 'NOT_CONFIGURED')
        throw error;
      return deny('INVALID_AUTHORIZATION');
    }
    const now = this.clock();
    const validFrom = Date.parse(grant.validFrom);
    const validUntil = Date.parse(grant.validUntil);
    if (
      !Number.isFinite(now) ||
      !Number.isSafeInteger(now) ||
      !sameRequest(request, grant) ||
      grant.requestHash !==
        linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash(request) ||
      validFrom > now ||
      validUntil <= now ||
      validUntil <= validFrom ||
      validUntil - validFrom > MAX_GRANT_LIFETIME_MS ||
      signal.aborted
    )
      deny('INVALID_AUTHORIZATION');
    try {
      return validateResult(this.host.provision(grant), grant);
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_ATTESTATION');
    }
  }
}
