import { createHash, createPublicKey, type KeyObject, verify } from 'node:crypto';

import { canonicalJson } from './codec';
import {
  BoundedLinuxExecutableAuthorizationVerifier,
  type LinuxExecutableAuthorityTrustRecord,
  type LinuxExecutableAuthorizationVerifier,
  SupervisorAuthorizationError,
} from './supervision-authorization';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const MAX_ROOT_LIFETIME_MS = 5 * 366 * 24 * 60 * 60 * 1_000;
const MAX_SNAPSHOT_LIFETIME_MS = 15 * 60 * 1_000;

export interface LinuxExecutableAuthorityRootRecord {
  readonly schemaVersion: 1;
  readonly rootRecordId: string;
  readonly rootRecordVersion: number;
  readonly signerKeyId: string;
  readonly algorithm: 'ED25519';
  readonly purpose: 'LINUX_EXECUTABLE_AUTHORITY_TRUST_SNAPSHOT';
  readonly publicKeySpkiBase64: string;
  readonly publicKeySpkiSha256: string;
  readonly minimumSnapshotVersion: number;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revokedAt: string | null;
  readonly testOnly: false;
}

export interface LinuxExecutableAuthorityTrustSnapshot {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly signerKeyId: string;
  readonly algorithm: 'ED25519';
  readonly issuedAt: string;
  readonly validUntil: string;
  readonly previousSnapshotHash: string | null;
  readonly records: readonly LinuxExecutableAuthorityTrustRecord[];
  readonly signature: string;
}

export type LinuxExecutableAuthorityTrustSnapshotPayload = Omit<
  LinuxExecutableAuthorityTrustSnapshot,
  'signature'
>;

export interface LinuxExecutableAuthorityTrustCheckpoint {
  readonly schemaVersion: 1;
  readonly signerKeyId: string;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
}

export interface LinuxExecutableAuthorityTrustSnapshotReader {
  read(): Promise<unknown>;
}

/**
 * Trusted durable anti-rollback port. Implementations must provide atomic CAS
 * semantics for each signer key and retain checkpoints across process restarts.
 */
export interface LinuxExecutableAuthorityTrustCheckpointStore {
  read(signerKeyId: string): Promise<unknown | null>;
  compareAndSwap(
    signerKeyId: string,
    expected: Readonly<LinuxExecutableAuthorityTrustCheckpoint> | null,
    next: Readonly<LinuxExecutableAuthorityTrustCheckpoint>,
  ): Promise<boolean>;
}

export interface VerifiedLinuxExecutableAuthorityTrustSnapshot {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
  readonly signerKeyId: string;
  readonly rootRecordId: string;
  readonly rootRecordVersion: number;
  readonly issuedAt: string;
  readonly validUntil: string;
  readonly recordCount: number;
  readonly authorizationVerifier: LinuxExecutableAuthorizationVerifier;
}

export interface LinuxExecutableAuthorityTrustSource {
  read(): Promise<Readonly<VerifiedLinuxExecutableAuthorityTrustSnapshot>>;
}

export const LINUX_EXECUTABLE_AUTHORITY_TRUST_SOURCE = Symbol(
  'LINUX_EXECUTABLE_AUTHORITY_TRUST_SOURCE',
);

interface ParsedRootRecord {
  readonly record: Readonly<LinuxExecutableAuthorityRootRecord>;
  readonly publicKey: KeyObject;
}

function deny(): never {
  throw new SupervisorAuthorizationError();
}

function plainRecord(input: unknown, expected: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deny();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny();
  const record = input as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const ownKeys = Reflect.ownKeys(record);
  const keys = [...expected].sort();
  const descriptors = Object.getOwnPropertyDescriptors(record);
  if (
    actual.length !== keys.length ||
    ownKeys.length !== actual.length ||
    ownKeys.some((key) => typeof key !== 'string') ||
    actual.some((key, index) => key !== keys[index]) ||
    actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value'))
  )
    deny();
  return record;
}

