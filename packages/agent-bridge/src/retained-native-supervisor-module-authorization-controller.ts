import { createHash } from 'node:crypto';

import { canonicalJson } from './codec';
import {
  linuxRetainedNativeSupervisorModuleLoadRequestHash,
  validateLinuxRetainedNativeSupervisorModuleAuthorization,
  type LinuxRetainedNativeSupervisorModuleLoadRequest,
} from './retained-native-supervisor-linux-module-loader';
import type { ProvisionedLinuxRetainedNativeSupervisorPaths } from './retained-native-supervisor-linux-path-provisioner';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import type {
  RetainedNativeSupervisorModuleAuthorizationSnapshot,
  RetainedNativeSupervisorModuleAuthorizationSnapshotPayload,
} from './retained-native-supervisor-module-authorization-trust-source';

const SHA256 = /^[a-f0-9]{64}$/u;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const LINUX_IDENTITY = /^linux:dev-[a-f0-9]+:ino-[a-f0-9]+$/u;
const SAFE_NATIVE_PATH = /^\/[A-Za-z0-9._/-]+\.node$/u;
const SAFE_SOCKET_PATH = /^\/[A-Za-z0-9._/-]+\.sock$/u;
const SAFE_DIRECTORY_PATH = /^\/[A-Za-z0-9._/-]+$/u;
const MAX_PATH_BYTES = 4_096;
const MAX_SOCKET_PATH_BYTES = 107;
const MAX_MODULE_BYTES = 8 * 1_024 * 1_024;
const MAX_LIFETIME_MS = 5 * 60 * 1_000;

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotEntry {
  readonly authorizationId: string;
  readonly authorizationVersion: number;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly provisionedPaths: Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths>;
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_ISSUANCE';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly signerKeyId: string;
  readonly previousSnapshotHash: string | null;
  readonly issuedAt: string;
  readonly validUntil: string;
  readonly authorizations: readonly Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotEntry>[];
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_ISSUANCE';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly signerKeyId: string;
  readonly issuanceRequestHash: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceGrant extends RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest {
  readonly issuanceAuthorizationId: string;
  readonly authorityRequestHash: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly authorizedByReference: string;
  readonly authorityLevel: 3;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthority {
  authorize(
    request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest>,
  ): Promise<unknown>;
}

export class DenyRetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthority implements RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthority {
  async authorize(
    _request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest>,
  ): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT';
  readonly signerKeyId: string;
  readonly snapshotPayloadHash: string;
  readonly payload: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotPayload>;
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotSignature {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT';
  readonly signerKeyId: string;
  readonly snapshotPayloadHash: string;
  readonly signature: string;
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotSigner {
  sign(
    request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest>,
  ): Promise<unknown>;
}

export class DenyRetainedNativeSupervisorModuleAuthorizationSnapshotSigner implements RetainedNativeSupervisorModuleAuthorizationSnapshotSigner {
  async sign(
    _request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest>,
  ): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationSink {
  publish(
    input: unknown,
    issuance: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance,
  ): Promise<'APPENDED' | 'REPLAYED'>;
}

export class DenyRetainedNativeSupervisorModuleAuthorizationSnapshotPublicationSink implements RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationSink {
  async publish(
    _input: unknown,
    _issuance: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance,
  ): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceEvidence {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly signerKeyId: string;
  readonly snapshotHash: string;
  readonly issuanceRequestHash: string;
  readonly issuanceAuthorizationId: string;
  readonly authorityRequestHash: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly authorizedByReference: string;
  readonly authorityLevel: 3;
  readonly authorizedFrom: string;
  readonly authorizedUntil: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

const AUTHENTICATED_SNAPSHOT_ISSUANCE = Symbol(
  'authenticated-retained-native-module-snapshot-issuance',
);

export class AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance {
  readonly #token: symbol;

  constructor(
    token: symbol,
    readonly evidence: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceEvidence>,
  ) {
    if (token !== AUTHENTICATED_SNAPSHOT_ISSUANCE) deny('INVALID_AUTHORIZATION');
    this.#token = token;
    Object.freeze(this);
  }

  static assertAuthenticated(
    value: unknown,
  ): asserts value is AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance {
    try {
      if (
        !(
          value instanceof AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance
        ) ||
        value.#token !== AUTHENTICATED_SNAPSHOT_ISSUANCE
      )
        deny('INVALID_AUTHORIZATION');
    } catch {
      deny('INVALID_AUTHORIZATION');
    }
  }
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceReceipt {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
  readonly issuanceAuthorizationId: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly publication: 'APPENDED' | 'REPLAYED';
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

const PATH_KEYS = [
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
const ENTRY_KEYS = [
  'authorizationId',
  'authorizationVersion',
  'provisionedPaths',
  'validFrom',
  'validUntil',
] as const;
const ISSUE_KEYS = [
  'authorizations',
  'issuedAt',
  'previousSnapshotHash',
  'purpose',
  'runtimeConnection',
  'schemaVersion',
  'signerKeyId',
  'snapshotId',
  'snapshotVersion',
  'supervisorInstanceId',
  'validUntil',
  'workspaceId',
] as const;
const AUTHORITY_REQUEST_KEYS = [
  'issuanceRequestHash',
  'purpose',
  'runtimeConnection',
  'schemaVersion',
  'signerKeyId',
  'snapshotId',
  'snapshotVersion',
  'supervisorInstanceId',
  'workspaceId',
] as const;
const GRANT_KEYS = [
  ...AUTHORITY_REQUEST_KEYS,
  'approvalEvidenceHash',
  'approvalId',
  'authorityLevel',
  'authorityRequestHash',
  'authorizedByReference',
  'issuanceAuthorizationId',
  'validFrom',
  'validUntil',
] as const;
const SIGNATURE_KEYS = [
  'purpose',
  'schemaVersion',
  'signature',
  'signerKeyId',
  'snapshotPayloadHash',
] as const;

function deny(code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(
  input: unknown,
  expected: readonly string[],
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION' = 'INVALID_AUTHORIZATION',
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

function plainArray(input: unknown, maximum: number): readonly unknown[] {
  if (
    !Array.isArray(input) ||
    input.length > maximum ||
    Object.getPrototypeOf(input) !== Array.prototype
  )
    deny('INVALID_AUTHORIZATION');
  const expected = Array.from({ length: input.length }, (_, index) => String(index));
  const enumerable = Object.keys(input);
  const ownKeys = Reflect.ownKeys(input);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    enumerable.length !== expected.length ||
    enumerable.some((key, index) => key !== expected[index]) ||
    ownKeys.length !== expected.length + 1 ||
    ownKeys.some(
      (key) => typeof key !== 'string' || (key !== 'length' && !expected.includes(key)),
    ) ||
    expected.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value'))
  )
    deny('INVALID_AUTHORIZATION');
  return input;
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

function positiveInteger(value: unknown, maximum = 1_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum)
    deny('INVALID_AUTHORIZATION');
  return value as number;
}

function nonnegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum)
    deny('INVALID_ATTESTATION');
  return value as number;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') deny('INVALID_AUTHORIZATION');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    deny('INVALID_AUTHORIZATION');
  return value;
}

function path(value: unknown, pattern: RegExp, maximumBytes = MAX_PATH_BYTES): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value) > maximumBytes ||
    !pattern.test(value) ||
    value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..')
  )
    deny('INVALID_ATTESTATION');
  return value;
}

function paths(input: unknown): Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths> {
  const value = plainRecord(input, PATH_KEYS, 'INVALID_ATTESTATION');
  const authorizedFrom = timestamp(value.authorizedFrom);
  const authorizedUntil = timestamp(value.authorizedUntil);
  const authorizationLifetimeMs = Date.parse(authorizedUntil) - Date.parse(authorizedFrom);
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_PATH_PROVISION' ||
    value.platform !== 'LINUX' ||
    value.architecture !== 'X64' ||
    (value.moduleKind !== 'CLIENT' && value.moduleKind !== 'LISTENER') ||
    value.moduleMode !== 0o500 ||
    value.socketDirectoryMode !== 0o700 ||
    value.authorityLevel !== 3 ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    typeof value.moduleIdentityReference !== 'string' ||
    !LINUX_IDENTITY.test(value.moduleIdentityReference) ||
    typeof value.socketDirectoryIdentityReference !== 'string' ||
    !LINUX_IDENTITY.test(value.socketDirectoryIdentityReference) ||
    authorizationLifetimeMs <= 0 ||
    authorizationLifetimeMs > MAX_LIFETIME_MS
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_PATH_PROVISION',
    workspaceId: reference(value.workspaceId),
    supervisorInstanceId: reference(value.supervisorInstanceId),
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: value.moduleKind,
    provisioningId: reference(value.provisioningId),
    requestHash: digest(value.requestHash),
    approvalId: reference(value.approvalId),
    approvalEvidenceHash: digest(value.approvalEvidenceHash),
    authorizedByReference: reference(value.authorizedByReference),
    authorityLevel: 3,
    authorizedFrom,
    authorizedUntil,
    canonicalModulePath: path(value.canonicalModulePath, SAFE_NATIVE_PATH),
    moduleSha256: digest(value.moduleSha256),
    moduleIdentityReference: value.moduleIdentityReference,
    moduleOwnerUid: nonnegativeInteger(value.moduleOwnerUid),
    moduleOwnerGid: nonnegativeInteger(value.moduleOwnerGid),
    moduleMode: 0o500,
    moduleSizeBytes: positiveInteger(value.moduleSizeBytes, MAX_MODULE_BYTES),
    socketDirectory: path(value.socketDirectory, SAFE_DIRECTORY_PATH),
    socketDirectoryIdentityReference: value.socketDirectoryIdentityReference,
    socketDirectoryOwnerUid: nonnegativeInteger(value.socketDirectoryOwnerUid),
    socketDirectoryOwnerGid: nonnegativeInteger(value.socketDirectoryOwnerGid),
    socketDirectoryMode: 0o700,
    socketPath: path(value.socketPath, SAFE_SOCKET_PATH, MAX_SOCKET_PATH_BYTES),
    runtimeConnection: 'NOT_CONFIGURED',
  } as Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths>);
}

function issueRequest(
  input: unknown,
): Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest> {
  const value = plainRecord(input, ISSUE_KEYS);
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_ISSUANCE' ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    (value.previousSnapshotHash !== null &&
      (typeof value.previousSnapshotHash !== 'string' || !SHA256.test(value.previousSnapshotHash)))
  )
    deny('INVALID_AUTHORIZATION');
  const workspaceId = reference(value.workspaceId);
  const supervisorInstanceId = reference(value.supervisorInstanceId);
  const entries = plainArray(value.authorizations, 2).map((raw) => {
    const entry = plainRecord(raw, ENTRY_KEYS);
    return Object.freeze({
      authorizationId: reference(entry.authorizationId),
      authorizationVersion: positiveInteger(entry.authorizationVersion),
      validFrom: timestamp(entry.validFrom),
      validUntil: timestamp(entry.validUntil),
      provisionedPaths: paths(entry.provisionedPaths),
    });
  });
  const kinds = entries.map((entry) => entry.provisionedPaths.moduleKind);
  if (
    new Set(kinds).size !== kinds.length ||
    new Set(entries.map((entry) => entry.authorizationId)).size !== entries.length ||
    entries.some(
      (entry) =>
        entry.provisionedPaths.workspaceId !== workspaceId ||
        entry.provisionedPaths.supervisorInstanceId !== supervisorInstanceId,
    ) ||
    (kinds.length === 2 && (kinds[0] !== 'CLIENT' || kinds[1] !== 'LISTENER'))
  )
    deny('INVALID_AUTHORIZATION');
  if (entries.length === 2) {
    const client = entries[0]!;
    const listener = entries[1]!;
    if (
      client.provisionedPaths.socketPath !== listener.provisionedPaths.socketPath ||
      client.provisionedPaths.socketDirectory !== listener.provisionedPaths.socketDirectory ||
      client.provisionedPaths.socketDirectoryIdentityReference !==
        listener.provisionedPaths.socketDirectoryIdentityReference ||
      client.provisionedPaths.socketDirectoryOwnerUid !==
        listener.provisionedPaths.socketDirectoryOwnerUid ||
      client.provisionedPaths.socketDirectoryOwnerGid !==
        listener.provisionedPaths.socketDirectoryOwnerGid
    )
      deny('INVALID_ATTESTATION');
  }
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_ISSUANCE',
    workspaceId,
    supervisorInstanceId,
    snapshotId: reference(value.snapshotId),
    snapshotVersion: positiveInteger(value.snapshotVersion),
    signerKeyId: reference(value.signerKeyId),
    previousSnapshotHash: value.previousSnapshotHash as string | null,
    issuedAt: timestamp(value.issuedAt),
    validUntil: timestamp(value.validUntil),
    authorizations: Object.freeze(entries),
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

/** Validates and freezes an issuance request before a composition root selects authority. */
export function validateRetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest(
  input: unknown,
): Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest> {
  return issueRequest(input);
}

export function retainedNativeSupervisorModuleAuthorizationSnapshotIssueRequestHash(
  request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest>,
): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

export function retainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequestHash(
  request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest>,
): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

function grant(
  input: unknown,
  request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest>,
) {
  const value = plainRecord(input, GRANT_KEYS);
  if (
    value.schemaVersion !== request.schemaVersion ||
    value.purpose !== request.purpose ||
    value.workspaceId !== request.workspaceId ||
    value.supervisorInstanceId !== request.supervisorInstanceId ||
    value.snapshotId !== request.snapshotId ||
    value.snapshotVersion !== request.snapshotVersion ||
    value.signerKeyId !== request.signerKeyId ||
    value.issuanceRequestHash !== request.issuanceRequestHash ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    value.authorityLevel !== 3 ||
    value.authorityRequestHash !==
      retainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequestHash(request)
  )
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    ...request,
    issuanceAuthorizationId: reference(value.issuanceAuthorizationId),
    authorityRequestHash: value.authorityRequestHash as string,
    approvalId: reference(value.approvalId),
    approvalEvidenceHash: digest(value.approvalEvidenceHash),
    authorizedByReference: reference(value.authorizedByReference),
    authorityLevel: 3 as const,
    validFrom: timestamp(value.validFrom),
    validUntil: timestamp(value.validUntil),
  });
}

function signingResult(
  input: unknown,
  request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest>,
) {
  const value = plainRecord(input, SIGNATURE_KEYS);
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== request.purpose ||
    value.signerKeyId !== request.signerKeyId ||
    value.snapshotPayloadHash !== request.snapshotPayloadHash ||
    typeof value.signature !== 'string' ||
    !ED25519_SIGNATURE.test(value.signature) ||
    Buffer.from(value.signature, 'base64').length !== 64 ||
    Buffer.from(value.signature, 'base64').toString('base64') !== value.signature
  )
    deny('INVALID_AUTHORIZATION');
  return value.signature;
}

