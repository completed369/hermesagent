import { createHash, createPublicKey, type KeyObject, verify } from 'node:crypto';

import { canonicalJson } from './codec';
import {
  linuxRetainedNativeSupervisorModuleAuthorizationHash,
  linuxRetainedNativeSupervisorModuleLoadRequestHash,
  type LinuxRetainedNativeSupervisorModuleAuthorization,
  type LinuxRetainedNativeSupervisorModuleAuthorizationSource,
  type LinuxRetainedNativeSupervisorModuleKind,
  type LinuxRetainedNativeSupervisorModuleLoadRequest,
  validateLinuxRetainedNativeSupervisorModuleAuthorization,
  validateLinuxRetainedNativeSupervisorModuleLoadRequest,
} from './retained-native-supervisor-linux-module-loader';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const MAX_ROOT_LIFETIME_MS = 5 * 366 * 24 * 60 * 60 * 1_000;
const MAX_SNAPSHOT_LIFETIME_MS = 5 * 60 * 1_000;

export interface RetainedNativeSupervisorModuleAuthorizationRootRecord {
  readonly schemaVersion: 1;
  readonly rootRecordId: string;
  readonly rootRecordVersion: number;
  readonly signerKeyId: string;
  readonly algorithm: 'ED25519';
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT';
  readonly publicKeySpkiBase64: string;
  readonly publicKeySpkiSha256: string;
  readonly minimumSnapshotVersion: number;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revokedAt: string | null;
  readonly testOnly: false;
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshot {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION';
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly signerKeyId: string;
  readonly algorithm: 'ED25519';
  readonly supervisorInstanceId: string;
  readonly issuedAt: string;
  readonly validUntil: string;
  readonly previousSnapshotHash: string | null;
  readonly authorizations: readonly Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>[];
  readonly signature: string;
}

export type RetainedNativeSupervisorModuleAuthorizationSnapshotPayload = Omit<
  RetainedNativeSupervisorModuleAuthorizationSnapshot,
  'signature'
>;

export interface RetainedNativeSupervisorModuleAuthorizationCheckpoint {
  readonly schemaVersion: 1;
  readonly supervisorInstanceId: string;
  readonly signerKeyId: string;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
  readonly clientAuthorizationId: string | null;
  readonly clientAuthorizationVersion: number | null;
  readonly clientAuthorizationHash: string | null;
  readonly listenerAuthorizationId: string | null;
  readonly listenerAuthorizationVersion: number | null;
  readonly listenerAuthorizationHash: string | null;
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotReader {
  read(): Promise<unknown>;
}

/** Implementations must provide durable, instance-scoped compare-and-swap state. */
export interface RetainedNativeSupervisorModuleAuthorizationCheckpointStore {
  read(supervisorInstanceId: string): Promise<unknown | null>;
  compareAndSwap(
    supervisorInstanceId: string,
    expected: Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint> | null,
    next: Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint>,
  ): Promise<boolean>;
}

interface ParsedRootRecord {
  readonly record: Readonly<RetainedNativeSupervisorModuleAuthorizationRootRecord>;
  readonly publicKey: KeyObject;
}

const AUTHENTICATED_SNAPSHOT = Symbol('authenticated-retained-native-module-snapshot');

export class AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot {
  readonly #token: symbol;

  constructor(
    token: symbol,
    readonly snapshot: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshot>,
    readonly snapshotHash: string,
    readonly authenticatedAt: number,
  ) {
    if (token !== AUTHENTICATED_SNAPSHOT) deny();
    this.#token = token;
    Object.freeze(this);
  }

  static assertAuthenticated(
    value: unknown,
  ): asserts value is AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot {
    try {
      if (
        !(value instanceof AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot) ||
        value.#token !== AUTHENTICATED_SNAPSHOT
      )
        deny();
    } catch {
      deny();
    }
  }
}

export interface RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore {
  append(
    authenticated: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot,
  ): Promise<'APPENDED' | 'REPLAYED'>;
}

function deny(): never {
  throw new RetainedNativeSupervisorLocalIpcError('NOT_CONFIGURED');
}

function plainRecord(input: unknown, expected: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deny();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny();
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
    deny();
  return value;
}

function plainArray(input: unknown, maximum: number): readonly unknown[] {
  if (
    !Array.isArray(input) ||
    input.length > maximum ||
    Object.getPrototypeOf(input) !== Array.prototype
  )
    deny();
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
    deny();
  return input;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value)) deny();
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000)
    deny();
  return value as number;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') deny();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) deny();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) deny();
  return value;
}

