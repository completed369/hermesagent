import { createHash } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, openSync, readFileSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { posix } from 'node:path';
import { dlopen } from 'node:process';

import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import type { LinuxRetainedNativeSupervisorClientNativeModule } from './retained-native-supervisor-linux-native-client-binding';
import type { LinuxRetainedNativeSupervisorListenerNativeModule } from './retained-native-supervisor-linux-native-listener-binding';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const LINUX_IDENTITY = /^linux:dev-[a-f0-9]+:ino-[a-f0-9]+$/u;
const SAFE_NATIVE_PATH = /^\/[A-Za-z0-9._/-]+\.node$/u;
const SAFE_SOCKET_PATH = /^\/[A-Za-z0-9._/-]+\.sock$/u;
const MAX_NATIVE_PATH_BYTES = 4_096;
const MAX_SOCKET_PATH_BYTES = 107;
const MAX_NATIVE_MODULE_BYTES = 8 * 1_024 * 1_024;
const MAX_AUTHORIZATION_LIFETIME_MS = 5 * 60 * 1_000;
// Linux UAPI value; @types/node omits this platform-specific open(2) flag.
const LINUX_O_CLOEXEC = 0o2000000;
const MAX_RETAINED_MODULE_DESCRIPTORS = 2;

export type LinuxRetainedNativeSupervisorModuleKind = 'CLIENT' | 'LISTENER';

export interface LinuxRetainedNativeSupervisorModuleLoadRequest {
  readonly schemaVersion: 1;
  readonly platform: 'LINUX';
  readonly architecture: 'X64';
  readonly moduleKind: LinuxRetainedNativeSupervisorModuleKind;
  readonly canonicalModulePath: string;
  readonly socketPath: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface LinuxRetainedNativeSupervisorModuleAuthorization extends LinuxRetainedNativeSupervisorModuleLoadRequest {
  readonly authorizationId: string;
  readonly authorizationVersion: number;
  readonly requestHash: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly moduleSha256: string;
  readonly moduleIdentityReference: string;
  readonly moduleOwnerUid: number;
  readonly moduleOwnerGid: number;
  readonly moduleMode: number;
  readonly moduleSizeBytes: number;
  readonly socketDirectory: string;
  readonly socketDirectoryIdentityReference: string;
  readonly socketDirectoryOwnerUid: number;
  readonly socketDirectoryOwnerGid: number;
  readonly socketDirectoryMode: 448;
}

export interface LinuxRetainedNativeSupervisorModuleAuthorizationSource {
  read(request: Readonly<LinuxRetainedNativeSupervisorModuleLoadRequest>): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorModuleAuthorizationSource implements LinuxRetainedNativeSupervisorModuleAuthorizationSource {
  async read(_request: Readonly<LinuxRetainedNativeSupervisorModuleLoadRequest>): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

export interface LinuxRetainedNativeSupervisorModuleHost {
  readonly platform: 'LINUX';
  readonly architecture: 'X64';
  verifySocketDirectory(
    authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>,
  ): void;
  loadAuthorizedModule(
    authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>,
  ): unknown;
}

export class DenyLinuxRetainedNativeSupervisorModuleHost implements LinuxRetainedNativeSupervisorModuleHost {
  readonly platform = 'LINUX' as const;
  readonly architecture = 'X64' as const;

  verifySocketDirectory(
    _authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>,
  ): never {
    return deny('NOT_CONFIGURED');
  }

  loadAuthorizedModule(
    _authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>,
  ): never {
    return deny('NOT_CONFIGURED');
  }
}

export interface LoadedLinuxRetainedNativeSupervisorClientModule {
  readonly schemaVersion: 1;
  readonly moduleKind: 'CLIENT';
  readonly socketPath: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly nativeModule: LinuxRetainedNativeSupervisorClientNativeModule;
}

export interface LoadedLinuxRetainedNativeSupervisorListenerModule {
  readonly schemaVersion: 1;
  readonly moduleKind: 'LISTENER';
  readonly socketPath: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly nativeModule: LinuxRetainedNativeSupervisorListenerNativeModule;
}

export type LoadedLinuxRetainedNativeSupervisorModule =
  | LoadedLinuxRetainedNativeSupervisorClientModule
  | LoadedLinuxRetainedNativeSupervisorListenerModule;

const REQUEST_KEYS = [
  'architecture',
  'canonicalModulePath',
  'moduleKind',
  'platform',
  'runtimeConnection',
  'schemaVersion',
  'socketPath',
] as const;
const AUTHORIZATION_KEYS = [
  ...REQUEST_KEYS,
  'authorizationId',
  'authorizationVersion',
  'moduleIdentityReference',
  'moduleMode',
  'moduleOwnerGid',
  'moduleOwnerUid',
  'moduleSha256',
  'moduleSizeBytes',
  'requestHash',
  'socketDirectory',
  'socketDirectoryIdentityReference',
  'socketDirectoryMode',
  'socketDirectoryOwnerGid',
  'socketDirectoryOwnerUid',
  'validFrom',
  'validUntil',
] as const;
const CLIENT_MODULE_KEYS = [
  'abiVersion',
  'connectUnixSocket',
  'lstatUnixSocket',
  'platform',
] as const;
const LISTENER_MODULE_KEYS = ['abiVersion', 'createOwnedListener', 'platform'] as const;

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

function nonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) deny('INVALID_AUTHORIZATION');
  return value as number;
}

function positiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum)
    deny('INVALID_AUTHORIZATION');
  return value as number;
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

