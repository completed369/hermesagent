import {
  BoundedLinuxRetainedNativeSupervisorModuleLoader,
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
  DenyLinuxRetainedNativeSupervisorTopologyObservationPort,
  DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  DenyRetainedNativeSupervisorLocalIpcClient,
  RootResolvedRetainedNativeSupervisorTopologyObservationWorker,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
} from '@ventureos/agent-bridge';
import { describe, expect, it, vi } from 'vitest';

import {
  createFramedRootResolvedLinuxNativeTopologyCarrierWorker,
  createLinuxLocalTopologyCarrierRootSource,
  createLoadedLinuxNativeTopologyCarrierRootSource,
  createRootResolvedLinuxNativeTopologyCarrierWorker,
  loadLinuxNativeTopologyCarrierRootSource,
} from './topology-carrier-root-lookup-composition';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const binding = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER',
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL',
  carrierId: 'carrier-worker-root-composition',
  coordinatorPrincipalReference: 'service:api:worker-root-composition',
  workerPrincipalReference: 'service:worker:worker-root-composition',
  workspaceId: 'workspace-worker-root-composition',
  supervisorInstanceId: 'supervisor-worker-root-composition',
  provisioningAttemptId: 'attempt-worker-root-composition',
  provisioningPlanHash: 'e'.repeat(64),
  issuedAt: new Date(NOW - 100).toISOString(),
  expiresAt: new Date(NOW + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED',
});
const localIpcAuthorization = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  socketPath: '/run/ventureos/carrier-root-lookup.sock',
  socketDevice: 43,
  socketInode: 9_401,
  socketOwnerUid: 700,
  socketOwnerGid: 701,
  socketMode: 0o600,
  expectedPeerPid: 840,
  expectedPeerUid: 700,
  expectedPeerGid: 701,
  runtimeConnection: 'NOT_CONFIGURED',
});

class UnusedClient implements ClosableRetainedNativeSupervisorLocalIpcClient {
  readonly exchange = vi.fn(async (): Promise<never> => {
    throw new Error('construction must not exchange');
  });
  readonly close = vi.fn(async (): Promise<void> => {
    throw new Error('construction must not close');
  });
}

