import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler,
  type RetainedNativeSupervisorLocalIpcAuthorization,
} from './retained-native-supervisor-local-ipc';
import {
  BoundedLinuxRetainedNativeSupervisorListenerLifecycle,
  DenyLinuxRetainedNativeSupervisorListenerLifecycleBinding,
  type LinuxRetainedNativeSupervisorListenerAuthorization,
  type LinuxRetainedNativeSupervisorListenerCreationRequest,
  type LinuxRetainedNativeSupervisorListenerLifecycleBinding,
  type LinuxRetainedNativeSupervisorOwnedListener,
} from './retained-native-supervisor-listener-lifecycle';
import type {
  LinuxRetainedNativeSupervisorAcceptedSession,
  LinuxRetainedNativeSupervisorWorkerCredentials,
} from './retained-native-supervisor-linux-session';
import type {
  RetainedNativeSupervisorRecoveryRequest,
  RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';

const socketPath = '/run/ventureos/retained-native-supervisor.sock';
const parentIdentity = Object.freeze({
  fileType: 'DIRECTORY',
  device: 40,
  inode: 8000,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o700,
});
const listenerIdentity = Object.freeze({
  fileType: 'SOCKET',
  device: 41,
  inode: 9001,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o600,
});
const workerCredentials: Readonly<LinuxRetainedNativeSupervisorWorkerCredentials> = Object.freeze({
  pid: 811,
  uid: 710,
  gid: 711,
});
const request = Object.freeze({
  schemaVersion: 1,
  requestId: 'native-recovery-request-lifecycle',
  requestHash: 'a'.repeat(64),
  challengeNonce: 'challenge-lifecycle',
  runtimeConnection: 'NOT_CONFIGURED',
}) as unknown as Readonly<RetainedNativeSupervisorRecoveryRequest>;
const response = Object.freeze({
  schemaVersion: 1,
  responseId: 'native-recovery-response-lifecycle',
  requestId: request.requestId,
  requestHash: request.requestHash,
  runtimeConnection: 'NOT_CONFIGURED',
});

function frame(
  direction: 'WORKER_TO_SUPERVISOR' | 'SUPERVISOR_TO_WORKER',
  message: unknown,
): Buffer {
  return Buffer.from(
    `${canonicalJson({
      schemaVersion: 1,
      protocol: 'VENTUREOS_RETAINED_NATIVE_RECOVERY_IPC',
      direction,
      message,
    })}\n`,
  );
}

const requestFrame = frame('WORKER_TO_SUPERVISOR', request);
const responseFrame = frame('SUPERVISOR_TO_WORKER', response);

function authorization(
  drift: Partial<LinuxRetainedNativeSupervisorListenerAuthorization> = {},
): LinuxRetainedNativeSupervisorListenerAuthorization {
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
    listenBacklog: 1,
    runtimeConnection: 'NOT_CONFIGURED',
    ...drift,
  };
}