function identityReference(value: unknown): string {
  if (typeof value !== 'string' || !LINUX_IDENTITY.test(value)) deny('INVALID_AUTHORIZATION');
  return value;
}

function canonicalPath(value: unknown, pattern: RegExp, maximumBytes: number): string {
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..') ||
    Buffer.byteLength(value, 'utf8') > maximumBytes ||
    posix.normalize(value) !== value
  )
    deny('INVALID_AUTHORIZATION');
  return value;
}

export function validateLinuxRetainedNativeSupervisorModuleLoadRequest(
  input: unknown,
): Readonly<LinuxRetainedNativeSupervisorModuleLoadRequest> {
  const value = plainRecord(input, REQUEST_KEYS, 'INVALID_AUTHORIZATION');
  if (
    value.schemaVersion !== 1 ||
    value.platform !== 'LINUX' ||
    value.architecture !== 'X64' ||
    (value.moduleKind !== 'CLIENT' && value.moduleKind !== 'LISTENER') ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1,
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: value.moduleKind,
    canonicalModulePath: canonicalPath(
      value.canonicalModulePath,
      SAFE_NATIVE_PATH,
      MAX_NATIVE_PATH_BYTES,
    ),
    socketPath: canonicalPath(value.socketPath, SAFE_SOCKET_PATH, MAX_SOCKET_PATH_BYTES),
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

export function linuxRetainedNativeSupervisorModuleLoadRequestHash(
  request: Readonly<LinuxRetainedNativeSupervisorModuleLoadRequest>,
): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

export function validateLinuxRetainedNativeSupervisorModuleAuthorization(
  input: unknown,
): Readonly<LinuxRetainedNativeSupervisorModuleAuthorization> {
  const value = plainRecord(input, AUTHORIZATION_KEYS, 'INVALID_AUTHORIZATION');
  const request = validateLinuxRetainedNativeSupervisorModuleLoadRequest(
    Object.fromEntries(REQUEST_KEYS.map((key) => [key, value[key]])),
  );
  const moduleMode = nonnegativeInteger(value.moduleMode);
  if (
    moduleMode > 0o777 ||
    (moduleMode & 0o222) !== 0 ||
    (moduleMode & 0o444) !== 0o444 ||
    typeof value.moduleSha256 !== 'string' ||
    !SHA256.test(value.moduleSha256) ||
    typeof value.requestHash !== 'string' ||
    !SHA256.test(value.requestHash) ||
    value.socketDirectoryMode !== 0o700
  )
    deny('INVALID_AUTHORIZATION');
  const socketDirectory = canonicalPath(
    value.socketDirectory,
    /^\/[A-Za-z0-9._/-]+$/u,
    MAX_NATIVE_PATH_BYTES,
  );
  if (
    posix.dirname(request.socketPath) !== socketDirectory ||
    posix.dirname(request.canonicalModulePath) === request.canonicalModulePath ||
    posix.dirname(request.canonicalModulePath) === '/'
  )
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    ...request,
    authorizationId: reference(value.authorizationId),
    authorizationVersion: positiveInteger(value.authorizationVersion, 1_000_000),
    requestHash: value.requestHash,
    validFrom: timestamp(value.validFrom),
    validUntil: timestamp(value.validUntil),
    moduleSha256: value.moduleSha256,
    moduleIdentityReference: identityReference(value.moduleIdentityReference),
    moduleOwnerUid: nonnegativeInteger(value.moduleOwnerUid),
    moduleOwnerGid: nonnegativeInteger(value.moduleOwnerGid),
    moduleMode,
    moduleSizeBytes: positiveInteger(value.moduleSizeBytes, MAX_NATIVE_MODULE_BYTES),
    socketDirectory,
    socketDirectoryIdentityReference: identityReference(value.socketDirectoryIdentityReference),
    socketDirectoryOwnerUid: nonnegativeInteger(value.socketDirectoryOwnerUid),
    socketDirectoryOwnerGid: nonnegativeInteger(value.socketDirectoryOwnerGid),
    socketDirectoryMode: 0o700,
  });
}

