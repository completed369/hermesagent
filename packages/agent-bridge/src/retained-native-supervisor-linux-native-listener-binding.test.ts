import { describe, expect, it, vi } from 'vitest';

import { MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES } from './retained-native-supervisor-local-ipc';
import type {
  LinuxRetainedNativeSupervisorListenerCreationRequest,
  LinuxRetainedNativeSupervisorOwnedListener,
} from './retained-native-supervisor-listener-lifecycle';
import {
  BoundedLinuxRetainedNativeSupervisorNativeListenerBinding,
  DenyLinuxRetainedNativeSupervisorListenerNativeModule,
} from './retained-native-supervisor-linux-native-listener-binding';
import type { LinuxRetainedNativeSupervisorAcceptedSession } from './retained-native-supervisor-linux-session';

const socketPath = '/run/ventureos/retained-native-supervisor.sock';
const createRequest: Readonly<LinuxRetainedNativeSupervisorListenerCreationRequest> = Object.freeze(
  {
    schemaVersion: 1,
    platform: 'LINUX',
    socketPath,
    socketMode: 0o600,
    listenBacklog: 1,
    pathDisposition: 'FAIL_IF_PRESENT',
  },
);
const listenerIdentity = Object.freeze({
  fileType: 'SOCKET',
  device: 41,
  inode: 9001,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o600,
});

