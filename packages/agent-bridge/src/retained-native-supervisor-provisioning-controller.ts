import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash,
  validateLinuxRetainedNativeSupervisorParentDirectoryProvisionRequest,
  type LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest,
  type ProvisionedLinuxRetainedNativeSupervisorParentDirectories,
} from './retained-native-supervisor-linux-parent-directory-provisioner';
import {
  linuxRetainedNativeSupervisorPathProvisionRequestHash,
  validateLinuxRetainedNativeSupervisorPathProvisionRequest,
  type LinuxRetainedNativeSupervisorPathProvisionRequest,
  type ProvisionedLinuxRetainedNativeSupervisorPaths,
} from './retained-native-supervisor-linux-path-provisioner';
import {
  linuxRetainedNativeSupervisorRuntimeRootProvisionRequestHash,
  validateLinuxRetainedNativeSupervisorRuntimeRootProvisionRequest,
  type LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest,
  type ProvisionedLinuxRetainedNativeSupervisorRuntimeRoot,
} from './retained-native-supervisor-linux-runtime-root-provisioner';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const LINUX_IDENTITY = /^linux:dev-[a-f0-9]+:ino-[a-f0-9]+$/u;
const SAFE_NATIVE_PATH = /^\/[A-Za-z0-9._/-]+\.node$/u;
const SAFE_SOCKET_PATH = /^\/[A-Za-z0-9._/-]+\.sock$/u;
const MAX_PATH_BYTES = 4_096;
const MAX_SOCKET_PATH_BYTES = 107;
const MAX_MODULE_BYTES = 8 * 1_024 * 1_024;
const MAX_EVIDENCE_LIFETIME_MS = 5 * 60 * 1_000;

export interface LinuxRetainedNativeSupervisorSourceModuleEvidence {
  readonly moduleKind: 'CLIENT' | 'LISTENER';
  readonly sourceModulePath: string;
  readonly sourceModuleSha256: string;
  readonly sourceModuleIdentityReference: string;
  readonly sourceModuleOwnerUid: number;
  readonly sourceModuleOwnerGid: number;
  readonly sourceModuleMode: number;
  readonly sourceModuleSizeBytes: number;
}