export function linuxRetainedNativeSupervisorModuleAuthorizationHash(
  authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>,
): string {
  return createHash('sha256').update(canonicalJson(authorization)).digest('hex');
}

function sameRequest(
  request: Readonly<LinuxRetainedNativeSupervisorModuleLoadRequest>,
  authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>,
): boolean {
  return REQUEST_KEYS.every((key) => request[key] === authorization[key]);
}

function validateFreshAuthorization(
  authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>,
  now: number,
): void {
  const validFrom = Date.parse(authorization.validFrom);
  const validUntil = Date.parse(authorization.validUntil);
  if (
    !Number.isFinite(now) ||
    validFrom > now ||
    validUntil <= now ||
    validUntil <= validFrom ||
    validUntil - validFrom > MAX_AUTHORIZATION_LIFETIME_MS
  )
    deny('INVALID_AUTHORIZATION');
}

function identity(device: bigint, inode: bigint): string {
  return `linux:dev-${device.toString(16)}:ino-${inode.toString(16)}`;
}

function verifyStat(
  descriptor: number,
  authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>,
  kind: 'DIRECTORY' | 'MODULE',
): void {
  const stat = fstatSync(descriptor, { bigint: true });
  const mode = Number(stat.mode & 0o777n);
  const observedIdentity = identity(stat.dev, stat.ino);
  if (kind === 'DIRECTORY') {
    if (
      !stat.isDirectory() ||
      observedIdentity !== authorization.socketDirectoryIdentityReference ||
      Number(stat.uid) !== authorization.socketDirectoryOwnerUid ||
      Number(stat.gid) !== authorization.socketDirectoryOwnerGid ||
      mode !== authorization.socketDirectoryMode
    )
      deny('INVALID_ATTESTATION');
    return;
  }
  if (
    !stat.isFile() ||
    observedIdentity !== authorization.moduleIdentityReference ||
    Number(stat.uid) !== authorization.moduleOwnerUid ||
    Number(stat.gid) !== authorization.moduleOwnerGid ||
    mode !== authorization.moduleMode ||
    stat.size !== BigInt(authorization.moduleSizeBytes)
  )
    deny('INVALID_ATTESTATION');
}

interface RetainedLoadedModule {
  readonly descriptor: number;
  readonly canonicalModulePath: string;
  readonly moduleSha256: string;
  readonly moduleIdentityReference: string;
  readonly moduleOwnerUid: number;
  readonly moduleOwnerGid: number;
  readonly moduleMode: number;
  readonly moduleSizeBytes: number;
  readonly nativeModule:
    | LinuxRetainedNativeSupervisorClientNativeModule
    | LinuxRetainedNativeSupervisorListenerNativeModule;
}

