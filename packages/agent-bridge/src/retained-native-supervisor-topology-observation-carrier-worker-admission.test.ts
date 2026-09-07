import { describe, expect, it, vi } from 'vitest';

import type { RetainedNativeSupervisorLocalIpcAuthorization } from './retained-native-supervisor-local-ipc';
import {
  DenyLinuxRetainedNativeSupervisorSessionBinding,
  type LinuxRetainedNativeSupervisorAcceptedSession,
  type LinuxRetainedNativeSupervisorListenerSocketStat,
  type LinuxRetainedNativeSupervisorSessionBinding,
  type LinuxRetainedNativeSupervisorWorkerCredentials,
} from './retained-native-supervisor-linux-session';
import { BoundedAuthenticatedLinuxRetainedNativeSupervisorTopologyObservationCarrierWorkerAdmission } from './retained-native-supervisor-topology-observation-carrier-worker-admission';

const socketPath = '/run/ventureos/topology-carrier-worker.sock';
const stat: Readonly<LinuxRetainedNativeSupervisorListenerSocketStat> = Object.freeze({
  fileType: 'SOCKET' as const,
  device: 41,
  inode: 9_001,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o600,
});
const credentials: Readonly<LinuxRetainedNativeSupervisorWorkerCredentials> = Object.freeze({
  pid: 811,
  uid: 710,
  gid: 711,
});

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
  readonly peerCredentials = vi.fn(async (): Promise<unknown> => credentials);
  readonly readToEof = vi.fn(async (): Promise<unknown> => new Uint8Array([123, 125]));
  readonly writeAndShutdown = vi.fn(async (): Promise<void> => undefined);
  readonly close = vi.fn(async (): Promise<void> => undefined);
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