function exactRecordArray(input: unknown): readonly LinuxExecutableAuthorityTrustRecord[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) deny();
  const keys = Object.keys(input);
  const ownKeys = Reflect.ownKeys(input);
  if (
    input.length === 0 ||
    input.length > 32 ||
    keys.length !== input.length ||
    ownKeys.length !== input.length + 1 ||
    ownKeys.some((key, index) => key !== (index === input.length ? 'length' : String(index))) ||
    keys.some((key, index) => key !== String(index))
  )
    deny();
  for (const item of input) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) deny();
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) deny();
    if (Reflect.ownKeys(item).length !== Object.keys(item).length) deny();
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, 'value')))
      deny();
  }
  return input as readonly LinuxExecutableAuthorityTrustRecord[];
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

function publicKey(value: Record<string, unknown>): KeyObject {
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
  let parsed: KeyObject;
  try {
    parsed = createPublicKey({ key: encoded, format: 'der', type: 'spki' });
  } catch {
    deny();
  }
  if (parsed.asymmetricKeyType !== 'ed25519') deny();
  return parsed;
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
    value.purpose !== 'LINUX_EXECUTABLE_AUTHORITY_TRUST_SNAPSHOT' ||
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
    purpose: 'LINUX_EXECUTABLE_AUTHORITY_TRUST_SNAPSHOT' as const,
    publicKeySpkiBase64: value.publicKeySpkiBase64 as string,
    publicKeySpkiSha256: value.publicKeySpkiSha256 as string,
    minimumSnapshotVersion: positiveInteger(value.minimumSnapshotVersion),
    validFrom,
    validUntil,
    revokedAt,
    testOnly: false as const,
  });
  return Object.freeze({ record, publicKey: publicKey(value) });
}

export function linuxExecutableAuthorityTrustSnapshotPayload(
  snapshot: LinuxExecutableAuthorityTrustSnapshot,
): LinuxExecutableAuthorityTrustSnapshotPayload {
  const { signature: _signature, ...payload } = snapshot;
  return payload;
}

export function linuxExecutableAuthorityTrustSnapshotHash(
  snapshot: LinuxExecutableAuthorityTrustSnapshot,
): string {
  return createHash('sha256')
    .update(canonicalJson(linuxExecutableAuthorityTrustSnapshotPayload(snapshot)))
    .digest('hex');
}

function parseSnapshot(input: unknown): Readonly<LinuxExecutableAuthorityTrustSnapshot> {
  const value = plainRecord(input, [
    'algorithm',
    'issuedAt',
    'previousSnapshotHash',
    'records',
    'schemaVersion',
    'signature',
    'signerKeyId',
    'snapshotId',
    'snapshotVersion',
    'validUntil',
  ]);
  if (
    value.schemaVersion !== 1 ||
    value.algorithm !== 'ED25519' ||
    !Array.isArray(value.records) ||
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
    issuedAt: timestamp(value.issuedAt),
    validUntil: timestamp(value.validUntil),
    previousSnapshotHash: value.previousSnapshotHash as string | null,
    records: exactRecordArray(value.records),
    signature: value.signature,
  });
}

function parseCheckpoint(input: unknown): Readonly<LinuxExecutableAuthorityTrustCheckpoint> {
  const value = plainRecord(input, [
    'schemaVersion',
    'signerKeyId',
    'snapshotHash',
    'snapshotId',
    'snapshotVersion',
  ]);
  if (value.schemaVersion !== 1) deny();
  return Object.freeze({
    schemaVersion: 1,
    signerKeyId: reference(value.signerKeyId),
    snapshotId: reference(value.snapshotId),
    snapshotVersion: positiveInteger(value.snapshotVersion),
    snapshotHash: digest(value.snapshotHash),
  });
}

function nextCheckpoint(
  snapshot: Readonly<LinuxExecutableAuthorityTrustSnapshot>,
  snapshotHash: string,
): Readonly<LinuxExecutableAuthorityTrustCheckpoint> {
  return Object.freeze({
    schemaVersion: 1,
    signerKeyId: snapshot.signerKeyId,
    snapshotId: snapshot.snapshotId,
    snapshotVersion: snapshot.snapshotVersion,
    snapshotHash,
  });
}

function sameCheckpoint(
  left: Readonly<LinuxExecutableAuthorityTrustCheckpoint>,
  right: Readonly<LinuxExecutableAuthorityTrustCheckpoint>,
): boolean {
  return (
    left.signerKeyId === right.signerKeyId &&
    left.snapshotId === right.snapshotId &&
    left.snapshotVersion === right.snapshotVersion &&
    left.snapshotHash === right.snapshotHash
  );
}

