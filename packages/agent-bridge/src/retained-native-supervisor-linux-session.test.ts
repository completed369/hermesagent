import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler,
  MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES,
  type RetainedNativeSupervisorLocalIpcAuthorization,
} from './retained-native-supervisor-local-ipc';
import {
  BoundedLinuxRetainedNativeSupervisorSession,
  DenyLinuxRetainedNativeSupervisorSessionBinding,
  type LinuxRetainedNativeSupervisorAcceptedSession,
  type LinuxRetainedNativeSupervisorListenerSocketStat,
  type LinuxRetainedNativeSupervisorSessionBinding,
  type LinuxRetainedNativeSupervisorWorkerCredentials,
} from './retained-native-supervisor-linux-session';
import type {
  RetainedNativeSupervisorRecoveryRequest,
  RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';

const socketPath = '/run/ventureos/retained-native-supervisor.sock';
const stat: Readonly<LinuxRetainedNativeSupervisorListenerSocketStat> = Object.freeze({
  fileType: 'SOCKET',
  device: 41,
  inode: 9001,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o600,
});
const credentials: Readonly<LinuxRetainedNativeSupervisorWorkerCredentials> = Object.freeze({
  pid: 811,
  uid: 710,
  gid: 711,
});
const request = Object.freeze({
  schemaVersion: 1,
  requestId: 'native-recovery-request-session',
  requestHash: 'a'.repeat(64),
  challengeNonce: 'challenge-session',
  runtimeConnection: 'NOT_CONFIGURED',
}) as unknown as Readonly<RetainedNativeSupervisorRecoveryRequest>;
const response = Object.freeze({
  schemaVersion: 1,
  responseId: 'native-recovery-response-session',
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

function authorization(): RetainedNativeSupervisorLocalIpcAuthorization {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    socketPath,
    socketDevice: stat.device,
    socketInode: stat.inode,
    socketOwnerUid: stat.ownerUid,
    socketOwnerGid: stat.ownerGid,
    socketMode: stat.mode,
    expectedPeerPid: credentials.pid,
    expectedPeerUid: credentials.uid,
    expectedPeerGid: credentials.gid,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

class FixtureAcceptedSession implements LinuxRetainedNativeSupervisorAcceptedSession {
  readonly peerCredentials = vi.fn(async (_signal: AbortSignal): Promise<unknown> => credentials);
  readonly readToEof = vi.fn(
    async (_maximumBytes: number, _signal: AbortSignal): Promise<unknown> =>
      Buffer.from(requestFrame),
  );
  readonly writeAndShutdown = vi.fn(
    async (_frame: Readonly<Uint8Array>, _signal: AbortSignal): Promise<void> => undefined,
  );
  readonly close = vi.fn(async () => undefined);
}

class FixtureBinding implements LinuxRetainedNativeSupervisorSessionBinding {
  readonly platform = 'LINUX' as const;
  readonly calls: string[] = [];
  readonly accepted = new FixtureAcceptedSession();
  readonly lstatUnixSocket = vi.fn(async (): Promise<unknown> => {
    this.calls.push('lstat');
    return stat;
  });
  readonly acceptAuthorizedUnixSocket = vi.fn(async (): Promise<unknown> => {
    this.calls.push('accept');
    return this.accepted;
  });
}

function fixture() {
  const binding = new FixtureBinding();
  const peer: RetainedNativeSupervisorRecoveryTransport = {
    exchange: vi.fn(async () => response),
  };
  const handler = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler(
    peer,
    authorization(),
  );
  return {
    binding,
    handler,
    peer,
    session: new BoundedLinuxRetainedNativeSupervisorSession(binding, handler),
  };
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

describe('bounded Linux retained-native supervisor session', () => {
  it('owns one accept-authenticate-handle-response-close lifecycle', async () => {
    const { binding, peer, session } = fixture();
    binding.accepted.peerCredentials.mockImplementation(async () => {
      binding.calls.push('peer');
      return credentials;
    });
    binding.accepted.readToEof.mockImplementation(async (limit) => {
      expect(limit).toBe(MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES);
      binding.calls.push('read-eof');
      return Buffer.from(requestFrame);
    });
    binding.accepted.writeAndShutdown.mockImplementation(async (candidate, signal) => {
      expect(signal.aborted).toBe(false);
      expect(Buffer.from(candidate)).toEqual(responseFrame);
      binding.calls.push('write-shutdown');
    });
    binding.accepted.close.mockImplementation(async () => {
      binding.calls.push('close');
    });

    await expect(
      session.handleOne(socketPath, new AbortController().signal),
    ).resolves.toBeUndefined();

    expect(binding.calls).toEqual([
      'lstat',
      'accept',
      'peer',
      'lstat',
      'read-eof',
      'lstat',
      'write-shutdown',
      'close',
    ]);
    expect(peer.exchange).toHaveBeenCalledOnce();
    expect(peer.exchange).toHaveBeenCalledWith(request, expect.any(AbortSignal));
  });

  it('rejects the explicit deny binding and non-Linux composition', () => {
    const { handler } = fixture();
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorSession(
          new DenyLinuxRetainedNativeSupervisorSessionBinding(),
          handler,
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorSession(
          { ...new FixtureBinding(), platform: 'WINDOWS' } as never,
          handler,
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
  });

  it.each([
    ['regular file', { fileType: 'REGULAR' }],
    ['unsafe mode', { mode: 0o640 }],
    ['zero inode', { inode: 0 }],
    ['negative owner', { ownerUid: -1 }],
    ['unknown key', { extra: true }],
  ])('denies invalid pre-accept lstat evidence: %s', async (_label, drift) => {
    const { binding, session } = fixture();
    binding.lstatUnixSocket.mockResolvedValue({ ...stat, ...drift });
    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(binding.acceptAuthorizedUnixSocket).not.toHaveBeenCalled();
  });

  it.each([
    ['zero pid', { pid: 0 }],
    ['negative uid', { uid: -1 }],
    ['unknown key', { extra: true }],
  ])('denies invalid worker credentials and closes: %s', async (_label, drift) => {
    const { binding, peer, session } = fixture();
    binding.accepted.peerCredentials.mockResolvedValue({ ...credentials, ...drift });
    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(peer.exchange).not.toHaveBeenCalled();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
  });

  it('denies listener replacement immediately after accept before handler effects', async () => {
    const { binding, peer, session } = fixture();
    binding.lstatUnixSocket
      .mockResolvedValueOnce(stat)
      .mockResolvedValueOnce({ ...stat, inode: stat.inode + 1 });
    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(binding.accepted.readToEof).not.toHaveBeenCalled();
    expect(peer.exchange).not.toHaveBeenCalled();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
  });

  it('denies listener replacement before releasing the response', async () => {
    const { binding, peer, session } = fixture();
    binding.lstatUnixSocket
      .mockResolvedValueOnce(stat)
      .mockResolvedValueOnce(stat)
      .mockResolvedValueOnce({ ...stat, inode: stat.inode + 1 });
    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(peer.exchange).toHaveBeenCalledOnce();
    expect(binding.accepted.writeAndShutdown).not.toHaveBeenCalled();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['oversized', Buffer.alloc(MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES + 1)],
    ['non-bytes', 'request'],
  ])('denies an invalid EOF-bounded request: %s', async (_label, candidate) => {
    const { binding, peer, session } = fixture();
    binding.accepted.readToEof.mockResolvedValue(candidate);
    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(peer.exchange).not.toHaveBeenCalled();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
  });

  it('denies malformed protocol input and closes without a response', async () => {
    const { binding, session } = fixture();
    binding.accepted.readToEof.mockResolvedValue(Buffer.from('{}\n'));
    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_FRAME'),
    );
    expect(binding.accepted.writeAndShutdown).not.toHaveBeenCalled();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
  });

  it('redacts native failures and closes without a response', async () => {
    const { binding, session } = fixture();
    binding.accepted.readToEof.mockRejectedValue(new Error('private native detail'));
    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(binding.accepted.writeAndShutdown).not.toHaveBeenCalled();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
  });

  it('clears native request and handler response buffers after success', async () => {
    const { binding, handler, session } = fixture();
    const nativeRequest = Buffer.from(requestFrame);
    const handlerResponse = Buffer.from(responseFrame);
    binding.accepted.readToEof.mockResolvedValue(nativeRequest);
    vi.spyOn(handler, 'handle').mockResolvedValue(handlerResponse);

    await session.handleOne(socketPath, new AbortController().signal);

    expect(nativeRequest.every((byte) => byte === 0)).toBe(true);
    expect(handlerResponse.every((byte) => byte === 0)).toBe(true);
  });

  it('denies an invalid path before native syscalls', async () => {
    const { binding, session } = fixture();
    await expect(
      session.handleOne('/run/../tmp/supervisor.sock', new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(binding.lstatUnixSocket).not.toHaveBeenCalled();
  });

  it('denies cancellation after accept and still closes', async () => {
    const { binding, session } = fixture();
    const controller = new AbortController();
    binding.accepted.peerCredentials.mockImplementation(async () => {
      controller.abort();
      return credentials;
    });
    await expect(session.handleOne(socketPath, controller.signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(binding.accepted.close).toHaveBeenCalledOnce();
  });

  it('treats close failure as session failure', async () => {
    const { binding, session } = fixture();
    binding.accepted.close.mockRejectedValue(new Error('private close detail'));
    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
  });

  it('denies a concurrent session without accepting twice', async () => {
    const { binding, session } = fixture();
    let release!: () => void;
    binding.lstatUnixSocket.mockImplementationOnce(
      async () => new Promise<typeof stat>((resolve) => (release = () => resolve(stat))),
    );
    const first = session.handleOne(socketPath, new AbortController().signal);
    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('CONCURRENT_EXCHANGE'),
    );
    release();
    await expect(first).resolves.toBeUndefined();
    expect(binding.acceptAuthorizedUnixSocket).toHaveBeenCalledOnce();
  });
});