function nativeFixture() {
  const calls: string[] = [];
  const accepted = {
    peerCredentials: vi.fn(async () => {
      calls.push('peer');
      return { pid: 811, uid: 710, gid: 711 };
    }),
    readToEof: vi.fn(async () => {
      calls.push('read');
      return Buffer.from('{}\n');
    }),
    writeAndShutdown: vi.fn(async (frame: Readonly<Uint8Array>) => {
      expect(Buffer.from(frame)).toEqual(Buffer.from('{}\n'));
      calls.push('write');
    }),
    close: vi.fn(async () => {
      calls.push('session-close');
    }),
  };
  const listener = {
    creationEvidence: vi.fn(async () => {
      calls.push('creation');
      return {
        schemaVersion: 1,
        pathStateBefore: 'ABSENT',
        bindDisposition: 'CREATED_WITHOUT_REPLACEMENT',
        parentIdentity: {
          fileType: 'DIRECTORY',
          device: 40,
          inode: 8000,
          ownerUid: 700,
          ownerGid: 701,
          mode: 0o700,
        },
        listenerIdentity,
      };
    }),
    lstatUnixSocket: vi.fn(async () => {
      calls.push('lstat');
      return listenerIdentity;
    }),
    acceptAuthorizedUnixSocket: vi.fn(async () => {
      calls.push('accept');
      return accepted;
    }),
    closeAndUnlinkOwned: vi.fn(() => {
      calls.push('cleanup');
      return {
        schemaVersion: 1,
        listenerClosed: true,
        disposition: 'OWNED_SOCKET_REMOVED',
        expectedDevice: listenerIdentity.device,
        expectedInode: listenerIdentity.inode,
      };
    }),
  };
  const native = {
    abiVersion: 1 as const,
    platform: 'LINUX' as const,
    createOwnedListener: vi.fn(
      async (
        _request: Readonly<LinuxRetainedNativeSupervisorListenerCreationRequest>,
        _signal: AbortSignal,
      ) => {
        calls.push('create');
        return listener;
      },
    ),
  };
  return { accepted, calls, listener, native };
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

describe('bounded Linux retained-native supervisor native listener binding', () => {
  it('clones one exact request and exposes one ordered bounded native lifecycle', async () => {
    const fixture = nativeFixture();
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(fixture.native);
    const signal = new AbortController().signal;
    const listener = (await binding.createOwnedListener(
      createRequest,
      signal,
    )) as LinuxRetainedNativeSupervisorOwnedListener;

    const forwarded = fixture.native.createOwnedListener.mock.calls[0]?.[0];
    expect(forwarded).toEqual(createRequest);
    expect(forwarded).not.toBe(createRequest);
    expect(Object.isFrozen(forwarded)).toBe(true);

    await expect(listener.creationEvidence(signal)).resolves.toMatchObject({
      bindDisposition: 'CREATED_WITHOUT_REPLACEMENT',
    });
    await expect(listener.lstatUnixSocket(socketPath, signal)).resolves.toEqual(listenerIdentity);
    const session = (await listener.acceptAuthorizedUnixSocket(
      socketPath,
      signal,
    )) as LinuxRetainedNativeSupervisorAcceptedSession;
    await expect(session.peerCredentials(signal)).resolves.toEqual({
      pid: 811,
      uid: 710,
      gid: 711,
    });
    await expect(
      session.readToEof(MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES, signal),
    ).resolves.toEqual(Buffer.from('{}\n'));
    await expect(session.writeAndShutdown(Buffer.from('{}\n'), signal)).resolves.toBeUndefined();
    await expect(session.close()).resolves.toBeUndefined();
    expect(listener.closeAndUnlinkOwned()).toMatchObject({ disposition: 'OWNED_SOCKET_REMOVED' });
    expect(fixture.calls).toEqual([
      'create',
      'creation',
      'lstat',
      'accept',
      'peer',
      'read',
      'write',
      'session-close',
      'cleanup',
    ]);
  });

  it.each([
    ['deny module', new DenyLinuxRetainedNativeSupervisorListenerNativeModule()],
    ['wrong ABI', { ...nativeFixture().native, abiVersion: 2 }],
    ['wrong platform', { ...nativeFixture().native, platform: 'WINDOWS' }],
    ['extra export', { ...nativeFixture().native, loadFromPath: vi.fn() }],
  ])('denies an untrusted native module shape: %s', (_label, native) => {
    expect(() => new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(native)).toThrow(
      expectCode('NOT_CONFIGURED'),
    );
  });

  it('denies accessor-based native exports without invoking them', () => {
    const create = vi.fn();
    const native = {
      abiVersion: 1,
      platform: 'LINUX',
      get createOwnedListener() {
        create();
        return vi.fn();
      },
    };
    expect(() => new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(native)).toThrow(
      expectCode('NOT_CONFIGURED'),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('redacts module shape-inspection trap details', () => {
    const native = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private proxy trap detail');
        },
      },
    );
    expect(() => new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(native)).toThrow(
      expectCode('NOT_CONFIGURED'),
    );
  });

  it.each([
    ['relative path', { socketPath: 'run/ventureos/supervisor.sock' }],
    ['replacement disposition', { pathDisposition: 'REPLACE' }],
    ['permissive mode', { socketMode: 0o660 }],
    ['larger backlog', { listenBacklog: 2 }],
    ['extra field', { authority: 'caller' }],
  ])('denies an invalid native creation request before effects: %s', async (_label, drift) => {
    const fixture = nativeFixture();
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(fixture.native);
    await expect(
      binding.createOwnedListener(
        { ...createRequest, ...drift } as never,
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(fixture.native.createOwnedListener).not.toHaveBeenCalled();
  });

  it('consumes the factory on its first attempt and denies an aborted attempt before effects', async () => {
    const abortedFixture = nativeFixture();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(
        abortedFixture.native,
      ).createOwnedListener(createRequest, aborted.signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(abortedFixture.native.createOwnedListener).not.toHaveBeenCalled();

    const fixture = nativeFixture();
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(fixture.native);
    await expect(
      binding.createOwnedListener(createRequest, new AbortController().signal),
    ).resolves.toBeDefined();
    await expect(
      binding.createOwnedListener(createRequest, new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(fixture.native.createOwnedListener).toHaveBeenCalledOnce();
  });

  it('synchronously cleans an allocated listener when cancellation wins native creation', async () => {
    const fixture = nativeFixture();
    const controller = new AbortController();
    fixture.native.createOwnedListener.mockImplementation(async () => {
      fixture.calls.push('create');
      controller.abort();
      return fixture.listener;
    });
    await expect(
      new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(
        fixture.native,
      ).createOwnedListener(createRequest, controller.signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(fixture.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
    expect(fixture.calls).toEqual(['create', 'cleanup']);
  });

  it('cleans a malformed allocated listener without invoking accessors', async () => {
    const fixture = nativeFixture();
    const creationAccessor = vi.fn();
    const cleanup = vi.fn(() => ({ disposition: 'OWNED_SOCKET_REMOVED' }));
    fixture.native.createOwnedListener.mockResolvedValueOnce({
      get creationEvidence() {
        creationAccessor();
        return vi.fn();
      },
      lstatUnixSocket: vi.fn(),
      acceptAuthorizedUnixSocket: vi.fn(),
      closeAndUnlinkOwned: cleanup,
    });
    await expect(
      new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(
        fixture.native,
      ).createOwnedListener(createRequest, new AbortController().signal),
    ).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(creationAccessor).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('does not let malformed asynchronous listener cleanup stall denial', async () => {
    const fixture = nativeFixture();
    const cleanup = vi.fn(() => new Promise<never>(() => undefined));
    fixture.native.createOwnedListener.mockResolvedValueOnce({
      creationEvidence: vi.fn(),
      lstatUnixSocket: vi.fn(),
      closeAndUnlinkOwned: cleanup,
    } as never);
    await expect(
      new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(
        fixture.native,
      ).createOwnedListener(createRequest, new AbortController().signal),
    ).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('denies out-of-order or repeated handle operations', async () => {
    const fixture = nativeFixture();
    const signal = new AbortController().signal;
    const listener = (await new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(
      fixture.native,
    ).createOwnedListener(createRequest, signal)) as LinuxRetainedNativeSupervisorOwnedListener;
    await expect(listener.lstatUnixSocket(socketPath, signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    await listener.creationEvidence(signal);
    await expect(listener.creationEvidence(signal)).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    const session = (await listener.acceptAuthorizedUnixSocket(
      socketPath,
      signal,
    )) as LinuxRetainedNativeSupervisorAcceptedSession;
    await expect(
      session.readToEof(MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES, signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    await session.close();
    await expect(session.close()).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    listener.closeAndUnlinkOwned();
    expect(() => listener.closeAndUnlinkOwned()).toThrow(expectCode('EXCHANGE_DENIED'));
  });

  it('pins stat and accept authority to the exact created socket path', async () => {
    const fixture = nativeFixture();
    const signal = new AbortController().signal;
    const listener = (await new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(
      fixture.native,
    ).createOwnedListener(createRequest, signal)) as LinuxRetainedNativeSupervisorOwnedListener;
    await listener.creationEvidence(signal);
    await expect(listener.lstatUnixSocket('/run/ventureos/other.sock', signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    await expect(
      listener.acceptAuthorizedUnixSocket('/run/ventureos/other.sock', signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(fixture.listener.lstatUnixSocket).not.toHaveBeenCalled();
    expect(fixture.listener.acceptAuthorizedUnixSocket).not.toHaveBeenCalled();
    listener.closeAndUnlinkOwned();
  });

  it('captures validated native methods so later property drift cannot change authority', async () => {
    const fixture = nativeFixture();
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(fixture.native);
    fixture.native.createOwnedListener = vi.fn(async () => {
      throw new Error('drifted module method');
    });
    const signal = new AbortController().signal;
    const listener = (await binding.createOwnedListener(
      createRequest,
      signal,
    )) as LinuxRetainedNativeSupervisorOwnedListener;
    fixture.listener.creationEvidence = vi.fn(async () => {
      throw new Error('drifted listener method');
    });
    await expect(listener.creationEvidence(signal)).resolves.toMatchObject({ schemaVersion: 1 });
    const session = (await listener.acceptAuthorizedUnixSocket(
      socketPath,
      signal,
    )) as LinuxRetainedNativeSupervisorAcceptedSession;
    fixture.accepted.peerCredentials = vi.fn(async () => {
      throw new Error('drifted session method');
    });
    await expect(session.peerCredentials(signal)).resolves.toEqual({
      pid: 811,
      uid: 710,
      gid: 711,
    });
    await session.close();
    listener.closeAndUnlinkOwned();
  });

  it('requires synchronous native cleanup and redacts native failure details', async () => {
    const fixture = nativeFixture();
    fixture.listener.closeAndUnlinkOwned.mockImplementation(() => Promise.resolve({}) as never);
    const listener = (await new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(
      fixture.native,
    ).createOwnedListener(
      createRequest,
      new AbortController().signal,
    )) as LinuxRetainedNativeSupervisorOwnedListener;
    expect(() => listener.closeAndUnlinkOwned()).toThrow(expectCode('EXCHANGE_DENIED'));

    const failed = nativeFixture();
    failed.native.createOwnedListener.mockRejectedValue(new Error('private native path detail'));
    await expect(
      new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(
        failed.native,
      ).createOwnedListener(createRequest, new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
  });
});
