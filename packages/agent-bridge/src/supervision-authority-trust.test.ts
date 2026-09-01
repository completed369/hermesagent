import { createHash, generateKeyPairSync, type KeyObject, sign } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  CODEX_APP_SERVER_ADAPTER_KIND,
  CODEX_APP_SERVER_ARGUMENT_POLICY,
} from './codex-app-server-policy';
import {
  BoundedLinuxExecutableAuthorizationVerifier,
  type LinuxExecutableAuthorization,
  type LinuxExecutableAuthorizationPayload,
  type LinuxExecutableAuthorityTrustRecord,
} from './supervision-authorization';

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const encodedPublicKey = publicKey.export({ format: 'der', type: 'spki' });
  const trustRecord: LinuxExecutableAuthorityTrustRecord = {
    schemaVersion: 1,
    trustRecordId: 'codex-executable-trust-v1',
    trustRecordVersion: 1,
    signerKeyId: 'codex-executable-authority-v1',
    algorithm: 'ED25519',
    publicKeySpkiBase64: encodedPublicKey.toString('base64'),
    publicKeySpkiSha256: createHash('sha256').update(encodedPublicKey).digest('hex'),
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
    argumentPolicyReference: CODEX_APP_SERVER_ARGUMENT_POLICY,
    authorizedWorktreeRoot: '/workspaces/ventureos',
    validFrom: '2026-08-31T00:00:00.000Z',
    validUntil: '2026-11-30T00:00:00.000Z',
    revokedAt: null,
    testOnly: false,
  };
  const payload: LinuxExecutableAuthorizationPayload = {
    schemaVersion: 1,
    authorizationId: 'codex-executable-authorization-v1',
    authorizationVersion: 1,
    signerKeyId: trustRecord.signerKeyId,
    validFrom: '2026-09-01T00:59:00.000Z',
    validUntil: '2026-09-01T01:04:00.000Z',
    adapterKind: trustRecord.adapterKind,
    testOnly: false,
    canonicalPath: '/opt/ventureos/runtimes/codex/codex',
    sha256: '8'.repeat(64),
    identityReference: 'device-8:inode-12',
    ownerUid: 10_001,
    ownerGid: 10_001,
    mode: 0o500,
    authorizedWorktreeRoot: trustRecord.authorizedWorktreeRoot,
    argumentPolicyReference: trustRecord.argumentPolicyReference,
  };
  const authorization: LinuxExecutableAuthorization = {
    ...payload,
    signature: sign(null, Buffer.from(canonicalJson(payload), 'utf8'), privateKey).toString(
      'base64',
    ),
  };
  return { authorization, privateKey, trustRecord };
}

function resign(
  authorization: LinuxExecutableAuthorization,
  privateKey: KeyObject,
  changes: Partial<LinuxExecutableAuthorizationPayload>,
): LinuxExecutableAuthorization {
  const { signature: _signature, ...current } = authorization;
  const payload = { ...current, ...changes };
  return {
    ...payload,
    signature: sign(null, Buffer.from(canonicalJson(payload), 'utf8'), privateKey).toString(
      'base64',
    ),
  };
}

