import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from './codec';
import {
  linuxExecutableAuthorizationPayload,
  type LinuxExecutableAuthorization,
  type LinuxExecutableAuthorityTrustRecord,
  SupervisorAuthorizationError,
} from './supervision-authorization';
import {
  BoundedLinuxExecutableAuthorityTrustSource,
  DenyLinuxExecutableAuthorityTrustSource,
  linuxExecutableAuthorityTrustSnapshotHash,
  linuxExecutableAuthorityTrustSnapshotPayload,
  type LinuxExecutableAuthorityRootRecord,
  type LinuxExecutableAuthorityTrustCheckpoint,
  type LinuxExecutableAuthorityTrustCheckpointStore,
  type LinuxExecutableAuthorityTrustSnapshot,
  type LinuxExecutableAuthorityTrustSnapshotReader,
} from './supervision-authority-trust-source';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');

function exported(key: KeyObject): { base64: string; sha256: string } {
  const der = key.export({ format: 'der', type: 'spki' });
  return {
    base64: der.toString('base64'),
    sha256: createHash('sha256').update(der).digest('hex'),
  };
}

class MutableReader implements LinuxExecutableAuthorityTrustSnapshotReader {
  constructor(public value: unknown) {}

  async read(): Promise<unknown> {
    return this.value;
  }
}

class MemoryCheckpointStore implements LinuxExecutableAuthorityTrustCheckpointStore {
  readonly values = new Map<string, Readonly<LinuxExecutableAuthorityTrustCheckpoint>>();
  failReads = false;
  failWrites = false;
  loseNextCasTo: Readonly<LinuxExecutableAuthorityTrustCheckpoint> | null = null;

  async read(signerKeyId: string): Promise<unknown | null> {
    if (this.failReads) throw new Error('unavailable');
    return this.values.get(signerKeyId) ?? null;
  }

  async compareAndSwap(
    signerKeyId: string,
    expected: Readonly<LinuxExecutableAuthorityTrustCheckpoint> | null,
    next: Readonly<LinuxExecutableAuthorityTrustCheckpoint>,
  ): Promise<boolean> {
    if (this.failWrites) throw new Error('unavailable');
    const current = this.values.get(signerKeyId) ?? null;
    if (this.loseNextCasTo) {
      this.values.set(signerKeyId, this.loseNextCasTo);
      this.loseNextCasTo = null;
      return false;
    }
    if (canonicalJson(current) !== canonicalJson(expected)) return false;
    this.values.set(signerKeyId, next);
    return true;
  }
}

interface Fixture {
  readonly rootPrivateKey: KeyObject;
  readonly authorityPrivateKey: KeyObject;
  readonly root: LinuxExecutableAuthorityRootRecord;
  readonly trustRecord: LinuxExecutableAuthorityTrustRecord;
}

function fixture(overrides: Partial<LinuxExecutableAuthorityRootRecord> = {}): Fixture {
  const rootKeys = generateKeyPairSync('ed25519');
  const authorityKeys = generateKeyPairSync('ed25519');
  const rootPublic = exported(rootKeys.publicKey);
  const authorityPublic = exported(authorityKeys.publicKey);
  return {
    rootPrivateKey: rootKeys.privateKey,
    authorityPrivateKey: authorityKeys.privateKey,
    root: {
      schemaVersion: 1,
      rootRecordId: 'root-record-1',
      rootRecordVersion: 1,
      signerKeyId: 'root-signer-1',
      algorithm: 'ED25519',
      purpose: 'LINUX_EXECUTABLE_AUTHORITY_TRUST_SNAPSHOT',
      publicKeySpkiBase64: rootPublic.base64,
      publicKeySpkiSha256: rootPublic.sha256,
      minimumSnapshotVersion: 1,
      validFrom: '2029-01-01T00:00:00.000Z',
      validUntil: '2031-01-01T00:00:00.000Z',
      revokedAt: null,
      testOnly: false,
      ...overrides,
    },
    trustRecord: {
      schemaVersion: 1,
      trustRecordId: 'authority-record-1',
      trustRecordVersion: 1,
      signerKeyId: 'executable-authority-1',
      algorithm: 'ED25519',
      publicKeySpkiBase64: authorityPublic.base64,
      publicKeySpkiSha256: authorityPublic.sha256,
      adapterKind: 'CODEX_APP_SERVER_STDIO',
      argumentPolicyReference: 'codex-app-server-stdio-v1',
      authorizedWorktreeRoot: '/srv/ventureos/worktrees',
      validFrom: '2029-12-01T00:00:00.000Z',
      validUntil: '2030-02-01T00:00:00.000Z',
      revokedAt: null,
      testOnly: false,
    },
  };
}