function authorization(entry: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotEntry>) {
  const provisioned = entry.provisionedPaths;
  const request: LinuxRetainedNativeSupervisorModuleLoadRequest = Object.freeze({
    schemaVersion: 1,
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: provisioned.moduleKind,
    canonicalModulePath: provisioned.canonicalModulePath,
    socketPath: provisioned.socketPath,
    runtimeConnection: 'NOT_CONFIGURED',
  });
  return validateLinuxRetainedNativeSupervisorModuleAuthorization(
    Object.freeze({
      ...request,
      authorizationId: entry.authorizationId,
      authorizationVersion: entry.authorizationVersion,
      requestHash: linuxRetainedNativeSupervisorModuleLoadRequestHash(request),
      validFrom: entry.validFrom,
      validUntil: entry.validUntil,
      moduleSha256: provisioned.moduleSha256,
      moduleIdentityReference: provisioned.moduleIdentityReference,
      moduleOwnerUid: provisioned.moduleOwnerUid,
      moduleOwnerGid: provisioned.moduleOwnerGid,
      moduleMode: provisioned.moduleMode,
      moduleSizeBytes: provisioned.moduleSizeBytes,
      socketDirectory: provisioned.socketDirectory,
      socketDirectoryIdentityReference: provisioned.socketDirectoryIdentityReference,
      socketDirectoryOwnerUid: provisioned.socketDirectoryOwnerUid,
      socketDirectoryOwnerGid: provisioned.socketDirectoryOwnerGid,
      socketDirectoryMode: provisioned.socketDirectoryMode,
    }),
  );
}

