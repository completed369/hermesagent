import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs';
import { posix } from 'node:path';
import { arch, getegid, geteuid, platform } from 'node:process';

import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import type { LinuxRetainedNativeSupervisorModuleKind } from './retained-native-supervisor-linux-module-loader';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const LINUX_IDENTITY = /^linux:dev-[a-f0-9]+:ino-[a-f0-9]+$/u;
const SAFE_NATIVE_PATH = /^\/[A-Za-z0-9._/-]+\.node$/u;
const SAFE_SOCKET_PATH = /^\/[A-Za-z0-9._/-]+\.sock$/u;
const SAFE_DIRECTORY_PATH = /^\/[A-Za-z0-9._/-]+$/u;
const MAX_PATH_BYTES = 4_096;
const MAX_SOCKET_PATH_BYTES = 107;
const MAX_MODULE_BYTES = 8 * 1_024 * 1_024;
const MAX_GRANT_LIFETIME_MS = 5 * 60 * 1_000;
const LINUX_O_CLOEXEC = 0o2000000;
const OWNER_ONLY_DIRECTORY_MODE = 0o700;
const OWNER_ONLY_MODULE_MODE = 0o500;

export interface LinuxRetainedNativeSupervisorPathProvisionRequest {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_PATH_PROVISION';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly platform: 'LINUX';
  readonly architecture: 'X64';
  readonly moduleKind: LinuxRetainedNativeSupervisorModuleKind;
  readonly sourceModulePath: string;
  readonly sourceModuleSha256: string;
  readonly sourceModuleIdentityReference: string;
  readonly sourceModuleOwnerUid: number;
  readonly sourceModuleOwnerGid: number;
  readonly sourceModuleMode: number;
  readonly sourceModuleSizeBytes: number;
  readonly parentDirectoryProvisioningId: string;
  readonly parentDirectoryProvisionRequestHash: string;
  readonly parentDirectoryApprovalEvidenceHash: string;
  readonly moduleDirectory: string;
  readonly moduleDirectoryIdentityReference: string;
  readonly canonicalModulePath: string;
  readonly socketDirectoryParent: string;
  readonly socketDirectoryParentIdentityReference: string;
  readonly socketDirectory: string;
  readonly socketDirectoryIdentityReference: string;
  readonly socketPath: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface LinuxRetainedNativeSupervisorPathProvisionGrant extends LinuxRetainedNativeSupervisorPathProvisionRequest {
  readonly provisioningId: string;
  readonly requestHash: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly authorizedByReference: string;
  readonly authorityLevel: 3;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface ProvisionedLinuxRetainedNativeSupervisorPaths {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_PATH_PROVISION';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly platform: 'LINUX';
  readonly architecture: 'X64';
  readonly moduleKind: LinuxRetainedNativeSupervisorModuleKind;
  readonly provisioningId: string;
  readonly requestHash: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly authorizedByReference: string;
  readonly authorityLevel: 3;
  readonly authorizedFrom: string;
  readonly authorizedUntil: string;
  readonly parentDirectoryProvisioningId: string;
  readonly parentDirectoryProvisionRequestHash: string;
  readonly parentDirectoryApprovalEvidenceHash: string;
  readonly canonicalModulePath: string;
  readonly moduleSha256: string;
  readonly moduleIdentityReference: string;
  readonly moduleOwnerUid: number;
  readonly moduleOwnerGid: number;
  readonly moduleMode: 320;
  readonly moduleSizeBytes: number;
  readonly socketDirectory: string;
  readonly socketDirectoryIdentityReference: string;
  readonly socketDirectoryOwnerUid: number;
  readonly socketDirectoryOwnerGid: number;
  readonly socketDirectoryMode: 448;
  readonly socketPath: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface LinuxRetainedNativeSupervisorPathProvisionAuthority {
  authorize(request: Readonly<LinuxRetainedNativeSupervisorPathProvisionRequest>): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorPathProvisionAuthority implements LinuxRetainedNativeSupervisorPathProvisionAuthority {
  async authorize(
    _request: Readonly<LinuxRetainedNativeSupervisorPathProvisionRequest>,
  ): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

export interface LinuxRetainedNativeSupervisorPathProvisionHost {
  readonly platform: 'LINUX';
  readonly architecture: 'X64';
  provision(
    grant: Readonly<LinuxRetainedNativeSupervisorPathProvisionGrant>,
  ): Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths>;
}

export class DenyLinuxRetainedNativeSupervisorPathProvisionHost implements LinuxRetainedNativeSupervisorPathProvisionHost {
  readonly platform = 'LINUX' as const;
  readonly architecture = 'X64' as const;

  provision(_grant: Readonly<LinuxRetainedNativeSupervisorPathProvisionGrant>): never {
    return deny('NOT_CONFIGURED');
  }
}

const REQUEST_KEYS = [
  'architecture',
  'canonicalModulePath',
  'moduleDirectory',
  'moduleDirectoryIdentityReference',
  'moduleKind',
  'ownerGid',
  'ownerUid',
  'parentDirectoryApprovalEvidenceHash',
  'parentDirectoryProvisioningId',
  'parentDirectoryProvisionRequestHash',
  'platform',
  'purpose',
  'runtimeConnection',
  'schemaVersion',
  'socketDirectory',
  'socketDirectoryIdentityReference',
  'socketDirectoryParent',
  'socketDirectoryParentIdentityReference',
  'socketPath',
  'sourceModuleIdentityReference',
  'sourceModuleMode',
  'sourceModuleOwnerGid',
  'sourceModuleOwnerUid',
  'sourceModulePath',
  'sourceModuleSha256',
  'sourceModuleSizeBytes',
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
];
const RESULT_KEYS = [
  'approvalEvidenceHash',
  'approvalId',
  'architecture',
  'authorityLevel',
  'authorizedByReference',
  'authorizedFrom',
  'authorizedUntil',
  'canonicalModulePath',
  'moduleIdentityReference',
  'moduleKind',
  'moduleMode',
  'moduleOwnerGid',
  'moduleOwnerUid',
  'moduleSha256',
  'moduleSizeBytes',
  'parentDirectoryApprovalEvidenceHash',
  'parentDirectoryProvisioningId',
  'parentDirectoryProvisionRequestHash',
  'platform',
  'provisioningId',
  'purpose',
  'requestHash',
  'runtimeConnection',
  'schemaVersion',
  'socketDirectory',
  'socketDirectoryIdentityReference',
  'socketDirectoryMode',
  'socketDirectoryOwnerGid',
  'socketDirectoryOwnerUid',
  'socketPath',
  'supervisorInstanceId',
  'workspaceId',
] as const;

function deny(code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(
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
      actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value'))
    )
      deny(code);
    return record;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny(code);
  }
}

function safeInteger(value: unknown, positive = false, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < (positive ? 1 : 0) ||
    (value as number) > maximum
  )
    deny('INVALID_AUTHORIZATION');
  return value as number;
}

function canonicalPath(value: unknown, pattern: RegExp, maximum = MAX_PATH_BYTES): string {
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..') ||
    Buffer.byteLength(value, 'utf8') > maximum ||
    posix.normalize(value) !== value
  )
    deny('INVALID_AUTHORIZATION');
  return value;
}

function identityReference(value: unknown): string {
  if (typeof value !== 'string' || !LINUX_IDENTITY.test(value)) deny('INVALID_AUTHORIZATION');
  const match = /^linux:dev-([a-f0-9]+):ino-([a-f0-9]+)$/u.exec(value)!;
  const device = Number.parseInt(match[1]!, 16);
  const inode = Number.parseInt(match[2]!, 16);
  if (!Number.isSafeInteger(device) || device < 1 || !Number.isSafeInteger(inode) || inode < 1)
    deny('INVALID_AUTHORIZATION');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') deny('INVALID_AUTHORIZATION');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    deny('INVALID_AUTHORIZATION');
  return value;
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

function validSourceMode(value: unknown): number {
  const mode = safeInteger(value, false, 0o777);
  if ((mode & 0o222) !== 0 || (mode & 0o400) !== 0o400) deny('INVALID_AUTHORIZATION');
  return mode;
}

export function validateLinuxRetainedNativeSupervisorPathProvisionRequest(
  input: unknown,
): Readonly<LinuxRetainedNativeSupervisorPathProvisionRequest> {
  const value = plainRecord(input, REQUEST_KEYS, 'INVALID_AUTHORIZATION');
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_PATH_PROVISION' ||
    value.platform !== 'LINUX' ||
    value.architecture !== 'X64' ||
    (value.moduleKind !== 'CLIENT' && value.moduleKind !== 'LISTENER') ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    typeof value.sourceModuleSha256 !== 'string' ||
    !SHA256.test(value.sourceModuleSha256)
  )
    deny('INVALID_AUTHORIZATION');
  const sourceModulePath = canonicalPath(value.sourceModulePath, SAFE_NATIVE_PATH);
  const moduleDirectory = canonicalPath(value.moduleDirectory, SAFE_DIRECTORY_PATH);
  const canonicalModulePath = canonicalPath(value.canonicalModulePath, SAFE_NATIVE_PATH);
  const socketDirectoryParent = canonicalPath(value.socketDirectoryParent, SAFE_DIRECTORY_PATH);
  const socketDirectory = canonicalPath(value.socketDirectory, SAFE_DIRECTORY_PATH);
  const socketPath = canonicalPath(value.socketPath, SAFE_SOCKET_PATH, MAX_SOCKET_PATH_BYTES);
  if (
    posix.dirname(canonicalModulePath) !== moduleDirectory ||
    posix.dirname(socketDirectory) !== socketDirectoryParent ||
    posix.dirname(socketPath) !== socketDirectory ||
    sourceModulePath === canonicalModulePath ||
    moduleDirectory === '/' ||
    socketDirectoryParent === '/' ||
    posix.basename(canonicalModulePath) !== `${value.moduleKind.toLowerCase()}.node`
  )
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_PATH_PROVISION',
    workspaceId: reference(value.workspaceId),
    supervisorInstanceId: reference(value.supervisorInstanceId),
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: value.moduleKind,
    sourceModulePath,
    sourceModuleSha256: value.sourceModuleSha256,
    sourceModuleIdentityReference: identityReference(value.sourceModuleIdentityReference),
    sourceModuleOwnerUid: safeInteger(value.sourceModuleOwnerUid),
    sourceModuleOwnerGid: safeInteger(value.sourceModuleOwnerGid),
    sourceModuleMode: validSourceMode(value.sourceModuleMode),
    sourceModuleSizeBytes: safeInteger(value.sourceModuleSizeBytes, true, MAX_MODULE_BYTES),
    parentDirectoryProvisioningId: reference(value.parentDirectoryProvisioningId),
    parentDirectoryProvisionRequestHash: digest(value.parentDirectoryProvisionRequestHash),
    parentDirectoryApprovalEvidenceHash: digest(value.parentDirectoryApprovalEvidenceHash),
    moduleDirectory,
    moduleDirectoryIdentityReference: identityReference(value.moduleDirectoryIdentityReference),
    canonicalModulePath,
    socketDirectoryParent,
    socketDirectoryParentIdentityReference: identityReference(
      value.socketDirectoryParentIdentityReference,
    ),
    socketDirectory,
    socketDirectoryIdentityReference: identityReference(value.socketDirectoryIdentityReference),
    socketPath,
    ownerUid: safeInteger(value.ownerUid),
    ownerGid: safeInteger(value.ownerGid),
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

export function linuxRetainedNativeSupervisorPathProvisionRequestHash(
  request: Readonly<LinuxRetainedNativeSupervisorPathProvisionRequest>,
): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

function validateGrant(input: unknown): Readonly<LinuxRetainedNativeSupervisorPathProvisionGrant> {
  const value = plainRecord(input, GRANT_KEYS, 'INVALID_AUTHORIZATION');
  const request = validateLinuxRetainedNativeSupervisorPathProvisionRequest(
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
  request: Readonly<LinuxRetainedNativeSupervisorPathProvisionRequest>,
  grant: Readonly<LinuxRetainedNativeSupervisorPathProvisionGrant>,
): boolean {
  return REQUEST_KEYS.every((key) => request[key] === grant[key]);
}

function validateFreshGrant(
  grant: Readonly<LinuxRetainedNativeSupervisorPathProvisionGrant>,
  now: number,
): void {
  const validFrom = Date.parse(grant.validFrom);
  const validUntil = Date.parse(grant.validUntil);
  if (
    !Number.isFinite(now) ||
    validFrom > now ||
    validUntil <= now ||
    validUntil <= validFrom ||
    validUntil - validFrom > MAX_GRANT_LIFETIME_MS
  )
    deny('INVALID_AUTHORIZATION');
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
  if (descriptor !== undefined) {
    try {
      closeSync(descriptor);
    } catch {
      // The primary fail-closed result must not disclose close details.
    }
  }
}

function removeCreatedModuleIfRetained(
  parentDescriptor: number,
  name: string,
  createdDescriptor: number | undefined,
): void {
  if (createdDescriptor === undefined) return;
  try {
    const created = fstatSync(createdDescriptor, { bigint: true });
    const path = `/proc/self/fd/${parentDescriptor}/${name}`;
    const observed = lstatSync(path, { bigint: true });
    if (!sameIdentity(created, observed)) return;
    unlinkSync(path);
  } catch {
    // Leave an inert owner-only path rather than broaden cleanup authority.
  }
}

class RetainedDescriptorLinuxNativeSupervisorPathProvisionHost implements LinuxRetainedNativeSupervisorPathProvisionHost {
  readonly platform = 'LINUX' as const;
  readonly architecture = 'X64' as const;

  constructor() {
    if (platform !== 'linux' || arch !== 'x64') deny('NOT_CONFIGURED');
    Object.freeze(this);
  }

  provision(
    grant: Readonly<LinuxRetainedNativeSupervisorPathProvisionGrant>,
  ): Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths> {
    let sourceDescriptor: number | undefined;
    let moduleParentDescriptor: number | undefined;
    let socketParentDescriptor: number | undefined;
    let moduleDescriptor: number | undefined;
    let socketDirectoryDescriptor: number | undefined;
    let bytes: Buffer | undefined;
    let createdModule = false;
    try {
      if (
        typeof geteuid !== 'function' ||
        typeof getegid !== 'function' ||
        geteuid() !== grant.ownerUid ||
        getegid() !== grant.ownerGid
      )
        deny('INVALID_ATTESTATION');
      sourceDescriptor = openSync(
        grant.sourceModulePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const sourceStat = fstatSync(sourceDescriptor, { bigint: true });
      if (
        !sourceStat.isFile() ||
        identity(sourceStat) !== grant.sourceModuleIdentityReference ||
        Number(sourceStat.uid) !== grant.sourceModuleOwnerUid ||
        Number(sourceStat.gid) !== grant.sourceModuleOwnerGid ||
        mode(sourceStat) !== grant.sourceModuleMode ||
        sourceStat.size !== BigInt(grant.sourceModuleSizeBytes)
      )
        deny('INVALID_ATTESTATION');
      bytes = readFileSync(sourceDescriptor);
      if (createHash('sha256').update(bytes).digest('hex') !== grant.sourceModuleSha256)
        deny('INVALID_ATTESTATION');
      const sourceStatAfterRead = fstatSync(sourceDescriptor, { bigint: true });
      if (
        !sameIdentity(sourceStat, sourceStatAfterRead) ||
        Number(sourceStatAfterRead.uid) !== grant.sourceModuleOwnerUid ||
        Number(sourceStatAfterRead.gid) !== grant.sourceModuleOwnerGid ||
        mode(sourceStatAfterRead) !== grant.sourceModuleMode ||
        sourceStatAfterRead.size !== BigInt(grant.sourceModuleSizeBytes)
      )
        deny('INVALID_ATTESTATION');

      moduleParentDescriptor = openSync(
        grant.moduleDirectory,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const moduleParentStat = verifyOwnedDirectory(
        moduleParentDescriptor,
        grant.ownerUid,
        grant.ownerGid,
      );
      if (identity(moduleParentStat) !== grant.moduleDirectoryIdentityReference)
        deny('INVALID_ATTESTATION');
      socketParentDescriptor = openSync(
        grant.socketDirectoryParent,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const socketParentStat = verifyOwnedDirectory(
        socketParentDescriptor,
        grant.ownerUid,
        grant.ownerGid,
      );
      if (identity(socketParentStat) !== grant.socketDirectoryParentIdentityReference)
        deny('INVALID_ATTESTATION');

      const moduleAtParent = `/proc/self/fd/${moduleParentDescriptor}/${posix.basename(grant.canonicalModulePath)}`;
      moduleDescriptor = openSync(
        moduleAtParent,
        fsConstants.O_RDWR |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          fsConstants.O_NOFOLLOW |
          LINUX_O_CLOEXEC,
        OWNER_ONLY_MODULE_MODE,
      );
      createdModule = true;
      writeFileSync(moduleDescriptor, bytes);
      fsyncSync(moduleDescriptor);
      fchmodSync(moduleDescriptor, OWNER_ONLY_MODULE_MODE);
      const moduleStat = fstatSync(moduleDescriptor, { bigint: true });
      if (
        !moduleStat.isFile() ||
        Number(moduleStat.uid) !== grant.ownerUid ||
        Number(moduleStat.gid) !== grant.ownerGid ||
        mode(moduleStat) !== OWNER_ONLY_MODULE_MODE ||
        moduleStat.size !== BigInt(grant.sourceModuleSizeBytes)
      )
        deny('INVALID_ATTESTATION');

      const socketDirectoryAtParent = `/proc/self/fd/${socketParentDescriptor}/${posix.basename(grant.socketDirectory)}`;
      socketDirectoryDescriptor = openSync(
        socketDirectoryAtParent,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const socketDirectoryStat = verifyOwnedDirectory(
        socketDirectoryDescriptor,
        grant.ownerUid,
        grant.ownerGid,
      );
      if (identity(socketDirectoryStat) !== grant.socketDirectoryIdentityReference)
        deny('INVALID_ATTESTATION');

      const reopenedModuleParent = lstatSync(grant.moduleDirectory, { bigint: true });
      const reopenedSocketParent = lstatSync(grant.socketDirectoryParent, { bigint: true });
      const reopenedModule = lstatSync(grant.canonicalModulePath, { bigint: true });
      const reopenedSocketDirectory = lstatSync(grant.socketDirectory, { bigint: true });
      if (
        !sameIdentity(moduleParentStat, reopenedModuleParent) ||
        !sameIdentity(socketParentStat, reopenedSocketParent) ||
        !sameIdentity(moduleStat, reopenedModule) ||
        !sameIdentity(socketDirectoryStat, reopenedSocketDirectory)
      )
        deny('INVALID_ATTESTATION');
      try {
        lstatSync(grant.socketPath);
        deny('INVALID_ATTESTATION');
      } catch (error) {
        if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') deny('INVALID_ATTESTATION');
      }
      const installedBytes = readFileSync(`/proc/self/fd/${moduleDescriptor}`);
      let moduleSha256: string;
      try {
        moduleSha256 = createHash('sha256').update(installedBytes).digest('hex');
      } finally {
        installedBytes.fill(0);
      }
      if (moduleSha256 !== grant.sourceModuleSha256) deny('INVALID_ATTESTATION');
      return Object.freeze({
        schemaVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_PATH_PROVISION',
        workspaceId: grant.workspaceId,
        supervisorInstanceId: grant.supervisorInstanceId,
        platform: 'LINUX',
        architecture: 'X64',
        moduleKind: grant.moduleKind,
        provisioningId: grant.provisioningId,
        requestHash: grant.requestHash,
        approvalId: grant.approvalId,
        approvalEvidenceHash: grant.approvalEvidenceHash,
        authorizedByReference: grant.authorizedByReference,
        authorityLevel: 3,
        authorizedFrom: grant.validFrom,
        authorizedUntil: grant.validUntil,
        parentDirectoryProvisioningId: grant.parentDirectoryProvisioningId,
        parentDirectoryProvisionRequestHash: grant.parentDirectoryProvisionRequestHash,
        parentDirectoryApprovalEvidenceHash: grant.parentDirectoryApprovalEvidenceHash,
        canonicalModulePath: grant.canonicalModulePath,
        moduleSha256,
        moduleIdentityReference: identity(moduleStat),
        moduleOwnerUid: Number(moduleStat.uid),
        moduleOwnerGid: Number(moduleStat.gid),
        moduleMode: OWNER_ONLY_MODULE_MODE,
        moduleSizeBytes: Number(moduleStat.size),
        socketDirectory: grant.socketDirectory,
        socketDirectoryIdentityReference: identity(socketDirectoryStat),
        socketDirectoryOwnerUid: Number(socketDirectoryStat.uid),
        socketDirectoryOwnerGid: Number(socketDirectoryStat.gid),
        socketDirectoryMode: OWNER_ONLY_DIRECTORY_MODE,
        socketPath: grant.socketPath,
        runtimeConnection: 'NOT_CONFIGURED',
      });
    } catch (error) {
      if (createdModule && moduleParentDescriptor !== undefined) {
        removeCreatedModuleIfRetained(
          moduleParentDescriptor,
          posix.basename(grant.canonicalModulePath),
          moduleDescriptor,
        );
      }
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_ATTESTATION');
    } finally {
      bytes?.fill(0);
      safeClose(socketDirectoryDescriptor);
      safeClose(moduleDescriptor);
      safeClose(socketParentDescriptor);
      safeClose(moduleParentDescriptor);
      safeClose(sourceDescriptor);
    }
  }
}

function validateResult(
  input: unknown,
  grant: Readonly<LinuxRetainedNativeSupervisorPathProvisionGrant>,
): Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths> {
  const value = plainRecord(input, RESULT_KEYS, 'INVALID_ATTESTATION');
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== grant.purpose ||
    value.workspaceId !== grant.workspaceId ||
    value.supervisorInstanceId !== grant.supervisorInstanceId ||
    value.platform !== 'LINUX' ||
    value.architecture !== 'X64' ||
    value.moduleKind !== grant.moduleKind ||
    value.provisioningId !== grant.provisioningId ||
    value.requestHash !== grant.requestHash ||
    value.approvalId !== grant.approvalId ||
    value.approvalEvidenceHash !== grant.approvalEvidenceHash ||
    value.authorizedByReference !== grant.authorizedByReference ||
    value.authorityLevel !== 3 ||
    value.authorizedFrom !== grant.validFrom ||
    value.authorizedUntil !== grant.validUntil ||
    value.parentDirectoryProvisioningId !== grant.parentDirectoryProvisioningId ||
    value.parentDirectoryProvisionRequestHash !== grant.parentDirectoryProvisionRequestHash ||
    value.parentDirectoryApprovalEvidenceHash !== grant.parentDirectoryApprovalEvidenceHash ||
    value.canonicalModulePath !== grant.canonicalModulePath ||
    value.moduleSha256 !== grant.sourceModuleSha256 ||
    value.moduleOwnerUid !== grant.ownerUid ||
    value.moduleOwnerGid !== grant.ownerGid ||
    value.moduleMode !== OWNER_ONLY_MODULE_MODE ||
    value.moduleSizeBytes !== grant.sourceModuleSizeBytes ||
    value.socketDirectory !== grant.socketDirectory ||
    value.socketDirectoryIdentityReference !== grant.socketDirectoryIdentityReference ||
    value.socketDirectoryOwnerUid !== grant.ownerUid ||
    value.socketDirectoryOwnerGid !== grant.ownerGid ||
    value.socketDirectoryMode !== OWNER_ONLY_DIRECTORY_MODE ||
    value.socketPath !== grant.socketPath ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    typeof value.moduleIdentityReference !== 'string' ||
    !LINUX_IDENTITY.test(value.moduleIdentityReference) ||
    typeof value.socketDirectoryIdentityReference !== 'string' ||
    !LINUX_IDENTITY.test(value.socketDirectoryIdentityReference)
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze(value) as unknown as Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths>;
}

export class BoundedLinuxRetainedNativeSupervisorPathProvisioner {
  #attempted = false;

  constructor(
    private readonly authority: LinuxRetainedNativeSupervisorPathProvisionAuthority = new DenyLinuxRetainedNativeSupervisorPathProvisionAuthority(),
    private readonly host: LinuxRetainedNativeSupervisorPathProvisionHost = new DenyLinuxRetainedNativeSupervisorPathProvisionHost(),
    private readonly clock: () => number = Date.now,
  ) {
    if (host.platform !== 'LINUX' || host.architecture !== 'X64') deny('NOT_CONFIGURED');
  }

  async provision(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('INVALID_AUTHORIZATION');
    const request = validateLinuxRetainedNativeSupervisorPathProvisionRequest(input);
    let grant: Readonly<LinuxRetainedNativeSupervisorPathProvisionGrant>;
    try {
      grant = validateGrant(await this.authority.authorize(request));
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError && error.code === 'NOT_CONFIGURED')
        throw error;
      return deny('INVALID_AUTHORIZATION');
    }
    const before = this.clock();
    validateFreshGrant(grant, before);
    if (
      !sameRequest(request, grant) ||
      grant.requestHash !== linuxRetainedNativeSupervisorPathProvisionRequestHash(request) ||
      signal.aborted
    )
      deny('INVALID_AUTHORIZATION');
    const beforeProvision = this.clock();
    if (beforeProvision < before || signal.aborted) deny('INVALID_AUTHORIZATION');
    validateFreshGrant(grant, beforeProvision);
    try {
      return validateResult(this.host.provision(grant), grant);
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_ATTESTATION');
    }
  }
}

/** Creates an uncomposed Linux host. The caller must supply explicit bounded authority. */
export function createRetainedDescriptorLinuxNativeSupervisorPathProvisioner(
  authority: LinuxRetainedNativeSupervisorPathProvisionAuthority,
  clock: () => number = Date.now,
): BoundedLinuxRetainedNativeSupervisorPathProvisioner {
  return new BoundedLinuxRetainedNativeSupervisorPathProvisioner(
    authority,
    new RetainedDescriptorLinuxNativeSupervisorPathProvisionHost(),
    clock,
  );
}
