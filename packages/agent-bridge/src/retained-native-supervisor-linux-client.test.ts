import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  BoundedLinuxRetainedNativeSupervisorLocalIpcClient,
  DenyLinuxRetainedNativeSupervisorBinding,
  type LinuxRetainedNativeSupervisorBinding,
  type LinuxRetainedNativeSupervisorConnection,
  type LinuxRetainedNativeSupervisorPeerCredentials,
  type LinuxRetainedNativeSupervisorSocketStat,
} from './retained-native-supervisor-linux-client';
import { MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES } from './retained-native-supervisor-local-ipc';

const socketPath = '/run/ventureos/retained-native-supervisor.sock';
const stat: Readonly<LinuxRetainedNativeSupervisorSocketStat> = Object.freeze({
  fileType: 'SOCKET',
  device: 41,
  inode: 9001,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o600,
});
const credentials: Readonly<LinuxRetainedNativeSupervisorPeerCredentials> = Object.freeze({
  pid: 810,
  uid: 700,
  gid: 701,
});
const requestFrame = Buffer.from(`${canonicalJson({ direction: 'request' })}\n`);
const responseFrame = Buffer.from(`${canonicalJson({ direction: 'response' })}\n`);

class FixtureConnection implements LinuxRetainedNativeSupervisorConnection {
  readonly peerCredentials = vi.fn(async (_signal: AbortSignal): Promise<unknown> => credentials);
  readonly writeAndShutdown = vi.fn(
    async (_frame: Readonly<Uint8Array>, _signal: AbortSignal): Promise<void> => undefined,
  );
  readonly readToEof = vi.fn(
    async (_maximumBytes: number, _signal: AbortSignal): Promise<unknown> => responseFrame,
  );
  readonly close = vi.fn(async () => undefined);
}