const retainedLoadedModules = new Map<
  LinuxRetainedNativeSupervisorModuleKind,
  RetainedLoadedModule
>();
const retainedDlopenDescriptors = new Set<number>();

function sameRetainedModule(
  retained: RetainedLoadedModule,
  authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>,
): boolean {
  return (
    retained.canonicalModulePath === authorization.canonicalModulePath &&
    retained.moduleSha256 === authorization.moduleSha256 &&
    retained.moduleIdentityReference === authorization.moduleIdentityReference &&
    retained.moduleOwnerUid === authorization.moduleOwnerUid &&
    retained.moduleOwnerGid === authorization.moduleOwnerGid &&
    retained.moduleMode === authorization.moduleMode &&
    retained.moduleSizeBytes === authorization.moduleSizeBytes
  );
}

/**
 * Linux-x64 host that verifies retained descriptors before loading. Construction
 * does not select a path; the caller must supply a separately authorized record.
 */
class RetainedDescriptorLinuxNativeSupervisorModuleHost implements LinuxRetainedNativeSupervisorModuleHost {
  readonly platform = 'LINUX' as const;
  readonly architecture = 'X64' as const;

  constructor() {
    if (process.platform !== 'linux' || process.arch !== 'x64') deny('NOT_CONFIGURED');
    Object.freeze(this);
  }

  verifySocketDirectory(
    authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>,
  ): void {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        authorization.socketDirectory,
        fsConstants.O_RDONLY | LINUX_O_CLOEXEC | fsConstants.O_NOFOLLOW | fsConstants.O_DIRECTORY,
      );
      verifyStat(descriptor, authorization, 'DIRECTORY');
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      deny('INVALID_ATTESTATION');
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  loadAuthorizedModule(
    authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>,
  ): unknown {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        authorization.canonicalModulePath,
        fsConstants.O_RDONLY | LINUX_O_CLOEXEC | fsConstants.O_NOFOLLOW,
      );
      verifyStat(descriptor, authorization, 'MODULE');
      const bytes = readFileSync(descriptor);
      const observedDigest = createHash('sha256').update(bytes).digest('hex');
      if (observedDigest !== authorization.moduleSha256) deny('INVALID_ATTESTATION');
      const beforeLoad = Date.now();
      if (
        beforeLoad < Date.parse(authorization.validFrom) ||
        beforeLoad >= Date.parse(authorization.validUntil)
      )
        deny('INVALID_AUTHORIZATION');
      const retained = retainedLoadedModules.get(authorization.moduleKind);
      if (retained !== undefined) {
        if (!sameRetainedModule(retained, authorization)) deny('INVALID_ATTESTATION');
        return retained.nativeModule;
      }
      if (retainedDlopenDescriptors.size >= MAX_RETAINED_MODULE_DESCRIPTORS) deny('NOT_CONFIGURED');
      const holder: { exports: unknown } = { exports: {} };
      dlopen(holder, `/proc/self/fd/${descriptor}`, osConstants.dlopen.RTLD_NOW);
      retainedDlopenDescriptors.add(descriptor);
      const retainedDescriptor = descriptor;
      descriptor = undefined;
      verifyStat(retainedDescriptor, authorization, 'MODULE');
      const nativeModule = validateNativeModule(holder.exports, authorization.moduleKind);
      retainedLoadedModules.set(
        authorization.moduleKind,
        Object.freeze({
          descriptor: retainedDescriptor,
          canonicalModulePath: authorization.canonicalModulePath,
          moduleSha256: authorization.moduleSha256,
          moduleIdentityReference: authorization.moduleIdentityReference,
          moduleOwnerUid: authorization.moduleOwnerUid,
          moduleOwnerGid: authorization.moduleOwnerGid,
          moduleMode: authorization.moduleMode,
          moduleSizeBytes: authorization.moduleSizeBytes,
          nativeModule,
        }),
      );
      return nativeModule;
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_ATTESTATION');
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}