function signature(value: unknown): string {
  if (typeof value !== 'string' || !ED25519_SIGNATURE.test(value)) deny();
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 64 || decoded.toString('base64') !== value) deny();
  return value;
}

function parsePublicKey(value: Record<string, unknown>): KeyObject {
  if (
    typeof value.publicKeySpkiBase64 !== 'string' ||
    value.publicKeySpkiBase64.length > 256 ||
    !BASE64.test(value.publicKeySpkiBase64) ||
    typeof value.publicKeySpkiSha256 !== 'string' ||
    !SHA256.test(value.publicKeySpkiSha256)
  )
    deny();
  const encoded = Buffer.from(value.publicKeySpkiBase64, 'base64');
  if (
    encoded.length === 0 ||
    encoded.toString('base64') !== value.publicKeySpkiBase64 ||
    createHash('sha256').update(encoded).digest('hex') !== value.publicKeySpkiSha256
  )
    deny();
  let key: KeyObject;
  try {
    key = createPublicKey({ key: encoded, format: 'der', type: 'spki' });
  } catch {
    deny();
  }
  if (key.asymmetricKeyType !== 'ed25519') deny();
  return key;
}

function parseRootRecord(input: unknown): Readonly<ParsedRootRecord> {
  const value = plainRecord(input, [
    'algorithm',
    'minimumSnapshotVersion',
    'publicKeySpkiBase64',
    'publicKeySpkiSha256',
    'purpose',
    'revokedAt',
    'rootRecordId',
    'rootRecordVersion',
    'schemaVersion',
    'signerKeyId',
    'testOnly',
    'validFrom',
    'validUntil',
  ]);
  if (
    value.schemaVersion !== 1 ||
    value.algorithm !== 'ED25519' ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT' ||
    value.testOnly !== false ||
    (value.revokedAt !== null && typeof value.revokedAt !== 'string')
  )
    deny();
  const validFrom = timestamp(value.validFrom);
  const validUntil = timestamp(value.validUntil);
  const revokedAt = value.revokedAt === null ? null : timestamp(value.revokedAt);
  const validFromMs = Date.parse(validFrom);
  const validUntilMs = Date.parse(validUntil);
  if (
    validUntilMs <= validFromMs ||
    validUntilMs - validFromMs > MAX_ROOT_LIFETIME_MS ||
    (revokedAt !== null &&
      (Date.parse(revokedAt) < validFromMs || Date.parse(revokedAt) > validUntilMs))
  )
    deny();
  const record = Object.freeze({
    schemaVersion: 1 as const,
    rootRecordId: reference(value.rootRecordId),
    rootRecordVersion: positiveInteger(value.rootRecordVersion),
    signerKeyId: reference(value.signerKeyId),
    algorithm: 'ED25519' as const,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT' as const,
    publicKeySpkiBase64: value.publicKeySpkiBase64 as string,
    publicKeySpkiSha256: value.publicKeySpkiSha256 as string,
    minimumSnapshotVersion: positiveInteger(value.minimumSnapshotVersion),
    validFrom,
    validUntil,
    revokedAt,
    testOnly: false as const,
  });
  return Object.freeze({ record, publicKey: parsePublicKey(value) });
}

/**
 * Parses and freezes one public verification-root record without retaining the
 * derived crypto key. Persistence adapters use this to share the exact same
 * fail-closed wire validation as the runtime authenticator.
 */
export function validateRetainedNativeSupervisorModuleAuthorizationRootRecord(
  input: unknown,
): Readonly<RetainedNativeSupervisorModuleAuthorizationRootRecord> {
  return parseRootRecord(input).record;
}

export function retainedNativeSupervisorModuleAuthorizationSnapshotPayload(
  snapshot: RetainedNativeSupervisorModuleAuthorizationSnapshot,
): RetainedNativeSupervisorModuleAuthorizationSnapshotPayload {
  const { signature: _signature, ...payload } = snapshot;
  return payload;
}

export function retainedNativeSupervisorModuleAuthorizationSnapshotHash(
  snapshot: RetainedNativeSupervisorModuleAuthorizationSnapshot,
): string {
  return createHash('sha256')
    .update(canonicalJson(retainedNativeSupervisorModuleAuthorizationSnapshotPayload(snapshot)))
    .digest('hex');
}