function sessionAuthorization(): RetainedNativeSupervisorLocalIpcAuthorization {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    socketPath,
    socketDevice: listenerIdentity.device,
    socketInode: listenerIdentity.inode,
    socketOwnerUid: listenerIdentity.ownerUid,
    socketOwnerGid: listenerIdentity.ownerGid,
    socketMode: listenerIdentity.mode,
    expectedPeerPid: workerCredentials.pid,
    expectedPeerUid: workerCredentials.uid,
    expectedPeerGid: workerCredentials.gid,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

class FixtureAcceptedSession implements LinuxRetainedNativeSupervisorAcceptedSession {
  readonly peerCredentials = vi.fn(async (_signal: AbortSignal) => workerCredentials);
  readonly readToEof = vi.fn(async (_maximumBytes: number, _signal: AbortSignal) =>
    Buffer.from(requestFrame),
  );
  readonly writeAndShutdown = vi.fn(
    async (_frame: Readonly<Uint8Array>, _signal: AbortSignal) => undefined,
  );
  readonly close = vi.fn(async () => undefined);
}

class FixtureOwnedListener implements LinuxRetainedNativeSupervisorOwnedListener {
  readonly platform = 'LINUX' as const;
  readonly calls: string[] = [];
  readonly accepted = new FixtureAcceptedSession();
  readonly creationEvidence = vi.fn(async (): Promise<unknown> => {
    this.calls.push('creation-evidence');
    return {
      schemaVersion: 1,
      pathStateBefore: 'ABSENT',
      bindDisposition: 'CREATED_WITHOUT_REPLACEMENT',
      parentIdentity,
      listenerIdentity,
    };
  });
  readonly lstatUnixSocket = vi.fn(async (): Promise<unknown> => {
    this.calls.push('lstat');
    return listenerIdentity;
  });
  readonly acceptAuthorizedUnixSocket = vi.fn(async (): Promise<unknown> => {
    this.calls.push('accept');
    return this.accepted;
  });
  readonly closeAndUnlinkOwned = vi.fn((): unknown => {
    this.calls.push('cleanup');
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
    ): Promise<unknown> => this.listener,
  );
}

function fixture(auth: unknown = authorization()) {
  const binding = new FixtureBinding();
  const peer: RetainedNativeSupervisorRecoveryTransport = {
    exchange: vi.fn(async () => response),
  };
  const handler = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler(
    peer,
    sessionAuthorization(),
  );
  return {
    binding,
    handler,
    peer,
    lifecycle: new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(binding, auth),
  };
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

describe('bounded Linux retained-native supervisor listener lifecycle', () => {
  it('owns one no-replacement listener, one session, and exact cleanup', async () => {
    const { binding, handler, lifecycle, peer } = fixture();
    binding.listener.accepted.peerCredentials.mockImplementation(async () => {
      binding.listener.calls.push('peer');
      return workerCredentials;
    });
    binding.listener.accepted.readToEof.mockImplementation(async () => {
      binding.listener.calls.push('read-eof');
      return Buffer.from(requestFrame);
    });
    binding.listener.accepted.writeAndShutdown.mockImplementation(async (candidate) => {
      expect(Buffer.from(candidate)).toEqual(responseFrame);
      binding.listener.calls.push('write-shutdown');
    });
    binding.listener.accepted.close.mockImplementation(async () => {
      binding.listener.calls.push('session-close');
    });

    await expect(lifecycle.runOne(handler, new AbortController().signal)).resolves.toBeUndefined();

    expect(binding.createOwnedListener).toHaveBeenCalledOnce();
    const creationRequest = binding.createOwnedListener.mock.calls[0]?.[0];
    expect(creationRequest).toEqual({
      schemaVersion: 1,
      platform: 'LINUX',
      socketPath,
      socketMode: 0o600,
      listenBacklog: 1,
      pathDisposition: 'FAIL_IF_PRESENT',
    });
    expect(Object.isFrozen(creationRequest)).toBe(true);
    expect(binding.listener.calls).toEqual([
      'creation-evidence',
      'lstat',
      'lstat',
      'accept',
      'peer',
      'lstat',
      'read-eof',
      'lstat',
      'write-shutdown',
      'session-close',
      'cleanup',
    ]);
    expect(binding.listener.closeAndUnlinkOwned.mock.results[0]?.value).not.toBeInstanceOf(Promise);
    expect(peer.exchange).toHaveBeenCalledOnce();
  });

  it('rejects deny and non-Linux bindings', () => {
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(
          new DenyLinuxRetainedNativeSupervisorListenerLifecycleBinding(),
          authorization(),
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(
          { ...new FixtureBinding(), platform: 'WINDOWS' } as never,
          authorization(),
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
  });

  it.each([
    ['relative path', { socketPath: 'run/ventureos/supervisor.sock' }],
    ['parent traversal', { socketPath: '/run/../tmp/supervisor.sock' }],
    ['unsafe parent mode', { parentMode: 0o750 }],
    ['unsafe socket mode', { socketMode: 0o640 }],
    ['unbounded backlog', { listenBacklog: 2 }],
    ['zero parent inode', { parentInode: 0 }],
    ['negative socket owner', { socketOwnerUid: -1 }],
    ['runtime promotion', { runtimeConnection: 'CONNECTED' }],
  ])('denies invalid lifecycle authorization: %s', (_label, drift) => {
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(
          new FixtureBinding(),
          authorization(drift as never),
        ),
    ).toThrow(expectCode('INVALID_AUTHORIZATION'));
  });

  it.each([
    ['pre-existing path', { pathStateBefore: 'PRESENT' }],
    ['replacement bind', { bindDisposition: 'REPLACED' }],
    ['parent drift', { parentIdentity: { ...parentIdentity, inode: 8001 } }],
    ['listener owner drift', { listenerIdentity: { ...listenerIdentity, ownerUid: 999 } }],
  ])('denies invalid creation evidence and still cleans up: %s', async (_label, drift) => {
    const { binding, handler, lifecycle, peer } = fixture();
    binding.listener.creationEvidence.mockResolvedValue({
      schemaVersion: 1,
      pathStateBefore: 'ABSENT',
      bindDisposition: 'CREATED_WITHOUT_REPLACEMENT',
      parentIdentity,
      listenerIdentity,
      ...drift,
    });
    await expect(lifecycle.runOne(handler, new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(peer.exchange).not.toHaveBeenCalled();
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it('denies post-creation identity substitution before accept and cleans up', async () => {
    const { binding, handler, lifecycle, peer } = fixture();
    binding.listener.lstatUnixSocket.mockResolvedValue({
      ...listenerIdentity,
      inode: listenerIdentity.inode + 1,
    });
    await expect(lifecycle.runOne(handler, new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(binding.listener.acceptAuthorizedUnixSocket).not.toHaveBeenCalled();
    expect(peer.exchange).not.toHaveBeenCalled();
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it('denies session failure and still performs listener cleanup', async () => {
    const { binding, handler, lifecycle } = fixture();
    binding.listener.accepted.readToEof.mockRejectedValue(new Error('private read detail'));
    await expect(lifecycle.runOne(handler, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(binding.listener.accepted.close).toHaveBeenCalledOnce();
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it.each([
    ['substitution preserved', { disposition: 'SUBSTITUTION_PRESERVED' }],
    ['listener not closed', { listenerClosed: false }],
    ['wrong owned inode', { expectedInode: listenerIdentity.inode + 1 }],
  ])('denies invalid cleanup evidence: %s', async (_label, drift) => {
    const { binding, handler, lifecycle } = fixture();
    binding.listener.closeAndUnlinkOwned.mockReturnValue({
      schemaVersion: 1,
      listenerClosed: true,
      disposition: 'OWNED_SOCKET_REMOVED',
      expectedDevice: listenerIdentity.device,
      expectedInode: listenerIdentity.inode,
      ...drift,
    });
    await expect(lifecycle.runOne(handler, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
  });

  it('denies native cleanup failure without exposing its detail', async () => {
    const { binding, handler, lifecycle } = fixture();
    binding.listener.closeAndUnlinkOwned.mockImplementation(() => {
      throw new Error('private cleanup detail');
    });
    await expect(lifecycle.runOne(handler, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
  });

  it('cancels after creation and still performs identity-owned cleanup', async () => {
    const { binding, handler, lifecycle } = fixture();
    const controller = new AbortController();
    binding.listener.creationEvidence.mockImplementation(async () => {
      controller.abort();
      return {
        schemaVersion: 1,
        pathStateBefore: 'ABSENT',
        bindDisposition: 'CREATED_WITHOUT_REPLACEMENT',
        parentIdentity,
        listenerIdentity,
      };
    });
    await expect(lifecycle.runOne(handler, controller.signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it('cannot retry or concurrently create through one consumed lifecycle', async () => {
    const { binding, handler, lifecycle } = fixture();
    let release!: () => void;
    binding.createOwnedListener.mockImplementationOnce(
      async () =>
        new Promise<FixtureOwnedListener>((resolve) => {
          release = () => resolve(binding.listener);
        }),
    );
    const first = lifecycle.runOne(handler, new AbortController().signal);
    await expect(lifecycle.runOne(handler, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    release();
    await expect(first).resolves.toBeUndefined();
    await expect(lifecycle.runOne(handler, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(binding.createOwnedListener).toHaveBeenCalledOnce();
  });
});