function validateNativeModule(
  input: unknown,
  kind: LinuxRetainedNativeSupervisorModuleKind,
):
  | LinuxRetainedNativeSupervisorClientNativeModule
  | LinuxRetainedNativeSupervisorListenerNativeModule {
  const keys = kind === 'CLIENT' ? CLIENT_MODULE_KEYS : LISTENER_MODULE_KEYS;
  const value = plainRecord(input, keys, 'INVALID_ATTESTATION');
  if (value.abiVersion !== 1 || value.platform !== 'LINUX') deny('INVALID_ATTESTATION');
  const methods =
    kind === 'CLIENT' ? ['connectUnixSocket', 'lstatUnixSocket'] : ['createOwnedListener'];
  if (methods.some((method) => typeof value[method] !== 'function')) deny('INVALID_ATTESTATION');
  return Object.freeze(value) as unknown as
    | LinuxRetainedNativeSupervisorClientNativeModule
    | LinuxRetainedNativeSupervisorListenerNativeModule;
}

/**
 * One-attempt loader for one explicitly authorized module and socket path. It
 * neither discovers paths nor composes a listener/client into a running service.
 */
export class BoundedLinuxRetainedNativeSupervisorModuleLoader {
  #attempted = false;

  constructor(
    private readonly authorizationSource: LinuxRetainedNativeSupervisorModuleAuthorizationSource = new DenyLinuxRetainedNativeSupervisorModuleAuthorizationSource(),
    private readonly host: LinuxRetainedNativeSupervisorModuleHost = new DenyLinuxRetainedNativeSupervisorModuleHost(),
    private readonly clock: () => number = Date.now,
  ) {
    if (host.platform !== 'LINUX' || host.architecture !== 'X64') deny('NOT_CONFIGURED');
  }

  async load(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<LoadedLinuxRetainedNativeSupervisorModule>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('INVALID_AUTHORIZATION');
    const request = validateLinuxRetainedNativeSupervisorModuleLoadRequest(input);
    let authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>;
    try {
      authorization = validateLinuxRetainedNativeSupervisorModuleAuthorization(
        await this.authorizationSource.read(request),
      );
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError && error.code === 'NOT_CONFIGURED')
        throw error;
      return deny('INVALID_AUTHORIZATION');
    }
    const before = this.clock();
    validateFreshAuthorization(authorization, before);
    if (
      !sameRequest(request, authorization) ||
      authorization.requestHash !== linuxRetainedNativeSupervisorModuleLoadRequestHash(request) ||
      signal.aborted
    )
      deny('INVALID_AUTHORIZATION');
    try {
      this.host.verifySocketDirectory(authorization);
      const afterDirectory = this.clock();
      if (afterDirectory < before || signal.aborted) deny('INVALID_AUTHORIZATION');
      validateFreshAuthorization(authorization, afterDirectory);
      const nativeModule = validateNativeModule(
        this.host.loadAuthorizedModule(authorization),
        authorization.moduleKind,
      );
      const afterLoad = this.clock();
      if (afterLoad < afterDirectory || signal.aborted) deny('INVALID_AUTHORIZATION');
      validateFreshAuthorization(authorization, afterLoad);
      return Object.freeze({
        schemaVersion: 1,
        moduleKind: authorization.moduleKind,
        socketPath: authorization.socketPath,
        runtimeConnection: 'NOT_CONFIGURED',
        nativeModule,
      }) as Readonly<LoadedLinuxRetainedNativeSupervisorModule>;
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_ATTESTATION');
    }
  }
}

/** Creates an uncomposed real Linux host bound to one explicit authority port. */
export function createRetainedDescriptorLinuxNativeSupervisorModuleLoader(
  authorizationSource: LinuxRetainedNativeSupervisorModuleAuthorizationSource,
  clock: () => number = Date.now,
): BoundedLinuxRetainedNativeSupervisorModuleLoader {
  return new BoundedLinuxRetainedNativeSupervisorModuleLoader(
    authorizationSource,
    new RetainedDescriptorLinuxNativeSupervisorModuleHost(),
    clock,
  );
}
