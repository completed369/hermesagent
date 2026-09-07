import {
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  DenyRetainedNativeSupervisorLocalIpcClient,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
} from '@ventureos/agent-bridge';
import { describe, expect, it, vi } from 'vitest';

import {
  createLinuxLocalTopologyCarrierRootSource,
  createLoadedLinuxNativeTopologyCarrierRootSource,
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
});
