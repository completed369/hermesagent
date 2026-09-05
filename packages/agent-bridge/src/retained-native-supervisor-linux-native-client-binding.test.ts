import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  BoundedLinuxRetainedNativeSupervisorNativeClientBinding,
  DenyLinuxRetainedNativeSupervisorClientNativeModule,
} from './retained-native-supervisor-linux-native-client-binding';
import {
  BoundedLinuxRetainedNativeSupervisorLocalIpcClient,
  type LinuxRetainedNativeSupervisorConnection,
} from './retained-native-supervisor-linux-client';
import { MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES } from './retained-native-supervisor-local-ipc';

const socketPath = '/run/ventureos/retained-native-supervisor.sock';
const otherSocketPath = '/run/ventureos/other.sock';
const socketIdentity = Object.freeze({
  fileType: 'SOCKET',
  device: 41,
  inode: 9001,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o600,
});
const credentials = Object.freeze({ pid: 810, uid: 700, gid: 701 });
const requestFrame = Buffer.from(`${canonicalJson({ direction: 'request' })}\n`);
const expectedResponse = Buffer.from(`${canonicalJson({ direction: 'response' })}\n`);

function nativeFixture() {
  const calls: string[] = [];
  const observedRequests: Buffer[] = [];
  const nativeResponse = Buffer.from(expectedResponse);
  const connection = {
    peerCredentials: vi.fn(async () => {
      calls.push('peer');
      return credentials;
    }),
    writeAndShutdown: vi.fn(async (frame: Readonly<Uint8Array>) => {
      calls.push('write');
      observedRequests.push(frame as Buffer);
      expect(Buffer.from(frame)).toEqual(requestFrame);
    }),
    readToEof: vi.fn(async () => {
      calls.push('read');
      return nativeResponse;
    }),
    close: vi.fn(async () => {
      calls.push('close');
    }),
  };
  const native = {
    abiVersion: 1 as const,
    platform: 'LINUX' as const,
    lstatUnixSocket: vi.fn(async () => {
      calls.push('lstat');
      return socketIdentity;
    }),
    connectUnixSocket: vi.fn(async () => {
      calls.push('connect');
      return connection;
    }),
  };
  return { calls, connection, native, nativeResponse, observedRequests };
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

describe('bounded Linux retained-native supervisor native client binding', () => {
  it('owns one exact lstat-connect-peer-write-read-lstat-close sequence', async () => {
    const fixture = nativeFixture();
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(fixture.native);
    const result = (await new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(binding).exchange(
      socketPath,
      requestFrame,
      new AbortController().signal,
    )) as { readonly responseFrame: Buffer };

    expect(result.responseFrame).toEqual(expectedResponse);
    expect(fixture.calls).toEqual(['lstat', 'connect', 'peer', 'write', 'read', 'lstat', 'close']);
    expect(fixture.native.lstatUnixSocket).toHaveBeenNthCalledWith(
      1,
      socketPath,
      expect.any(AbortSignal),
    );
    expect(fixture.native.lstatUnixSocket).toHaveBeenNthCalledWith(
      2,
      socketPath,
      expect.any(AbortSignal),
    );
    expect(fixture.nativeResponse).toEqual(Buffer.alloc(expectedResponse.byteLength));
    expect(fixture.observedRequests[0]).toEqual(Buffer.alloc(requestFrame.byteLength));
  });

  it('clears native response bytes with a captured intrinsic', async () => {
    const fixture = nativeFixture();
    const replacedFill = vi.fn(() => {
      throw new Error('attacker-controlled fill');
    });
    Object.defineProperty(fixture.nativeResponse, 'fill', {
      configurable: true,
      value: replacedFill,
    });
    const result = (await new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(
      new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(fixture.native),
    ).exchange(socketPath, requestFrame, new AbortController().signal)) as {
      readonly responseFrame: Buffer;
    };

    expect(result.responseFrame).toEqual(expectedResponse);
    expect([...fixture.nativeResponse]).toEqual([...Buffer.alloc(expectedResponse.byteLength)]);
    expect(replacedFill).not.toHaveBeenCalled();
  });

  it.each([
    ['deny module', new DenyLinuxRetainedNativeSupervisorClientNativeModule()],
    ['wrong ABI', { ...nativeFixture().native, abiVersion: 2 }],
    ['wrong platform', { ...nativeFixture().native, platform: 'WINDOWS' }],
    ['extra export', { ...nativeFixture().native, loadFromPath: vi.fn() }],
    [
      'missing method',
      {
        abiVersion: 1,
        platform: 'LINUX',
        lstatUnixSocket: vi.fn(),
      },
    ],
  ])('denies an untrusted native module shape: %s', (_label, native) => {
    expect(() => new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(native)).toThrow(
      expectCode('NOT_CONFIGURED'),
    );
  });

  it('denies accessor-based module exports without invoking them', () => {
    const connect = vi.fn();
    const native = {
      abiVersion: 1,
      platform: 'LINUX',
      lstatUnixSocket: vi.fn(),
      get connectUnixSocket() {
        connect();
        return vi.fn();
      },
    };
    expect(() => new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(native)).toThrow(
      expectCode('NOT_CONFIGURED'),
    );
    expect(connect).not.toHaveBeenCalled();
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
    expect(() => new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(native)).toThrow(
      expectCode('NOT_CONFIGURED'),
    );
  });

  it('pins one path and denies out-of-order or repeated binding operations', async () => {
    const fixture = nativeFixture();
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(fixture.native);
    const signal = new AbortController().signal;
    await expect(binding.connectUnixSocket(socketPath, signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    await binding.lstatUnixSocket(socketPath, signal);
    await expect(binding.connectUnixSocket(otherSocketPath, signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    const connection = (await binding.connectUnixSocket(
      socketPath,
      signal,
    )) as LinuxRetainedNativeSupervisorConnection;
    await expect(binding.lstatUnixSocket(socketPath, signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    await connection.peerCredentials(signal);
    await connection.writeAndShutdown(requestFrame, signal);
    await connection.readToEof(MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES, signal);
    await binding.lstatUnixSocket(socketPath, signal);
    await expect(binding.lstatUnixSocket(socketPath, signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    await expect(binding.connectUnixSocket(socketPath, signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    await connection.close();
  });

  it('enforces ordered one-shot connection methods and exact frame bounds', async () => {
    const fixture = nativeFixture();
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(fixture.native);
    const signal = new AbortController().signal;
    await binding.lstatUnixSocket(socketPath, signal);
    const connection = (await binding.connectUnixSocket(
      socketPath,
      signal,
    )) as LinuxRetainedNativeSupervisorConnection;

    await expect(connection.writeAndShutdown(requestFrame, signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    await connection.peerCredentials(signal);
    await expect(
      connection.writeAndShutdown(
        Buffer.alloc(MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES + 1),
        signal,
      ),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    await connection.writeAndShutdown(requestFrame, signal);
    await expect(connection.readToEof(1024, signal)).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    await connection.close();
    await expect(connection.close()).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
  });

  it('captures module and handle methods against later property drift', async () => {
    const fixture = nativeFixture();
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(fixture.native);
    fixture.native.lstatUnixSocket = vi.fn(async () => {
      throw new Error('drifted module method');
    });
    const signal = new AbortController().signal;
    await expect(binding.lstatUnixSocket(socketPath, signal)).resolves.toEqual(socketIdentity);
    const connection = (await binding.connectUnixSocket(
      socketPath,
      signal,
    )) as LinuxRetainedNativeSupervisorConnection;
    fixture.connection.peerCredentials = vi.fn(async () => {
      throw new Error('drifted handle method');
    });
    await expect(connection.peerCredentials(signal)).resolves.toEqual(credentials);
    await connection.close();
  });

  it('closes a malformed allocated connection without invoking accessors', async () => {
    const fixture = nativeFixture();
    const peerAccessor = vi.fn();
    const close = vi.fn(async () => undefined);
    fixture.native.connectUnixSocket.mockResolvedValueOnce({
      get peerCredentials() {
        peerAccessor();
        return vi.fn();
      },
      writeAndShutdown: vi.fn(),
      readToEof: vi.fn(),
      close,
    });
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(fixture.native);
    await binding.lstatUnixSocket(socketPath, new AbortController().signal);
    await expect(
      binding.connectUnixSocket(socketPath, new AbortController().signal),
    ).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(peerAccessor).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not let malformed asynchronous connection cleanup stall denial', async () => {
    const fixture = nativeFixture();
    const close = vi.fn(() => new Promise<never>(() => undefined));
    fixture.native.connectUnixSocket.mockResolvedValueOnce({
      peerCredentials: vi.fn(),
      writeAndShutdown: vi.fn(),
      readToEof: vi.fn(),
      close,
      extraAuthority: true,
    } as never);
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(fixture.native);
    await binding.lstatUnixSocket(socketPath, new AbortController().signal);
    await expect(
      binding.connectUnixSocket(socketPath, new AbortController().signal),
    ).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes an allocated connection when cancellation wins connect', async () => {
    const fixture = nativeFixture();
    const controller = new AbortController();
    fixture.connection.close.mockImplementationOnce(() => new Promise<never>(() => undefined));
    fixture.native.connectUnixSocket.mockImplementationOnce(async () => {
      controller.abort();
      return fixture.connection;
    });
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(fixture.native);
    await binding.lstatUnixSocket(socketPath, controller.signal);
    await expect(binding.connectUnixSocket(socketPath, controller.signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(fixture.connection.close).toHaveBeenCalledOnce();
  });

  it('redacts native failure details and consumes the failed operation', async () => {
    const fixture = nativeFixture();
    fixture.native.lstatUnixSocket.mockRejectedValueOnce(new Error('private native path detail'));
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(fixture.native);
    await expect(binding.lstatUnixSocket(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    await expect(binding.lstatUnixSocket(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
  });
});
