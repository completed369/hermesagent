import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  DenyRetainedNativeSupervisorLocalIpcClient,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
} from './retained-native-supervisor-local-ipc';
import { retainedNativeSupervisorTopologyObservationCarrierBindingHash } from './retained-native-supervisor-topology-observation-carrier';
import {
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  type RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransportAuthorization,
} from './retained-native-supervisor-topology-observation-carrier-root-lookup';
import { BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler } from './retained-native-supervisor-topology-observation-carrier-root-lookup-handler';
import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler,
  AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport,
} from './retained-native-supervisor-topology-observation-carrier-root-lookup-local-ipc';
import type { RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource } from './retained-native-supervisor-topology-observation-carrier-composition';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const binding = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER' as const,
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' as const,
  carrierId: 'carrier-root-local-ipc',
  coordinatorPrincipalReference: 'service:api:carrier-root-local-ipc',
  workerPrincipalReference: 'service:worker:carrier-root-local-ipc',
  workspaceId: 'workspace-carrier-root-local-ipc',
  supervisorInstanceId: 'supervisor-carrier-root-local-ipc',
  provisioningAttemptId: 'attempt-carrier-root-local-ipc',
  provisioningPlanHash: 'e'.repeat(64),
  issuedAt: new Date(NOW - 100).toISOString(),
  expiresAt: new Date(NOW + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED' as const,
});
const bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding);
const socketPath = '/run/ventureos/carrier-root-lookup.sock';
const endpoint = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_LSTAT_UNIX_SOCKET',
  fileType: 'SOCKET',
  socketPath,
  socketDevice: 41,
  socketInode: 9_101,
  socketOwnerUid: 700,
  socketOwnerGid: 701,
  socketMode: 0o600,
});
const apiPeer = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_SO_PEERCRED',
  peerPid: 810,
  peerUid: 700,
  peerGid: 701,
});
const workerPeer = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_SO_PEERCRED',
  peerPid: 820,
  peerUid: 702,
  peerGid: 703,
});
const clientAuthorization = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  socketPath,
  socketDevice: endpoint.socketDevice,
  socketInode: endpoint.socketInode,
  socketOwnerUid: endpoint.socketOwnerUid,
  socketOwnerGid: endpoint.socketOwnerGid,
  socketMode: endpoint.socketMode,
  expectedPeerPid: apiPeer.peerPid,
  expectedPeerUid: apiPeer.peerUid,
  expectedPeerGid: apiPeer.peerGid,
  runtimeConnection: 'NOT_CONFIGURED',
});
const serverAuthorization = Object.freeze({
  ...clientAuthorization,
  expectedPeerPid: workerPeer.peerPid,
  expectedPeerUid: workerPeer.peerUid,
  expectedPeerGid: workerPeer.peerGid,
});
const publicSpki = generateKeyPairSync('ed25519').publicKey.export({
  format: 'der',
  type: 'spki',
});
const root = Object.freeze({
  schemaVersion: 1 as const,
  rootRecordId: 'root:api:carrier-root-local-ipc',
  rootRecordVersion: 1 as const,
  signerKeyId: 'key:api:carrier-root-local-ipc',
  algorithm: 'ED25519' as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY' as const,
  principalRole: 'API_COORDINATOR' as const,
  principalReference: binding.coordinatorPrincipalReference,
  bindingHash,
  publicKeySpkiBase64: publicSpki.toString('base64'),
  publicKeySpkiSha256: createHash('sha256').update(publicSpki).digest('hex'),
  validFrom: new Date(NOW - 1_000).toISOString(),
  validUntil: new Date(NOW + 10_000).toISOString(),
  revokedAt: null,
  testOnly: false,
});

class RootSource implements RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource {
  readonly read = vi.fn(async (): Promise<unknown> => root);
}

class LoopbackClient implements ClosableRetainedNativeSupervisorLocalIpcClient {
  readonly exchange = vi.fn(
    async (
      _path: string,
      requestFrame: Readonly<Uint8Array>,
      signal: AbortSignal,
    ): Promise<unknown> => ({
      endpointBefore: endpoint,
      peerCredentials: apiPeer,
      endpointAfter: endpoint,
      responseFrame: await this.endpointHandler.handle(
        {
          endpointIdentity: endpoint,
          peerCredentials: workerPeer,
          requestFrame: Buffer.from(requestFrame),
        },
        signal,
      ),
    }),
  );
  readonly close = vi.fn(async (): Promise<void> => undefined);

  constructor(
    private readonly endpointHandler: AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler,
  ) {}
}

