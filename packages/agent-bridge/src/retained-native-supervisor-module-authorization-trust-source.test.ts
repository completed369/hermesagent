import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from './codec';
import {
  linuxRetainedNativeSupervisorModuleLoadRequestHash,
  type LinuxRetainedNativeSupervisorModuleAuthorization,
  type LinuxRetainedNativeSupervisorModuleLoadRequest,
} from './retained-native-supervisor-linux-module-loader';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot,
  BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotPublisher,
  BoundedRetainedNativeSupervisorModuleAuthorizationTrustSource,
  DenyRetainedNativeSupervisorModuleAuthorizationTrustSource,
  retainedNativeSupervisorModuleAuthorizationSnapshotHash,
  retainedNativeSupervisorModuleAuthorizationSnapshotPayload,
  type RetainedNativeSupervisorModuleAuthorizationCheckpoint,
  type RetainedNativeSupervisorModuleAuthorizationCheckpointStore,
  type RetainedNativeSupervisorModuleAuthorizationRootRecord,
  type RetainedNativeSupervisorModuleAuthorizationSnapshot,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotReader,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore,
} from './retained-native-supervisor-module-authorization-trust-source';

const INSTANCE = 'native-supervisor-production-1';
const NOW = Date.parse('2030-01-01T12:00:00.000Z');

class MutableReader implements RetainedNativeSupervisorModuleAuthorizationSnapshotReader {
  readCalls = 0;
  constructor(public value: unknown) {}
  async read(): Promise<unknown> {
    this.readCalls += 1;
    return this.value;
  }
}

class MemoryCheckpointStore implements RetainedNativeSupervisorModuleAuthorizationCheckpointStore {
  readonly values = new Map<
    string,
    Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint>
  >();
  loseNextCasTo: Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint> | null = null;
  fail = false;

  async read(instance: string): Promise<unknown | null> {
    if (this.fail) throw new Error('private database error');
    return this.values.get(instance) ?? null;
  }

  async compareAndSwap(
    instance: string,
    expected: Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint> | null,
    next: Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint>,
  ): Promise<boolean> {
    if (this.fail) throw new Error('private database error');
    if (this.loseNextCasTo !== null) {
      this.values.set(instance, this.loseNextCasTo);
      this.loseNextCasTo = null;
      return false;
    }
    const current = this.values.get(instance) ?? null;
    if (canonicalJson(current) !== canonicalJson(expected)) return false;
    this.values.set(instance, next);
    return true;
  }
}

class MemoryPublicationStore implements RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore {
  calls = 0;
  authenticated: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot | null = null;
  result: 'APPENDED' | 'REPLAYED' = 'APPENDED';

  async append(
    authenticated: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot,
  ): Promise<'APPENDED' | 'REPLAYED'> {
    AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot.assertAuthenticated(
      authenticated,
    );
    this.calls += 1;
    this.authenticated = authenticated;
    return this.result;
  }
}

interface Fixture {
  readonly root: RetainedNativeSupervisorModuleAuthorizationRootRecord;
  readonly privateKey: KeyObject;
  readonly request: LinuxRetainedNativeSupervisorModuleLoadRequest;
  readonly authorization: LinuxRetainedNativeSupervisorModuleAuthorization;
}

