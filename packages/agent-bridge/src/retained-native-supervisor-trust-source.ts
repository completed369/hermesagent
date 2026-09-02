import { createHash, createPublicKey, type KeyObject, verify } from 'node:crypto';

import { canonicalJson } from './codec';
import {
  BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier,
  RetainedNativeSupervisorRecoveryError,
  type RetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorRecoveryResponse,
  type RetainedNativeSupervisorRecoveryResponseVerifier,
  type RetainedNativeSupervisorTrustRecord,
} from './retained-native-supervisor-recovery';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const MAX_ROOT_LIFETIME_MS = 5 * 366 * 24 * 60 * 60 * 1_000;
const MAX_SNAPSHOT_LIFETIME_MS = 15 * 60 * 1_000;

export interface RetainedNativeSupervisorTrustRootRecord {
  readonly schemaVersion: 1;
  readonly rootRecordId: string;
  readonly rootRecordVersion: number;
  readonly signerKeyId: string;
  readonly algorithm: 'ED25519';
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_TRUST_SNAPSHOT';
  readonly publicKeySpkiBase64: string;
  readonly publicKeySpkiSha256: string;
  readonly minimumSnapshotVersion: number;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revokedAt: string | null;
  readonly testOnly: false;
}

/**
 * Exactly one current key is active for a supervisor instance. A signed null
 * record is an explicit fail-closed revocation snapshot.
 */
export interface RetainedNativeSupervisorTrustSnapshot {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly signerKeyId: string;
  readonly algorithm: 'ED25519';
  readonly supervisorInstanceId: string;
  readonly issuedAt: string;
  readonly validUntil: string;
  readonly previousSnapshotHash: string | null;
  readonly record: Readonly<RetainedNativeSupervisorTrustRecord> | null;
  readonly signature: string;
}

export type RetainedNativeSupervisorTrustSnapshotPayload = Omit<
  RetainedNativeSupervisorTrustSnapshot,
  'signature'
>;

export interface RetainedNativeSupervisorTrustCheckpoint {
  readonly schemaVersion: 1;
  readonly supervisorInstanceId: string;
  readonly signerKeyId: string;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
  readonly activeSupervisorKeyId: string | null;
  readonly activePublicKeySpkiSha256: string | null;
  readonly activeTrustRecordId: string | null;
  readonly activeTrustRecordVersion: number | null;
}

export interface RetainedNativeSupervisorTrustSnapshotReader {
  read(): Promise<unknown>;
}

/** Durable supervisor-instance-scoped CAS state; implementations must survive restarts. */
export interface RetainedNativeSupervisorTrustCheckpointStore {
  read(supervisorInstanceId: string): Promise<unknown | null>;
  compareAndSwap(
    supervisorInstanceId: string,
    expected: Readonly<RetainedNativeSupervisorTrustCheckpoint> | null,
    next: Readonly<RetainedNativeSupervisorTrustCheckpoint>,
  ): Promise<boolean>;
}

export interface VerifiedRetainedNativeSupervisorTrustSnapshot {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
  readonly signerKeyId: string;
  readonly rootRecordId: string;
  readonly rootRecordVersion: number;
  readonly supervisorInstanceId: string;
  readonly supervisorKeyId: string;
  readonly trustRecordId: string;
  readonly trustRecordVersion: number;
  readonly issuedAt: string;
  readonly validUntil: string;
  readonly responseVerifier: RetainedNativeSupervisorRecoveryResponseVerifier;
}

export interface RetainedNativeSupervisorTrustSource {
  read(): Promise<Readonly<VerifiedRetainedNativeSupervisorTrustSnapshot>>;
}

interface ParsedRootRecord {
  readonly record: Readonly<RetainedNativeSupervisorTrustRootRecord>;
  readonly publicKey: KeyObject;
}

