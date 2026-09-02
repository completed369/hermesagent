import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from './codec';
import {
  retainedNativeSupervisorRecoveryResponsePayload,
  RetainedNativeSupervisorRecoveryError,
  type RetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorRecoveryResponse,
  type RetainedNativeSupervisorTrustRecord,
} from './retained-native-supervisor-recovery';
import {
  BoundedRetainedNativeSupervisorTrustSource,
  DenyRetainedNativeSupervisorTrustSource,
  retainedNativeSupervisorTrustSnapshotHash,
  retainedNativeSupervisorTrustSnapshotPayload,
  type RetainedNativeSupervisorTrustCheckpoint,
  type RetainedNativeSupervisorTrustCheckpointStore,
  type RetainedNativeSupervisorTrustRootRecord,
  type RetainedNativeSupervisorTrustSnapshot,
  type RetainedNativeSupervisorTrustSnapshotReader,
} from './retained-native-supervisor-trust-source';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const INSTANCE = 'native-supervisor-instance-trust';

function exported(key: KeyObject): { base64: string; sha256: string } {
  const der = key.export({ format: 'der', type: 'spki' });
  return {
    base64: der.toString('base64'),
    sha256: createHash('sha256').update(der).digest('hex'),
  };
}

class MutableReader implements RetainedNativeSupervisorTrustSnapshotReader {
  constructor(public value: unknown) {}

  async read(): Promise<unknown> {
    return this.value;
  }
}

class MemoryCheckpointStore implements RetainedNativeSupervisorTrustCheckpointStore {
  readonly values = new Map<string, Readonly<RetainedNativeSupervisorTrustCheckpoint>>();
  failReads = false;
  failWrites = false;
  loseNextCasTo: Readonly<RetainedNativeSupervisorTrustCheckpoint> | null = null;

  async read(supervisorInstanceId: string): Promise<unknown | null> {
    if (this.failReads) throw new Error('unavailable');
    return this.values.get(supervisorInstanceId) ?? null;
  }

  async compareAndSwap(
    supervisorInstanceId: string,
    expected: Readonly<RetainedNativeSupervisorTrustCheckpoint> | null,
    next: Readonly<RetainedNativeSupervisorTrustCheckpoint>,
  ): Promise<boolean> {
    if (this.failWrites) throw new Error('unavailable');
    const current = this.values.get(supervisorInstanceId) ?? null;
    if (this.loseNextCasTo) {
      this.values.set(supervisorInstanceId, this.loseNextCasTo);
      this.loseNextCasTo = null;
      return false;
    }
    if (canonicalJson(current) !== canonicalJson(expected)) return false;
    this.values.set(supervisorInstanceId, next);
    return true;
  }
}

interface Fixture {
  readonly rootPrivateKey: KeyObject;
  readonly supervisorPrivateKey: KeyObject;
  readonly root: RetainedNativeSupervisorTrustRootRecord;
  readonly record: RetainedNativeSupervisorTrustRecord;
}

function fixture(
  rootOverrides: Partial<RetainedNativeSupervisorTrustRootRecord> = {},
  recordOverrides: Partial<RetainedNativeSupervisorTrustRecord> = {},
): Fixture {
  const rootKeys = generateKeyPairSync('ed25519');
  const supervisorKeys = generateKeyPairSync('ed25519');
  const rootPublic = exported(rootKeys.publicKey);
  const supervisorPublic = exported(supervisorKeys.publicKey);
  return {
    rootPrivateKey: rootKeys.privateKey,
    supervisorPrivateKey: supervisorKeys.privateKey,
    root: {
      schemaVersion: 1,
      rootRecordId: 'native-root-record-1',
      rootRecordVersion: 1,
      signerKeyId: 'native-root-signer-1',
      algorithm: 'ED25519',
      purpose: 'RETAINED_NATIVE_SUPERVISOR_TRUST_SNAPSHOT',
      publicKeySpkiBase64: rootPublic.base64,
      publicKeySpkiSha256: rootPublic.sha256,
      minimumSnapshotVersion: 1,
      validFrom: '2029-01-01T00:00:00.000Z',
      validUntil: '2031-01-01T00:00:00.000Z',
      revokedAt: null,
      testOnly: false,
      ...rootOverrides,
    },
    record: {
      schemaVersion: 1,
      trustRecordId: 'native-trust-record-1',
      trustRecordVersion: 1,
      supervisorInstanceId: INSTANCE,
      supervisorKeyId: 'native-supervisor-key-1',
      algorithm: 'ED25519',
      purpose: 'RETAINED_NATIVE_RECOVERY_OBSERVATION',
      publicKeySpkiBase64: supervisorPublic.base64,
      publicKeySpkiSha256: supervisorPublic.sha256,
      validFrom: '2029-12-01T00:00:00.000Z',
      validUntil: '2030-02-01T00:00:00.000Z',
      revokedAt: null,
      testOnly: false,
      ...recordOverrides,
    },
  };
}