function fixture(timeoutMs = 5_000) {
  const binding = new FixtureBinding();
  return {
    binding,
    admission:
      new BoundedAuthenticatedLinuxRetainedNativeSupervisorTopologyObservationCarrierWorkerAdmission(
        binding,
        authorization(),
        timeoutMs,
      ),
  };
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

describe('authenticated Linux topology carrier worker admission', () => {
  it('authenticates exact retained listener and peer evidence before transferring once', async () => {
    const { admission, binding } = fixture();
    binding.accepted.peerCredentials.mockImplementation(async () => {
      binding.calls.push('peer');
      return credentials;
    });

    const accepted = await admission.acceptOne(new AbortController().signal);

    expect(binding.calls).toEqual(['lstat', 'accept', 'peer', 'lstat']);
    expect(binding.accepted.readToEof).not.toHaveBeenCalled();
    expect(binding.accepted.writeAndShutdown).not.toHaveBeenCalled();
    expect(binding.accepted.close).not.toHaveBeenCalled();
    await accepted.close();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
    await expect(admission.acceptOne(new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
  });

  it('validates timeout and authorization before touching hostile binding accessors', () => {
    const platform = vi.fn(() => 'LINUX');
    const binding = Object.defineProperty({}, 'platform', { get: platform }) as never;
    expect(
      () =>
        new BoundedAuthenticatedLinuxRetainedNativeSupervisorTopologyObservationCarrierWorkerAdmission(
          binding,
          authorization(),
          99,
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
    expect(platform).not.toHaveBeenCalled();

    expect(
      () =>
        new BoundedAuthenticatedLinuxRetainedNativeSupervisorTopologyObservationCarrierWorkerAdmission(
          binding,
          { ...authorization(), runtimeConnection: 'CONNECTED' },
        ),
    ).toThrow(expectCode('INVALID_AUTHORIZATION'));
    expect(platform).not.toHaveBeenCalled();
  });

  it('rejects explicit deny and non-Linux bindings', () => {
    expect(
      () =>
        new BoundedAuthenticatedLinuxRetainedNativeSupervisorTopologyObservationCarrierWorkerAdmission(
          new DenyLinuxRetainedNativeSupervisorSessionBinding(),
          authorization(),
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
    expect(
      () =>
        new BoundedAuthenticatedLinuxRetainedNativeSupervisorTopologyObservationCarrierWorkerAdmission(
          { ...new FixtureBinding(), platform: 'WINDOWS' } as never,
          authorization(),
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
  });

  it('captures each accepted-session method exactly once before peer authentication', async () => {
    const { admission, binding } = fixture();
    const reads = {
      peerCredentials: 0,
      readToEof: 0,
      writeAndShutdown: 0,
      close: 0,
    };
    const session = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(reads) as Array<keyof typeof reads>) {
      Object.defineProperty(session, key, {
        configurable: true,
        get: () => {
          reads[key] += 1;
          if (reads[key] > 1) throw new Error(`substituted ${key}`);
          if (key === 'peerCredentials') return async () => credentials;
          if (key === 'readToEof') return async () => new Uint8Array([123, 125]);
          return async () => undefined;
        },
      });
    }
    binding.acceptAuthorizedUnixSocket.mockResolvedValue(session);
    const accepted = await admission.acceptOne(new AbortController().signal);
    expect(reads).toEqual({ peerCredentials: 1, readToEof: 1, writeAndShutdown: 1, close: 1 });
    await accepted.close();
    expect(reads).toEqual({ peerCredentials: 1, readToEof: 1, writeAndShutdown: 1, close: 1 });
  });

  it('captures close first and cleans up when a later session accessor throws', async () => {
    const { admission, binding } = fixture();
    const close = vi.fn(async (): Promise<void> => undefined);
    const session = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(session, 'close', { get: () => close });
    Object.defineProperty(session, 'peerCredentials', {
      get: () => {
        throw new Error('private peer accessor detail');
      },
    });
    binding.acceptAuthorizedUnixSocket.mockResolvedValue(session);

    await expect(admission.acceptOne(new AbortController().signal)).rejects.toEqual(
      expectCode('NOT_CONFIGURED'),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(binding.accepted.readToEof).not.toHaveBeenCalled();
  });

  it('redacts hostile authorization accessors before native binding access', () => {
    const binding = new FixtureBinding();
    const candidate = { ...authorization() } as Record<string, unknown>;
    Object.defineProperty(candidate, 'socketPath', {
      enumerable: true,
      get: () => {
        throw new Error('private authorization getter');
      },
    });
    expect(
      () =>
        new BoundedAuthenticatedLinuxRetainedNativeSupervisorTopologyObservationCarrierWorkerAdmission(
          binding,
          candidate,
        ),
    ).toThrow(expectCode('INVALID_AUTHORIZATION'));
    expect(binding.lstatUnixSocket).not.toHaveBeenCalled();
  });

  it.each([
    ['device drift', { device: stat.device + 1 }],
    ['inode drift', { inode: stat.inode + 1 }],
    ['owner drift', { ownerUid: stat.ownerUid + 1 }],
    ['unsafe mode', { mode: 0o640 }],
    ['wrong type', { fileType: 'REGULAR' }],
    ['extra key', { extra: true }],
  ])('denies pre-accept listener attestation mismatch: %s', async (_label, drift) => {
    const { admission, binding } = fixture();
    binding.lstatUnixSocket.mockResolvedValue({ ...stat, ...drift });
    await expect(admission.acceptOne(new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(binding.acceptAuthorizedUnixSocket).not.toHaveBeenCalled();
  });

  it.each([
    ['pid drift', { pid: credentials.pid + 1 }],
    ['uid drift', { uid: credentials.uid + 1 }],
    ['gid drift', { gid: credentials.gid + 1 }],
    ['extra key', { extra: true }],
  ])('denies peer-credential mismatch and closes: %s', async (_label, drift) => {
    const { admission, binding } = fixture();
    binding.accepted.peerCredentials.mockResolvedValue({ ...credentials, ...drift });
    await expect(admission.acceptOne(new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(binding.lstatUnixSocket).toHaveBeenCalledOnce();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
  });

  it('denies listener replacement after accept and closes before transfer', async () => {
    const { admission, binding } = fixture();
    binding.lstatUnixSocket
      .mockResolvedValueOnce(stat)
      .mockResolvedValueOnce({ ...stat, inode: stat.inode + 1 });
    await expect(admission.acceptOne(new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(binding.accepted.readToEof).not.toHaveBeenCalled();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
  });

  it('denies cancellation after accept and closes', async () => {
    const { admission, binding } = fixture();
    const controller = new AbortController();
    binding.accepted.peerCredentials.mockImplementation(async () => {
      controller.abort();
      return credentials;
    });
    await expect(admission.acceptOne(controller.signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(binding.accepted.close).toHaveBeenCalledOnce();
  });

  it('redacts native failures and bounds failed-session cleanup', async () => {
    vi.useFakeTimers();
    try {
      const { admission, binding } = fixture(100);
      binding.accepted.peerCredentials.mockRejectedValue(new Error('private native detail'));
      binding.accepted.close.mockImplementation(async () => new Promise<void>(() => undefined));
      const result = admission.acceptOne(new AbortController().signal);
      const rejection = expect(result).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(binding.accepted.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('denies concurrent and repeated accept attempts', async () => {
    const { admission, binding } = fixture();
    let release!: () => void;
    binding.lstatUnixSocket.mockImplementationOnce(
      async () => new Promise<typeof stat>((resolve) => (release = () => resolve(stat))),
    );
    const first = admission.acceptOne(new AbortController().signal);
    await expect(admission.acceptOne(new AbortController().signal)).rejects.toEqual(
      expectCode('CONCURRENT_EXCHANGE'),
    );
    release();
    const accepted = await first;
    await expect(admission.acceptOne(new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    await accepted.close();
    expect(binding.acceptAuthorizedUnixSocket).toHaveBeenCalledOnce();
  });
});
