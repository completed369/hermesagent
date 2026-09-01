import { createHash, verify } from 'node:crypto';

import { canonicalJson } from './codec';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const MAX_AUTHORIZATION_LIFETIME_MS = 5 * 60 * 1_000;
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

function verifyTestOnlyLinuxExecutableAuthorization(
  input: unknown,
): Readonly<LinuxExecutableAuthorization> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deny();
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
  if (
    record.schemaVersion !== 1 ||
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
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