function request(
  kind: 'CLIENT' | 'LISTENER' = 'CLIENT',
  socketPath = '/run/ventureos/supervisor/recovery.sock',
): LinuxRetainedNativeSupervisorModuleLoadRequest {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: kind,
    canonicalModulePath: `/opt/ventureos/native/${kind.toLowerCase()}.node`,
    socketPath,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function fixture(
  kind: 'CLIENT' | 'LISTENER' = 'CLIENT',
  rootOverrides: Partial<RetainedNativeSupervisorModuleAuthorizationRootRecord> = {},
  authorizationOverrides: Partial<LinuxRetainedNativeSupervisorModuleAuthorization> = {},
): Fixture {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const loadRequest = request(kind);
  return {
    privateKey,
    root: {
      schemaVersion: 1,
      rootRecordId: 'native-module-root-record-1',
      rootRecordVersion: 1,
      signerKeyId: 'native-module-root-signer-1',
      algorithm: 'ED25519',
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT',
      publicKeySpkiBase64: spki.toString('base64'),
      publicKeySpkiSha256: createHash('sha256').update(spki).digest('hex'),
      minimumSnapshotVersion: 1,
      validFrom: '2029-01-01T00:00:00.000Z',
      validUntil: '2031-01-01T00:00:00.000Z',
      revokedAt: null,
      testOnly: false,
      ...rootOverrides,
    },
    request: loadRequest,
    authorization: {
      ...loadRequest,
      authorizationId: `native-module-${kind.toLowerCase()}-authorization-1`,
      authorizationVersion: 1,
      requestHash: linuxRetainedNativeSupervisorModuleLoadRequestHash(loadRequest),
      validFrom: '2030-01-01T11:59:59.000Z',
      validUntil: '2030-01-01T12:01:00.000Z',
      moduleSha256: kind === 'CLIENT' ? 'a'.repeat(64) : 'b'.repeat(64),
      moduleIdentityReference: kind === 'CLIENT' ? 'linux:dev-1:ino-2' : 'linux:dev-1:ino-3',
      moduleOwnerUid: 1000,
      moduleOwnerGid: 1000,
      moduleMode: 0o555,
      moduleSizeBytes: 64_000,
      socketDirectory: '/run/ventureos/supervisor',
      socketDirectoryIdentityReference: 'linux:dev-4:ino-5',
      socketDirectoryOwnerUid: 1000,
      socketDirectoryOwnerGid: 1000,
      socketDirectoryMode: 0o700,
      ...authorizationOverrides,
    },
  };
}

function snapshot(
  value: Fixture,
  overrides: Partial<RetainedNativeSupervisorModuleAuthorizationSnapshot> = {},
): RetainedNativeSupervisorModuleAuthorizationSnapshot {
  const unsigned = {
    schemaVersion: 1 as const,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION' as const,
    snapshotId: 'native-module-snapshot-1',
    snapshotVersion: 1,
    signerKeyId: value.root.signerKeyId,
    algorithm: 'ED25519' as const,
    supervisorInstanceId: INSTANCE,
    issuedAt: '2030-01-01T11:59:58.000Z',
    validUntil: '2030-01-01T12:02:00.000Z',
    previousSnapshotHash: null,
    authorizations: [
      value.authorization,
    ] as readonly Readonly<LinuxRetainedNativeSupervisorModuleAuthorization>[],
    ...overrides,
  };
  const { signature: _ignored, ...payload } = unsigned as typeof unsigned & { signature?: string };
  return {
    ...payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), value.privateKey).toString('base64'),
  };
}

function subject(
  value: Fixture,
  reader = new MutableReader(snapshot(value)),
  checkpoints = new MemoryCheckpointStore(),
  roots: readonly unknown[] = [value.root],
): BoundedRetainedNativeSupervisorModuleAuthorizationTrustSource {
  return new BoundedRetainedNativeSupervisorModuleAuthorizationTrustSource(
    INSTANCE,
    reader,
    checkpoints,
    roots,
    () => NOW,
  );
}

