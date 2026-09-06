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
const SAFE_ATTEMPT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const LINUX_IDENTITY = /^linux:dev-([a-f0-9]+):ino-([a-f0-9]+)$/u;
const SAFE_DIRECTORY_PATH = /^\/[A-Za-z0-9._/-]+$/u;
const MAX_PATH_BYTES = 4_096;
const MAX_GRANT_LIFETIME_MS = 5 * 60 * 1_000;
const LINUX_O_CLOEXEC = 0o2000000;
const OWNER_ONLY_DIRECTORY_MODE = 0o700;

export interface LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_RUNTIME_ROOT_PROVISION';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly provisioningAttemptId: string;
  readonly platform: 'LINUX';
  readonly architecture: 'X64';
  readonly runtimeRootParent: string;
  readonly runtimeRootParentIdentityReference: string;
  readonly runtimeRootParentOwnerUid: number;
  readonly runtimeRootParentOwnerGid: number;
  readonly runtimeRootParentMode: 448;
  readonly runtimeRoot: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant extends LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest {
  readonly provisioningId: string;
  readonly requestHash: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly authorizedByReference: string;
  readonly authorityLevel: 3;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface ProvisionedLinuxRetainedNativeSupervisorRuntimeRoot {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_RUNTIME_ROOT_PROVISION';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly provisioningAttemptId: string;
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
  readonly runtimeRoot: string;
  readonly runtimeRootIdentityReference: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly directoryMode: 448;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface LinuxRetainedNativeSupervisorRuntimeRootProvisionAuthority {
  authorize(
    request: Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest>,
  ): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorRuntimeRootProvisionAuthority implements LinuxRetainedNativeSupervisorRuntimeRootProvisionAuthority {
  async authorize(
    _request: Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest>,
  ): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

export interface LinuxRetainedNativeSupervisorRuntimeRootProvisionHost {
  readonly platform: 'LINUX';
  readonly architecture: 'X64';
  provision(
    grant: Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant>,
  ): Readonly<ProvisionedLinuxRetainedNativeSupervisorRuntimeRoot>;
}

export class DenyLinuxRetainedNativeSupervisorRuntimeRootProvisionHost implements LinuxRetainedNativeSupervisorRuntimeRootProvisionHost {
  readonly platform = 'LINUX' as const;
  readonly architecture = 'X64' as const;

  provision(_grant: Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant>): never {
    return deny('NOT_CONFIGURED');
  }
}

const REQUEST_KEYS = [
  'architecture',
  'ownerGid',
  'ownerUid',
  'platform',
  'provisioningAttemptId',
  'purpose',
  'runtimeConnection',
  'runtimeRoot',
  'runtimeRootParent',
  'runtimeRootParentIdentityReference',
  'runtimeRootParentMode',
  'runtimeRootParentOwnerGid',
  'runtimeRootParentOwnerUid',
  'schemaVersion',
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
  'ownerGid',
  'ownerUid',
  'platform',
  'provisioningAttemptId',
  'provisioningId',
  'purpose',
  'requestHash',
  'runtimeConnection',
  'runtimeRoot',
  'runtimeRootIdentityReference',
  'schemaVersion',
  'supervisorInstanceId',
  'workspaceId',
] as const;

function deny(code: ConstructorParameters<typeof RetainedNativeSupervisorLocalIpcError>[0]): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(
  input: unknown,
  expected: readonly string[],
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) deny(code);
    const value = input as Record<string, unknown>;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(value).sort();
    const keys = [...expected].sort();
    if (
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      Reflect.ownKeys(value).length !== actual.length ||
      actual.length !== keys.length ||
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
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value))
    deny('INVALID_AUTHORIZATION');
  return value;
}

function attempt(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_ATTEMPT.test(value) || PRIVATE_TEXT.test(value))
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
  if (typeof value !== 'string') return false;
  const match = LINUX_IDENTITY.exec(value);
  if (!match) return false;
  const device = Number.parseInt(match[1]!, 16);
  const inode = Number.parseInt(match[2]!, 16);
  return Number.isSafeInteger(device) && device >= 1 && Number.isSafeInteger(inode) && inode >= 1;
}

export function validateLinuxRetainedNativeSupervisorRuntimeRootProvisionRequest(
  input: unknown,
): Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest> {
  const value = plainRecord(input, REQUEST_KEYS, 'INVALID_AUTHORIZATION');
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_RUNTIME_ROOT_PROVISION' ||
    value.platform !== 'LINUX' ||
    value.architecture !== 'X64' ||
    value.runtimeRootParentMode !== OWNER_ONLY_DIRECTORY_MODE ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    !positiveIdentityReference(value.runtimeRootParentIdentityReference)
  )
    deny('INVALID_AUTHORIZATION');
  const runtimeRootParent = directoryPath(value.runtimeRootParent);
  const provisioningAttemptId = attempt(value.provisioningAttemptId);
  const runtimeRoot = directoryPath(value.runtimeRoot);
  if (
    runtimeRoot !== posix.join(runtimeRootParent, provisioningAttemptId) ||
    value.runtimeRootParentOwnerUid !== value.ownerUid ||
    value.runtimeRootParentOwnerGid !== value.ownerGid
  )
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_RUNTIME_ROOT_PROVISION',
    workspaceId: reference(value.workspaceId),
    supervisorInstanceId: reference(value.supervisorInstanceId),
    provisioningAttemptId,
    platform: 'LINUX',
    architecture: 'X64',
    runtimeRootParent,
    runtimeRootParentIdentityReference: value.runtimeRootParentIdentityReference,
    runtimeRootParentOwnerUid: nonnegative(value.runtimeRootParentOwnerUid),
    runtimeRootParentOwnerGid: nonnegative(value.runtimeRootParentOwnerGid),
    runtimeRootParentMode: OWNER_ONLY_DIRECTORY_MODE,
    runtimeRoot,
    ownerUid: nonnegative(value.ownerUid),
    ownerGid: nonnegative(value.ownerGid),
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

export function linuxRetainedNativeSupervisorRuntimeRootProvisionRequestHash(
  request: Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest>,
): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

function validateGrant(
  input: unknown,
): Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant> {
  const value = plainRecord(input, GRANT_KEYS, 'INVALID_AUTHORIZATION');
  const request = validateLinuxRetainedNativeSupervisorRuntimeRootProvisionRequest(
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

function validateResult(
  input: unknown,
  grant: Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant>,
): Readonly<ProvisionedLinuxRetainedNativeSupervisorRuntimeRoot> {
  const value = plainRecord(input, RESULT_KEYS, 'INVALID_ATTESTATION');
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== grant.purpose ||
    value.workspaceId !== grant.workspaceId ||
    value.supervisorInstanceId !== grant.supervisorInstanceId ||
    value.provisioningAttemptId !== grant.provisioningAttemptId ||
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
    value.runtimeRoot !== grant.runtimeRoot ||
    !positiveIdentityReference(value.runtimeRootIdentityReference) ||
    value.ownerUid !== grant.ownerUid ||
    value.ownerGid !== grant.ownerGid ||
    value.directoryMode !== OWNER_ONLY_DIRECTORY_MODE ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze(
    value,
  ) as unknown as Readonly<ProvisionedLinuxRetainedNativeSupervisorRuntimeRoot>;
}

function identity(stat: { readonly dev: bigint; readonly ino: bigint }): string {
  return `linux:dev-${stat.dev.toString(16)}:ino-${stat.ino.toString(16)}`;
}

function mode(stat: { readonly mode: bigint }): number {
  return Number(stat.mode & 0o7777n);
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

function sameIdentity(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function safeClose(descriptor: number | undefined): void {
  if (descriptor === undefined) return;
  try {
    closeSync(descriptor);
  } catch {
    /* Preserve the primary fail-closed result. */
  }
}

class RetainedDescriptorLinuxRuntimeRootProvisionHost implements LinuxRetainedNativeSupervisorRuntimeRootProvisionHost {
  readonly platform = 'LINUX' as const;
  readonly architecture = 'X64' as const;

  constructor() {
    if (platform !== 'linux' || arch !== 'x64') deny('NOT_CONFIGURED');
    Object.freeze(this);
  }

  provision(
    grant: Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant>,
  ): Readonly<ProvisionedLinuxRetainedNativeSupervisorRuntimeRoot> {
    let parentDescriptor: number | undefined;
    let rootDescriptor: number | undefined;
    let created = false;
    try {
      if (
        typeof geteuid !== 'function' ||
        typeof getegid !== 'function' ||
        geteuid() !== grant.ownerUid ||
        getegid() !== grant.ownerGid
      )
        deny('INVALID_ATTESTATION');
      parentDescriptor = openSync(
        grant.runtimeRootParent,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const parentStat = verifyOwnedDirectory(parentDescriptor, grant.ownerUid, grant.ownerGid);
      if (identity(parentStat) !== grant.runtimeRootParentIdentityReference)
        deny('INVALID_ATTESTATION');
      const rootAtParent = `/proc/self/fd/${parentDescriptor}/${grant.provisioningAttemptId}`;
      mkdirSync(rootAtParent, { mode: OWNER_ONLY_DIRECTORY_MODE });
      created = true;
      rootDescriptor = openSync(
        rootAtParent,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const rootStat = verifyOwnedDirectory(rootDescriptor, grant.ownerUid, grant.ownerGid);
      const reopenedParent = lstatSync(grant.runtimeRootParent, { bigint: true });
      const reopenedRoot = lstatSync(grant.runtimeRoot, { bigint: true });
      if (!sameIdentity(parentStat, reopenedParent) || !sameIdentity(rootStat, reopenedRoot))
        deny('INVALID_ATTESTATION');
      return Object.freeze({
        schemaVersion: 1,
        purpose: grant.purpose,
        workspaceId: grant.workspaceId,
        supervisorInstanceId: grant.supervisorInstanceId,
        provisioningAttemptId: grant.provisioningAttemptId,
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
        runtimeRoot: grant.runtimeRoot,
        runtimeRootIdentityReference: identity(rootStat),
        ownerUid: grant.ownerUid,
        ownerGid: grant.ownerGid,
        directoryMode: OWNER_ONLY_DIRECTORY_MODE,
        runtimeConnection: 'NOT_CONFIGURED',
      });
    } catch (error) {
      if (created && parentDescriptor !== undefined && rootDescriptor !== undefined) {
        try {
          const createdStat = fstatSync(rootDescriptor, { bigint: true });
          const observed = lstatSync(
            `/proc/self/fd/${parentDescriptor}/${grant.provisioningAttemptId}`,
            { bigint: true },
          );
          if (sameIdentity(createdStat, observed))
            rmdirSync(`/proc/self/fd/${parentDescriptor}/${grant.provisioningAttemptId}`);
        } catch {
          /* Never broaden cleanup beyond the retained empty attempt root. */
        }
      }
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_ATTESTATION');
    } finally {
      safeClose(rootDescriptor);
      safeClose(parentDescriptor);
    }
  }
}

export class BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner {
  #attempted = false;

  constructor(
    private readonly authority: LinuxRetainedNativeSupervisorRuntimeRootProvisionAuthority = new DenyLinuxRetainedNativeSupervisorRuntimeRootProvisionAuthority(),
    private readonly host: LinuxRetainedNativeSupervisorRuntimeRootProvisionHost = new DenyLinuxRetainedNativeSupervisorRuntimeRootProvisionHost(),
    private readonly clock: () => number = Date.now,
  ) {
    if (
      !host ||
      host.platform !== 'LINUX' ||
      host.architecture !== 'X64' ||
      typeof host.provision !== 'function' ||
      host instanceof DenyLinuxRetainedNativeSupervisorRuntimeRootProvisionHost
    )
      deny('NOT_CONFIGURED');
  }

  async provision(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<ProvisionedLinuxRetainedNativeSupervisorRuntimeRoot>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('INVALID_AUTHORIZATION');
    const request = validateLinuxRetainedNativeSupervisorRuntimeRootProvisionRequest(input);
    let grant: Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant>;
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
      validFrom > now ||
      validUntil <= now ||
      validUntil <= validFrom ||
      validUntil - validFrom > MAX_GRANT_LIFETIME_MS ||
      REQUEST_KEYS.some((key) => request[key] !== grant[key]) ||
      grant.requestHash !== linuxRetainedNativeSupervisorRuntimeRootProvisionRequestHash(request) ||
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

/** Creates one absent attempt root under an already-attested owner-only parent. */
export function createRetainedDescriptorLinuxNativeSupervisorRuntimeRootProvisioner(
  authority: LinuxRetainedNativeSupervisorRuntimeRootProvisionAuthority = new DenyLinuxRetainedNativeSupervisorRuntimeRootProvisionAuthority(),
  clock: () => number = Date.now,
): BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner {
  return new BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner(
    authority,
    new RetainedDescriptorLinuxRuntimeRootProvisionHost(),
    clock,
  );
}
