import {
  BoundedLinuxRetainedNativeSupervisorModuleLoader,
  BoundedLinuxRetainedNativeSupervisorServiceOwner,
  canonicalJson,
  linuxRetainedNativeSupervisorServiceRequestHash,
  type LinuxRetainedNativeSupervisorServiceGrant,
  type LinuxRetainedNativeSupervisorServiceRequest,
} from '@ventureos/agent-bridge';
import { describe, expect, it, vi } from 'vitest';

import { createLinuxLocalTopologyCarrierRootSource } from './topology-carrier-root-lookup-composition';
import {
  createLoadedLinuxNativeTopologyCarrierWorkerListenerServiceOwner,
  loadLinuxNativeTopologyCarrierWorkerListenerServiceOwner,
  runLoadedRetainedDescriptorKeylessLinuxNativeTopologyCarrierWorkerServiceOne,
} from './topology-carrier-worker-listener-composition';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const itLinux = process.platform === 'linux' && process.arch === 'x64' ? it : it.skip;
const socketPath = '/run/ventureos/topology-carrier-worker.sock';
const listenerIdentity = Object.freeze({
  fileType: 'SOCKET' as const,
  device: 43,
  inode: 9_501,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o600,
});
const parentIdentity = Object.freeze({
  fileType: 'DIRECTORY' as const,
  device: 42,
  inode: 9_500,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o700,
});
const binding = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER' as const,
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' as const,
  carrierId: 'carrier-worker-listener-composition',
  coordinatorPrincipalReference: 'service:api:worker-listener-composition',
  workerPrincipalReference: 'service:worker:worker-listener-composition',
  workspaceId: 'workspace-worker-listener-composition',
  supervisorInstanceId: 'supervisor-worker-listener-composition',
  provisioningAttemptId: 'attempt-worker-listener-composition',
  provisioningPlanHash: 'a'.repeat(64),
  issuedAt: new Date(NOW - 100).toISOString(),
  expiresAt: new Date(NOW + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED' as const,
});
const request: LinuxRetainedNativeSupervisorServiceRequest = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_ONE_SESSION_SERVICE',
  workspaceId: binding.workspaceId,
  supervisorInstanceId: binding.supervisorInstanceId,
  serviceKind: 'TOPOLOGY_CARRIER_WORKER_LISTENER',
  provisioningId: 'provisioning-worker-listener-composition',
  pathProvisionRequestHash: 'b'.repeat(64),
  pathApprovalEvidenceHash: 'c'.repeat(64),
  socketDirectory: '/run/ventureos',
  socketDirectoryIdentityReference: 'linux:dev-2a:ino-251c',
  socketDirectoryOwnerUid: parentIdentity.ownerUid,
  socketDirectoryOwnerGid: parentIdentity.ownerGid,
  socketDirectoryMode: 0o700,
  socketPath,
  expectedPeerRole: 'API_COORDINATOR',
  expectedPeerPid: 851,
  expectedPeerUid: 710,
  expectedPeerGid: 711,
  maximumSessionDurationMs: 2_000,
  runtimeConnection: 'NOT_CONFIGURED',
});

function grant(): LinuxRetainedNativeSupervisorServiceGrant {
  return {
    ...request,
    serviceRunId: 'service-run-worker-listener-composition',
    requestHash: linuxRetainedNativeSupervisorServiceRequestHash(request),
    approvalId: 'approval-worker-listener-composition',
    approvalEvidenceHash: 'd'.repeat(64),
    authorizedByReference: 'operator-worker-listener-composition',
    authorityLevel: 3,
    validFrom: new Date(NOW - 1_000).toISOString(),
    validUntil: new Date(NOW + 30_000).toISOString(),
  };
}

function loadedListenerModule(createOwnedListener = vi.fn()) {
  return Object.freeze({
    schemaVersion: 1 as const,
    moduleKind: 'LISTENER' as const,
    socketPath,
    runtimeConnection: 'NOT_CONFIGURED' as const,
    nativeModule: Object.freeze({
      abiVersion: 1 as const,
      platform: 'LINUX' as const,
      createOwnedListener,
    }),
  });
}

function moduleRequest(moduleKind: 'LISTENER' | 'CLIENT', path = socketPath) {
  return Object.freeze({
    schemaVersion: 1 as const,
    platform: 'LINUX' as const,
    architecture: 'X64' as const,
    moduleKind,
    canonicalModulePath: `/opt/ventureos/${moduleKind.toLowerCase()}.node`,
    socketPath: path,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  });
}

