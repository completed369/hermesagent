import { describe, expect, it, vi } from 'vitest';

import {
  DenyRetainedNativeSupervisorLocalIpcClient,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
} from './retained-native-supervisor-local-ipc';
import {
  DenyLinuxRetainedNativeSupervisorTopologyObservationPort,
  linuxRetainedNativeSupervisorTopologyObservationRequestHash,
  type LinuxRetainedNativeSupervisorTopologyObservationPort,
  type LinuxRetainedNativeSupervisorTopologyObservationRequest,
} from './retained-native-supervisor-shared-runtime-topology';
import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationHandler,
  AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationTransport,
} from './retained-native-supervisor-topology-observation-local-ipc';

const currentTime = Date.parse('2030-01-01T12:00:00.000Z');
const socketPath = '/run/ventureos/topology-observer.sock';
const authorization = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  socketPath,
  socketDevice: 41,
  socketInode: 9001,
  socketOwnerUid: 65532,
  socketOwnerGid: 65532,
  socketMode: 0o600,
  expectedPeerPid: 810,
  expectedPeerUid: 65532,
  expectedPeerGid: 65532,
  runtimeConnection: 'NOT_CONFIGURED',
});
const endpoint = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_LSTAT_UNIX_SOCKET',
  fileType: 'SOCKET',
  socketPath,
  socketDevice: 41,
  socketInode: 9001,
  socketOwnerUid: 65532,
  socketOwnerGid: 65532,
  socketMode: 0o600,
});
const peer = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_SO_PEERCRED',
  peerPid: 810,
  peerUid: 65532,
  peerGid: 65532,
});
const request: LinuxRetainedNativeSupervisorTopologyObservationRequest = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION',
  observerRole: 'WORKER_CLIENT',
  workspaceId: 'workspace-one',
  supervisorInstanceId: 'supervisor-one',
  provisioningAttemptId: 'attempt-0001',
  provisioningPlanHash: 'a'.repeat(64),
  platform: 'LINUX',
  architecture: 'X64',
  runtimeRootParent: '/var/lib/ventureos/runtime/workspace-one/supervisor-one',
  runtimeRootParentIdentityReference: 'linux:dev-a:ino-10',
  runtimeRootParentOwnerUid: 65532,
  runtimeRootParentOwnerGid: 65532,
  runtimeRootParentMode: 0o700,
  sourceModulePath: '/usr/lib/ventureos/native/linux-retained-native-client.node',
  sourceModuleSha256: 'b'.repeat(64),
  sourceModuleIdentityReference: 'linux:dev-b:ino-20',
  sourceModuleOwnerUid: 0,
  sourceModuleOwnerGid: 0,
  sourceModuleMode: 0o444,
  sourceModuleSizeBytes: 4096,
  runtimeConnection: 'NOT_CONFIGURED',
});

function observation(input: LinuxRetainedNativeSupervisorTopologyObservationRequest) {
  return {
    ...input,
    observationId: 'observation-worker-client-1',
    requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(input),
    evidenceAuthority: 'LINUX_RETAINED_DESCRIPTORS',
    principalAuthority: 'LINUX_EFFECTIVE_IDENTITY',
    observerUid: input.runtimeRootParentOwnerUid,
    observerGid: input.runtimeRootParentOwnerGid,
    observedAt: new Date(currentTime).toISOString(),
    validUntil: new Date(currentTime + 4_000).toISOString(),
    topologyState: 'VISIBLE_NOT_PROVISIONED',
  };
}

class Observer implements LinuxRetainedNativeSupervisorTopologyObservationPort {
  observe = vi.fn(async (input: unknown): Promise<unknown> =>
    observation(input as LinuxRetainedNativeSupervisorTopologyObservationRequest),
  );
}

class LoopbackClient implements ClosableRetainedNativeSupervisorLocalIpcClient {
  exchange = vi.fn(
    async (
      path: string,
      requestFrame: Readonly<Uint8Array>,
      signal: AbortSignal,
    ): Promise<unknown> => ({
      endpointBefore: endpoint,
      peerCredentials: peer,
      endpointAfter: endpoint,
      responseFrame: await this.handler.handle(
        { endpointIdentity: endpoint, peerCredentials: peer, requestFrame },
        signal,
      ),
      path,
    }),
  );
  readonly close = vi.fn(async (): Promise<void> => undefined);