function parseSnapshot(
  input: unknown,
): Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshot> {
  const value = plainRecord(input, [
    'algorithm',
    'authorizations',
    'issuedAt',
    'previousSnapshotHash',
    'purpose',
    'schemaVersion',
    'signature',
    'signerKeyId',
    'snapshotId',
    'snapshotVersion',
    'supervisorInstanceId',
    'validUntil',
  ]);
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION' ||
    value.algorithm !== 'ED25519' ||
    (value.previousSnapshotHash !== null &&
      (typeof value.previousSnapshotHash !== 'string' ||
        !SHA256.test(value.previousSnapshotHash))) ||
    typeof value.signature !== 'string'
  )
    deny();
  const rawAuthorizations = plainArray(value.authorizations, 2);
  let authorizations: readonly Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>[];
  try {
    authorizations = Object.freeze(
      rawAuthorizations.map(validateLinuxRetainedNativeSupervisorModuleAuthorization),
    );
  } catch {
    deny();
  }
  const kinds = authorizations.map((authorization) => authorization.moduleKind);
  if (
    new Set(kinds).size !== kinds.length ||
    (kinds.length === 2 && (kinds[0] !== 'CLIENT' || kinds[1] !== 'LISTENER'))
  )
    deny();
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION',
    snapshotId: reference(value.snapshotId),
    snapshotVersion: positiveInteger(value.snapshotVersion),
    signerKeyId: reference(value.signerKeyId),
    algorithm: 'ED25519',
    supervisorInstanceId: reference(value.supervisorInstanceId),
    issuedAt: timestamp(value.issuedAt),
    validUntil: timestamp(value.validUntil),
    previousSnapshotHash: value.previousSnapshotHash as string | null,
    authorizations,
    signature: signature(value.signature),
  });
}

function optionalAuthorizationFields(
  value: Record<string, unknown>,
  kind: 'client' | 'listener',
): { id: string | null; version: number | null; hash: string | null } {
  const id = value[`${kind}AuthorizationId`];
  const version = value[`${kind}AuthorizationVersion`];
  const hash = value[`${kind}AuthorizationHash`];
  const active = id !== null;
  if (active !== (version !== null) || active !== (hash !== null)) deny();
  return {
    id: active ? reference(id) : null,
    version: active ? positiveInteger(version) : null,
    hash: active ? digest(hash) : null,
  };
}

function parseCheckpoint(
  input: unknown,
): Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint> {
  const value = plainRecord(input, [
    'clientAuthorizationHash',
    'clientAuthorizationId',
    'clientAuthorizationVersion',
    'listenerAuthorizationHash',
    'listenerAuthorizationId',
    'listenerAuthorizationVersion',
    'schemaVersion',
    'signerKeyId',
    'snapshotHash',
    'snapshotId',
    'snapshotVersion',
    'supervisorInstanceId',
  ]);
  if (value.schemaVersion !== 1) deny();
  const client = optionalAuthorizationFields(value, 'client');
  const listener = optionalAuthorizationFields(value, 'listener');
  return Object.freeze({
    schemaVersion: 1,
    supervisorInstanceId: reference(value.supervisorInstanceId),
    signerKeyId: reference(value.signerKeyId),
    snapshotId: reference(value.snapshotId),
    snapshotVersion: positiveInteger(value.snapshotVersion),
    snapshotHash: digest(value.snapshotHash),
    clientAuthorizationId: client.id,
    clientAuthorizationVersion: client.version,
    clientAuthorizationHash: client.hash,
    listenerAuthorizationId: listener.id,
    listenerAuthorizationVersion: listener.version,
    listenerAuthorizationHash: listener.hash,
  });
}

function authorizationFor(
  snapshot: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshot>,
  kind: LinuxRetainedNativeSupervisorModuleKind,
): Readonly<LinuxRetainedNativeSupervisorModuleAuthorization> | undefined {
  return snapshot.authorizations.find((authorization) => authorization.moduleKind === kind);
}

function nextCheckpoint(
  snapshot: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshot>,
  snapshotHash: string,
): Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint> {
  const client = authorizationFor(snapshot, 'CLIENT');
  const listener = authorizationFor(snapshot, 'LISTENER');
  return Object.freeze({
    schemaVersion: 1,
    supervisorInstanceId: snapshot.supervisorInstanceId,
    signerKeyId: snapshot.signerKeyId,
    snapshotId: snapshot.snapshotId,
    snapshotVersion: snapshot.snapshotVersion,
    snapshotHash,
    clientAuthorizationId: client?.authorizationId ?? null,
    clientAuthorizationVersion: client?.authorizationVersion ?? null,
    clientAuthorizationHash: client
      ? linuxRetainedNativeSupervisorModuleAuthorizationHash(client)
      : null,
    listenerAuthorizationId: listener?.authorizationId ?? null,
    listenerAuthorizationVersion: listener?.authorizationVersion ?? null,
    listenerAuthorizationHash: listener
      ? linuxRetainedNativeSupervisorModuleAuthorizationHash(listener)
      : null,
  });
}