describe('retained-native module authorization trust source', () => {
  it('publishes only a cryptographically authenticated owned snapshot', async () => {
    const value = fixture();
    const signed = snapshot(value);
    const store = new MemoryPublicationStore();
    const publisher = new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotPublisher(
      INSTANCE,
      [value.root],
      store,
      () => NOW,
    );

    await expect(publisher.publish(signed)).resolves.toBe('APPENDED');
    expect(store.calls).toBe(1);
    expect(store.authenticated?.snapshot).toEqual(signed);
    expect(store.authenticated?.snapshot).not.toBe(signed);
    expect(store.authenticated?.snapshotHash).toBe(
      retainedNativeSupervisorModuleAuthorizationSnapshotHash(signed),
    );
    expect(Object.isFrozen(store.authenticated)).toBe(true);
    expect(Object.isFrozen(store.authenticated?.snapshot)).toBe(true);
    expect(Object.isFrozen(publisher)).toBe(true);

    store.result = 'REPLAYED';
    await expect(publisher.publish(signed)).resolves.toBe('REPLAYED');
  });

  it('keeps publication deny-by-default and never calls storage for unauthenticated input', async () => {
    const value = fixture();
    const signed = snapshot(value);
    const store = new MemoryPublicationStore();
    const publisher = new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotPublisher(
      INSTANCE,
      [value.root],
      store,
      () => NOW,
    );
    await expect(
      publisher.publish({ ...signed, signature: Buffer.alloc(64, 9).toString('base64') }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(store.calls).toBe(0);
    await expect(
      new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotPublisher(
        INSTANCE,
        [value.root],
        undefined,
        () => NOW,
      ).publish(signed),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(publisher.publish(signed)).resolves.toBe('APPENDED');
    const proxied = new Proxy(store.authenticated!, {});
    expect(() =>
      AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot.assertAuthenticated(proxied),
    ).toThrow(RetainedNativeSupervisorLocalIpcError);
    expect(
      () =>
        new AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot(
          Symbol('forged'),
          signed,
          retainedNativeSupervisorModuleAuthorizationSnapshotHash(signed),
          NOW,
        ),
    ).toThrow(RetainedNativeSupervisorLocalIpcError);
  });

  it('authenticates an exact request-bound grant only after durable checkpoint advance', async () => {
    const value = fixture();
    const checkpoints = new MemoryCheckpointStore();
    const grant = await subject(value, undefined, checkpoints).read(value.request);

    expect(grant).toEqual(value.authorization);
    expect(Object.isFrozen(grant)).toBe(true);
    expect(checkpoints.values.get(INSTANCE)).toMatchObject({
      schemaVersion: 1,
      snapshotVersion: 1,
      clientAuthorizationId: value.authorization.authorizationId,
      listenerAuthorizationId: null,
    });
  });

  it('keeps the default source deny-only', async () => {
    await expect(
      new DenyRetainedNativeSupervisorModuleAuthorizationTrustSource().read(request()),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorLocalIpcError);
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
      (value: Fixture) => snapshot(value, { validUntil: '2030-01-01T12:04:58.001Z' }),
    ],
    [
      'other supervisor',
      (value: Fixture) => snapshot(value, { supervisorInstanceId: 'other-supervisor' }),
    ],
    [
      'grant outside snapshot',
      (value: Fixture) =>
        snapshot(value, {
          authorizations: [{ ...value.authorization, validUntil: '2030-01-01T12:03:00.000Z' }],
        }),
    ],
    [
      'expired enclosed grant',
      (value: Fixture) =>
        snapshot(value, {
          authorizations: [{ ...value.authorization, validUntil: '2030-01-01T12:00:00.000Z' }],
        }),
    ],
  ] as const)('denies %s', async (_name, mutate) => {
    const value = fixture();
    await expect(
      subject(value, new MutableReader(mutate(value))).read(value.request),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorLocalIpcError);
  });

  it('supports one or two canonically ordered grants and denies duplicates or reordering', async () => {
    const client = fixture('CLIENT');
    const listenerBase = fixture('LISTENER');
    const listener = { ...listenerBase, root: client.root, privateKey: client.privateKey };
    const signed = snapshot(client, {
      authorizations: [client.authorization, listener.authorization],
    });
    const source = subject(client, new MutableReader(signed));
    expect((await source.read(listener.request)).moduleKind).toBe('LISTENER');

    await expect(
      subject(
        client,
        new MutableReader(
          snapshot(client, { authorizations: [listener.authorization, client.authorization] }),
        ),
      ).read(client.request),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorLocalIpcError);
    await expect(
      subject(
        client,
        new MutableReader(
          snapshot(client, { authorizations: [client.authorization, client.authorization] }),
        ),
      ).read(client.request),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorLocalIpcError);
  });

  it('advances exact hash-linked rotation and rejects rollback, gaps, and equivocation', async () => {
    const value = fixture();
    const first = snapshot(value);
    const reader = new MutableReader(first);
    const checkpoints = new MemoryCheckpointStore();
    const source = subject(value, reader, checkpoints);
    await source.read(value.request);

    const secondAuthorization = { ...value.authorization, authorizationVersion: 2 };
    const second = snapshot(value, {
      snapshotId: 'native-module-snapshot-2',
      snapshotVersion: 2,
      previousSnapshotHash: retainedNativeSupervisorModuleAuthorizationSnapshotHash(first),
      authorizations: [secondAuthorization],
    });
    reader.value = second;
    expect((await source.read(value.request)).authorizationVersion).toBe(2);

    reader.value = snapshot(value, {
      snapshotId: 'native-module-snapshot-3-version-rollback',
      snapshotVersion: 3,
      previousSnapshotHash: retainedNativeSupervisorModuleAuthorizationSnapshotHash(second),
      authorizations: [value.authorization],
    });
    await expect(source.read(value.request)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
    reader.value = snapshot(value, {
      snapshotId: 'native-module-snapshot-3-content-equivocation',
      snapshotVersion: 3,
      previousSnapshotHash: retainedNativeSupervisorModuleAuthorizationSnapshotHash(second),
      authorizations: [{ ...secondAuthorization, moduleSha256: 'c'.repeat(64) }],
    });
    await expect(source.read(value.request)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );

    reader.value = first;
    await expect(source.read(value.request)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
    reader.value = snapshot(value, {
      snapshotId: 'native-module-snapshot-4',
      snapshotVersion: 4,
      previousSnapshotHash: retainedNativeSupervisorModuleAuthorizationSnapshotHash(second),
    });
    await expect(source.read(value.request)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
    reader.value = snapshot(value, {
      snapshotId: 'equivocated-native-module-snapshot-2',
      snapshotVersion: 2,
      previousSnapshotHash: retainedNativeSupervisorModuleAuthorizationSnapshotHash(first),
    });
    await expect(source.read(value.request)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
  });

  it('keeps root rotation inside the same supervisor-instance checkpoint chain', async () => {
    const first = fixture();
    const nextRoot = fixture('CLIENT', {
      rootRecordId: 'native-module-root-record-2',
      rootRecordVersion: 2,
      signerKeyId: 'native-module-root-signer-2',
    });
    const firstSnapshot = snapshot(first);
    const reader = new MutableReader(firstSnapshot);
    const checkpoints = new MemoryCheckpointStore();
    const source = subject(first, reader, checkpoints, [first.root, nextRoot.root]);
    await source.read(first.request);
    reader.value = snapshot(
      {
        ...nextRoot,
        request: first.request,
        authorization: first.authorization,
      },
      {
        snapshotId: 'native-module-new-root-snapshot-2',
        snapshotVersion: 2,
        previousSnapshotHash:
          retainedNativeSupervisorModuleAuthorizationSnapshotHash(firstSnapshot),
      },
    );
    await expect(source.read(first.request)).resolves.toEqual(first.authorization);
    expect(checkpoints.values.size).toBe(1);
    expect(checkpoints.values.get(INSTANCE)?.signerKeyId).toBe(nextRoot.root.signerKeyId);
  });

  it('durably advances explicit revocation before denying stale grants', async () => {
    const value = fixture();
    const first = snapshot(value);
    const reader = new MutableReader(first);
    const checkpoints = new MemoryCheckpointStore();
    const source = subject(value, reader, checkpoints);
    await source.read(value.request);
    reader.value = snapshot(value, {
      snapshotId: 'native-module-revocation-2',
      snapshotVersion: 2,
      previousSnapshotHash: retainedNativeSupervisorModuleAuthorizationSnapshotHash(first),
      authorizations: [],
    });
    await expect(source.read(value.request)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(checkpoints.values.get(INSTANCE)).toMatchObject({
      snapshotVersion: 2,
      clientAuthorizationId: null,
    });
    reader.value = first;
    await expect(source.read(value.request)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
  });

  it('advances a valid snapshot but denies a request not explicitly present', async () => {
    const value = fixture();
    const checkpoints = new MemoryCheckpointStore();
    await expect(
      subject(value, undefined, checkpoints).read(
        request('CLIENT', '/run/ventureos/supervisor/other.sock'),
      ),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(checkpoints.values.get(INSTANCE)?.snapshotVersion).toBe(1);
  });

  it('enforces root fingerprint, scope, version floor, revocation, and uniqueness', async () => {
    const revoked = fixture('CLIENT', { revokedAt: '2030-01-01T12:00:00.000Z' });
    await expect(subject(revoked).read(revoked.request)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
    const floored = fixture('CLIENT', { minimumSnapshotVersion: 2 });
    await expect(subject(floored).read(floored.request)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
    const value = fixture();
    expect(() =>
      subject(value, undefined, undefined, [{ ...value.root, purpose: 'WRONG' }]),
    ).toThrow(RetainedNativeSupervisorLocalIpcError);
    expect(() =>
      subject(value, undefined, undefined, [
        value.root,
        { ...value.root, rootRecordId: 'duplicate-key-root' },
      ]),
    ).toThrow(RetainedNativeSupervisorLocalIpcError);
  });

  it('accepts only an identical CAS-race winner and denies unavailable state', async () => {
    const value = fixture();
    const signed = snapshot(value);
    const firstStore = new MemoryCheckpointStore();
    const firstSource = subject(value, new MutableReader(signed), firstStore);
    await firstSource.read(value.request);
    const expected = firstStore.values.get(INSTANCE)!;

    const identicalRace = new MemoryCheckpointStore();
    identicalRace.loseNextCasTo = expected;
    await expect(
      subject(value, new MutableReader(signed), identicalRace).read(value.request),
    ).resolves.toEqual(value.authorization);

    const conflict = new MemoryCheckpointStore();
    conflict.loseNextCasTo = { ...expected, snapshotHash: '0'.repeat(64) };
    await expect(
      subject(value, new MutableReader(signed), conflict).read(value.request),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorLocalIpcError);

    const unavailable = new MemoryCheckpointStore();
    unavailable.fail = true;
    await expect(subject(value, undefined, unavailable).read(value.request)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
  });

  it('rejects accessors without invoking them and hashes only the canonical payload', async () => {
    const value = fixture();
    const signed = snapshot(value);
    const accessor = { ...signed } as Record<string, unknown>;
    let calls = 0;
    Object.defineProperty(accessor, 'snapshotId', {
      enumerable: true,
      get() {
        calls += 1;
        return signed.snapshotId;
      },
    });
    await expect(
      subject(value, new MutableReader(accessor)).read(value.request),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorLocalIpcError);
    expect(calls).toBe(0);

    const requestAccessor = { ...value.request } as LinuxRetainedNativeSupervisorModuleLoadRequest;
    Object.defineProperty(requestAccessor, 'moduleKind', {
      enumerable: true,
      get() {
        calls += 1;
        return 'CLIENT';
      },
    });
    const unread = new MutableReader(signed);
    await expect(subject(value, unread).read(requestAccessor)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
    expect(calls).toBe(0);
    expect(unread.readCalls).toBe(0);

    const authorizationAccessor: unknown[] = [value.authorization];
    Object.defineProperty(authorizationAccessor, '0', {
      enumerable: true,
      get() {
        calls += 1;
        return value.authorization;
      },
    });
    await expect(
      subject(value, new MutableReader({ ...signed, authorizations: authorizationAccessor })).read(
        value.request,
      ),
    ).rejects.toBeInstanceOf(RetainedNativeSupervisorLocalIpcError);
    expect(calls).toBe(0);
    expect(retainedNativeSupervisorModuleAuthorizationSnapshotPayload(signed)).not.toHaveProperty(
      'signature',
    );
    expect(retainedNativeSupervisorModuleAuthorizationSnapshotHash(signed)).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });
});