class FixtureBinding implements LinuxRetainedNativeSupervisorBinding {
  readonly platform = 'LINUX' as const;
  readonly calls: string[] = [];
  readonly connection = new FixtureConnection();
  readonly lstatUnixSocket = vi.fn(async (): Promise<unknown> => {
    this.calls.push('lstat');
    return stat;
  });
  readonly connectUnixSocket = vi.fn(async (): Promise<unknown> => {
    this.calls.push('connect');
    return this.connection;
  });
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

describe('bounded Linux retained-native supervisor local IPC client', () => {
  it('owns one lstat-connect-peer-write/read-to-EOF-lstat-close sequence', async () => {
    const binding = new FixtureBinding();
    binding.connection.peerCredentials.mockImplementation(async () => {
      binding.calls.push('peer');
      return credentials;
    });
    binding.connection.writeAndShutdown.mockImplementation(async (frame, signal) => {
      expect(signal.aborted).toBe(false);
      expect(Buffer.from(frame)).toEqual(requestFrame);
      binding.calls.push('write-shutdown');
    });
    binding.connection.readToEof.mockImplementation(async (limit) => {
      expect(limit).toBe(MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES);
      binding.calls.push('read-eof');
      return responseFrame;
    });
    binding.connection.close.mockImplementation(async () => {
      binding.calls.push('close');
    });

    const result = (await new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding).exchange(
      socketPath,
      requestFrame,
      new AbortController().signal,
    )) as Record<string, unknown>;

    expect(binding.calls).toEqual([
      'lstat',
      'connect',
      'peer',
      'write-shutdown',
      'read-eof',
      'lstat',
      'close',
    ]);
    expect(result).toMatchObject({
      endpointBefore: {
        schemaVersion: 1,
        platform: 'LINUX',
        authority: 'LINUX_LSTAT_UNIX_SOCKET',
        fileType: 'SOCKET',
        socketPath,
        socketDevice: 41,
        socketInode: 9001,
        socketOwnerUid: 700,
        socketOwnerGid: 701,
        socketMode: 0o600,
      },
      peerCredentials: {
        schemaVersion: 1,
        platform: 'LINUX',
        authority: 'LINUX_SO_PEERCRED',
        peerPid: 810,
        peerUid: 700,
        peerGid: 701,
      },
      responseFrame,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects explicit deny binding and non-Linux composition', () => {
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(
          new DenyLinuxRetainedNativeSupervisorBinding(),
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorLocalIpcClient({
          ...new FixtureBinding(),
          platform: 'WINDOWS',
        } as never),
    ).toThrow(expectCode('NOT_CONFIGURED'));
  });

  it.each([
    ['regular file', { fileType: 'REGULAR' }],
    ['unsafe mode', { mode: 0o640 }],
    ['zero inode', { inode: 0 }],
    ['negative owner', { ownerUid: -1 }],
    ['unknown key', { extra: true }],
  ])('denies invalid pre-connect lstat evidence: %s', async (_label, drift) => {
    const binding = new FixtureBinding();
    binding.lstatUnixSocket.mockResolvedValue({ ...stat, ...drift });
    await expect(
      new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding).exchange(
        socketPath,
        requestFrame,
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_ATTESTATION'));
    expect(binding.connectUnixSocket).not.toHaveBeenCalled();
  });

  it.each([
    ['zero pid', { pid: 0 }],
    ['negative uid', { uid: -1 }],
    ['unknown key', { extra: true }],
  ])('denies invalid SO_PEERCRED evidence and closes: %s', async (_label, drift) => {
    const binding = new FixtureBinding();
    binding.connection.peerCredentials.mockResolvedValue({ ...credentials, ...drift });
    await expect(
      new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding).exchange(
        socketPath,
        requestFrame,
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_ATTESTATION'));
    expect(binding.connection.writeAndShutdown).not.toHaveBeenCalled();
    expect(binding.connection.close).toHaveBeenCalledOnce();
  });

  it('denies endpoint replacement after response and closes', async () => {
    const binding = new FixtureBinding();
    binding.lstatUnixSocket
      .mockResolvedValueOnce(stat)
      .mockResolvedValueOnce({ ...stat, inode: stat.inode + 1 });
    await expect(
      new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding).exchange(
        socketPath,
        requestFrame,
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_ATTESTATION'));
    expect(binding.connection.close).toHaveBeenCalledOnce();
  });

  it('redacts a native read failure and closes the connection', async () => {
    const binding = new FixtureBinding();
    binding.connection.readToEof.mockRejectedValue(new Error('private native failure'));
    await expect(
      new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding).exchange(
        socketPath,
        requestFrame,
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(binding.connection.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['oversized', Buffer.alloc(MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES + 1)],
    ['non-bytes', 'response'],
  ])('denies invalid EOF-bounded response: %s', async (_label, candidate) => {
    const binding = new FixtureBinding();
    binding.connection.readToEof.mockResolvedValue(candidate);
    await expect(
      new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding).exchange(
        socketPath,
        requestFrame,
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(binding.connection.close).toHaveBeenCalledOnce();
  });

  it('denies an invalid request before native syscalls', async () => {
    const binding = new FixtureBinding();
    await expect(
      new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding).exchange(
        '../supervisor.sock',
        requestFrame,
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(binding.lstatUnixSocket).not.toHaveBeenCalled();
  });

  it('denies parent traversal before native syscalls', async () => {
    const binding = new FixtureBinding();
    await expect(
      new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding).exchange(
        '/run/../tmp/supervisor.sock',
        requestFrame,
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(binding.lstatUnixSocket).not.toHaveBeenCalled();
  });

  it('denies cancellation after connect and still closes', async () => {
    const binding = new FixtureBinding();
    const controller = new AbortController();
    binding.connection.peerCredentials.mockImplementation(async () => {
      controller.abort();
      return credentials;
    });
    await expect(
      new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding).exchange(
        socketPath,
        requestFrame,
        controller.signal,
      ),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(binding.connection.close).toHaveBeenCalledOnce();
  });

  it('actively closes a pending native exchange and permanently denies reuse', async () => {
    const binding = new FixtureBinding();
    let rejectRead: ((error: Error) => void) | undefined;
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    binding.connection.readToEof.mockImplementation(async () => {
      markReadStarted?.();
      return new Promise<never>((_resolve, reject) => {
        rejectRead = reject;
      });
    });
    binding.connection.close.mockImplementation(async () => {
      rejectRead?.(new Error('closed'));
    });
    const client = new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding);
    const pending = client.exchange(socketPath, requestFrame, new AbortController().signal);
    await readStarted;

    await expect(client.close()).resolves.toBeUndefined();
    await expect(pending).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(binding.connection.close).toHaveBeenCalledOnce();
    await expect(
      client.exchange(socketPath, requestFrame, new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
  });

  it('does not connect when explicit close wins a pending lstat race', async () => {
    const binding = new FixtureBinding();
    let resolveStat: ((value: unknown) => void) | undefined;
    let markStatStarted: (() => void) | undefined;
    const statStarted = new Promise<void>((resolve) => {
      markStatStarted = resolve;
    });
    binding.lstatUnixSocket.mockImplementation(async () => {
      markStatStarted?.();
      return new Promise<unknown>((resolve) => {
        resolveStat = resolve;
      });
    });
    const client = new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding);
    const pending = client.exchange(socketPath, requestFrame, new AbortController().signal);
    await statStarted;

    await expect(client.close()).resolves.toBeUndefined();
    resolveStat?.(stat);
    await expect(pending).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(binding.connectUnixSocket).not.toHaveBeenCalled();
  });

  it('treats close failure as exchange failure', async () => {
    const binding = new FixtureBinding();
    binding.connection.close.mockRejectedValue(new Error('private close detail'));
    await expect(
      new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding).exchange(
        socketPath,
        requestFrame,
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
  });

  it('denies a concurrent exchange without crossing the binding twice', async () => {
    const binding = new FixtureBinding();
    let release!: () => void;
    binding.lstatUnixSocket.mockImplementationOnce(
      async () => new Promise<typeof stat>((resolve) => (release = () => resolve(stat))),
    );
    const client = new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding);
    const first = client.exchange(socketPath, requestFrame, new AbortController().signal);
    await expect(
      client.exchange(socketPath, requestFrame, new AbortController().signal),
    ).rejects.toEqual(expectCode('CONCURRENT_EXCHANGE'));
    release();
    await expect(first).resolves.toBeDefined();
    expect(binding.connectUnixSocket).toHaveBeenCalledOnce();
  });
});