export class DenyLinuxExecutableAuthorityTrustSource implements LinuxExecutableAuthorityTrustSource {
  async read(): Promise<never> {
    deny();
  }
}

class SnapshotBoundAuthorizationVerifier implements LinuxExecutableAuthorizationVerifier {
  constructor(
    private readonly delegate: LinuxExecutableAuthorizationVerifier,
    private readonly validFrom: number,
    private readonly validUntil: number,
    private readonly clock: () => number,
  ) {
    Object.freeze(this);
  }

  verify(input: unknown) {
    const before = this.clock();
    if (!Number.isFinite(before) || before < this.validFrom || before >= this.validUntil) deny();
    const authorization = this.delegate.verify(input);
    const after = this.clock();
    if (!Number.isFinite(after) || after < before || after >= this.validUntil) deny();
    return authorization;
  }
}

/**
 * Authenticates bounded trust snapshots and advances a durable monotonic
 * checkpoint before exposing a verifier. Reader, checkpoint store, and root
 * records are explicit composition-root trust decisions; no ambient source is
 * consulted.
 */
export class BoundedLinuxExecutableAuthorityTrustSource implements LinuxExecutableAuthorityTrustSource {
  readonly #roots: ReadonlyMap<string, Readonly<ParsedRootRecord>>;

  constructor(
    private readonly reader: LinuxExecutableAuthorityTrustSnapshotReader,
    private readonly checkpoints: LinuxExecutableAuthorityTrustCheckpointStore,
    roots: readonly unknown[],
    private readonly clock: () => number = Date.now,
  ) {
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

  async read(): Promise<Readonly<VerifiedLinuxExecutableAuthorityTrustSnapshot>> {
    let snapshot: Readonly<LinuxExecutableAuthorityTrustSnapshot>;
    try {
      snapshot = parseSnapshot(await this.reader.read());
    } catch {
      deny();
    }
    const root = this.#roots.get(snapshot.signerKeyId);
    if (!root) deny();
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
        Buffer.from(canonicalJson(linuxExecutableAuthorityTrustSnapshotPayload(snapshot)), 'utf8'),
        root.publicKey,
        Buffer.from(snapshot.signature, 'base64'),
      )
    )
      deny();

    let authorizationVerifier: LinuxExecutableAuthorizationVerifier;
    try {
      authorizationVerifier = new SnapshotBoundAuthorizationVerifier(
        new BoundedLinuxExecutableAuthorizationVerifier(snapshot.records, this.clock),
        issuedAt,
        validUntil,
        this.clock,
      );
    } catch {
      deny();
    }
    const snapshotHash = linuxExecutableAuthorityTrustSnapshotHash(snapshot);
    const checkpoint = nextCheckpoint(snapshot, snapshotHash);
    await this.#advanceCheckpoint(snapshot, checkpoint);
    return Object.freeze({
      schemaVersion: 1,
      snapshotId: snapshot.snapshotId,
      snapshotVersion: snapshot.snapshotVersion,
      snapshotHash,
      signerKeyId: snapshot.signerKeyId,
      rootRecordId: root.record.rootRecordId,
      rootRecordVersion: root.record.rootRecordVersion,
      issuedAt: snapshot.issuedAt,
      validUntil: snapshot.validUntil,
      recordCount: snapshot.records.length,
      authorizationVerifier,
    });
  }

  async #advanceCheckpoint(
    snapshot: Readonly<LinuxExecutableAuthorityTrustSnapshot>,
    next: Readonly<LinuxExecutableAuthorityTrustCheckpoint>,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let current: Readonly<LinuxExecutableAuthorityTrustCheckpoint> | null;
      try {
        const stored = await this.checkpoints.read(snapshot.signerKeyId);
        current = stored === null ? null : parseCheckpoint(stored);
      } catch {
        deny();
      }
      if (current !== null) {
        if (current.signerKeyId !== snapshot.signerKeyId) deny();
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
      } else if (snapshot.previousSnapshotHash !== null) {
        deny();
      }
      try {
        if (await this.checkpoints.compareAndSwap(snapshot.signerKeyId, current, next)) return;
      } catch {
        deny();
      }
    }
    deny();
  }
}