function outboundAuthorization(
  overrides: Partial<RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransportAuthorization> = {},
) {
  return {
    authority: 'INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT',
    localPrincipalRole: 'WORKER_CLIENT',
    localPrincipalReference: binding.workerPrincipalReference,
    peerPrincipalRole: 'API_COORDINATOR',
    peerPrincipalReference: binding.coordinatorPrincipalReference,
    carrierId: binding.carrierId,
    bindingHash,
    notAfter: binding.expiresAt,
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  } as const;
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

function subject() {
  const roots = new RootSource();
  const protocolHandler =
    new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
      binding,
      roots,
      () => NOW,
    );
  const endpointHandler =
    new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
      protocolHandler,
      binding,
      serverAuthorization,
      () => NOW,
    );
  const client = new LoopbackClient(endpointHandler);
  const transport =
    new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport(
      client,
      binding,
      clientAuthorization,
      () => NOW,
    );
  return { roots, endpointHandler, client, transport };
}

describe('Linux-authenticated topology carrier root lookup transport', () => {
  it('completes the full root protocol only across exact endpoint and SO_PEERCRED evidence', async () => {
    const { roots, client, transport } = subject();
    const worker =
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource(
        binding,
        transport,
        () => NOW,
      );

    await expect(
      worker.read(binding, 'API_COORDINATOR', new AbortController().signal),
    ).resolves.toEqual(root);
    expect(client.exchange).toHaveBeenCalledWith(
      socketPath,
      expect.any(Uint8Array),
      expect.any(AbortSignal),
    );
    expect(client.close).toHaveBeenCalledOnce();
    expect(roots.read).toHaveBeenCalledWith(binding, 'API_COORDINATOR', expect.any(AbortSignal));
  });

  it('denies caller-asserted role, principal, carrier, binding, deadline, and shape drift before IPC', async () => {
    const mutations: Record<string, unknown>[] = [
      { localPrincipalRole: 'API_COORDINATOR' },
      { localPrincipalReference: 'service:worker:other' },
      { peerPrincipalRole: 'WORKER_CLIENT' },
      { peerPrincipalReference: 'service:api:other' },
      { carrierId: 'carrier-other' },
      { bindingHash: '0'.repeat(64) },
      { notAfter: new Date(NOW + 3_999).toISOString() },
      { runtimeConnection: 'CONNECTED' },
      { extra: true },
    ];
    for (const mutation of mutations) {
      const { client, transport } = subject();
      await expect(
        transport.exchange(
          new Uint8Array([1, 2]),
          { ...outboundAuthorization(), ...mutation } as never,
          new AbortController().signal,
        ),
      ).rejects.toEqual(expectCode('INVALID_AUTHORIZATION'));
      expect(client.exchange).not.toHaveBeenCalled();
      await expect(transport.close()).resolves.toBeUndefined();
    }
  });

  it('denies client endpoint replacement or API peer drift and closes after the attempt', async () => {
    for (const drift of [
      { endpointAfter: { ...endpoint, socketInode: endpoint.socketInode + 1 } },
      { peerCredentials: { ...apiPeer, peerPid: apiPeer.peerPid + 1 } },
    ]) {
      const { client, transport } = subject();
      client.exchange.mockResolvedValue({
        endpointBefore: endpoint,
        peerCredentials: apiPeer,
        endpointAfter: endpoint,
        responseFrame: new Uint8Array([1, 2]),
        ...drift,
      });
      await expect(
        transport.exchange(
          new Uint8Array([1, 2]),
          outboundAuthorization(),
          new AbortController().signal,
        ),
      ).rejects.toEqual(expectCode('INVALID_ATTESTATION'));
      await expect(transport.close()).resolves.toBeUndefined();
      expect(client.close).toHaveBeenCalledOnce();
    }
  });

  it('denies worker peer drift before the API root source or protocol parser', async () => {
    const { roots, endpointHandler } = subject();
    await expect(
      endpointHandler.handle(
        {
          endpointIdentity: endpoint,
          peerCredentials: { ...workerPeer, peerUid: workerPeer.peerUid + 1 },
          requestFrame: new Uint8Array([1, 2]),
        },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_ATTESTATION'));
    expect(roots.read).not.toHaveBeenCalled();
  });

  it('rejects deny clients and invalid bindings or IPC authorizations at construction', () => {
    const { endpointHandler } = subject();
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport(
          new DenyRetainedNativeSupervisorLocalIpcClient(),
          binding,
          clientAuthorization,
          () => NOW,
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport(
          new LoopbackClient(endpointHandler),
          { ...binding, runtimeConnection: 'CONNECTED' },
          clientAuthorization,
          () => NOW,
        ),
    ).toThrow(expectCode('INVALID_AUTHORIZATION'));
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport(
          new LoopbackClient(endpointHandler),
          binding,
          { ...clientAuthorization, socketInode: 0 },
          () => NOW,
        ),
    ).toThrow(expectCode('INVALID_AUTHORIZATION'));
  });

  it('lets the bounded worker actively close a non-cooperating native exchange', async () => {
    const { client, transport } = subject();
    client.exchange.mockImplementation(async () => new Promise<never>(() => undefined));
    const worker =
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource(
        binding,
        transport,
        () => NOW,
        100,
      );
    await expect(
      worker.read(binding, 'API_COORDINATOR', new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(client.close).toHaveBeenCalledOnce();
  });
});