function snapshot(
  value: Fixture,
  overrides: Partial<LinuxExecutableAuthorityTrustSnapshot> = {},
): LinuxExecutableAuthorityTrustSnapshot {
  const unsigned = {
    schemaVersion: 1 as const,
    snapshotId: 'snapshot-1',
    snapshotVersion: 1,
    signerKeyId: value.root.signerKeyId,
    algorithm: 'ED25519' as const,
    issuedAt: '2030-01-01T11:59:00.000Z',
    validUntil: '2030-01-01T12:10:00.000Z',
    previousSnapshotHash: null,
    records: [value.trustRecord],
    ...overrides,
  };
  return {
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(canonicalJson(unsigned), 'utf8'),
      value.rootPrivateKey,
    ).toString('base64'),
  };
}

function authorization(value: Fixture): LinuxExecutableAuthorization {
  const unsigned = {
    schemaVersion: 1 as const,
    authorizationId: 'authorization-1',
    authorizationVersion: 1,
    signerKeyId: value.trustRecord.signerKeyId,
    validFrom: '2030-01-01T11:59:30.000Z',
    validUntil: '2030-01-01T12:01:00.000Z',
    adapterKind: value.trustRecord.adapterKind,
    testOnly: false,
    canonicalPath: '/opt/codex/bin/codex',
    sha256: 'a'.repeat(64),
    identityReference: 'codex-linux-x64-v1',
    ownerUid: 1000,
    ownerGid: 1000,
    mode: 0o555,
    authorizedWorktreeRoot: value.trustRecord.authorizedWorktreeRoot,
    argumentPolicyReference: value.trustRecord.argumentPolicyReference,
  };
  return {
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(canonicalJson(unsigned), 'utf8'),
      value.authorityPrivateKey,
    ).toString('base64'),
  };
}

function source(
  value: Fixture,
  reader = new MutableReader(snapshot(value)),
  checkpoints = new MemoryCheckpointStore(),
): {
  readonly subject: BoundedLinuxExecutableAuthorityTrustSource;
  readonly reader: MutableReader;
  readonly checkpoints: MemoryCheckpointStore;
} {
  return {
    subject: new BoundedLinuxExecutableAuthorityTrustSource(
      reader,
      checkpoints,
      [value.root],
      () => NOW,
    ),
    reader,
    checkpoints,
  };
}