  constructor(
    readonly handler: AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationHandler,
  ) {
    this.exchange.mockImplementation(async (path, requestFrame, signal) => {
      const responseFrame = await this.handler.handle(
        { endpointIdentity: endpoint, peerCredentials: peer, requestFrame },
        signal,
      );
      return {
        endpointBefore: endpoint,
        peerCredentials: peer,
        endpointAfter: endpoint,
        responseFrame,
      };
    });
  }
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

function subject() {
  const observer = new Observer();
  const handler = new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationHandler(
    observer,
    authorization,
    'WORKER_CLIENT',
    () => currentTime,
  );
  const client = new LoopbackClient(handler);
  const transport = new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationTransport(
    client,
    authorization,
    'WORKER_CLIENT',
    () => currentTime,
  );
  return { observer, handler, client, transport };
}

describe('authenticated Linux local topology observation IPC', () => {
  it('authenticates both peers and returns one exact fresh role-local observation', async () => {
    const { observer, client, transport } = subject();
    await expect(transport.observe(request, new AbortController().signal)).resolves.toMatchObject({
      observerRole: 'WORKER_CLIENT',
      requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(request),
      topologyState: 'VISIBLE_NOT_PROVISIONED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(observer.observe).toHaveBeenCalledOnce();
    expect(client.exchange).toHaveBeenCalledWith(
      socketPath,
      expect.any(Uint8Array),
      expect.any(AbortSignal),
    );
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('denies unconfigured dependencies and invalid role or timeout', () => {
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationTransport(
          new DenyRetainedNativeSupervisorLocalIpcClient(),
          authorization,
          'WORKER_CLIENT',
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationHandler(
          new DenyLinuxRetainedNativeSupervisorTopologyObservationPort(),
          authorization,
          'WORKER_CLIENT',
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationTransport(
          new LoopbackClient(
            new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationHandler(
              new Observer(),
              authorization,
              'WORKER_CLIENT',
            ),
          ),
          authorization,
          'WORKER_CLIENT',
          () => currentTime,
          99,
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
  });

  it('denies role drift before reaching the client', async () => {
    const { client, transport } = subject();
    await expect(
      transport.observe({ ...request, observerRole: 'API_LISTENER' }, new AbortController().signal),
    ).rejects.toEqual(expectCode('INVALID_AUTHORIZATION'));
    expect(client.exchange).not.toHaveBeenCalled();
  });

  it.each([
    ['endpoint replacement', { endpointAfter: { ...endpoint, socketInode: 9002 } }],
    ['wrong peer', { peerCredentials: { ...peer, peerPid: 811 } }],
    ['extra result key', { extra: true }],
  ])('denies %s and closes the client', async (_label, drift) => {
    const { client, transport } = subject();
    client.exchange.mockResolvedValue({
      endpointBefore: endpoint,
      peerCredentials: peer,
      endpointAfter: endpoint,
      responseFrame: new Uint8Array([1, 2, 3]),
      ...drift,
    });
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('denies unauthenticated or malformed inbound frames before observing', async () => {
    const observer = new Observer();
    const handler = new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationHandler(
      observer,
      authorization,
      'WORKER_CLIENT',
      () => currentTime,
    );
    await expect(
      handler.handle(
        {
          endpointIdentity: endpoint,
          peerCredentials: { ...peer, peerUid: 0 },
          requestFrame: new TextEncoder().encode('{}\n'),
        },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_ATTESTATION'));
    expect(observer.observe).not.toHaveBeenCalled();
  });

  it('withholds malformed role-local evidence at the handler boundary', async () => {
    const { observer, transport, client } = subject();
    observer.observe.mockResolvedValue({ ...observation(request), unexpected: true });
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('is one-use and captures both dependency methods at construction', async () => {
    const { observer, client, transport } = subject();
    const originalExchange = client.exchange;
    const originalObserve = observer.observe;
    observer.observe = vi.fn(async () => ({ substituted: true }));
    client.exchange = vi.fn(async () => ({ substituted: true })) as typeof client.exchange;
    await expect(transport.observe(request, new AbortController().signal)).resolves.toMatchObject({
      observerRole: 'WORKER_CLIENT',
    });
    expect(originalExchange).toHaveBeenCalledOnce();
    expect(originalObserve).toHaveBeenCalledOnce();
    expect(observer.observe).not.toHaveBeenCalled();
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      expectCode('CONCURRENT_EXCHANGE'),
    );
  });

  it('bounds a non-cooperating exchange, closes it, and consumes the attempt', async () => {
    const close = vi.fn(async (): Promise<void> => undefined);
    const client: ClosableRetainedNativeSupervisorLocalIpcClient = {
      exchange: async () => new Promise<never>(() => undefined),
      close,
    };
    const transport =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationTransport(
        client,
        authorization,
        'WORKER_CLIENT',
        () => currentTime,
        100,
      );
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(close).toHaveBeenCalledOnce();
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      expectCode('CONCURRENT_EXCHANGE'),
    );
  });

  it('bounds a non-cooperating role-local observer before a response can escape', async () => {
    const observer: LinuxRetainedNativeSupervisorTopologyObservationPort = {
      observe: async () => new Promise<never>(() => undefined),
    };
    const handler = new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationHandler(
      observer,
      authorization,
      'WORKER_CLIENT',
      () => currentTime,
      100,
    );
    const client = new LoopbackClient(handler);
    const transport =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationTransport(
        client,
        authorization,
        'WORKER_CLIENT',
        () => currentTime,
        500,
      );
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(client.close).toHaveBeenCalledOnce();
  });
});