export class BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController {
  #attempted = false;
  readonly #workspaceId: string;
  readonly #supervisorInstanceId: string;

  constructor(
    expectedWorkspaceId: string,
    expectedSupervisorInstanceId: string,
    private readonly authority: RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthority = new DenyRetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthority(),
    private readonly signer: RetainedNativeSupervisorModuleAuthorizationSnapshotSigner = new DenyRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(),
    private readonly publisher: RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationSink = new DenyRetainedNativeSupervisorModuleAuthorizationSnapshotPublicationSink(),
    private readonly clock: () => number = Date.now,
  ) {
    this.#workspaceId = reference(expectedWorkspaceId);
    this.#supervisorInstanceId = reference(expectedSupervisorInstanceId);
  }

  async issue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceReceipt>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('INVALID_AUTHORIZATION');
    const request = issueRequest(input);
    const now = this.clock();
    const issuedAt = Date.parse(request.issuedAt);
    const validUntil = Date.parse(request.validUntil);
    if (
      !Number.isFinite(now) ||
      request.workspaceId !== this.#workspaceId ||
      request.supervisorInstanceId !== this.#supervisorInstanceId ||
      issuedAt > now ||
      validUntil <= now ||
      validUntil <= issuedAt ||
      validUntil - issuedAt > MAX_LIFETIME_MS
    )
      deny('INVALID_AUTHORIZATION');
    for (const entry of request.authorizations) {
      const from = Date.parse(entry.validFrom);
      const until = Date.parse(entry.validUntil);
      if (
        from < issuedAt ||
        from > now ||
        until <= now ||
        until > validUntil ||
        until <= from ||
        until - from > MAX_LIFETIME_MS
      )
        deny('INVALID_AUTHORIZATION');
    }
    const authorityRequest = Object.freeze({
      schemaVersion: 1 as const,
      purpose: request.purpose,
      workspaceId: request.workspaceId,
      supervisorInstanceId: request.supervisorInstanceId,
      snapshotId: request.snapshotId,
      snapshotVersion: request.snapshotVersion,
      signerKeyId: request.signerKeyId,
      issuanceRequestHash:
        retainedNativeSupervisorModuleAuthorizationSnapshotIssueRequestHash(request),
      runtimeConnection: 'NOT_CONFIGURED' as const,
    });
    let approved;
    try {
      approved = grant(await this.authority.authorize(authorityRequest), authorityRequest);
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_AUTHORIZATION');
    }
    const afterApproval = this.clock();
    if (
      signal.aborted ||
      !Number.isFinite(afterApproval) ||
      afterApproval < now ||
      Date.parse(approved.validFrom) > afterApproval ||
      Date.parse(approved.validUntil) <= afterApproval ||
      Date.parse(approved.validUntil) <= Date.parse(approved.validFrom) ||
      Date.parse(approved.validUntil) - Date.parse(approved.validFrom) > MAX_LIFETIME_MS ||
      afterApproval >= validUntil ||
      request.authorizations.some((entry) => Date.parse(entry.validUntil) <= afterApproval)
    )
      deny('INVALID_AUTHORIZATION');
    const authorizations = Object.freeze(request.authorizations.map(authorization));
    const payload: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotPayload> =
      Object.freeze({
        schemaVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION',
        snapshotId: request.snapshotId,
        snapshotVersion: request.snapshotVersion,
        signerKeyId: request.signerKeyId,
        algorithm: 'ED25519',
        supervisorInstanceId: request.supervisorInstanceId,
        issuedAt: request.issuedAt,
        validUntil: request.validUntil,
        previousSnapshotHash: request.previousSnapshotHash,
        authorizations,
      });
    const snapshotPayloadHash = createHash('sha256').update(canonicalJson(payload)).digest('hex');
    const signingRequest = Object.freeze({
      schemaVersion: 1 as const,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT' as const,
      signerKeyId: request.signerKeyId,
      snapshotPayloadHash,
      payload,
    });
    let signature: string;
    try {
      signature = signingResult(await this.signer.sign(signingRequest), signingRequest);
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_AUTHORIZATION');
    }
    const beforePublish = this.clock();
    if (
      signal.aborted ||
      !Number.isFinite(beforePublish) ||
      beforePublish < afterApproval ||
      beforePublish >= validUntil ||
      beforePublish >= Date.parse(approved.validUntil)
    )
      deny('INVALID_AUTHORIZATION');
    const snapshot: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshot> = Object.freeze({
      ...payload,
      signature,
    });
    const issuance = new AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance(
      AUTHENTICATED_SNAPSHOT_ISSUANCE,
      Object.freeze({
        schemaVersion: 1,
        workspaceId: request.workspaceId,
        supervisorInstanceId: request.supervisorInstanceId,
        snapshotId: request.snapshotId,
        snapshotVersion: request.snapshotVersion,
        signerKeyId: request.signerKeyId,
        snapshotHash: snapshotPayloadHash,
        issuanceRequestHash: authorityRequest.issuanceRequestHash,
        issuanceAuthorizationId: approved.issuanceAuthorizationId,
        authorityRequestHash: approved.authorityRequestHash,
        approvalId: approved.approvalId,
        approvalEvidenceHash: approved.approvalEvidenceHash,
        authorizedByReference: approved.authorizedByReference,
        authorityLevel: 3,
        authorizedFrom: approved.validFrom,
        authorizedUntil: approved.validUntil,
        runtimeConnection: 'NOT_CONFIGURED',
      }),
    );
    let publication: 'APPENDED' | 'REPLAYED';
    try {
      publication = await this.publisher.publish(snapshot, issuance);
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('NOT_CONFIGURED');
    }
    if (publication !== 'APPENDED' && publication !== 'REPLAYED') deny('NOT_CONFIGURED');
    return Object.freeze({
      schemaVersion: 1,
      workspaceId: request.workspaceId,
      supervisorInstanceId: request.supervisorInstanceId,
      snapshotId: request.snapshotId,
      snapshotVersion: request.snapshotVersion,
      snapshotHash: snapshotPayloadHash,
      issuanceAuthorizationId: approved.issuanceAuthorizationId,
      approvalId: approved.approvalId,
      approvalEvidenceHash: approved.approvalEvidenceHash,
      publication,
      runtimeConnection: 'NOT_CONFIGURED',
    });
  }
}
