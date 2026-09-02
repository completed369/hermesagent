import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  DenyRetainedNativeSupervisorRecoveryTransport,
  type RetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';
import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler,
  AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport,
  DenyRetainedNativeSupervisorLocalIpcClient,
  MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES,
  RetainedNativeSupervisorLocalIpcError,
  type RetainedNativeSupervisorLocalIpcAuthorization,
  type RetainedNativeSupervisorLocalIpcClient,
} from './retained-native-supervisor-local-ipc';

const endpoint = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_LSTAT_UNIX_SOCKET',
  fileType: 'SOCKET',
  socketPath: '/run/ventureos/retained-native-supervisor.sock',
  socketDevice: 41,
  socketInode: 9001,
  socketOwnerUid: 700,
  socketOwnerGid: 701,
  socketMode: 0o600,
});

const supervisorCredentials = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_SO_PEERCRED',
  peerPid: 810,
  peerUid: 700,
  peerGid: 701,
});

const workerCredentials = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_SO_PEERCRED',
  peerPid: 811,
  peerUid: 710,
  peerGid: 711,
});

function authorization(
  side: 'worker' | 'supervisor',
  drift: Partial<RetainedNativeSupervisorLocalIpcAuthorization> = {},
): RetainedNativeSupervisorLocalIpcAuthorization {
  const credentials = side === 'worker' ? supervisorCredentials : workerCredentials;
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    socketPath: endpoint.socketPath,
    socketDevice: endpoint.socketDevice,
    socketInode: endpoint.socketInode,
    socketOwnerUid: endpoint.socketOwnerUid,
    socketOwnerGid: endpoint.socketOwnerGid,
    socketMode: endpoint.socketMode,
    expectedPeerPid: credentials.peerPid,
    expectedPeerUid: credentials.peerUid,
    expectedPeerGid: credentials.peerGid,
    runtimeConnection: 'NOT_CONFIGURED',
    ...drift,
  };
}

const request = Object.freeze({
  schemaVersion: 1,
  requestId: 'native-recovery-request-ipc',
  requestHash: 'a'.repeat(64),
  challengeNonce: 'challenge-ipc',
  runtimeConnection: 'NOT_CONFIGURED',
}) as unknown as Readonly<RetainedNativeSupervisorRecoveryRequest>;

