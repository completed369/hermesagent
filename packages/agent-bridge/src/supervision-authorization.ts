import { createHash, createPublicKey, type KeyObject, verify } from 'node:crypto';

import { canonicalJson } from './codec';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const MAX_AUTHORIZATION_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_TRUST_RECORD_LIFETIME_MS = 366 * 24 * 60 * 60 * 1_000;
export const TEST_EXECUTABLE_AUTHORITY_KEY_ID = 'ventureos-test-executable-authority-v1';
const TEST_SIGNER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA3WTv/WkFWYJB+O7cnVrQWgt7B3viN00IuDAmvAPy1Iw=
-----END PUBLIC KEY-----`;

export interface LinuxExecutableAuthorization {
  readonly schemaVersion: 1;
  readonly authorizationId: string;
  readonly authorizationVersion: number;
  readonly signerKeyId: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly adapterKind: string;
  readonly testOnly: boolean;
  readonly canonicalPath: string;
  readonly sha256: string;
  readonly identityReference: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly mode: number;
  readonly authorizedWorktreeRoot: string;
  readonly argumentPolicyReference: string;
  readonly signature: string;
}

export type LinuxExecutableAuthorizationPayload = Omit<LinuxExecutableAuthorization, 'signature'>;

export interface LinuxExecutableAuthorityTrustRecord {
  readonly schemaVersion: 1;
  readonly trustRecordId: string;
  readonly trustRecordVersion: number;
  readonly signerKeyId: string;
  readonly algorithm: 'ED25519';
  readonly publicKeySpkiBase64: string;
  readonly publicKeySpkiSha256: string;
  readonly adapterKind: string;
  readonly argumentPolicyReference: string;
  readonly authorizedWorktreeRoot: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revokedAt: string | null;
  readonly testOnly: false;
}

/**
 * Trusted signature-verification port. Implementations must validate the exact
 * authorization shape, signature, trust root, validity window, and test-only
 * policy before returning a normalized authorization.
 */
export interface LinuxExecutableAuthorizationVerifier {
  verify(input: unknown): Readonly<LinuxExecutableAuthorization>;
}

export const LINUX_EXECUTABLE_AUTHORIZATION_VERIFIER = Symbol(
  'LINUX_EXECUTABLE_AUTHORIZATION_VERIFIER',
);

export class SupervisorAuthorizationError extends Error {
  constructor() {
    super('Runtime executable authorization denied');
  }
}

function deny(): never {
  throw new SupervisorAuthorizationError();
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value)) deny();
  return value;
}

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) deny();
  return value as number;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') deny();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) deny();
  return value;
}

export function linuxExecutableAuthorizationPayload(
  authorization: LinuxExecutableAuthorization,
): LinuxExecutableAuthorizationPayload {
  const { signature: _signature, ...payload } = authorization;
  return payload;
}

export function linuxExecutableAuthorizationHash(
  authorization: LinuxExecutableAuthorization,
): string {
  return createHash('sha256')
    .update(canonicalJson(linuxExecutableAuthorizationPayload(authorization)))
    .digest('hex');
}

function parseLinuxExecutableAuthorization(input: unknown): Readonly<LinuxExecutableAuthorization> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deny();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny();
  const record = input as Record<string, unknown>;
  const expected = [
    'adapterKind',
    'argumentPolicyReference',
    'authorizationId',
    'authorizationVersion',
    'authorizedWorktreeRoot',
    'canonicalPath',
    'identityReference',
    'mode',
    'ownerGid',
    'ownerUid',
    'schemaVersion',
    'sha256',
    'signature',
    'signerKeyId',
    'testOnly',
    'validFrom',
    'validUntil',
  ].sort();
  const actual = Object.keys(record).sort();
  const ownKeys = Reflect.ownKeys(record);
  const descriptors = Object.getOwnPropertyDescriptors(record);
  if (
    record.schemaVersion !== 1 ||
    actual.length !== expected.length ||
    ownKeys.length !== actual.length ||
    ownKeys.some((key) => typeof key !== 'string') ||
    actual.some((key, index) => key !== expected[index]) ||
    actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value')) ||
    typeof record.testOnly !== 'boolean' ||
    typeof record.canonicalPath !== 'string' ||
    !record.canonicalPath.startsWith('/') ||
    typeof record.authorizedWorktreeRoot !== 'string' ||
    !record.authorizedWorktreeRoot.startsWith('/') ||
    typeof record.sha256 !== 'string' ||
    !SHA256.test(record.sha256) ||
    typeof record.signature !== 'string' ||
    !ED25519_SIGNATURE.test(record.signature)
  )
    deny();
  const mode = integer(record.mode, 0o777);
  if ((mode & 0o222) !== 0 || (mode & 0o111) === 0) deny();
  const authorization: LinuxExecutableAuthorization = {
    schemaVersion: 1,
    authorizationId: reference(record.authorizationId),
    authorizationVersion: integer(record.authorizationVersion, 1_000_000),
    signerKeyId: reference(record.signerKeyId),
    validFrom: timestamp(record.validFrom),
    validUntil: timestamp(record.validUntil),
    adapterKind: reference(record.adapterKind),
    testOnly: record.testOnly,
    canonicalPath: record.canonicalPath,
    sha256: record.sha256,
    identityReference: reference(record.identityReference),
    ownerUid: integer(record.ownerUid, 2_147_483_647),
    ownerGid: integer(record.ownerGid, 2_147_483_647),
    mode,
    authorizedWorktreeRoot: record.authorizedWorktreeRoot,
    argumentPolicyReference: reference(record.argumentPolicyReference),
    signature: record.signature,
  };
  if (authorization.authorizationVersion === 0) deny();
  return Object.freeze(authorization);
}

function verifyTestOnlyLinuxExecutableAuthorization(
  input: unknown,
): Readonly<LinuxExecutableAuthorization> {
  const authorization = parseLinuxExecutableAuthorization(input);
  const validFrom = Date.parse(authorization.validFrom);
  const validUntil = Date.parse(authorization.validUntil);
  const now = Date.now();
  if (
    authorization.signerKeyId !== TEST_EXECUTABLE_AUTHORITY_KEY_ID ||
    authorization.testOnly !== true ||
    validFrom > now ||
    validUntil <= now ||
    validUntil <= validFrom ||
    validUntil - validFrom > MAX_AUTHORIZATION_LIFETIME_MS ||
    !verify(
      null,
      Buffer.from(canonicalJson(linuxExecutableAuthorizationPayload(authorization)), 'utf8'),
      TEST_SIGNER_PUBLIC_KEY,
      Buffer.from(authorization.signature, 'base64'),
    )
  )
    deny();
  return Object.freeze(authorization);
}

interface ParsedTrustRecord {
  readonly record: Readonly<LinuxExecutableAuthorityTrustRecord>;
  readonly publicKey: KeyObject;
}

function parseTrustRecord(input: unknown): Readonly<ParsedTrustRecord> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deny();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny();
  const value = input as Record<string, unknown>;
  const expected = [
    'adapterKind',
    'algorithm',
    'argumentPolicyReference',
    'authorizedWorktreeRoot',
    'publicKeySpkiBase64',
    'publicKeySpkiSha256',
    'revokedAt',
    'schemaVersion',
    'signerKeyId',
    'testOnly',
    'trustRecordId',
    'trustRecordVersion',
    'validFrom',
    'validUntil',
  ].sort();
  const actual = Object.keys(value).sort();
  const ownKeys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    value.schemaVersion !== 1 ||
    value.algorithm !== 'ED25519' ||
    value.testOnly !== false ||
    actual.length !== expected.length ||
    ownKeys.length !== actual.length ||
    ownKeys.some((key) => typeof key !== 'string') ||
    actual.some((key, index) => key !== expected[index]) ||
    actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value')) ||
    typeof value.authorizedWorktreeRoot !== 'string' ||
    !value.authorizedWorktreeRoot.startsWith('/') ||
    typeof value.publicKeySpkiBase64 !== 'string' ||
    value.publicKeySpkiBase64.length > 256 ||
    !BASE64.test(value.publicKeySpkiBase64) ||
    typeof value.publicKeySpkiSha256 !== 'string' ||
    !SHA256.test(value.publicKeySpkiSha256) ||
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
    validUntilMs - validFromMs > MAX_TRUST_RECORD_LIFETIME_MS ||
    (revokedAt !== null &&
      (Date.parse(revokedAt) < validFromMs || Date.parse(revokedAt) > validUntilMs))
  )
    deny();
  const encodedKey = Buffer.from(value.publicKeySpkiBase64, 'base64');
  if (
    encodedKey.length === 0 ||
    encodedKey.toString('base64') !== value.publicKeySpkiBase64 ||
    createHash('sha256').update(encodedKey).digest('hex') !== value.publicKeySpkiSha256
  )
    deny();
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: encodedKey, format: 'der', type: 'spki' });
  } catch {
    deny();
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') deny();
  const record: LinuxExecutableAuthorityTrustRecord = {
    schemaVersion: 1,
    trustRecordId: reference(value.trustRecordId),
    trustRecordVersion: integer(value.trustRecordVersion, 1_000_000),
    signerKeyId: reference(value.signerKeyId),
    algorithm: 'ED25519',
    publicKeySpkiBase64: value.publicKeySpkiBase64,
    publicKeySpkiSha256: value.publicKeySpkiSha256,
    adapterKind: reference(value.adapterKind),
    argumentPolicyReference: reference(value.argumentPolicyReference),
    authorizedWorktreeRoot: value.authorizedWorktreeRoot,
    validFrom,
    validUntil,
    revokedAt,
    testOnly: false,
  };
  if (record.trustRecordVersion === 0) deny();
  return Object.freeze({ record: Object.freeze(record), publicKey });
}

/**
 * Bounded verifier over an immutable, explicitly supplied public-key trust set.
 * Constructing this class is a trust decision; production composition does not.
 */
export class BoundedLinuxExecutableAuthorizationVerifier implements LinuxExecutableAuthorizationVerifier {
  readonly #records: ReadonlyMap<string, Readonly<ParsedTrustRecord>>;

  constructor(
    records: readonly unknown[],
    private readonly clock: () => number = Date.now,
  ) {
    const parsed = records.map(parseTrustRecord);
    if (parsed.length === 0 || parsed.length > 32) deny();
    const bySigner = new Map<string, Readonly<ParsedTrustRecord>>();
    const recordIds = new Set<string>();
    const keyFingerprints = new Set<string>();
    for (const record of parsed) {
      if (
        bySigner.has(record.record.signerKeyId) ||
        recordIds.has(record.record.trustRecordId) ||
        keyFingerprints.has(record.record.publicKeySpkiSha256)
      )
        deny();
      bySigner.set(record.record.signerKeyId, record);
      recordIds.add(record.record.trustRecordId);
      keyFingerprints.add(record.record.publicKeySpkiSha256);
    }
    this.#records = bySigner;
    Object.freeze(this);
  }

  verify(input: unknown): Readonly<LinuxExecutableAuthorization> {
    const authorization = parseLinuxExecutableAuthorization(input);
    const trusted = this.#records.get(authorization.signerKeyId);
    if (!trusted) deny();
    const now = this.clock();
    const validFrom = Date.parse(authorization.validFrom);
    const validUntil = Date.parse(authorization.validUntil);
    const trustFrom = Date.parse(trusted.record.validFrom);
    const trustUntil = Date.parse(trusted.record.validUntil);
    const revokedAt =
      trusted.record.revokedAt === null ? null : Date.parse(trusted.record.revokedAt);
    if (
      !Number.isFinite(now) ||
      authorization.testOnly ||
      authorization.adapterKind !== trusted.record.adapterKind ||
      authorization.argumentPolicyReference !== trusted.record.argumentPolicyReference ||
      authorization.authorizedWorktreeRoot !== trusted.record.authorizedWorktreeRoot ||
      trustFrom > now ||
      trustUntil <= now ||
      validFrom > now ||
      validUntil <= now ||
      validUntil <= validFrom ||
      validUntil - validFrom > MAX_AUTHORIZATION_LIFETIME_MS ||
      validFrom < trustFrom ||
      validUntil > trustUntil ||
      (revokedAt !== null && (now >= revokedAt || validUntil > revokedAt)) ||
      !verify(
        null,
        Buffer.from(canonicalJson(linuxExecutableAuthorizationPayload(authorization)), 'utf8'),
        trusted.publicKey,
        Buffer.from(authorization.signature, 'base64'),
      )
    )
      deny();
    return authorization;
  }
}

export class DenyLinuxExecutableAuthorizationVerifier implements LinuxExecutableAuthorizationVerifier {
  verify(_input: unknown): never {
    deny();
  }
}

/** Pinned deterministic verifier for repository tests only. */
export class TestOnlyLinuxExecutableAuthorizationVerifier implements LinuxExecutableAuthorizationVerifier {
  verify(input: unknown): Readonly<LinuxExecutableAuthorization> {
    return verifyTestOnlyLinuxExecutableAuthorization(input);
  }
}

/**
 * Backward-compatible test-only validator. Production composition must inject
 * an explicit verifier and never use this helper as a trust decision.
 */
export function validateLinuxExecutableAuthorization(
  input: unknown,
): Readonly<LinuxExecutableAuthorization> {
  return verifyTestOnlyLinuxExecutableAuthorization(input);
}