function sameCheckpoint(
  left: Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint>,
  right: Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint>,
): boolean {
  return Object.keys(left).every(
    (key) =>
      left[key as keyof RetainedNativeSupervisorModuleAuthorizationCheckpoint] ===
      right[key as keyof RetainedNativeSupervisorModuleAuthorizationCheckpoint],
  );
}

export class BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator {
  readonly #roots: ReadonlyMap<string, Readonly<ParsedRootRecord>>;
  readonly #supervisorInstanceId: string;

  constructor(
    expectedSupervisorInstanceId: string,
    roots: readonly unknown[],
    private readonly clock: () => number = Date.now,
  ) {
    this.#supervisorInstanceId = reference(expectedSupervisorInstanceId);
    const parsed = plainArray(roots, 8).map(parseRootRecord);
    if (parsed.length === 0) deny();
    const bySigner = new Map<string, Readonly<ParsedRootRecord>>();
    const ids = new Set<string>();
    const fingerprints = new Set<string>();
    for (const root of parsed) {
      if (
        bySigner.has(root.record.signerKeyId) ||
        ids.has(root.record.rootRecordId) ||
        fingerprints.has(root.record.publicKeySpkiSha256)
      )
        deny();
      bySigner.set(root.record.signerKeyId, root);
      ids.add(root.record.rootRecordId);
      fingerprints.add(root.record.publicKeySpkiSha256);
    }
    this.#roots = bySigner;
    Object.freeze(this);
  }

  authenticate(input: unknown): AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot {
    let snapshot: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshot>;
    try {
      snapshot = parseSnapshot(input);
    } catch {
      deny();
    }
    const root = this.#roots.get(snapshot.signerKeyId);
    if (!root || snapshot.supervisorInstanceId !== this.#supervisorInstanceId) deny();
    const now = this.clock();
    const issuedAt = Date.parse(snapshot.issuedAt);
    const validUntil = Date.parse(snapshot.validUntil);
    const rootFrom = Date.parse(root.record.validFrom);
    const rootUntil = Date.parse(root.record.validUntil);
    const revokedAt = root.record.revokedAt === null ? null : Date.parse(root.record.revokedAt);
    if (
      !Number.isFinite(now) ||
      snapshot.snapshotVersion < root.record.minimumSnapshotVersion ||
      issuedAt > now ||
      validUntil <= now ||
      validUntil <= issuedAt ||
      validUntil - issuedAt > MAX_SNAPSHOT_LIFETIME_MS ||
      issuedAt < rootFrom ||
      validUntil > rootUntil ||
      rootFrom > now ||
      rootUntil <= now ||
      (revokedAt !== null && (now >= revokedAt || validUntil > revokedAt)) ||
      !verify(
        null,
        Buffer.from(
          canonicalJson(retainedNativeSupervisorModuleAuthorizationSnapshotPayload(snapshot)),
          'utf8',
        ),
        root.publicKey,
        Buffer.from(snapshot.signature, 'base64'),
      )
    )
      deny();
    for (const authorization of snapshot.authorizations) {
      if (
        Date.parse(authorization.validFrom) < issuedAt ||
        Date.parse(authorization.validUntil) > validUntil
      )
        deny();
    }
    return new AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot(
      AUTHENTICATED_SNAPSHOT,
      snapshot,
      retainedNativeSupervisorModuleAuthorizationSnapshotHash(snapshot),
      now,
    );
  }
}

export class DenyRetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore implements RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore {
  async append(
    _authenticated: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot,
  ): Promise<never> {
    deny();
  }
}

export class BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotPublisher {
  readonly #authenticator: BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator;

  constructor(
    expectedSupervisorInstanceId: string,
    roots: readonly unknown[],
    private readonly store: RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore = new DenyRetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore(),
    clock: () => number = Date.now,
  ) {
    this.#authenticator =
      new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator(
        expectedSupervisorInstanceId,
        roots,
        clock,
      );
    Object.freeze(this);
  }