describe('bounded Linux executable authority trust records', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-01T01:00:00.000Z') }));
  afterEach(() => vi.useRealTimers());

  it('verifies and freezes one production authorization under exact trust scope', () => {
    const { authorization, trustRecord } = fixture();
    const verifier = new BoundedLinuxExecutableAuthorizationVerifier([trustRecord]);

    const result = verifier.verify(structuredClone(authorization));

    expect(result).toEqual(authorization);
    expect(result.testOnly).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('requires a non-empty bounded trust set with one record per signer', () => {
    const { trustRecord } = fixture();

    expect(() => new BoundedLinuxExecutableAuthorizationVerifier([])).toThrow();
    expect(
      () => new BoundedLinuxExecutableAuthorizationVerifier([trustRecord, { ...trustRecord }]),
    ).toThrow();
    expect(
      () =>
        new BoundedLinuxExecutableAuthorizationVerifier(
          Array.from({ length: 33 }, (_, index) => ({
            ...trustRecord,
            trustRecordId: `trust-record-${index}`,
            signerKeyId: `signer-${index}`,
          })),
        ),
    ).toThrow();
  });

  it('denies duplicate record identities, key aliases, and non-plain inputs', () => {
    const first = fixture();
    const second = fixture();

    expect(
      () =>
        new BoundedLinuxExecutableAuthorizationVerifier([
          first.trustRecord,
          { ...second.trustRecord, trustRecordId: first.trustRecord.trustRecordId },
        ]),
    ).toThrow();
    expect(
      () =>
        new BoundedLinuxExecutableAuthorizationVerifier([
          first.trustRecord,
          {
            ...first.trustRecord,
            trustRecordId: 'codex-executable-trust-v2',
            signerKeyId: 'codex-executable-authority-v2',
          },
        ]),
    ).toThrow();
    expect(() =>
      new BoundedLinuxExecutableAuthorizationVerifier([first.trustRecord]).verify(
        Object.assign(Object.create({ inherited: true }), first.authorization),
      ),
    ).toThrow();
  });

  it.each([
    ['adapterKind', 'OTHER_ADAPTER'],
    ['argumentPolicyReference', 'ventureos.codex-app-server.other.v1'],
    ['authorizedWorktreeRoot', '/workspaces/other'],
    ['signerKeyId', 'other-authority-v1'],
    ['testOnly', true],
  ] as const)('denies signed authorization scope drift in %s', (field, value) => {
    const { authorization, privateKey, trustRecord } = fixture();
    const verifier = new BoundedLinuxExecutableAuthorizationVerifier([trustRecord]);
    const drifted = resign(authorization, privateKey, { [field]: value });

    expect(() => verifier.verify(drifted)).toThrow();
  });

  it.each([
    ['2026-09-01T01:00:01.000Z', '2026-09-01T01:04:00.000Z'],
    ['2026-09-01T00:55:00.000Z', '2026-09-01T01:00:00.000Z'],
    ['2026-09-01T00:59:00.000Z', '2026-09-01T01:04:00.001Z'],
  ])('denies future, expired, or overlong authorization windows', (validFrom, validUntil) => {
    const { authorization, privateKey, trustRecord } = fixture();
    const verifier = new BoundedLinuxExecutableAuthorizationVerifier([trustRecord]);

    expect(() =>
      verifier.verify(resign(authorization, privateKey, { validFrom, validUntil })),
    ).toThrow();
  });

  it('denies invalid signatures and signer substitution', () => {
    const first = fixture();
    const second = fixture();
    const verifier = new BoundedLinuxExecutableAuthorizationVerifier([first.trustRecord]);
    const substituted = resign(first.authorization, second.privateKey, {});

    expect(() =>
      verifier.verify({ ...first.authorization, signature: 'A'.repeat(86) + '==' }),
    ).toThrow();
    expect(() => verifier.verify(substituted)).toThrow();
  });

  it('denies malformed, mismatched, non-Ed25519, and overlong trust records', () => {
    const { trustRecord } = fixture();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
      format: 'der',
      type: 'spki',
    });

    expect(
      () =>
        new BoundedLinuxExecutableAuthorizationVerifier([
          { ...trustRecord, publicKeySpkiSha256: '0'.repeat(64) },
        ]),
    ).toThrow();
    expect(
      () =>
        new BoundedLinuxExecutableAuthorizationVerifier([
          {
            ...trustRecord,
            publicKeySpkiBase64: rsa.toString('base64'),
            publicKeySpkiSha256: createHash('sha256').update(rsa).digest('hex'),
          },
        ]),
    ).toThrow();
    expect(
      () =>
        new BoundedLinuxExecutableAuthorizationVerifier([
          { ...trustRecord, validUntil: '2027-09-02T00:00:00.000Z' },
        ]),
    ).toThrow();
  });

  it('enforces immediate and scheduled revocation against authorization expiry', () => {
    const { authorization, trustRecord } = fixture();

    expect(() =>
      new BoundedLinuxExecutableAuthorizationVerifier([
        { ...trustRecord, revokedAt: '2026-09-01T01:00:00.000Z' },
      ]).verify(authorization),
    ).toThrow();
    expect(() =>
      new BoundedLinuxExecutableAuthorizationVerifier([
        { ...trustRecord, revokedAt: '2026-09-01T01:02:00.000Z' },
      ]).verify(authorization),
    ).toThrow();
  });
});