describe('bounded executable authority trust source', () => {
  it('authenticates a fresh snapshot and exposes only bounded verification authority', async () => {
    const value = fixture();
    const { subject, checkpoints } = source(value);
    const trusted = await subject.read();

    expect(trusted).toMatchObject({
      schemaVersion: 1,
      snapshotId: 'snapshot-1',
      snapshotVersion: 1,
      signerKeyId: 'root-signer-1',
      rootRecordId: 'root-record-1',
      recordCount: 1,
    });
    expect(Object.isFrozen(trusted)).toBe(true);
    expect(Object.isFrozen(trusted.authorizationVerifier)).toBe(true);
    expect(trusted.authorizationVerifier.verify(authorization(value))).toMatchObject({
      authorizationId: 'authorization-1',
      testOnly: false,
    });
    expect(checkpoints.values.get('root-signer-1')).toMatchObject({
      snapshotId: 'snapshot-1',
      snapshotVersion: 1,
      snapshotHash: trusted.snapshotHash,
    });
  });

  it('denies absent production configuration', async () => {
    await expect(new DenyLinuxExecutableAuthorityTrustSource().read()).rejects.toBeInstanceOf(
      SupervisorAuthorizationError,
    );
  });

  it('denies empty, oversized, duplicate, and aliased root registries', () => {
    const value = fixture();
    const reader = new MutableReader(snapshot(value));
    const store = new MemoryCheckpointStore();
    expect(
      () => new BoundedLinuxExecutableAuthorityTrustSource(reader, store, [], () => NOW),
    ).toThrow(SupervisorAuthorizationError);
    expect(
      () =>
        new BoundedLinuxExecutableAuthorityTrustSource(
          reader,
          store,
          Array.from({ length: 9 }, (_, index) => ({
            ...fixture().root,
            rootRecordId: `root-${index}`,
            signerKeyId: `signer-${index}`,
          })),
          () => NOW,
        ),
    ).toThrow(SupervisorAuthorizationError);
    expect(
      () =>
        new BoundedLinuxExecutableAuthorityTrustSource(
          reader,
          store,
          [value.root, { ...value.root, rootRecordId: 'root-record-2' }],
          () => NOW,
        ),
    ).toThrow(SupervisorAuthorizationError);
    expect(
      () =>
        new BoundedLinuxExecutableAuthorityTrustSource(
          reader,
          store,
          [value.root, { ...value.root, signerKeyId: 'root-signer-2' }],
          () => NOW,
        ),
    ).toThrow(SupervisorAuthorizationError);
  });

  it.each([
    [
      'bad signature',
      (value: Fixture) => ({ ...snapshot(value), signature: 'A'.repeat(86) + '==' }),
    ],
    [
      'unknown signer',
      (value: Fixture) => snapshot(value, { signerKeyId: 'untrusted-root-signer' }),
    ],
    [
      'expired snapshot',
      (value: Fixture) => snapshot(value, { validUntil: '2030-01-01T12:00:00.000Z' }),
    ],
    [
      'future snapshot',
      (value: Fixture) => snapshot(value, { issuedAt: '2030-01-01T12:00:01.000Z' }),
    ],
    [
      'overlong snapshot',
      (value: Fixture) => snapshot(value, { validUntil: '2030-01-01T12:14:00.001Z' }),
    ],
  ])('denies a %s', async (_name, mutate) => {
    const value = fixture();
    const { subject, reader } = source(value);
    reader.value = mutate(value);
    await expect(subject.read()).rejects.toBeInstanceOf(SupervisorAuthorizationError);
  });

  it('denies root validity, revocation, floor, fingerprint, and non-plain record failures', async () => {
    const expired = fixture({ validUntil: '2030-01-01T12:00:00.000Z' });
    await expect(source(expired).subject.read()).rejects.toBeInstanceOf(
      SupervisorAuthorizationError,
    );
    const revoked = fixture({ revokedAt: '2030-01-01T12:00:00.000Z' });
    await expect(source(revoked).subject.read()).rejects.toBeInstanceOf(
      SupervisorAuthorizationError,
    );
    const floor = fixture({ minimumSnapshotVersion: 2 });
    await expect(source(floor).subject.read()).rejects.toBeInstanceOf(SupervisorAuthorizationError);
    const valid = fixture();
    expect(
      () =>
        new BoundedLinuxExecutableAuthorityTrustSource(
          new MutableReader(snapshot(valid)),
          new MemoryCheckpointStore(),
          [{ ...valid.root, publicKeySpkiSha256: '0'.repeat(64) }],
          () => NOW,
        ),
    ).toThrow(SupervisorAuthorizationError);
    const inherited = Object.create(valid.root) as LinuxExecutableAuthorityRootRecord;
    expect(
      () =>
        new BoundedLinuxExecutableAuthorityTrustSource(
          new MutableReader(snapshot(valid)),
          new MemoryCheckpointStore(),
          [inherited],
          () => NOW,
        ),
    ).toThrow(SupervisorAuthorizationError);
  });

  it('denies malformed or untrusted authority records even when the snapshot is signed', async () => {
    const value = fixture();
    const malformed = { ...value.trustRecord, testOnly: true };
    const { subject } = source(
      value,
      new MutableReader(
        snapshot(value, {
          records: [malformed as unknown as LinuxExecutableAuthorityTrustRecord],
        }),
      ),
      new MemoryCheckpointStore(),
    );
    await expect(subject.read()).rejects.toBeInstanceOf(SupervisorAuthorizationError);
  });

  it('denies accessor-backed roots, snapshots, trust records, and checkpoints', async () => {
    const value = fixture();
    const rootWithAccessor = { ...value.root } as Record<string, unknown>;
    Object.defineProperty(rootWithAccessor, 'rootRecordId', {
      enumerable: true,
      get: () => value.root.rootRecordId,
    });
    expect(
      () =>
        new BoundedLinuxExecutableAuthorityTrustSource(
          new MutableReader(snapshot(value)),
          new MemoryCheckpointStore(),
          [rootWithAccessor],
          () => NOW,
        ),
    ).toThrow(SupervisorAuthorizationError);

    const signed = snapshot(value);
    const snapshotWithAccessor = { ...signed } as Record<string, unknown>;
    Object.defineProperty(snapshotWithAccessor, 'snapshotId', {
      enumerable: true,
      get: () => signed.snapshotId,
    });
    await expect(
      source(
        value,
        new MutableReader(snapshotWithAccessor),
        new MemoryCheckpointStore(),
      ).subject.read(),
    ).rejects.toBeInstanceOf(SupervisorAuthorizationError);

    const recordWithAccessor = { ...value.trustRecord } as Record<string, unknown>;
    Object.defineProperty(recordWithAccessor, 'trustRecordId', {
      enumerable: true,
      get: () => value.trustRecord.trustRecordId,
    });
    await expect(
      source(
        value,
        new MutableReader(
          snapshot(value, {
            records: [recordWithAccessor as unknown as LinuxExecutableAuthorityTrustRecord],
          }),
        ),
        new MemoryCheckpointStore(),
      ).subject.read(),
    ).rejects.toBeInstanceOf(SupervisorAuthorizationError);

    const checkpointStore = new MemoryCheckpointStore();
    const checkpointWithAccessor = {
      schemaVersion: 1,
      signerKeyId: value.root.signerKeyId,
      snapshotId: 'snapshot-1',
      snapshotVersion: 1,
      snapshotHash: '0'.repeat(64),
    } as Record<string, unknown>;
    Object.defineProperty(checkpointWithAccessor, 'snapshotId', {
      enumerable: true,
      get: () => 'snapshot-1',
    });
    checkpointStore.values.set(
      value.root.signerKeyId,
      checkpointWithAccessor as unknown as LinuxExecutableAuthorityTrustCheckpoint,
    );
    await expect(
      source(value, new MutableReader(signed), checkpointStore).subject.read(),
    ).rejects.toBeInstanceOf(SupervisorAuthorizationError);
  });

  it('allows an identical snapshot replay without rewriting its checkpoint', async () => {
    const value = fixture();
    const { subject, checkpoints } = source(value);
    const first = await subject.read();
    const retained = checkpoints.values.get(value.root.signerKeyId);
    const second = await subject.read();
    expect(second.snapshotHash).toBe(first.snapshotHash);
    expect(checkpoints.values.get(value.root.signerKeyId)).toBe(retained);
  });

  it('expires the returned verifier at the signed snapshot boundary', async () => {
    const value = fixture();
    let now = NOW;
    const subject = new BoundedLinuxExecutableAuthorityTrustSource(
      new MutableReader(snapshot(value, { validUntil: '2030-01-01T12:00:30.000Z' })),
      new MemoryCheckpointStore(),
      [value.root],
      () => now,
    );
    const trusted = await subject.read();
    expect(() => trusted.authorizationVerifier.verify(authorization(value))).not.toThrow();
    now = Date.parse('2030-01-01T12:00:30.000Z');
    expect(() => trusted.authorizationVerifier.verify(authorization(value))).toThrow(
      SupervisorAuthorizationError,
    );
  });

  it('requires an explicit null predecessor when bootstrapping an empty checkpoint', async () => {
    const value = fixture();
    await expect(
      source(
        value,
        new MutableReader(snapshot(value, { previousSnapshotHash: '0'.repeat(64) })),
        new MemoryCheckpointStore(),
      ).subject.read(),
    ).rejects.toBeInstanceOf(SupervisorAuthorizationError);
  });

  it('denies hidden object and array extensions omitted by JSON serialization', async () => {
    const value = fixture();
    const signed = snapshot(value) as LinuxExecutableAuthorityTrustSnapshot &
      Record<string, unknown>;
    Object.defineProperty(signed, 'hidden', { value: 'ignored-by-json' });
    await expect(
      source(value, new MutableReader(signed), new MemoryCheckpointStore()).subject.read(),
    ).rejects.toBeInstanceOf(SupervisorAuthorizationError);

    const records = [value.trustRecord];
    Object.defineProperty(records, 'hidden', { value: 'ignored-by-json' });
    await expect(
      source(
        value,
        new MutableReader(snapshot(value, { records })),
        new MemoryCheckpointStore(),
      ).subject.read(),
    ).rejects.toBeInstanceOf(SupervisorAuthorizationError);
  });

  it('advances exactly one hash-linked version and survives a new source instance', async () => {
    const value = fixture();
    const reader = new MutableReader(snapshot(value));
    const checkpoints = new MemoryCheckpointStore();
    const firstSource = source(value, reader, checkpoints).subject;
    const first = await firstSource.read();
    reader.value = snapshot(value, {
      snapshotId: 'snapshot-2',
      snapshotVersion: 2,
      previousSnapshotHash: first.snapshotHash,
    });
    const second = await source(value, reader, checkpoints).subject.read();
    expect(second.snapshotVersion).toBe(2);
    expect(checkpoints.values.get(value.root.signerKeyId)?.snapshotHash).toBe(second.snapshotHash);
  });

  it('denies rollback, skipped versions, broken links, and equivocation', async () => {
    const value = fixture();
    const firstSnapshot = snapshot(value);
    const reader = new MutableReader(firstSnapshot);
    const checkpoints = new MemoryCheckpointStore();
    const subject = source(value, reader, checkpoints).subject;
    const first = await subject.read();

    reader.value = snapshot(value, { snapshotId: 'snapshot-3', snapshotVersion: 3 });
    await expect(subject.read()).rejects.toBeInstanceOf(SupervisorAuthorizationError);
    reader.value = snapshot(value, {
      snapshotId: 'snapshot-2',
      snapshotVersion: 2,
      previousSnapshotHash: '0'.repeat(64),
    });
    await expect(subject.read()).rejects.toBeInstanceOf(SupervisorAuthorizationError);
    reader.value = snapshot(value, { snapshotId: 'equivocation-1' });
    await expect(subject.read()).rejects.toBeInstanceOf(SupervisorAuthorizationError);

    reader.value = snapshot(value, {
      snapshotId: 'snapshot-2',
      snapshotVersion: 2,
      previousSnapshotHash: first.snapshotHash,
    });
    await subject.read();
    reader.value = firstSnapshot;
    await expect(subject.read()).rejects.toBeInstanceOf(SupervisorAuthorizationError);
  });

  it('accepts a CAS race only when the winner installed the identical checkpoint', async () => {
    const value = fixture();
    const signed = snapshot(value);
    const expected = {
      schemaVersion: 1 as const,
      signerKeyId: signed.signerKeyId,
      snapshotId: signed.snapshotId,
      snapshotVersion: signed.snapshotVersion,
      snapshotHash: linuxExecutableAuthorityTrustSnapshotHash(signed),
    };
    const store = new MemoryCheckpointStore();
    store.loseNextCasTo = expected;
    await expect(
      source(value, new MutableReader(signed), store).subject.read(),
    ).resolves.toMatchObject(expected);

    const losingStore = new MemoryCheckpointStore();
    losingStore.loseNextCasTo = { ...expected, snapshotId: 'different-winner' };
    await expect(
      source(value, new MutableReader(signed), losingStore).subject.read(),
    ).rejects.toBeInstanceOf(SupervisorAuthorizationError);
  });

  it('fails closed on reader, checkpoint read, checkpoint write, and malformed checkpoint errors', async () => {
    const value = fixture();
    const brokenReader: LinuxExecutableAuthorityTrustSnapshotReader = {
      async read() {
        throw new Error('unavailable');
      },
    };
    await expect(
      new BoundedLinuxExecutableAuthorityTrustSource(
        brokenReader,
        new MemoryCheckpointStore(),
        [value.root],
        () => NOW,
      ).read(),
    ).rejects.toBeInstanceOf(SupervisorAuthorizationError);

    const readFailure = source(value);
    readFailure.checkpoints.failReads = true;
    await expect(readFailure.subject.read()).rejects.toBeInstanceOf(SupervisorAuthorizationError);
    const writeFailure = source(value);
    writeFailure.checkpoints.failWrites = true;
    await expect(writeFailure.subject.read()).rejects.toBeInstanceOf(SupervisorAuthorizationError);
    const malformed = source(value);
    malformed.checkpoints.values.set(value.root.signerKeyId, {
      schemaVersion: 1,
      signerKeyId: value.root.signerKeyId,
      snapshotId: 'snapshot-1',
      snapshotVersion: 1,
      snapshotHash: '0'.repeat(64),
      extra: true,
    } as unknown as LinuxExecutableAuthorityTrustCheckpoint);
    await expect(malformed.subject.read()).rejects.toBeInstanceOf(SupervisorAuthorizationError);
  });

  it('signs exactly the documented payload and excludes the signature from the snapshot hash', () => {
    const value = fixture();
    const signed = snapshot(value);
    expect(Object.keys(linuxExecutableAuthorityTrustSnapshotPayload(signed))).not.toContain(
      'signature',
    );
    expect(
      linuxExecutableAuthorityTrustSnapshotHash({ ...signed, signature: 'B'.repeat(86) + '==' }),
    ).toBe(linuxExecutableAuthorityTrustSnapshotHash(signed));
  });

  it('keeps executable authorization payload signatures independent from snapshot signatures', () => {
    const value = fixture();
    expect(linuxExecutableAuthorizationPayload(authorization(value))).not.toHaveProperty(
      'signature',
    );
  });
});
