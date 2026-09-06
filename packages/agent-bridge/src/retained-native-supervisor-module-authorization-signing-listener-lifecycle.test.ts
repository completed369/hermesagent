import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  BoundedLinuxRetainedNativeSupervisorListenerLifecycle,
  DenyLinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyFactory,
  type LinuxRetainedNativeSupervisorListenerAuthorization,
  type LinuxRetainedNativeSupervisorListenerCreationRequest,
  type LinuxRetainedNativeSupervisorListenerLifecycleBinding,
  type LinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyFactory,
  type LinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyRequest,
  type LinuxRetainedNativeSupervisorOwnedListener,
} from './retained-native-supervisor-listener-lifecycle';
import type {
  LinuxRetainedNativeSupervisorAcceptedSession,
  LinuxRetainedNativeSupervisorWorkerCredentials,
} from './retained-native-supervisor-linux-session';
import type { RetainedNativeSupervisorModuleAuthorizationSigningCustodySession } from './retained-native-supervisor-module-authorization-signing-handler';

const socketPath = '/run/ventureos/native-module-signer.sock';
const signerKeyId = 'native-module-signer-v1';
const parentIdentity = Object.freeze({
  fileType: 'DIRECTORY',
  device: 40,
  inode: 8_000,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o700,
});
const listenerIdentity = Object.freeze({
  fileType: 'SOCKET',
  device: 41,
  inode: 9_001,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o600,
});
const workerCredentials: Readonly<LinuxRetainedNativeSupervisorWorkerCredentials> = Object.freeze({
  pid: 811,
  uid: 710,
  gid: 711,
});