function deny(): never {
  throw new RetainedNativeSupervisorRecoveryError('NOT_CONFIGURED');
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
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_TRUST_SNAPSHOT' ||
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
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TRUST_SNAPSHOT' as const,
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

const TRUST_RECORD_KEYS = [
  'algorithm',
  'publicKeySpkiBase64',
  'publicKeySpkiSha256',
  'purpose',
  'revokedAt',
  'schemaVersion',
  'supervisorInstanceId',
  'supervisorKeyId',
  'testOnly',
  'trustRecordId',
  'trustRecordVersion',
  'validFrom',
  'validUntil',
] as const;

function exactTrustRecord(input: unknown): Readonly<RetainedNativeSupervisorTrustRecord> {
  const value = plainRecord(input, TRUST_RECORD_KEYS);
  return Object.freeze({ ...value }) as unknown as Readonly<RetainedNativeSupervisorTrustRecord>;
}

export function retainedNativeSupervisorTrustSnapshotPayload(
  snapshot: RetainedNativeSupervisorTrustSnapshot,
): RetainedNativeSupervisorTrustSnapshotPayload {
  const { signature: _signature, ...payload } = snapshot;
  return payload;
}

export function retainedNativeSupervisorTrustSnapshotHash(
  snapshot: RetainedNativeSupervisorTrustSnapshot,
): string {
  return createHash('sha256')
    .update(canonicalJson(retainedNativeSupervisorTrustSnapshotPayload(snapshot)))
    .digest('hex');
}

function parseSnapshot(input: unknown): Readonly<RetainedNativeSupervisorTrustSnapshot> {
  const value = plainRecord(input, [
    'algorithm',
    'issuedAt',
    'previousSnapshotHash',
    'record',
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
    value.algorithm !== 'ED25519' ||
    (value.previousSnapshotHash !== null &&
      (typeof value.previousSnapshotHash !== 'string' ||
        !SHA256.test(value.previousSnapshotHash))) ||
    typeof value.signature !== 'string' ||
    !ED25519_SIGNATURE.test(value.signature)
  )
    deny();
  return Object.freeze({
    schemaVersion: 1,
    snapshotId: reference(value.snapshotId),
    snapshotVersion: positiveInteger(value.snapshotVersion),
    signerKeyId: reference(value.signerKeyId),
    algorithm: 'ED25519',
    supervisorInstanceId: reference(value.supervisorInstanceId),
    issuedAt: timestamp(value.issuedAt),
    validUntil: timestamp(value.validUntil),
    previousSnapshotHash: value.previousSnapshotHash as string | null,
    record: value.record === null ? null : exactTrustRecord(value.record),
    signature: value.signature,
  });
}

function parseCheckpoint(input: unknown): Readonly<RetainedNativeSupervisorTrustCheckpoint> {
  const value = plainRecord(input, [
    'activePublicKeySpkiSha256',
    'activeSupervisorKeyId',
    'activeTrustRecordId',
    'activeTrustRecordVersion',
    'schemaVersion',
    'signerKeyId',
    'snapshotHash',
    'snapshotId',
    'snapshotVersion',
    'supervisorInstanceId',
  ]);
  const active = value.activeSupervisorKeyId !== null;
  if (
    value.schemaVersion !== 1 ||
    active !== (value.activePublicKeySpkiSha256 !== null) ||
    active !== (value.activeTrustRecordId !== null) ||
    active !== (value.activeTrustRecordVersion !== null)
  )
    deny();
  return Object.freeze({
    schemaVersion: 1,
    supervisorInstanceId: reference(value.supervisorInstanceId),
    signerKeyId: reference(value.signerKeyId),
    snapshotId: reference(value.snapshotId),
    snapshotVersion: positiveInteger(value.snapshotVersion),
    snapshotHash: digest(value.snapshotHash),
    activeSupervisorKeyId: active ? reference(value.activeSupervisorKeyId) : null,
    activePublicKeySpkiSha256: active ? digest(value.activePublicKeySpkiSha256) : null,
    activeTrustRecordId: active ? reference(value.activeTrustRecordId) : null,
    activeTrustRecordVersion: active ? positiveInteger(value.activeTrustRecordVersion) : null,
  });
}

function nextCheckpoint(
  snapshot: Readonly<RetainedNativeSupervisorTrustSnapshot>,
  snapshotHash: string,
): Readonly<RetainedNativeSupervisorTrustCheckpoint> {
  return Object.freeze({
    schemaVersion: 1,
    supervisorInstanceId: snapshot.supervisorInstanceId,
    signerKeyId: snapshot.signerKeyId,
    snapshotId: snapshot.snapshotId,
    snapshotVersion: snapshot.snapshotVersion,
    snapshotHash,
    activeSupervisorKeyId: snapshot.record?.supervisorKeyId ?? null,
    activePublicKeySpkiSha256: snapshot.record?.publicKeySpkiSha256 ?? null,
    activeTrustRecordId: snapshot.record?.trustRecordId ?? null,
    activeTrustRecordVersion: snapshot.record?.trustRecordVersion ?? null,
  });
}

function sameCheckpoint(
  left: Readonly<RetainedNativeSupervisorTrustCheckpoint>,
  right: Readonly<RetainedNativeSupervisorTrustCheckpoint>,
): boolean {
  return (
    left.signerKeyId === right.signerKeyId &&
    left.supervisorInstanceId === right.supervisorInstanceId &&
    left.snapshotId === right.snapshotId &&
    left.snapshotVersion === right.snapshotVersion &&
    left.snapshotHash === right.snapshotHash &&
    left.activeSupervisorKeyId === right.activeSupervisorKeyId &&
    left.activePublicKeySpkiSha256 === right.activePublicKeySpkiSha256 &&
    left.activeTrustRecordId === right.activeTrustRecordId &&
    left.activeTrustRecordVersion === right.activeTrustRecordVersion
  );
}

export class DenyRetainedNativeSupervisorTrustSource implements RetainedNativeSupervisorTrustSource {
  async read(): Promise<never> {
    deny();
  }
}

class SnapshotBoundRecoveryResponseVerifier implements RetainedNativeSupervisorRecoveryResponseVerifier {
  constructor(
    private readonly delegate: RetainedNativeSupervisorRecoveryResponseVerifier,
    private readonly validFrom: number,
    private readonly validUntil: number,
  ) {
    Object.freeze(this);
  }

  verify(
    response: unknown,
    request: Readonly<RetainedNativeSupervisorRecoveryRequest>,
    observedAt: Date,
  ): Readonly<RetainedNativeSupervisorRecoveryResponse> {
    if (
      !(observedAt instanceof Date) ||
      !Number.isFinite(observedAt.getTime()) ||
      observedAt.getTime() < this.validFrom ||
      observedAt.getTime() >= this.validUntil
    )
      deny();
    return this.delegate.verify(response, request, observedAt);
  }
}

/**
 * Authenticates one fresh, versioned supervisor-key decision and advances a
 * durable checkpoint before exposing any response-verification authority.
 */
export class BoundedRetainedNativeSupervisorTrustSource implements RetainedNativeSupervisorTrustSource {
  readonly #roots: ReadonlyMap<string, Readonly<ParsedRootRecord>>;
  readonly #supervisorInstanceId: string;

  constructor(
    expectedSupervisorInstanceId: string,
    private readonly reader: RetainedNativeSupervisorTrustSnapshotReader,
    private readonly checkpoints: RetainedNativeSupervisorTrustCheckpointStore,
    roots: readonly unknown[],
    private readonly clock: () => number = Date.now,
  ) {
    this.#supervisorInstanceId = reference(expectedSupervisorInstanceId);
    const parsed = roots.map(parseRootRecord);
    if (parsed.length === 0 || parsed.length > 8) deny();
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

  async read(): Promise<Readonly<VerifiedRetainedNativeSupervisorTrustSnapshot>> {
    let snapshot: Readonly<RetainedNativeSupervisorTrustSnapshot>;
    try {
      snapshot = parseSnapshot(await this.reader.read());
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
        Buffer.from(canonicalJson(retainedNativeSupervisorTrustSnapshotPayload(snapshot)), 'utf8'),
        root.publicKey,
        Buffer.from(snapshot.signature, 'base64'),
      )
    )
      deny();

    let responseVerifier: RetainedNativeSupervisorRecoveryResponseVerifier | null = null;
    if (snapshot.record !== null) {
      if (snapshot.record.supervisorInstanceId !== this.#supervisorInstanceId) deny();
      try {
        responseVerifier = new SnapshotBoundRecoveryResponseVerifier(
          new BoundedEd25519RetainedNativeSupervisorRecoveryResponseVerifier(snapshot.record),
          issuedAt,
          validUntil,
        );
      } catch {
        deny();
      }
    }
    const snapshotHash = retainedNativeSupervisorTrustSnapshotHash(snapshot);
    await this.#advanceCheckpoint(snapshot, nextCheckpoint(snapshot, snapshotHash));
    const finishedAt = this.clock();
    if (!Number.isFinite(finishedAt) || finishedAt < now || finishedAt >= validUntil) deny();
    if (snapshot.record === null || responseVerifier === null) deny();
    return Object.freeze({
      schemaVersion: 1,
      snapshotId: snapshot.snapshotId,
      snapshotVersion: snapshot.snapshotVersion,
      snapshotHash,
      signerKeyId: snapshot.signerKeyId,
      rootRecordId: root.record.rootRecordId,
      rootRecordVersion: root.record.rootRecordVersion,
      supervisorInstanceId: this.#supervisorInstanceId,
      supervisorKeyId: reference(snapshot.record.supervisorKeyId),
      trustRecordId: reference(snapshot.record.trustRecordId),
      trustRecordVersion: positiveInteger(snapshot.record.trustRecordVersion),
      issuedAt: snapshot.issuedAt,
      validUntil: snapshot.validUntil,
      responseVerifier,
    });
  }

  async #advanceCheckpoint(
    snapshot: Readonly<RetainedNativeSupervisorTrustSnapshot>,
    next: Readonly<RetainedNativeSupervisorTrustCheckpoint>,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let current: Readonly<RetainedNativeSupervisorTrustCheckpoint> | null;
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
        if (
          current.activeSupervisorKeyId !== null &&
          current.activeSupervisorKeyId === next.activeSupervisorKeyId &&
          current.activePublicKeySpkiSha256 !== next.activePublicKeySpkiSha256
        )
          deny();
        if (
          current.activeTrustRecordId !== null &&
          current.activeTrustRecordId === next.activeTrustRecordId &&
          next.activeTrustRecordVersion !== null &&
          current.activeTrustRecordVersion !== null &&
          next.activeTrustRecordVersion < current.activeTrustRecordVersion
        )
          deny();
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