  async publish(input: unknown): Promise<'APPENDED' | 'REPLAYED'> {
    const authenticated = this.#authenticator.authenticate(input);
    let result: 'APPENDED' | 'REPLAYED';
    try {
      result = await this.store.append(authenticated);
    } catch {
      deny();
    }
    if (result !== 'APPENDED' && result !== 'REPLAYED') deny();
    return result;
  }
}

export class DenyRetainedNativeSupervisorModuleAuthorizationTrustSource implements LinuxRetainedNativeSupervisorModuleAuthorizationSource {
  async read(_request: Readonly<LinuxRetainedNativeSupervisorModuleLoadRequest>): Promise<never> {
    deny();
  }
}

/**
 * Authenticates one fresh module-authorization snapshot and advances its
 * durable monotonic checkpoint before exposing an exact request-bound grant.
 */
export class BoundedRetainedNativeSupervisorModuleAuthorizationTrustSource implements LinuxRetainedNativeSupervisorModuleAuthorizationSource {
  readonly #authenticator: BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator;

  constructor(
    expectedSupervisorInstanceId: string,
    private readonly reader: RetainedNativeSupervisorModuleAuthorizationSnapshotReader,
    private readonly checkpoints: RetainedNativeSupervisorModuleAuthorizationCheckpointStore,
    roots: readonly unknown[],
    private readonly clock: () => number = Date.now,
  ) {
    this.#authenticator =
      new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator(
        expectedSupervisorInstanceId,
        roots,
        clock,
      );
    Object.freeze(this);
  }

  async read(
    request: Readonly<LinuxRetainedNativeSupervisorModuleLoadRequest>,
  ): Promise<Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>> {
    let validatedRequest: Readonly<LinuxRetainedNativeSupervisorModuleLoadRequest>;
    try {
      validatedRequest = validateLinuxRetainedNativeSupervisorModuleLoadRequest(request);
    } catch {
      deny();
    }
    let authenticated: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot;
    try {
      authenticated = this.#authenticator.authenticate(await this.reader.read());
    } catch {
      deny();
    }
    const { snapshot, snapshotHash } = authenticated;
    const now = authenticated.authenticatedAt;
    const validUntil = Date.parse(snapshot.validUntil);
    await this.#advanceCheckpoint(snapshot, nextCheckpoint(snapshot, snapshotHash));
    const finishedAt = this.clock();
    if (!Number.isFinite(finishedAt) || finishedAt < now || finishedAt >= validUntil) deny();
    const requestHash = linuxRetainedNativeSupervisorModuleLoadRequestHash(validatedRequest);
    const authorization = snapshot.authorizations.find(
      (candidate) =>
        candidate.moduleKind === validatedRequest.moduleKind &&
        candidate.requestHash === requestHash &&
        candidate.canonicalModulePath === validatedRequest.canonicalModulePath &&
        candidate.socketPath === validatedRequest.socketPath,
    );
    if (authorization === undefined) deny();
    if (
      Date.parse(authorization.validFrom) > finishedAt ||
      Date.parse(authorization.validUntil) <= finishedAt
    )
      deny();
    return authorization;
  }

  async #advanceCheckpoint(
    snapshot: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshot>,
    next: Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint>,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let current: Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint> | null;
      try {
        const stored = await this.checkpoints.read(snapshot.supervisorInstanceId);
        current = stored === null ? null : parseCheckpoint(stored);
      } catch {
        deny();
      }
      if (current !== null) {
        if (current.supervisorInstanceId !== snapshot.supervisorInstanceId) deny();
        if (snapshot.snapshotVersion < current.snapshotVersion) deny();
        if (snapshot.snapshotVersion === current.snapshotVersion) {
          if (!sameCheckpoint(current, next)) deny();
          return;
        }
        if (
          snapshot.snapshotVersion !== current.snapshotVersion + 1 ||
          snapshot.previousSnapshotHash !== current.snapshotHash
        )
          deny();
        for (const kind of ['client', 'listener'] as const) {
          const currentId = current[`${kind}AuthorizationId`];
          const currentVersion = current[`${kind}AuthorizationVersion`];
          const currentHash = current[`${kind}AuthorizationHash`];
          const nextId = next[`${kind}AuthorizationId`];
          const nextVersion = next[`${kind}AuthorizationVersion`];
          const nextHash = next[`${kind}AuthorizationHash`];
          if (
            currentId !== null &&
            currentId === nextId &&
            currentVersion !== null &&
            nextVersion !== null &&
            (nextVersion < currentVersion ||
              (nextVersion === currentVersion && nextHash !== currentHash))
          )
            deny();
        }
      } else if (snapshot.previousSnapshotHash !== null) {
        deny();
      }
      try {
        if (await this.checkpoints.compareAndSwap(snapshot.supervisorInstanceId, current, next))
          return;
      } catch {
        deny();
      }
    }
    deny();
  }
}