describe('worker Linux topology carrier root lookup composition', () => {
  it('constructs the exact one-use source without touching the injected client', () => {
    const client = new UnusedClient();
    const source = createLinuxLocalTopologyCarrierRootSource(
      client,
      binding,
      localIpcAuthorization,
      () => NOW,
    );

    expect(source).toBeInstanceOf(
      BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
    );
    expect(client.exchange).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
  });

  it('rejects the deny client and invalid authorization without client activity', () => {
    expect(() =>
      createLinuxLocalTopologyCarrierRootSource(
        new DenyRetainedNativeSupervisorLocalIpcClient(),
        binding,
        localIpcAuthorization,
        () => NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'NOT_CONFIGURED' }));

    const client = new UnusedClient();
    expect(() =>
      createLinuxLocalTopologyCarrierRootSource(
        client,
        binding,
        { ...localIpcAuthorization, expectedPeerUid: -1 },
        () => NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(client.exchange).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
  });

  it('binds an exact loaded CLIENT module without loading, native calls, or IPC', () => {
    const nativeModule = {
      abiVersion: 1 as const,
      platform: 'LINUX' as const,
      lstatUnixSocket: vi.fn(async (): Promise<never> => {
        throw new Error('construction must not stat');
      }),
      connectUnixSocket: vi.fn(async (): Promise<never> => {
        throw new Error('construction must not connect');
      }),
    };
    const source = createLoadedLinuxNativeTopologyCarrierRootSource(
      Object.freeze({
        schemaVersion: 1,
        moduleKind: 'CLIENT',
        socketPath: localIpcAuthorization.socketPath,
        runtimeConnection: 'NOT_CONFIGURED',
        nativeModule,
      }),
      binding,
      localIpcAuthorization,
      () => NOW,
    );

    expect(source).toBeInstanceOf(
      BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
    );
    expect(nativeModule.lstatUnixSocket).not.toHaveBeenCalled();
    expect(nativeModule.connectUnixSocket).not.toHaveBeenCalled();
  });

  it('joins the concrete root source to the worker endpoint without side effects', () => {
    const client = new UnusedClient();
    const source = createLinuxLocalTopologyCarrierRootSource(
      client,
      binding,
      localIpcAuthorization,
      () => NOW,
    );
    const observer = {
      observe: vi.fn(async (): Promise<never> => {
        throw new Error('construction must not observe');
      }),
    };
    const signer = {
      sign: vi.fn(async (): Promise<never> => {
        throw new Error('construction must not sign');
      }),
    };

    const worker = createRootResolvedLinuxNativeTopologyCarrierWorker(
      source,
      observer,
      signer,
      binding,
      () => NOW,
    );

    expect(worker).toBeInstanceOf(RootResolvedRetainedNativeSupervisorTopologyObservationWorker);
    expect(client.exchange).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
    expect(observer.observe).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('denies substituted sources and deny-only worker dependencies without activity', () => {
    const client = new UnusedClient();
    const source = createLinuxLocalTopologyCarrierRootSource(
      client,
      binding,
      localIpcAuthorization,
      () => NOW,
    );
    const observer = { observe: vi.fn() };
    const signer = { sign: vi.fn() };

    expect(() =>
      createRootResolvedLinuxNativeTopologyCarrierWorker(
        {
          read: vi.fn(),
        } as unknown as BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
        observer,
        signer,
        binding,
        () => NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(() =>
      createRootResolvedLinuxNativeTopologyCarrierWorker(
        source,
        new DenyLinuxRetainedNativeSupervisorTopologyObservationPort(),
        signer,
        binding,
        () => NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    expect(() =>
      createRootResolvedLinuxNativeTopologyCarrierWorker(
        source,
        observer,
        new DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(),
        binding,
        () => NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    expect(client.exchange).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
    expect(observer.observe).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('wraps the exact root-resolved worker in the bounded frame endpoint without activity', () => {
    const client = new UnusedClient();
    const source = createLinuxLocalTopologyCarrierRootSource(
      client,
      binding,
      localIpcAuthorization,
      () => NOW,
    );
    const observer = {
      observe: vi.fn(async (): Promise<never> => {
        throw new Error('construction must not observe');
      }),
    };
    const signer = {
      sign: vi.fn(async (): Promise<never> => {
        throw new Error('construction must not sign');
      }),
    };

    const endpoint = createFramedRootResolvedLinuxNativeTopologyCarrierWorker(
      source,
      observer,
      signer,
      binding,
      () => NOW,
      2_000,
    );

    expect(endpoint).toBeInstanceOf(
      BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
    );
    expect(client.exchange).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
    expect(observer.observe).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('denies invalid frame bounds without lookup, observation, signing, or IPC', () => {
    const client = new UnusedClient();
    const source = createLinuxLocalTopologyCarrierRootSource(
      client,
      binding,
      localIpcAuthorization,
      () => NOW,
    );
    const observer = { observe: vi.fn() };
    const signer = { sign: vi.fn() };

    expect(() =>
      createFramedRootResolvedLinuxNativeTopologyCarrierWorker(
        {
          read: vi.fn(),
        } as unknown as BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
        observer,
        signer,
        binding,
        () => NOW,
        2_000,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(() =>
      createFramedRootResolvedLinuxNativeTopologyCarrierWorker(
        source,
        observer,
        signer,
        binding,
        () => NOW,
        5_001,
      ),
    ).toThrowError(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    expect(client.exchange).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
    expect(observer.observe).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('denies envelope drift and socket-path substitution before native activity', () => {
    const nativeModule = {
      abiVersion: 1 as const,
      platform: 'LINUX' as const,
      lstatUnixSocket: vi.fn(),
      connectUnixSocket: vi.fn(),
    };
    const loadedModule = Object.freeze({
      schemaVersion: 1,
      moduleKind: 'CLIENT',
      socketPath: localIpcAuthorization.socketPath,
      runtimeConnection: 'NOT_CONFIGURED',
      nativeModule,
    });

    expect(() =>
      createLoadedLinuxNativeTopologyCarrierRootSource(
        { ...loadedModule, moduleKind: 'LISTENER' },
        binding,
        localIpcAuthorization,
        () => NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(() =>
      createLoadedLinuxNativeTopologyCarrierRootSource(
        { ...loadedModule, unexpected: true },
        binding,
        localIpcAuthorization,
        () => NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    let getterCalls = 0;
    const accessorEnvelope = { ...loadedModule } as Record<string, unknown>;
    Object.defineProperty(accessorEnvelope, 'nativeModule', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return nativeModule;
      },
    });
    expect(() =>
      createLoadedLinuxNativeTopologyCarrierRootSource(
        accessorEnvelope,
        binding,
        localIpcAuthorization,
        () => NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(getterCalls).toBe(0);
    expect(() =>
      createLoadedLinuxNativeTopologyCarrierRootSource(
        { ...loadedModule, socketPath: '/run/ventureos/substituted.sock' },
        binding,
        localIpcAuthorization,
        () => NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(nativeModule.lstatUnixSocket).not.toHaveBeenCalled();
    expect(nativeModule.connectUnixSocket).not.toHaveBeenCalled();
  });

  it('loads one exact CLIENT request before inert source construction', async () => {
    const nativeModule = {
      abiVersion: 1 as const,
      platform: 'LINUX' as const,
      lstatUnixSocket: vi.fn(),
      connectUnixSocket: vi.fn(),
    };
    const request = Object.freeze({
      schemaVersion: 1,
      platform: 'LINUX',
      architecture: 'X64',
      moduleKind: 'CLIENT',
      canonicalModulePath: '/opt/ventureos/native/client.node',
      socketPath: localIpcAuthorization.socketPath,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const load = vi.spyOn(loader, 'load').mockResolvedValue(
      Object.freeze({
        schemaVersion: 1,
        moduleKind: 'CLIENT',
        socketPath: localIpcAuthorization.socketPath,
        runtimeConnection: 'NOT_CONFIGURED',
        nativeModule,
      }),
    );
    const signal = new AbortController().signal;

    const source = await loadLinuxNativeTopologyCarrierRootSource(
      loader,
      request,
      signal,
      binding,
      localIpcAuthorization,
      () => NOW,
    );

    expect(source).toBeInstanceOf(
      BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
    );
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(request, signal);
    expect(nativeModule.lstatUnixSocket).not.toHaveBeenCalled();
    expect(nativeModule.connectUnixSocket).not.toHaveBeenCalled();
  });

  it('rejects role, socket, and cancellation drift before consuming the loader', async () => {
    const request = Object.freeze({
      schemaVersion: 1,
      platform: 'LINUX',
      architecture: 'X64',
      moduleKind: 'CLIENT',
      canonicalModulePath: '/opt/ventureos/native/client.node',
      socketPath: localIpcAuthorization.socketPath,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const load = vi.spyOn(loader, 'load');

    await expect(
      loadLinuxNativeTopologyCarrierRootSource(
        { load: vi.fn() } as unknown as BoundedLinuxRetainedNativeSupervisorModuleLoader,
        request,
        new AbortController().signal,
        binding,
        localIpcAuthorization,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });

    await expect(
      loadLinuxNativeTopologyCarrierRootSource(
        loader,
        { ...request, moduleKind: 'LISTENER' },
        new AbortController().signal,
        binding,
        localIpcAuthorization,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    await expect(
      loadLinuxNativeTopologyCarrierRootSource(
        loader,
        { ...request, socketPath: '/run/ventureos/substituted.sock' },
        new AbortController().signal,
        binding,
        localIpcAuthorization,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadLinuxNativeTopologyCarrierRootSource(
        loader,
        request,
        controller.signal,
        binding,
        localIpcAuthorization,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(load).not.toHaveBeenCalled();
  });

  it('rejects loader output drift and post-load cancellation before native activity', async () => {
    const nativeModule = {
      abiVersion: 1 as const,
      platform: 'LINUX' as const,
      lstatUnixSocket: vi.fn(),
      connectUnixSocket: vi.fn(),
    };
    const request = Object.freeze({
      schemaVersion: 1,
      platform: 'LINUX',
      architecture: 'X64',
      moduleKind: 'CLIENT',
      canonicalModulePath: '/opt/ventureos/native/client.node',
      socketPath: localIpcAuthorization.socketPath,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const load = vi.spyOn(loader, 'load');
    load.mockResolvedValueOnce(
      Object.freeze({
        schemaVersion: 1,
        moduleKind: 'CLIENT',
        socketPath: '/run/ventureos/substituted.sock',
        runtimeConnection: 'NOT_CONFIGURED',
        nativeModule,
      }),
    );
    await expect(
      loadLinuxNativeTopologyCarrierRootSource(
        loader,
        request,
        new AbortController().signal,
        binding,
        localIpcAuthorization,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });

    const controller = new AbortController();
    load.mockImplementationOnce(async () => {
      controller.abort();
      return Object.freeze({
        schemaVersion: 1,
        moduleKind: 'CLIENT',
        socketPath: localIpcAuthorization.socketPath,
        runtimeConnection: 'NOT_CONFIGURED',
        nativeModule,
      });
    });
    await expect(
      loadLinuxNativeTopologyCarrierRootSource(
        loader,
        request,
        controller.signal,
        binding,
        localIpcAuthorization,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(nativeModule.lstatUnixSocket).not.toHaveBeenCalled();
    expect(nativeModule.connectUnixSocket).not.toHaveBeenCalled();
  });
});