export interface LinuxRetainedNativeSupervisorProvisioningPlan {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_PROVISIONING';
  readonly runtimeRootRequest: Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest>;
  readonly clientSource: Readonly<LinuxRetainedNativeSupervisorSourceModuleEvidence>;
  readonly listenerSource: Readonly<LinuxRetainedNativeSupervisorSourceModuleEvidence>;
  readonly socketPath: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface LinuxRetainedNativeSupervisorProvisioningPort {
  provision(input: unknown, signal: AbortSignal): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorProvisioningPort implements LinuxRetainedNativeSupervisorProvisioningPort {
  async provision(_input: unknown, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

export interface ProvisionedLinuxRetainedNativeSupervisorBundle {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_PROVISIONING';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly provisioningAttemptId: string;
  readonly runtimeRoot: Readonly<ProvisionedLinuxRetainedNativeSupervisorRuntimeRoot>;
  readonly parentDirectories: Readonly<ProvisionedLinuxRetainedNativeSupervisorParentDirectories>;
  readonly client: Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths>;
  readonly listener: Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths>;
  readonly provisioningState: 'PROVISIONED_NOT_ACTIVATED';
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

const PLAN_KEYS = [
  'clientSource',
  'listenerSource',
  'purpose',
  'runtimeConnection',
  'runtimeRootRequest',
  'schemaVersion',
  'socketPath',
] as const;
const SOURCE_KEYS = [
  'moduleKind',
  'sourceModuleIdentityReference',
  'sourceModuleMode',
  'sourceModuleOwnerGid',
  'sourceModuleOwnerUid',
  'sourceModulePath',
  'sourceModuleSha256',
  'sourceModuleSizeBytes',
] as const;
const ROOT_RESULT_KEYS = [
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
const PARENT_RESULT_KEYS = [
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
  'socketDirectory',
  'socketDirectoryIdentityReference',
  'socketDirectoryParent',
  'socketDirectoryParentIdentityReference',
  'supervisorInstanceId',
  'workspaceId',
] as const;
const PATH_RESULT_KEYS = [
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
  keys: readonly string[],
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) deny(code);
    const value = input as Record<string, unknown>;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    const own = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      actual.length !== expected.length ||
      own.length !== actual.length ||
      own.some((key) => typeof key !== 'string') ||
      actual.some((key, index) => key !== expected[index]) ||
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
    deny('INVALID_ATTESTATION');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) deny('INVALID_ATTESTATION');
  return value;
}

function identity(value: unknown): string {
  if (typeof value !== 'string' || !LINUX_IDENTITY.test(value)) deny('INVALID_ATTESTATION');
  const match = /^linux:dev-([a-f0-9]+):ino-([a-f0-9]+)$/u.exec(value)!;
  const device = Number.parseInt(match[1]!, 16);
  const inode = Number.parseInt(match[2]!, 16);
  if (!Number.isSafeInteger(device) || device < 1 || !Number.isSafeInteger(inode) || inode < 1)
    deny('INVALID_ATTESTATION');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') deny('INVALID_ATTESTATION');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    deny('INVALID_ATTESTATION');
  return value;
}

function authorizationPath(value: unknown, pattern: RegExp, maximum = MAX_PATH_BYTES): string {
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

function authorizationIdentity(value: unknown): string {
  try {
    return identity(value);
  } catch {
    return deny('INVALID_AUTHORIZATION');
  }
}

function authorizationInteger(
  value: unknown,
  positive = false,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < (positive ? 1 : 0) ||
    (value as number) > maximum
  )
    deny('INVALID_AUTHORIZATION');
  return value as number;
}

function assertFreshWindow(from: unknown, until: unknown, now: number): readonly [string, string] {
  const validFrom = timestamp(from);
  const validUntil = timestamp(until);
  const start = Date.parse(validFrom);
  const end = Date.parse(validUntil);
  if (
    !Number.isSafeInteger(now) ||
    start > now ||
    end <= now ||
    end <= start ||
    end - start > MAX_EVIDENCE_LIFETIME_MS
  )
    deny('INVALID_ATTESTATION');
  return [validFrom, validUntil];
}

function source(
  input: unknown,
  expectedKind: 'CLIENT' | 'LISTENER',
): Readonly<LinuxRetainedNativeSupervisorSourceModuleEvidence> {
  const value = plainRecord(input, SOURCE_KEYS, 'INVALID_AUTHORIZATION');
  if (
    value.moduleKind !== expectedKind ||
    typeof value.sourceModuleSha256 !== 'string' ||
    !SHA256.test(value.sourceModuleSha256)
  )
    deny('INVALID_AUTHORIZATION');
  const sourceModuleMode = authorizationInteger(value.sourceModuleMode, false, 0o777);
  if ((sourceModuleMode & 0o222) !== 0 || (sourceModuleMode & 0o400) !== 0o400)
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    moduleKind: expectedKind,
    sourceModulePath: authorizationPath(value.sourceModulePath, SAFE_NATIVE_PATH),
    sourceModuleSha256: value.sourceModuleSha256,
    sourceModuleIdentityReference: authorizationIdentity(value.sourceModuleIdentityReference),
    sourceModuleOwnerUid: authorizationInteger(value.sourceModuleOwnerUid),
    sourceModuleOwnerGid: authorizationInteger(value.sourceModuleOwnerGid),
    sourceModuleMode,
    sourceModuleSizeBytes: authorizationInteger(
      value.sourceModuleSizeBytes,
      true,
      MAX_MODULE_BYTES,
    ),
  });
}

function plan(input: unknown): Readonly<LinuxRetainedNativeSupervisorProvisioningPlan> {
  const value = plainRecord(input, PLAN_KEYS, 'INVALID_AUTHORIZATION');
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_PROVISIONING' ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    deny('INVALID_AUTHORIZATION');
  const runtimeRootRequest = validateLinuxRetainedNativeSupervisorRuntimeRootProvisionRequest(
    value.runtimeRootRequest,
  );
  const clientSource = source(value.clientSource, 'CLIENT');
  const listenerSource = source(value.listenerSource, 'LISTENER');
  const socketPath = authorizationPath(value.socketPath, SAFE_SOCKET_PATH, MAX_SOCKET_PATH_BYTES);
  const moduleDirectory = posix.join(runtimeRootRequest.runtimeRoot, 'native');
  if (
    posix.dirname(socketPath) !== posix.join(runtimeRootRequest.runtimeRoot, 'run', 'supervisor') ||
    clientSource.sourceModulePath === posix.join(moduleDirectory, 'client.node') ||
    listenerSource.sourceModulePath === posix.join(moduleDirectory, 'listener.node')
  )
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_PROVISIONING',
    runtimeRootRequest,
    clientSource,
    listenerSource,
    socketPath,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function runtimeRootEvidence(
  input: unknown,
  request: Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest>,
  now: number,
): Readonly<ProvisionedLinuxRetainedNativeSupervisorRuntimeRoot> {
  const value = plainRecord(input, ROOT_RESULT_KEYS, 'INVALID_ATTESTATION');
  const [authorizedFrom, authorizedUntil] = assertFreshWindow(
    value.authorizedFrom,
    value.authorizedUntil,
    now,
  );
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== request.purpose ||
    value.workspaceId !== request.workspaceId ||
    value.supervisorInstanceId !== request.supervisorInstanceId ||
    value.provisioningAttemptId !== request.provisioningAttemptId ||
    value.platform !== 'LINUX' ||
    value.architecture !== 'X64' ||
    value.runtimeRoot !== request.runtimeRoot ||
    value.ownerUid !== request.ownerUid ||
    value.ownerGid !== request.ownerGid ||
    value.directoryMode !== 0o700 ||
    value.authorityLevel !== 3 ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    value.requestHash !== linuxRetainedNativeSupervisorRuntimeRootProvisionRequestHash(request)
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: request.purpose,
    workspaceId: request.workspaceId,
    supervisorInstanceId: request.supervisorInstanceId,
    provisioningAttemptId: request.provisioningAttemptId,
    platform: 'LINUX',
    architecture: 'X64',
    provisioningId: reference(value.provisioningId),
    requestHash: digest(value.requestHash),
    approvalId: reference(value.approvalId),
    approvalEvidenceHash: digest(value.approvalEvidenceHash),
    authorizedByReference: reference(value.authorizedByReference),
    authorityLevel: 3,
    authorizedFrom,
    authorizedUntil,
    runtimeRoot: request.runtimeRoot,
    runtimeRootIdentityReference: identity(value.runtimeRootIdentityReference),
    ownerUid: request.ownerUid,
    ownerGid: request.ownerGid,
    directoryMode: 0o700,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function parentRequest(
  root: Readonly<ProvisionedLinuxRetainedNativeSupervisorRuntimeRoot>,
): Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest> {
  return validateLinuxRetainedNativeSupervisorParentDirectoryProvisionRequest({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_PARENT_DIRECTORIES_PROVISION',
    workspaceId: root.workspaceId,
    supervisorInstanceId: root.supervisorInstanceId,
    platform: 'LINUX',
    architecture: 'X64',
    runtimeRoot: root.runtimeRoot,
    runtimeRootIdentityReference: root.runtimeRootIdentityReference,
    runtimeRootProvisioningId: root.provisioningId,
    runtimeRootProvisionRequestHash: root.requestHash,
    runtimeRootApprovalEvidenceHash: root.approvalEvidenceHash,
    runtimeRootOwnerUid: root.ownerUid,
    runtimeRootOwnerGid: root.ownerGid,
    runtimeRootMode: 0o700,
    moduleDirectory: posix.join(root.runtimeRoot, 'native'),
    socketDirectoryParent: posix.join(root.runtimeRoot, 'run'),
    socketDirectory: posix.join(root.runtimeRoot, 'run', 'supervisor'),
    ownerUid: root.ownerUid,
    ownerGid: root.ownerGid,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function parentEvidence(
  input: unknown,
  request: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest>,
  now: number,
): Readonly<ProvisionedLinuxRetainedNativeSupervisorParentDirectories> {
  const value = plainRecord(input, PARENT_RESULT_KEYS, 'INVALID_ATTESTATION');
  const [authorizedFrom, authorizedUntil] = assertFreshWindow(
    value.authorizedFrom,
    value.authorizedUntil,
    now,
  );
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== request.purpose ||
    value.workspaceId !== request.workspaceId ||
    value.supervisorInstanceId !== request.supervisorInstanceId ||
    value.platform !== 'LINUX' ||
    value.architecture !== 'X64' ||
    value.requestHash !==
      linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash(request) ||
    value.moduleDirectory !== request.moduleDirectory ||
    value.socketDirectoryParent !== request.socketDirectoryParent ||
    value.socketDirectory !== request.socketDirectory ||
    value.ownerUid !== request.ownerUid ||
    value.ownerGid !== request.ownerGid ||
    value.directoryMode !== 0o700 ||
    value.authorityLevel !== 3 ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: request.purpose,
    workspaceId: request.workspaceId,
    supervisorInstanceId: request.supervisorInstanceId,
    platform: 'LINUX',
    architecture: 'X64',
    provisioningId: reference(value.provisioningId),
    requestHash: digest(value.requestHash),
    approvalId: reference(value.approvalId),
    approvalEvidenceHash: digest(value.approvalEvidenceHash),
    authorizedByReference: reference(value.authorizedByReference),
    authorityLevel: 3,
    authorizedFrom,
    authorizedUntil,
    moduleDirectory: request.moduleDirectory,
    moduleDirectoryIdentityReference: identity(value.moduleDirectoryIdentityReference),
    socketDirectoryParent: request.socketDirectoryParent,
    socketDirectoryParentIdentityReference: identity(value.socketDirectoryParentIdentityReference),
    socketDirectory: request.socketDirectory,
    socketDirectoryIdentityReference: identity(value.socketDirectoryIdentityReference),
    ownerUid: request.ownerUid,
    ownerGid: request.ownerGid,
    directoryMode: 0o700,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function pathRequest(
  sourceEvidence: Readonly<LinuxRetainedNativeSupervisorSourceModuleEvidence>,
  parents: Readonly<ProvisionedLinuxRetainedNativeSupervisorParentDirectories>,
  socketPath: string,
): Readonly<LinuxRetainedNativeSupervisorPathProvisionRequest> {
  return validateLinuxRetainedNativeSupervisorPathProvisionRequest({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_PATH_PROVISION',
    workspaceId: parents.workspaceId,
    supervisorInstanceId: parents.supervisorInstanceId,
    platform: 'LINUX',
    architecture: 'X64',
    ...sourceEvidence,
    parentDirectoryProvisioningId: parents.provisioningId,
    parentDirectoryProvisionRequestHash: parents.requestHash,
    parentDirectoryApprovalEvidenceHash: parents.approvalEvidenceHash,
    moduleDirectory: parents.moduleDirectory,
    moduleDirectoryIdentityReference: parents.moduleDirectoryIdentityReference,
    canonicalModulePath: posix.join(
      parents.moduleDirectory,
      `${sourceEvidence.moduleKind.toLowerCase()}.node`,
    ),
    socketDirectoryParent: parents.socketDirectoryParent,
    socketDirectoryParentIdentityReference: parents.socketDirectoryParentIdentityReference,
    socketDirectory: parents.socketDirectory,
    socketDirectoryIdentityReference: parents.socketDirectoryIdentityReference,
    socketPath,
    ownerUid: parents.ownerUid,
    ownerGid: parents.ownerGid,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function pathEvidence(
  input: unknown,
  request: Readonly<LinuxRetainedNativeSupervisorPathProvisionRequest>,
  now: number,
): Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths> {
  const value = plainRecord(input, PATH_RESULT_KEYS, 'INVALID_ATTESTATION');
  const [authorizedFrom, authorizedUntil] = assertFreshWindow(
    value.authorizedFrom,
    value.authorizedUntil,
    now,
  );
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== request.purpose ||
    value.workspaceId !== request.workspaceId ||
    value.supervisorInstanceId !== request.supervisorInstanceId ||
    value.platform !== 'LINUX' ||
    value.architecture !== 'X64' ||
    value.moduleKind !== request.moduleKind ||
    value.requestHash !== linuxRetainedNativeSupervisorPathProvisionRequestHash(request) ||
    value.parentDirectoryProvisioningId !== request.parentDirectoryProvisioningId ||
    value.parentDirectoryProvisionRequestHash !== request.parentDirectoryProvisionRequestHash ||
    value.parentDirectoryApprovalEvidenceHash !== request.parentDirectoryApprovalEvidenceHash ||
    value.canonicalModulePath !== request.canonicalModulePath ||
    value.moduleSha256 !== request.sourceModuleSha256 ||
    value.moduleOwnerUid !== request.ownerUid ||
    value.moduleOwnerGid !== request.ownerGid ||
    value.moduleMode !== 0o500 ||
    value.moduleSizeBytes !== request.sourceModuleSizeBytes ||
    value.socketDirectory !== request.socketDirectory ||
    value.socketDirectoryIdentityReference !== request.socketDirectoryIdentityReference ||
    value.socketDirectoryOwnerUid !== request.ownerUid ||
    value.socketDirectoryOwnerGid !== request.ownerGid ||
    value.socketDirectoryMode !== 0o700 ||
    value.socketPath !== request.socketPath ||
    value.authorityLevel !== 3 ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze({
    ...value,
    authorizedFrom,
    authorizedUntil,
    provisioningId: reference(value.provisioningId),
    approvalId: reference(value.approvalId),
    approvalEvidenceHash: digest(value.approvalEvidenceHash),
    authorizedByReference: reference(value.authorizedByReference),
    requestHash: digest(value.requestHash),
    moduleIdentityReference: identity(value.moduleIdentityReference),
  }) as unknown as Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths>;
}

/** Coordinates four independently authorized provisioning boundaries without supplying their transport. */
export class BoundedLinuxRetainedNativeSupervisorProvisioningController {
  #attempted = false;
  #lastObservedNow = -1;
  readonly #runtimeRootProvision: LinuxRetainedNativeSupervisorProvisioningPort['provision'];
  readonly #parentDirectoryProvision: LinuxRetainedNativeSupervisorProvisioningPort['provision'];
  readonly #clientProvision: LinuxRetainedNativeSupervisorProvisioningPort['provision'];
  readonly #listenerProvision: LinuxRetainedNativeSupervisorProvisioningPort['provision'];

  constructor(
    runtimeRootPort: LinuxRetainedNativeSupervisorProvisioningPort = new DenyLinuxRetainedNativeSupervisorProvisioningPort(),
    parentDirectoryPort: LinuxRetainedNativeSupervisorProvisioningPort = new DenyLinuxRetainedNativeSupervisorProvisioningPort(),
    clientPort: LinuxRetainedNativeSupervisorProvisioningPort = new DenyLinuxRetainedNativeSupervisorProvisioningPort(),
    listenerPort: LinuxRetainedNativeSupervisorProvisioningPort = new DenyLinuxRetainedNativeSupervisorProvisioningPort(),
    private readonly clock: () => number = Date.now,
  ) {
    for (const port of [runtimeRootPort, parentDirectoryPort, clientPort, listenerPort]) {
      if (
        !port ||
        port instanceof DenyLinuxRetainedNativeSupervisorProvisioningPort ||
        typeof port.provision !== 'function'
      )
        deny('NOT_CONFIGURED');
    }
    this.#runtimeRootProvision = runtimeRootPort.provision.bind(runtimeRootPort);
    this.#parentDirectoryProvision = parentDirectoryPort.provision.bind(parentDirectoryPort);
    this.#clientProvision = clientPort.provision.bind(clientPort);
    this.#listenerProvision = listenerPort.provision.bind(listenerPort);
  }

  async provision(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<ProvisionedLinuxRetainedNativeSupervisorBundle>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('INVALID_AUTHORIZATION');
    const request = plan(input);
    const root = runtimeRootEvidence(
      await this.call(this.#runtimeRootProvision, request.runtimeRootRequest, signal),
      request.runtimeRootRequest,
      this.now(signal),
    );
    const parentProvisionRequest = parentRequest(root);
    const parents = parentEvidence(
      await this.call(this.#parentDirectoryProvision, parentProvisionRequest, signal),
      parentProvisionRequest,
      this.now(signal),
    );
    const clientProvisionRequest = pathRequest(request.clientSource, parents, request.socketPath);
    const client = pathEvidence(
      await this.call(this.#clientProvision, clientProvisionRequest, signal),
      clientProvisionRequest,
      this.now(signal),
    );
    const listenerProvisionRequest = pathRequest(
      request.listenerSource,
      parents,
      request.socketPath,
    );
    const listener = pathEvidence(
      await this.call(this.#listenerProvision, listenerProvisionRequest, signal),
      listenerProvisionRequest,
      this.now(signal),
    );
    if (
      client.socketDirectoryIdentityReference !== listener.socketDirectoryIdentityReference ||
      client.parentDirectoryProvisioningId !== listener.parentDirectoryProvisioningId
    )
      deny('INVALID_ATTESTATION');
    const completedAt = this.now(signal);
    for (const evidence of [root, parents, client, listener])
      assertFreshWindow(evidence.authorizedFrom, evidence.authorizedUntil, completedAt);
    return Object.freeze({
      schemaVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_PROVISIONING',
      workspaceId: root.workspaceId,
      supervisorInstanceId: root.supervisorInstanceId,
      provisioningAttemptId: root.provisioningAttemptId,
      runtimeRoot: root,
      parentDirectories: parents,
      client,
      listener,
      provisioningState: 'PROVISIONED_NOT_ACTIVATED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
  }

  private async call(
    provision: LinuxRetainedNativeSupervisorProvisioningPort['provision'],
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) deny('INVALID_AUTHORIZATION');
    try {
      return await provision(Object.freeze(input), signal);
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_ATTESTATION');
    }
  }

  private now(signal: AbortSignal): number {
    if (signal.aborted) deny('INVALID_AUTHORIZATION');
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0 || now < this.#lastObservedNow)
      deny('INVALID_ATTESTATION');
    this.#lastObservedNow = now;
    return now;
  }
}

export function linuxRetainedNativeSupervisorProvisioningPlanHash(input: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(plan(input)))
    .digest('hex');
}