function authorization(): LinuxRetainedNativeSupervisorListenerAuthorization {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    socketPath,
    parentDevice: parentIdentity.device,
    parentInode: parentIdentity.inode,
    parentOwnerUid: parentIdentity.ownerUid,
    parentOwnerGid: parentIdentity.ownerGid,
    parentMode: parentIdentity.mode,
    socketOwnerUid: listenerIdentity.ownerUid,
    socketOwnerGid: listenerIdentity.ownerGid,
    socketMode: listenerIdentity.mode,
    expectedWorkerPid: workerCredentials.pid,
    expectedWorkerUid: workerCredentials.uid,
    expectedWorkerGid: workerCredentials.gid,
    listenBacklog: 1,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function signingRequestFrame(): Uint8Array {
  const payload = {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION',
    algorithm: 'ED25519',
    signerKeyId,
    snapshotId: 'snapshot-signing-lifecycle-1',
    snapshotVersion: 1,
    supervisorInstanceId: 'supervisor-1',
    issuedAt: '2026-09-06T00:00:00.000Z',
    validUntil: '2026-09-06T00:05:00.000Z',
    previousSnapshotHash: null,
    authorizations: [],
  };
  const snapshotPayloadHash = createHash('sha256').update(canonicalJson(payload)).digest('hex');
  const binding = {
    protocolVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_REQUEST',
    signerKeyId,
    snapshotPayloadHash,
    payload,
    runtimeConnection: 'NOT_CONFIGURED',
  };
  return new TextEncoder().encode(
    canonicalJson({
      ...binding,
      signingRequestHash: createHash('sha256').update(canonicalJson(binding)).digest('hex'),
    }),
  );
}

class FixtureCustody implements RetainedNativeSupervisorModuleAuthorizationSigningCustodySession {
  readonly calls: string[];
  readonly sign = vi.fn(async () => {
    this.calls.push('sign');
    return Uint8Array.from({ length: 64 }, () => 7);
  });
  readonly close = vi.fn(async () => {
    this.calls.push('custody-close');
  });

  constructor(calls: string[]) {
    this.calls = calls;
  }
}

class FixtureAcceptedSession implements LinuxRetainedNativeSupervisorAcceptedSession {
  readonly calls: string[];
  written: Uint8Array | undefined;
  readonly peerCredentials = vi.fn(async () => {
    this.calls.push('peer');
    return workerCredentials;
  });
  readonly readToEof = vi.fn(async () => {
    this.calls.push('read');
    return signingRequestFrame();
  });
  readonly writeAndShutdown = vi.fn(async (frame: Readonly<Uint8Array>) => {
    this.calls.push('write');
    this.written = Uint8Array.from(frame);
  });
  readonly close = vi.fn(async () => {
    this.calls.push('session-close');
  });

  constructor(calls: string[]) {
    this.calls = calls;
  }
}

class FixtureOwnedListener implements LinuxRetainedNativeSupervisorOwnedListener {
  readonly platform = 'LINUX' as const;
  readonly calls: string[] = [];
  readonly accepted = new FixtureAcceptedSession(this.calls);
  readonly creationEvidence = vi.fn(async () => {
    this.calls.push('creation-evidence');
    return {
      schemaVersion: 1,
      pathStateBefore: 'ABSENT',
      bindDisposition: 'CREATED_WITHOUT_REPLACEMENT',
      parentIdentity,
      listenerIdentity,
    };
  });
  readonly lstatUnixSocket = vi.fn(async () => {
    this.calls.push('lstat');
    return listenerIdentity;
  });
  readonly acceptAuthorizedUnixSocket = vi.fn(async () => {
    this.calls.push('accept');
    return this.accepted;
  });
  readonly closeAndUnlinkOwned = vi.fn(() => {
    this.calls.push('listener-cleanup');
    return {
      schemaVersion: 1,
      listenerClosed: true,
      disposition: 'OWNED_SOCKET_REMOVED',
      expectedDevice: listenerIdentity.device,
      expectedInode: listenerIdentity.inode,
    };
  });
}

class FixtureBinding implements LinuxRetainedNativeSupervisorListenerLifecycleBinding {
  readonly platform = 'LINUX' as const;
  readonly listener = new FixtureOwnedListener();
  readonly createOwnedListener = vi.fn(
    async (
      _request: Readonly<LinuxRetainedNativeSupervisorListenerCreationRequest>,
      _signal: AbortSignal,
    ) => {
      this.listener.calls.push('create-listener');
      return this.listener;
    },
  );
}

class FixtureCustodyFactory implements LinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyFactory {
  readonly platform = 'LINUX' as const;
  readonly custody: FixtureCustody;
  readonly createOne = vi.fn(
    (_request: Readonly<LinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyRequest>) => {
      this.custody.calls.push('create-custody');
      return this.custody;
    },
  );

  constructor(calls: string[]) {
    this.custody = new FixtureCustody(calls);
  }
}

function fixture() {
  const binding = new FixtureBinding();
  const factory = new FixtureCustodyFactory(binding.listener.calls);
  return {
    binding,
    factory,
    lifecycle: new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(binding, authorization()),
  };
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

describe('bounded Linux retained-native supervisor signing listener lifecycle', () => {
  it('creates custody only after exact listener attestation and owns one complete exchange', async () => {
    const { binding, factory, lifecycle } = fixture();

    await expect(
      lifecycle.runSigningOne(signerKeyId, factory, new AbortController().signal),
    ).resolves.toBeUndefined();

    expect(factory.createOne).toHaveBeenCalledOnce();
    expect(factory.createOne).toHaveBeenCalledWith({
      schemaVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SIGNING_CUSTODY',
      platform: 'LINUX',
      signerKeyId,
      socketPath,
      socketDevice: listenerIdentity.device,
      socketInode: listenerIdentity.inode,
      socketOwnerUid: listenerIdentity.ownerUid,
      socketOwnerGid: listenerIdentity.ownerGid,
      socketMode: listenerIdentity.mode,
      expectedWorkerPid: workerCredentials.pid,
      expectedWorkerUid: workerCredentials.uid,
      expectedWorkerGid: workerCredentials.gid,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(Object.isFrozen(factory.createOne.mock.calls[0]?.[0])).toBe(true);
    expect(binding.listener.calls).toEqual([
      'create-listener',
      'creation-evidence',
      'lstat',
      'create-custody',
      'lstat',
      'accept',
      'peer',
      'lstat',
      'read',
      'sign',
      'custody-close',
      'lstat',
      'write',
      'session-close',
      'listener-cleanup',
    ]);
    expect(factory.custody.sign).toHaveBeenCalledOnce();
    expect(factory.custody.close).toHaveBeenCalledOnce();
    expect(binding.listener.accepted.writeAndShutdown).toHaveBeenCalledOnce();
  });

  it('does not create custody when listener identity attestation fails', async () => {
    const { binding, factory, lifecycle } = fixture();
    binding.listener.lstatUnixSocket.mockResolvedValueOnce({
      ...listenerIdentity,
      inode: listenerIdentity.inode + 1,
    } as never);

    await expect(
      lifecycle.runSigningOne(signerKeyId, factory, new AbortController().signal),
    ).rejects.toEqual(expectCode('INVALID_ATTESTATION'));
    expect(factory.createOne).not.toHaveBeenCalled();
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it('rejects an unconfigured custody factory before listener creation', async () => {
    const { binding, lifecycle } = fixture();

    await expect(
      lifecycle.runSigningOne(
        signerKeyId,
        new DenyLinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyFactory(),
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(binding.createOwnedListener).not.toHaveBeenCalled();
  });

  it('redacts a hostile custody-factory accessor before listener creation', async () => {
    const { binding, lifecycle } = fixture();
    const hostileFactory = Object.defineProperty({}, 'platform', {
      enumerable: true,
      get: () => {
        throw new Error('private factory detail');
      },
    }) as LinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyFactory;

    await expect(
      lifecycle.runSigningOne(signerKeyId, hostileFactory, new AbortController().signal),
    ).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(binding.createOwnedListener).not.toHaveBeenCalled();
  });

  it.each([
    ['unsafe signer key', 'private-secret-key'],
    ['short timeout', 99],
    ['long timeout', 5_001],
  ])('rejects invalid signing configuration before listener creation: %s', async (label, value) => {
    const { binding, factory, lifecycle } = fixture();
    const operation =
      label === 'unsafe signer key'
        ? lifecycle.runSigningOne(value as string, factory, new AbortController().signal)
        : lifecycle.runSigningOne(
            signerKeyId,
            factory,
            new AbortController().signal,
            value as number,
          );
    await expect(operation).rejects.toEqual(expect.any(Error));
    expect(binding.createOwnedListener).not.toHaveBeenCalled();
  });

  it('redacts custody factory failure and still removes the owned listener', async () => {
    const { binding, factory, lifecycle } = fixture();
    factory.createOne.mockImplementation(() => {
      throw new Error('private key-store detail');
    });

    await expect(
      lifecycle.runSigningOne(signerKeyId, factory, new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(binding.listener.acceptAuthorizedUnixSocket).not.toHaveBeenCalled();
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it('closes a rejected custody candidate before removing the listener', async () => {
    const { binding, factory, lifecycle } = fixture();
    const close = vi.fn(async () => undefined);
    factory.createOne.mockReturnValue({ sign: null, close } as never);

    await expect(
      lifecycle.runSigningOne(signerKeyId, factory, new AbortController().signal),
    ).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(close).toHaveBeenCalledOnce();
    expect(binding.listener.acceptAuthorizedUnixSocket).not.toHaveBeenCalled();
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it('closes custody and listener when accepted-session work fails', async () => {
    const { binding, factory, lifecycle } = fixture();
    binding.listener.accepted.readToEof.mockRejectedValue(new Error('private socket detail'));

    await expect(
      lifecycle.runSigningOne(signerKeyId, factory, new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(factory.custody.sign).not.toHaveBeenCalled();
    expect(factory.custody.close).toHaveBeenCalledOnce();
    expect(binding.listener.accepted.close).toHaveBeenCalledOnce();
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it('consumes the shared lifecycle across signing and recovery entry points', async () => {
    const { binding, factory, lifecycle } = fixture();

    await expect(
      lifecycle.runSigningOne(signerKeyId, factory, new AbortController().signal),
    ).resolves.toBeUndefined();
    await expect(
      lifecycle.runSigningOne(signerKeyId, factory, new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(binding.createOwnedListener).toHaveBeenCalledOnce();
    expect(factory.createOne).toHaveBeenCalledOnce();
  });
});