describe('worker topology carrier listener composition', () => {
  it('creates and loads the exact listener owner without native or authority activity', async () => {
    const createOwnedListener = vi.fn();
    const authorize = vi.fn();
    const loaded = loadedListenerModule(createOwnedListener);
    const authority = { authorize };
    const owner = createLoadedLinuxNativeTopologyCarrierWorkerListenerServiceOwner(
      loaded,
      authority,
      request,
      () => NOW,
    );
    expect(owner).toBeInstanceOf(BoundedLinuxRetainedNativeSupervisorServiceOwner);
    expect(createOwnedListener).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();

    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const load = vi.spyOn(loader, 'load').mockResolvedValue(loaded);
    const loadedOwner = await loadLinuxNativeTopologyCarrierWorkerListenerServiceOwner(
      loader,
      moduleRequest('LISTENER'),
      new AbortController().signal,
      authority,
      request,
      () => NOW,
    );
    expect(loadedOwner).toBeInstanceOf(BoundedLinuxRetainedNativeSupervisorServiceOwner);
    expect(load).toHaveBeenCalledOnce();
    expect(createOwnedListener).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it('denies listener purpose and path drift before loading or authority activity', async () => {
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const load = vi.spyOn(loader, 'load');
    const authorize = vi.fn();
    await expect(
      loadLinuxNativeTopologyCarrierWorkerListenerServiceOwner(
        loader,
        moduleRequest('LISTENER', '/run/ventureos/other.sock'),
        new AbortController().signal,
        { authorize },
        request,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(() =>
      createLoadedLinuxNativeTopologyCarrierWorkerListenerServiceOwner(
        loadedListenerModule(),
        { authorize },
        { ...request, serviceKind: 'RECOVERY', expectedPeerRole: 'WORKER_CLIENT' },
        () => NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(load).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  itLinux(
    'loads the signer and reaches one authorized listener exchange with exact cleanup',
    async () => {
      const accepted = {
        peerCredentials: vi.fn(async () => ({ pid: 851, uid: 710, gid: 711 })),
        readToEof: vi.fn(async (): Promise<unknown> => new Uint8Array([0xff])),
        writeAndShutdown: vi.fn(),
        close: vi.fn(async () => undefined),
      };
      const closeAndUnlinkOwned = vi.fn(async () => ({
        schemaVersion: 1,
        expectedDevice: listenerIdentity.device,
        expectedInode: listenerIdentity.inode,
        listenerClosed: true,
        disposition: 'OWNED_SOCKET_REMOVED',
      }));
      const listener = {
        platform: 'LINUX' as const,
        creationEvidence: vi.fn(async () => ({
          schemaVersion: 1,
          pathStateBefore: 'ABSENT',
          bindDisposition: 'CREATED_WITHOUT_REPLACEMENT',
          parentIdentity,
          listenerIdentity,
        })),
        lstatUnixSocket: vi.fn(async () => listenerIdentity),
        acceptAuthorizedUnixSocket: vi.fn(async () => accepted),
        closeAndUnlinkOwned,
      };
      const authority = { authorize: vi.fn(async (): Promise<unknown> => grant()) };
      const owner = new BoundedLinuxRetainedNativeSupervisorServiceOwner(
        {
          platform: 'LINUX',
          createOwnedListener: vi.fn(async () => listener),
        },
        authority,
        () => NOW,
      );
      const shadowedRun = vi.fn(async () => undefined);
      Object.defineProperty(owner, 'runTopologyCarrierWorkerOne', { value: shadowedRun });
      const rootClient = {
        exchange: vi.fn(async (): Promise<never> => {
          throw new Error('invalid input must fail before root lookup');
        }),
        close: vi.fn(async () => undefined),
      };
      const source = createLinuxLocalTopologyCarrierRootSource(
        rootClient,
        binding,
        {
          schemaVersion: 1,
          platform: 'LINUX',
          socketPath: '/run/ventureos/root.sock',
          socketDevice: 44,
          socketInode: 9_502,
          socketOwnerUid: 700,
          socketOwnerGid: 701,
          socketMode: 0o600,
          expectedPeerPid: 852,
          expectedPeerUid: 700,
          expectedPeerGid: 701,
          runtimeConnection: 'NOT_CONFIGURED',
        },
        () => NOW,
      );
      const signingPath = '/run/ventureos/signer.sock';
      const signerNative = {
        abiVersion: 1 as const,
        platform: 'LINUX' as const,
        lstatUnixSocket: vi.fn(),
        connectUnixSocket: vi.fn(),
      };
      const signerLoader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
      const loadSigner = vi.spyOn(signerLoader, 'load').mockResolvedValue(
        Object.freeze({
          schemaVersion: 1,
          moduleKind: 'CLIENT',
          socketPath: signingPath,
          runtimeConnection: 'NOT_CONFIGURED',
          nativeModule: signerNative,
        }),
      );

      await expect(
        runLoadedRetainedDescriptorKeylessLinuxNativeTopologyCarrierWorkerServiceOne(
          owner,
          signerLoader,
          moduleRequest('CLIENT', signingPath),
          {
            schemaVersion: 1,
            platform: 'LINUX',
            socketPath: signingPath,
            socketDevice: 45,
            socketInode: 9_503,
            socketOwnerUid: 700,
            socketOwnerGid: 701,
            socketMode: 0o600,
            expectedPeerPid: 853,
            expectedPeerUid: 700,
            expectedPeerGid: 701,
            runtimeConnection: 'NOT_CONFIGURED',
          },
          'key:worker-listener-composition',
          source,
          request,
          binding,
          new AbortController().signal,
          () => NOW,
        ),
      ).rejects.toMatchObject({ code: 'EXCHANGE_DENIED' });

      expect(loadSigner).toHaveBeenCalledOnce();
      expect(shadowedRun).not.toHaveBeenCalled();
      expect(authority.authorize).toHaveBeenCalledOnce();
      expect(accepted.peerCredentials).toHaveBeenCalledOnce();
      expect(accepted.readToEof).toHaveBeenCalledOnce();
      expect(accepted.writeAndShutdown).not.toHaveBeenCalled();
      expect(accepted.close).toHaveBeenCalledOnce();
      expect(closeAndUnlinkOwned).toHaveBeenCalledOnce();
      expect(rootClient.exchange).not.toHaveBeenCalled();
      expect(rootClient.close).not.toHaveBeenCalled();
      expect(signerNative.lstatUnixSocket).not.toHaveBeenCalled();
      expect(signerNative.connectUnixSocket).not.toHaveBeenCalled();
    },
  );

  it('denies cross-tenant scope before signer loading or service authority', async () => {
    const authority = { authorize: vi.fn(async (): Promise<unknown> => grant()) };
    const owner = createLoadedLinuxNativeTopologyCarrierWorkerListenerServiceOwner(
      loadedListenerModule(),
      authority,
      request,
      () => NOW,
    );
    const source = createLinuxLocalTopologyCarrierRootSource(
      { exchange: vi.fn(), close: vi.fn() },
      binding,
      {
        schemaVersion: 1,
        platform: 'LINUX',
        socketPath: '/run/ventureos/root.sock',
        socketDevice: 44,
        socketInode: 9_502,
        socketOwnerUid: 700,
        socketOwnerGid: 701,
        socketMode: 0o600,
        expectedPeerPid: 852,
        expectedPeerUid: 700,
        expectedPeerGid: 701,
        runtimeConnection: 'NOT_CONFIGURED',
      },
      () => NOW,
    );
    const signerLoader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const loadSigner = vi.spyOn(signerLoader, 'load');
    await expect(
      runLoadedRetainedDescriptorKeylessLinuxNativeTopologyCarrierWorkerServiceOne(
        owner,
        signerLoader,
        moduleRequest('CLIENT', '/run/ventureos/signer.sock'),
        {},
        'key:worker-listener-composition',
        source,
        { ...request, workspaceId: 'workspace-other' },
        binding,
        new AbortController().signal,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(loadSigner).not.toHaveBeenCalled();
    expect(authority.authorize).not.toHaveBeenCalled();
  });

  it('denies a prototype-forged service owner before signer loading', async () => {
    const source = createLinuxLocalTopologyCarrierRootSource(
      { exchange: vi.fn(), close: vi.fn() },
      binding,
      {
        schemaVersion: 1,
        platform: 'LINUX',
        socketPath: '/run/ventureos/root.sock',
        socketDevice: 44,
        socketInode: 9_502,
        socketOwnerUid: 700,
        socketOwnerGid: 701,
        socketMode: 0o600,
        expectedPeerPid: 852,
        expectedPeerUid: 700,
        expectedPeerGid: 701,
        runtimeConnection: 'NOT_CONFIGURED',
      },
      () => NOW,
    );
    const signerLoader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const loadSigner = vi.spyOn(signerLoader, 'load');
    await expect(
      runLoadedRetainedDescriptorKeylessLinuxNativeTopologyCarrierWorkerServiceOne(
        Object.create(
          BoundedLinuxRetainedNativeSupervisorServiceOwner.prototype,
        ) as BoundedLinuxRetainedNativeSupervisorServiceOwner,
        signerLoader,
        moduleRequest('CLIENT', '/run/ventureos/signer.sock'),
        {},
        'key:worker-listener-composition',
        source,
        request,
        binding,
        new AbortController().signal,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(loadSigner).not.toHaveBeenCalled();
  });

  it('contains no runtime promotion in the composed service request', () => {
    expect(canonicalJson(request)).not.toContain('CONNECTED');
  });
});