const response = Object.freeze({
  schemaVersion: 1,
  responseId: 'native-recovery-response-ipc',
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

class FixturePeer implements RetainedNativeSupervisorRecoveryTransport {
  readonly exchange = vi.fn(
    async (_request: Readonly<RetainedNativeSupervisorRecoveryRequest>, _signal: AbortSignal) =>
      response,
  );
}

class LoopbackClient implements RetainedNativeSupervisorLocalIpcClient {
  readonly exchange = vi.fn(
    async (socketPath: string, requestFrame: Readonly<Uint8Array>, signal: AbortSignal) => ({
      endpointBefore: endpoint,
      peerCredentials: supervisorCredentials,
      endpointAfter: endpoint,
      responseFrame: await this.handler.handle(
        { endpointIdentity: endpoint, peerCredentials: workerCredentials, requestFrame },
        signal,
      ),
    }),
  );

  constructor(
    private readonly handler: AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler,
  ) {}
}

function fixture() {
  const peer = new FixturePeer();
  const handler = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler(
    peer,
    authorization('supervisor'),
  );
  const client = new LoopbackClient(handler);
  const transport = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport(
    client,
    authorization('worker'),
  );
  return { client, handler, peer, transport };
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

describe('authenticated retained-native supervisor Linux local IPC contract', () => {
  it('authenticates both OS peers and the socket identity around one canonical exchange', async () => {
    const { client, peer, transport } = fixture();
    const result = await transport.exchange(request, new AbortController().signal);

    expect(result).toEqual(response);
    expect(client.exchange).toHaveBeenCalledOnce();
    expect(client.exchange.mock.calls[0]?.[0]).toBe(endpoint.socketPath);
    expect(peer.exchange).toHaveBeenCalledOnce();
    expect(peer.exchange.mock.calls[0]?.[0]).toEqual(request);
    expect(Object.isFrozen(peer.exchange.mock.calls[0]?.[0])).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect((result as Record<string, unknown>).runtimeConnection).toBe('NOT_CONFIGURED');
  });

  it.each([
    ['relative socket', { socketPath: 'run/ventureos/supervisor.sock' }],
    ['parent traversal', { socketPath: '/run/../tmp/supervisor.sock' }],
    ['non-socket suffix', { socketPath: '/run/ventureos/supervisor' }],
    ['control character', { socketPath: '/run/ventureos/supervisor\n.sock' }],
    ['group-readable socket', { socketMode: 0o640 }],
    ['owner-executable socket', { socketMode: 0o700 }],
    ['missing owner read/write', { socketMode: 0o400 }],
    ['zero inode', { socketInode: 0 }],
    ['zero peer pid', { expectedPeerPid: 0 }],
    ['non-Linux platform', { platform: 'WINDOWS' }],
    ['runtime promotion', { runtimeConnection: 'CONNECTED' }],
  ])('rejects invalid authorization: %s', (_label, drift) => {
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport(
          { exchange: vi.fn() },
          authorization('worker', drift as never),
        ),
    ).toThrow(expectCode('INVALID_AUTHORIZATION'));
  });

  it('rejects explicit deny-only dependencies on both sides', () => {
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport(
          new DenyRetainedNativeSupervisorLocalIpcClient(),
          authorization('worker'),
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler(
          new DenyRetainedNativeSupervisorRecoveryTransport(),
          authorization('supervisor'),
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
  });

  it.each([
    ['pre-connect socket replacement', { endpointBefore: { ...endpoint, socketInode: 9002 } }],
    ['post-connect socket replacement', { endpointAfter: { ...endpoint, socketInode: 9002 } }],
    ['wrong supervisor pid', { peerCredentials: { ...supervisorCredentials, peerPid: 999 } }],
    ['wrong supervisor uid', { peerCredentials: { ...supervisorCredentials, peerUid: 0 } }],
    [
      'untrusted credential authority',
      { peerCredentials: { ...supervisorCredentials, authority: 'CALLER_ASSERTED' } },
    ],
    ['non-socket endpoint', { endpointBefore: { ...endpoint, fileType: 'REGULAR' } }],
  ])('denies client attestation drift: %s', async (_label, drift) => {
    const client: RetainedNativeSupervisorLocalIpcClient = {
      exchange: vi.fn(async () => ({
        endpointBefore: endpoint,
        peerCredentials: supervisorCredentials,
        endpointAfter: endpoint,
        responseFrame: frame('SUPERVISOR_TO_WORKER', response),
        ...drift,
      })),
    };
    const transport = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport(
      client,
      authorization('worker'),
    );
    await expect(transport.exchange(request, new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
  });

  it.each([
    ['wrong direction', frame('WORKER_TO_SUPERVISOR', response)],
    ['extra frame', Buffer.concat([frame('SUPERVISOR_TO_WORKER', response), Buffer.from('{}\n')])],
    ['missing newline', frame('SUPERVISOR_TO_WORKER', response).subarray(0, -1)],
    [
      'noncanonical JSON',
      Buffer.from(
        '{"schemaVersion":1,"protocol":"VENTUREOS_RETAINED_NATIVE_RECOVERY_IPC","direction":"SUPERVISOR_TO_WORKER","message":{}}\n',
      ),
    ],
    ['invalid UTF-8', Buffer.from([0xc3, 0x28, 0x0a])],
    ['oversized frame', Buffer.alloc(MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES + 1, 65)],
  ])('denies malformed or ambiguous response framing: %s', async (_label, responseFrame) => {
    const transport = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport(
      {
        exchange: vi.fn(async () => ({
          endpointBefore: endpoint,
          peerCredentials: supervisorCredentials,
          endpointAfter: endpoint,
          responseFrame,
        })),
      },
      authorization('worker'),
    );
    await expect(transport.exchange(request, new AbortController().signal)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
  });

  it('denies a concurrent exchange while the first native call is unresolved', async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const transport = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport(
      { exchange: vi.fn(async () => pending) },
      authorization('worker'),
    );
    const first = transport.exchange(request, new AbortController().signal);
    await expect(transport.exchange(request, new AbortController().signal)).rejects.toEqual(
      expectCode('CONCURRENT_EXCHANGE'),
    );
    release({
      endpointBefore: endpoint,
      peerCredentials: supervisorCredentials,
      endpointAfter: endpoint,
      responseFrame: frame('SUPERVISOR_TO_WORKER', response),
    });
    await expect(first).resolves.toEqual(response);
  });

  it('does not cross the native client boundary when already aborted', async () => {
    const client = { exchange: vi.fn() };
    const transport = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport(
      client,
      authorization('worker'),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(transport.exchange(request, controller.signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(client.exchange).not.toHaveBeenCalled();
  });

  it('discards a native response when cancellation wins after I/O', async () => {
    const controller = new AbortController();
    const transport = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport(
      {
        exchange: vi.fn(async () => {
          controller.abort();
          return {
            endpointBefore: endpoint,
            peerCredentials: supervisorCredentials,
            endpointAfter: endpoint,
            responseFrame: frame('SUPERVISOR_TO_WORKER', response),
          };
        }),
      },
      authorization('worker'),
    );
    await expect(transport.exchange(request, controller.signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
  });

  it.each([
    ['wrong worker pid', { peerCredentials: { ...workerCredentials, peerPid: 999 } }],
    ['wrong worker gid', { peerCredentials: { ...workerCredentials, peerGid: 0 } }],
    ['wrong socket owner', { endpointIdentity: { ...endpoint, socketOwnerUid: 0 } }],
  ])(
    'denies unauthenticated supervisor-side input before invoking the peer: %s',
    async (_label, drift) => {
      const peer = new FixturePeer();
      const handler = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler(
        peer,
        authorization('supervisor'),
      );
      await expect(
        handler.handle(
          {
            endpointIdentity: endpoint,
            peerCredentials: workerCredentials,
            requestFrame: frame('WORKER_TO_SUPERVISOR', request),
            ...drift,
          },
          new AbortController().signal,
        ),
      ).rejects.toEqual(expectCode('INVALID_ATTESTATION'));
      expect(peer.exchange).not.toHaveBeenCalled();
    },
  );

  it('denies malformed request framing before invoking the supervisor peer', async () => {
    const peer = new FixturePeer();
    const handler = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler(
      peer,
      authorization('supervisor'),
    );
    await expect(
      handler.handle(
        {
          endpointIdentity: endpoint,
          peerCredentials: workerCredentials,
          requestFrame: frame('SUPERVISOR_TO_WORKER', request),
        },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_FRAME'));
    expect(peer.exchange).not.toHaveBeenCalled();
  });

  it('maps supervisor peer failure to a closed IPC denial', async () => {
    const handler = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler(
      { exchange: vi.fn(async () => Promise.reject(new Error('private native detail'))) },
      authorization('supervisor'),
    );
    await expect(
      handler.handle(
        {
          endpointIdentity: endpoint,
          peerCredentials: workerCredentials,
          requestFrame: frame('WORKER_TO_SUPERVISOR', request),
        },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
  });
});