function snapshot(
  value: Fixture,
  overrides: Partial<RetainedNativeSupervisorTrustSnapshot> = {},
): RetainedNativeSupervisorTrustSnapshot {
  const unsigned = {
    schemaVersion: 1 as const,
    snapshotId: 'native-snapshot-1',
    snapshotVersion: 1,
    signerKeyId: value.root.signerKeyId,
    algorithm: 'ED25519' as const,
    supervisorInstanceId: INSTANCE,
    issuedAt: '2030-01-01T11:59:00.000Z',
    validUntil: '2030-01-01T12:10:00.000Z',
    previousSnapshotHash: null,
    record: value.record,
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

function source(
  value: Fixture,
  reader = new MutableReader(snapshot(value)),
  checkpoints = new MemoryCheckpointStore(),
  clock: () => number = () => NOW,
) {
  return {
    subject: new BoundedRetainedNativeSupervisorTrustSource(
      INSTANCE,
      reader,
      checkpoints,
      [value.root],
      clock,
    ),
    reader,
    checkpoints,
  };
}

function request(): RetainedNativeSupervisorRecoveryRequest {
  return {
    schemaVersion: 1,
    requestId: 'recovery-observation-00000000-0000-4000-8000-000000000001',
    challengeNonce: 'A'.repeat(43),
    issuedAt: '2030-01-01T12:00:00.000Z',
    expiresAt: '2030-01-01T12:00:02.000Z',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    runtimeId: 'runtime-trust-source',
    connectionId: 'connection-trust-source',
    recoveryLeaseId: 'recovery-lease-trust-source',
    recoveryGeneration: 1,
    claimId: 'claim-trust-source',
    handoffAttemptId: 'handoff-trust-source',
    supervisionId: 'supervision-trust-source',
    launchNonce: 'launch-trust-source',
    platform: 'LINUX',
    testOnly: false,
    sessionId: 'session-trust-source',
    dispatchId: 'dispatch-trust-source',
    runId: 'run-trust-source',
    validationDispatchCandidateHash: 'a'.repeat(64),
    manifestHash: 'b'.repeat(64),
    admissionEvidenceHash: 'c'.repeat(64),
    admissionBindingHash: 'd'.repeat(64),
    processClaimedAt: '2030-01-01T11:58:00.000Z',
    processExpiresAt: '2030-01-01T11:59:30.000Z',
    runtimeConnection: 'NOT_CONFIGURED',
    requestHash: 'e'.repeat(64),
  };
}

function response(
  value: Fixture,
  requestValue = request(),
): RetainedNativeSupervisorRecoveryResponse {
  const payload = {
    schemaVersion: 1 as const,
    responseId: 'native-recovery-observation-00000000-0000-4000-8000-000000000001',
    requestId: requestValue.requestId,
    requestHash: requestValue.requestHash,
    supervisorInstanceId: value.record.supervisorInstanceId,
    supervisorKeyId: value.record.supervisorKeyId,
    identityEstablishedAt: '2030-01-01T11:58:01.000Z',
    identityVerifiedAt: '2030-01-01T12:00:00.300Z',
    exitedAt: '2030-01-01T11:59:00.000Z',
    observedAt: '2030-01-01T12:00:00.400Z',
    processState: 'EXITED' as const,
    exitCode: 0,
    signal: null,
    identityAuthority: 'RETAINED_NATIVE_IDENTITY' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  return {
    ...payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), value.supervisorPrivateKey).toString(
      'base64',
    ),
  };
}

describe('bounded retained-native supervisor trust source', () => {
  it('authenticates a fresh snapshot, checkpoints it, and exposes bounded verification only', async () => {
    const value = fixture();
    const { subject, checkpoints } = source(value);
    const trusted = await subject.read();

    expect(trusted).toMatchObject({
      schemaVersion: 1,
      snapshotId: 'native-snapshot-1',
      snapshotVersion: 1,
      supervisorInstanceId: INSTANCE,
      supervisorKeyId: 'native-supervisor-key-1',
      trustRecordId: 'native-trust-record-1',
    });
    expect(Object.isFrozen(trusted)).toBe(true);
    expect(Object.isFrozen(trusted.responseVerifier)).toBe(true);
    expect(
      trusted.responseVerifier.verify(
        response(value),
        request(),
        new Date('2030-01-01T12:00:00.500Z'),
      ),
    ).toMatchObject({
      supervisorInstanceId: INSTANCE,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(checkpoints.values.get(INSTANCE)).toMatchObject({
      snapshotVersion: 1,
      snapshotHash: trusted.snapshotHash,
    });
  });

  it('denies absent configuration', async () => {
    await expect(new DenyRetainedNativeSupervisorTrustSource().read()).rejects.toBeInstanceOf(
      RetainedNativeSupervisorRecoveryError,
    );
  });

  it.each([
    [
      'bad signature',
      (value: Fixture) => ({ ...snapshot(value), signature: 'A'.repeat(86) + '==' }),
    ],
    [
      'future snapshot',
      (value: Fixture) => snapshot(value, { issuedAt: '2030-01-01T12:00:00.001Z' }),
    ],
    [
      'expired snapshot',
      (value: Fixture) => snapshot(value, { validUntil: '2030-01-01T12:00:00.000Z' }),
    ],
    [
      'overlong snapshot',
      (value: Fixture) => snapshot(value, { validUntil: '2030-01-01T12:14:00.001Z' }),
    ],
    [
      'other supervisor',
      (value: Fixture) => snapshot(value, { supervisorInstanceId: 'other-supervisor' }),
    ],
    [
      'record substitution',
      (value: Fixture) =>
        snapshot(value, { record: { ...value.record, supervisorInstanceId: 'other-supervisor' } }),
    ],
  ] as const)('denies %s', async (_name, mutate) => {
    const value = fixture();
    await expect(
      source(value, new MutableReader(mutate(value))).subject.read(),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorRecoveryError);
  });

  it('enforces root validity, revocation, version floor, fingerprint, and uniqueness', async () => {
    await expect(
      source(fixture({ revokedAt: '2030-01-01T12:00:00.000Z' })).subject.read(),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorRecoveryError);
    await expect(
      source(fixture({ minimumSnapshotVersion: 2 })).subject.read(),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorRecoveryError);
    const value = fixture();
    expect(
      () =>
        new BoundedRetainedNativeSupervisorTrustSource(
          INSTANCE,
          new MutableReader(snapshot(value)),
          new MemoryCheckpointStore(),
          [{ ...value.root, publicKeySpkiSha256: '0'.repeat(64) }],
          () => NOW,
        ),
    ).toThrow(RetainedNativeSupervisorRecoveryError);
    expect(
      () =>
        new BoundedRetainedNativeSupervisorTrustSource(
          INSTANCE,
          new MutableReader(snapshot(value)),
          new MemoryCheckpointStore(),
          [value.root, { ...value.root, rootRecordId: 'other-root' }],
          () => NOW,
        ),
    ).toThrow(RetainedNativeSupervisorRecoveryError);
  });

  it('rotates by one hash-linked version and rejects the prior supervisor key', async () => {
    const first = fixture();
    const firstSnapshot = snapshot(first);
    const reader = new MutableReader(firstSnapshot);
    const checkpoints = new MemoryCheckpointStore();
    const { subject } = source(first, reader, checkpoints);
    await subject.read();

    const second = fixture(
      {},
      {
        trustRecordId: 'native-trust-record-2',
        trustRecordVersion: 2,
        supervisorKeyId: 'native-supervisor-key-2',
      },
    );
    const secondSnapshot = snapshot(
      { ...second, root: first.root, rootPrivateKey: first.rootPrivateKey },
      {
        snapshotId: 'native-snapshot-2',
        snapshotVersion: 2,
        previousSnapshotHash: retainedNativeSupervisorTrustSnapshotHash(firstSnapshot),
      },
    );
    reader.value = secondSnapshot;
    const rotated = await subject.read();
    expect(rotated.snapshotVersion).toBe(2);
    expect(rotated.trustRecordVersion).toBe(2);
    expect(() =>
      rotated.responseVerifier.verify(
        response(first),
        request(),
        new Date('2030-01-01T12:00:00.500Z'),
      ),
    ).toThrow(RetainedNativeSupervisorRecoveryError);
    expect(
      rotated.responseVerifier.verify(
        response(second),
        request(),
        new Date('2030-01-01T12:00:00.500Z'),
      ),
    ).toMatchObject({ supervisorKeyId: second.record.supervisorKeyId });
  });

  it('keeps root rotation inside the same supervisor-instance checkpoint chain', async () => {
    const first = fixture();
    const secondRoot = fixture({
      rootRecordId: 'native-root-record-2',
      rootRecordVersion: 2,
      signerKeyId: 'native-root-signer-2',
    });
    const firstSnapshot = snapshot(first);
    const reader = new MutableReader(firstSnapshot);
    const checkpoints = new MemoryCheckpointStore();
    const subject = new BoundedRetainedNativeSupervisorTrustSource(
      INSTANCE,
      reader,
      checkpoints,
      [first.root, secondRoot.root],
      () => NOW,
    );
    await subject.read();
    reader.value = snapshot(
      {
        ...first,
        root: secondRoot.root,
        rootPrivateKey: secondRoot.rootPrivateKey,
      },
      {
        snapshotId: 'new-root-snapshot-2',
        snapshotVersion: 2,
        previousSnapshotHash: retainedNativeSupervisorTrustSnapshotHash(firstSnapshot),
      },
    );
    const rotated = await subject.read();
    expect(rotated.signerKeyId).toBe(secondRoot.root.signerKeyId);
    expect(checkpoints.values.size).toBe(1);
    expect(checkpoints.values.get(INSTANCE)?.signerKeyId).toBe(secondRoot.root.signerKeyId);
    reader.value = firstSnapshot;
    await expect(subject.read()).rejects.toBeInstanceOf(RetainedNativeSupervisorRecoveryError);
  });

  it('denies rollback, skipped versions, broken links, and same-version equivocation', async () => {
    const value = fixture();
    const first = snapshot(value);
    const reader = new MutableReader(first);
    const { subject } = source(value, reader);
    await subject.read();
    reader.value = snapshot(value, { snapshotId: 'equivocated-snapshot' });
    await expect(subject.read()).rejects.toBeInstanceOf(RetainedNativeSupervisorRecoveryError);
    reader.value = snapshot(value, {
      snapshotId: 'skipped-snapshot',
      snapshotVersion: 3,
      previousSnapshotHash: retainedNativeSupervisorTrustSnapshotHash(first),
    });
    await expect(subject.read()).rejects.toBeInstanceOf(RetainedNativeSupervisorRecoveryError);
    reader.value = snapshot(value, {
      snapshotId: 'broken-link-snapshot',
      snapshotVersion: 2,
      previousSnapshotHash: '0'.repeat(64),
    });
    await expect(subject.read()).rejects.toBeInstanceOf(RetainedNativeSupervisorRecoveryError);
  });

  it('denies key-id substitution and trust-record version rollback across linked snapshots', async () => {
    const first = fixture();
    const firstSnapshot = snapshot(first);
    const reader = new MutableReader(firstSnapshot);
    const { subject } = source(first, reader);
    await subject.read();

    const substituted = fixture({}, { supervisorKeyId: first.record.supervisorKeyId });
    reader.value = snapshot(
      { ...substituted, root: first.root, rootPrivateKey: first.rootPrivateKey },
      {
        snapshotId: 'key-substitution-2',
        snapshotVersion: 2,
        previousSnapshotHash: retainedNativeSupervisorTrustSnapshotHash(firstSnapshot),
      },
    );
    await expect(subject.read()).rejects.toBeInstanceOf(RetainedNativeSupervisorRecoveryError);

    const store = new MemoryCheckpointStore();
    const versionReader = new MutableReader(firstSnapshot);
    const versionSource = source(first, versionReader, store).subject;
    await versionSource.read();
    versionReader.value = snapshot(first, {
      snapshotId: 'record-version-2',
      snapshotVersion: 2,
      previousSnapshotHash: retainedNativeSupervisorTrustSnapshotHash(firstSnapshot),
      record: { ...first.record, trustRecordVersion: 2 },
    });
    const second = versionReader.value as RetainedNativeSupervisorTrustSnapshot;
    await versionSource.read();
    versionReader.value = snapshot(first, {
      snapshotId: 'record-version-rollback-3',
      snapshotVersion: 3,
      previousSnapshotHash: retainedNativeSupervisorTrustSnapshotHash(second),
      record: first.record,
    });
    await expect(versionSource.read()).rejects.toBeInstanceOf(
      RetainedNativeSupervisorRecoveryError,
    );
  });

  it('durably advances an explicit revocation snapshot and denies subsequent rollback', async () => {
    const value = fixture();
    const first = snapshot(value);
    const reader = new MutableReader(first);
    const checkpoints = new MemoryCheckpointStore();
    const { subject } = source(value, reader, checkpoints);
    await subject.read();
    reader.value = snapshot(value, {
      snapshotId: 'native-revocation-2',
      snapshotVersion: 2,
      previousSnapshotHash: retainedNativeSupervisorTrustSnapshotHash(first),
      record: null,
    });
    await expect(subject.read()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(checkpoints.values.get(INSTANCE)?.snapshotVersion).toBe(2);
    reader.value = first;
    await expect(subject.read()).rejects.toBeInstanceOf(RetainedNativeSupervisorRecoveryError);
  });

  it('denies accessor input, unavailable durable state, and an expired returned verifier', async () => {
    const value = fixture();
    const signed = snapshot(value);
    const accessor = { ...signed } as Record<string, unknown>;
    let getterCalls = 0;
    Object.defineProperty(accessor, 'snapshotId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return signed.snapshotId;
      },
    });
    await expect(source(value, new MutableReader(accessor)).subject.read()).rejects.toBeInstanceOf(
      RetainedNativeSupervisorRecoveryError,
    );
    expect(getterCalls).toBe(0);

    const unavailable = new MemoryCheckpointStore();
    unavailable.failWrites = true;
    await expect(
      source(value, new MutableReader(signed), unavailable).subject.read(),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorRecoveryError);

    const trusted = await source(value).subject.read();
    expect(() =>
      trusted.responseVerifier.verify(response(value), request(), new Date(trusted.validUntil)),
    ).toThrow(RetainedNativeSupervisorRecoveryError);
  });

  it('accepts only an identical CAS-race winner', async () => {
    const value = fixture();
    const signed = snapshot(value);
    const expected: RetainedNativeSupervisorTrustCheckpoint = {
      schemaVersion: 1,
      supervisorInstanceId: INSTANCE,
      signerKeyId: signed.signerKeyId,
      snapshotId: signed.snapshotId,
      snapshotVersion: signed.snapshotVersion,
      snapshotHash: retainedNativeSupervisorTrustSnapshotHash(signed),
      activeSupervisorKeyId: value.record.supervisorKeyId,
      activePublicKeySpkiSha256: value.record.publicKeySpkiSha256,
      activeTrustRecordId: value.record.trustRecordId,
      activeTrustRecordVersion: value.record.trustRecordVersion,
    };
    const store = new MemoryCheckpointStore();
    store.loseNextCasTo = expected;
    const trusted = await source(value, new MutableReader(signed), store).subject.read();
    expect(trusted.snapshotHash).toBe(expected.snapshotHash);

    const conflict = new MemoryCheckpointStore();
    conflict.loseNextCasTo = { ...expected, snapshotHash: '0'.repeat(64) };
    await expect(
      source(value, new MutableReader(signed), conflict).subject.read(),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorRecoveryError);
  });

  it('hashes only the canonical signed snapshot payload', () => {
    const value = fixture();
    const signed = snapshot(value);
    expect(retainedNativeSupervisorTrustSnapshotPayload(signed)).not.toHaveProperty('signature');
    expect(retainedNativeSupervisorTrustSnapshotHash(signed)).toMatch(/^[a-f0-9]{64}$/u);
    expect(retainedNativeSupervisorRecoveryResponsePayload(response(value))).not.toHaveProperty(
      'signature',
    );
  });
});
