import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import {
  AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority,
  BoundedLinuxRetainedNativeSupervisorModuleLoader,
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
  BoundedRetainedNativeSupervisorWorkerServiceAuthorityCoordinatorHandler,
  canonicalJson,
  DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  Ed25519RetainedNativeSupervisorTopologyObservationCoordinatorEndpoint,
  linuxRetainedNativeSupervisorServiceRequestHash,
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  type LinuxRetainedNativeSupervisorModuleLoadRequest,
  type LinuxRetainedNativeSupervisorServiceAuthority,
  type LinuxRetainedNativeSupervisorServiceGrant,
  type RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  type RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport,
  type RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransportAuthorization,
} from '@ventureos/agent-bridge';
import { describe, expect, it, vi } from 'vitest';

import {
  createLoadedLinuxNativeWorkerServiceAuthority,
  loadLinuxNativeWorkerServiceAuthority,
} from './worker-service-authority-client-composition';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const authoritySocketPath = '/run/ventureos/worker-service-authority.sock';
const binding = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER' as const,
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' as const,
  carrierId: 'carrier-worker-authority-client-composition',
  coordinatorPrincipalReference: 'service:api:worker-authority-client',
  workerPrincipalReference: 'service:worker:worker-authority-client',
  workspaceId: 'workspace-worker-authority-client',
  supervisorInstanceId: 'supervisor-worker-authority-client',
  provisioningAttemptId: 'attempt-worker-authority-client',
  provisioningPlanHash: 'a'.repeat(64),
  issuedAt: new Date(NOW - 100).toISOString(),
  expiresAt: new Date(NOW + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED' as const,
});
const localAuthorization = Object.freeze({
  schemaVersion: 1 as const,
  platform: 'LINUX' as const,
  socketPath: authoritySocketPath,
  socketDevice: 61,
  socketInode: 9_461,
  socketOwnerUid: 700,
  socketOwnerGid: 701,
  socketMode: 0o600,
  expectedPeerPid: 861,
  expectedPeerUid: 702,
  expectedPeerGid: 703,
  runtimeConnection: 'NOT_CONFIGURED' as const,
});
const serviceRequest = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_ONE_SESSION_SERVICE' as const,
  workspaceId: binding.workspaceId,
  supervisorInstanceId: binding.supervisorInstanceId,
  serviceKind: 'TOPOLOGY_CARRIER_WORKER_LISTENER' as const,
  provisioningId: 'path-provision:worker-carrier',
  pathProvisionRequestHash: 'b'.repeat(64),
  pathApprovalEvidenceHash: 'c'.repeat(64),
  socketDirectory: '/run/ventureos',
  socketDirectoryIdentityReference: 'linux:dev-2b:ino-2461',
  socketDirectoryOwnerUid: 704,
  socketDirectoryOwnerGid: 705,
  socketDirectoryMode: 0o700,
  socketPath: '/run/ventureos/topology-carrier-worker.sock',
  expectedPeerRole: 'API_COORDINATOR' as const,
  expectedPeerPid: 862,
  expectedPeerUid: 706,
  expectedPeerGid: 707,
  maximumSessionDurationMs: 2_000,
  runtimeConnection: 'NOT_CONFIGURED' as const,
});

function code(value: string) {
  return expect.objectContaining({ code: value });
}

function keyFixture(role: 'API_COORDINATOR' | 'WORKER_CLIENT', principalReference: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const signerKeyId = `key:${role.toLowerCase()}:worker-authority-client`;
  const root = Object.freeze({
    schemaVersion: 1,
    rootRecordId: `root:${role.toLowerCase()}:worker-authority-client`,
    rootRecordVersion: 1,
    signerKeyId,
    algorithm: 'ED25519',
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY',
    principalRole: role,
    principalReference,
    bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
    publicKeySpkiBase64: spki.toString('base64'),
    publicKeySpkiSha256: createHash('sha256').update(spki).digest('hex'),
    validFrom: new Date(NOW - 1_000).toISOString(),
    validUntil: new Date(NOW + 10_000).toISOString(),
    revokedAt: null,
    testOnly: false,
  } as const);
  const signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner = {
    sign: vi.fn(async (payload: unknown) => {
      const serialized = canonicalJson(payload);
      return {
        algorithm: 'ED25519',
        signerKeyId,
        payloadHash: createHash('sha256').update(serialized).digest('hex'),
        signature: sign(null, Buffer.from(serialized), privateKey).toString('base64'),
      };
    }),
  };
  return { root, signer };
}

function grant(): LinuxRetainedNativeSupervisorServiceGrant {
  return {
    ...serviceRequest,
    serviceRunId: 'native-supervisor-service:worker-authority-client',
    requestHash: linuxRetainedNativeSupervisorServiceRequestHash(serviceRequest),
    approvalId: 'level3-control-plane:worker-authority-client',
    approvalEvidenceHash: 'd'.repeat(64),
    authorizedByReference: 'founder:one',
    authorityLevel: 3,
    validFrom: new Date(NOW - 100).toISOString(),
    validUntil: new Date(NOW + 3_000).toISOString(),
  };
}

function endpointEvidence() {
  return {
    fileType: 'SOCKET',
    device: localAuthorization.socketDevice,
    inode: localAuthorization.socketInode,
    ownerUid: localAuthorization.socketOwnerUid,
    ownerGid: localAuthorization.socketOwnerGid,
    mode: localAuthorization.socketMode,
  };
}

function nativeModule(
  endpoint?: BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
  endpointDrift: Record<string, unknown> = {},
  peerDrift: Record<string, unknown> = {},
) {
  let requestFrame: Uint8Array | undefined;
  const connection = {
    peerCredentials: vi.fn(async () => ({
      pid: localAuthorization.expectedPeerPid,
      uid: localAuthorization.expectedPeerUid,
      gid: localAuthorization.expectedPeerGid,
      ...peerDrift,
    })),
    writeAndShutdown: vi.fn(async (input: Uint8Array) => {
      requestFrame = Uint8Array.from(input);
    }),
    readToEof: vi.fn(async (_maximumBytes: number, signal: AbortSignal) => {
      if (!endpoint || !requestFrame) throw new Error('No endpoint configured');
      return endpoint.handle(requestFrame, signal);
    }),
    close: vi.fn(async () => undefined),
  };
  const native = {
    abiVersion: 1 as const,
    platform: 'LINUX' as const,
    lstatUnixSocket: vi.fn(async () => ({ ...endpointEvidence(), ...endpointDrift })),
    connectUnixSocket: vi.fn(async () => connection),
  };
  return { connection, native };
}

function loaded(native: ReturnType<typeof nativeModule>['native'], overrides = {}) {
  return {
    schemaVersion: 1,
    moduleKind: 'CLIENT',
    socketPath: authoritySocketPath,
    runtimeConnection: 'NOT_CONFIGURED',
    nativeModule: native,
    ...overrides,
  };
}

function loadRequest(
  overrides: Partial<LinuxRetainedNativeSupervisorModuleLoadRequest> = {},
): LinuxRetainedNativeSupervisorModuleLoadRequest {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: 'CLIENT',
    canonicalModulePath: '/opt/ventureos/worker-service-authority-client.node',
    socketPath: authoritySocketPath,
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  };
}

function rootResponse(request: Record<string, unknown>, root: unknown) {
  return new TextEncoder().encode(
    canonicalJson({
      protocolVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_ROOT_LOOKUP_RESPONSE',
      requesterPrincipalRole: request.requesterPrincipalRole,
      requesterPrincipalReference: request.requesterPrincipalReference,
      requestedPrincipalRole: request.requestedPrincipalRole,
      requestedPrincipalReference: request.requestedPrincipalReference,
      carrierId: request.carrierId,
      bindingHash: request.bindingHash,
      challenge: request.challenge,
      requestHash: createHash('sha256').update(canonicalJson(request)).digest('hex'),
      root,
      runtimeConnection: 'NOT_CONFIGURED',
    }),
  );
}

class RootTransport implements RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport {
  readonly close = vi.fn(async () => undefined);
  readonly exchange = vi.fn(
    async (
      bytes: Uint8Array,
      _authorization: Readonly<RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransportAuthorization>,
      _signal: AbortSignal,
    ) => {
      const request = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      return rootResponse(request, this.root);
    },
  );
  constructor(private readonly root: unknown) {}
}

describe('worker service-authority native client composition', () => {
  it('is inert until the returned one-shot authority is invoked', () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    const fixture = nativeModule();
    const authority = createLoadedLinuxNativeWorkerServiceAuthority(
      loaded(fixture.native),
      localAuthorization,
      worker.signer,
      api.root,
      serviceRequest,
      binding,
      new AbortController().signal,
      () => NOW,
    );
    expect(authority).toBeInstanceOf(
      AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority,
    );
    expect(fixture.native.lstatUnixSocket).not.toHaveBeenCalled();
    expect(fixture.native.connectUnixSocket).not.toHaveBeenCalled();
    expect(worker.signer.sign).not.toHaveBeenCalled();
  });

  it('obtains one exact fresh grant through native kernel evidence and mutual signatures', async () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    const issuer: LinuxRetainedNativeSupervisorServiceAuthority = {
      authorize: vi.fn(async () => grant()),
    };
    const handler = new BoundedRetainedNativeSupervisorWorkerServiceAuthorityCoordinatorHandler(
      issuer,
      serviceRequest,
      binding,
      () => NOW,
    );
    const endpoint =
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
        new Ed25519RetainedNativeSupervisorTopologyObservationCoordinatorEndpoint(
          handler,
          api.signer,
          worker.root,
          binding,
          () => NOW,
        ),
      );
    const fixture = nativeModule(endpoint);
    const authority = createLoadedLinuxNativeWorkerServiceAuthority(
      loaded(fixture.native),
      localAuthorization,
      worker.signer,
      api.root,
      serviceRequest,
      binding,
      new AbortController().signal,
      () => NOW,
    );

    await expect(authority.authorize(serviceRequest)).resolves.toEqual(grant());
    expect(fixture.native.lstatUnixSocket).toHaveBeenCalledTimes(2);
    expect(fixture.native.connectUnixSocket).toHaveBeenCalledOnce();
    expect(fixture.connection.peerCredentials).toHaveBeenCalledOnce();
    expect(fixture.connection.close).toHaveBeenCalledOnce();
    expect(worker.signer.sign).toHaveBeenCalledOnce();
    expect(api.signer.sign).toHaveBeenCalledOnce();
    expect(issuer.authorize).toHaveBeenCalledWith(serviceRequest);
  });

  it('denies envelope, socket, scope, signer, cancellation, and timeout drift before native use', () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    const candidates: ReadonlyArray<
      readonly [unknown, unknown, unknown, unknown, AbortSignal, number]
    > = [
      [
        loaded(nativeModule().native, { unexpected: true }),
        localAuthorization,
        worker.signer,
        serviceRequest,
        new AbortController().signal,
        2_000,
      ],
      [
        loaded(nativeModule().native),
        { ...localAuthorization, socketPath: '/run/ventureos/drift.sock' },
        worker.signer,
        serviceRequest,
        new AbortController().signal,
        2_000,
      ],
      [
        loaded(nativeModule().native),
        localAuthorization,
        worker.signer,
        { ...serviceRequest, workspaceId: 'workspace-other' },
        new AbortController().signal,
        2_000,
      ],
      [
        loaded(nativeModule().native),
        localAuthorization,
        new DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(),
        serviceRequest,
        new AbortController().signal,
        2_000,
      ],
      [
        loaded(nativeModule().native),
        localAuthorization,
        worker.signer,
        serviceRequest,
        AbortSignal.abort(),
        2_000,
      ],
      [
        loaded(nativeModule().native),
        localAuthorization,
        worker.signer,
        serviceRequest,
        new AbortController().signal,
        99,
      ],
    ];
    for (const [candidate, authorization, signer, request, signal, timeoutMs] of candidates) {
      expect(() =>
        createLoadedLinuxNativeWorkerServiceAuthority(
          candidate,
          authorization,
          signer as RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
          api.root,
          request,
          binding,
          signal,
          () => NOW,
          timeoutMs,
        ),
      ).toThrow(code('INVALID_AUTHORIZATION'));
      const module = (candidate as { nativeModule?: ReturnType<typeof nativeModule>['native'] })
        .nativeModule;
      expect(module?.lstatUnixSocket).not.toHaveBeenCalled();
      expect(module?.connectUnixSocket).not.toHaveBeenCalled();
    }
  });

  it('rejects kernel endpoint drift before opening a connection or reaching the API issuer', async () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    const issuer: LinuxRetainedNativeSupervisorServiceAuthority = {
      authorize: vi.fn(async () => grant()),
    };
    const handler = new BoundedRetainedNativeSupervisorWorkerServiceAuthorityCoordinatorHandler(
      issuer,
      serviceRequest,
      binding,
      () => NOW,
    );
    const endpoint =
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
        new Ed25519RetainedNativeSupervisorTopologyObservationCoordinatorEndpoint(
          handler,
          api.signer,
          worker.root,
          binding,
          () => NOW,
        ),
      );
    const fixture = nativeModule(endpoint, { inode: localAuthorization.socketInode + 1 });
    const authority = createLoadedLinuxNativeWorkerServiceAuthority(
      loaded(fixture.native),
      localAuthorization,
      worker.signer,
      api.root,
      serviceRequest,
      binding,
      new AbortController().signal,
      () => NOW,
    );
    await expect(authority.authorize(serviceRequest)).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(issuer.authorize).not.toHaveBeenCalled();
    expect(fixture.native.connectUnixSocket).not.toHaveBeenCalled();
    expect(fixture.connection.close).not.toHaveBeenCalled();
  });

  it('rejects peer-credential drift before writing grant-request bytes and closes the connection', async () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    const issuer: LinuxRetainedNativeSupervisorServiceAuthority = {
      authorize: vi.fn(async () => grant()),
    };
    const handler = new BoundedRetainedNativeSupervisorWorkerServiceAuthorityCoordinatorHandler(
      issuer,
      serviceRequest,
      binding,
      () => NOW,
    );
    const endpoint =
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
        new Ed25519RetainedNativeSupervisorTopologyObservationCoordinatorEndpoint(
          handler,
          api.signer,
          worker.root,
          binding,
          () => NOW,
        ),
      );
    const fixture = nativeModule(endpoint, {}, { uid: localAuthorization.expectedPeerUid + 1 });
    const authority = createLoadedLinuxNativeWorkerServiceAuthority(
      loaded(fixture.native),
      localAuthorization,
      worker.signer,
      api.root,
      serviceRequest,
      binding,
      new AbortController().signal,
      () => NOW,
    );
    await expect(authority.authorize(serviceRequest)).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(fixture.connection.writeAndShutdown).not.toHaveBeenCalled();
    expect(issuer.authorize).not.toHaveBeenCalled();
    expect(fixture.connection.close).toHaveBeenCalledOnce();
  });

  it('resolves only the API root and loads one exact client without opening the authority socket', async () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    const rootTransport = new RootTransport(api.root);
    const source =
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource(
        binding,
        rootTransport,
        () => NOW,
      );
    const fixture = nativeModule();
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const load = vi
      .spyOn(BoundedLinuxRetainedNativeSupervisorModuleLoader.prototype, 'load')
      .mockResolvedValue(loaded(fixture.native) as never);
    const signal = new AbortController().signal;
    await expect(
      loadLinuxNativeWorkerServiceAuthority(
        loader,
        loadRequest(),
        source,
        localAuthorization,
        worker.signer,
        serviceRequest,
        binding,
        signal,
        () => NOW,
      ),
    ).resolves.toBeInstanceOf(
      AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority,
    );
    expect(rootTransport.exchange).toHaveBeenCalledOnce();
    expect(rootTransport.close).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(loadRequest(), signal);
    expect(fixture.native.lstatUnixSocket).not.toHaveBeenCalled();
    expect(fixture.native.connectUnixSocket).not.toHaveBeenCalled();
    load.mockRestore();
  });

  it('denies malformed loading inputs before consuming the root source or loader', async () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    for (const [request, authorization, signer, signal, timeoutMs] of [
      [
        loadRequest({ moduleKind: 'LISTENER' }),
        localAuthorization,
        worker.signer,
        new AbortController().signal,
        2_000,
      ],
      [
        loadRequest(),
        { ...localAuthorization, socketPath: '/run/ventureos/drift.sock' },
        worker.signer,
        new AbortController().signal,
        2_000,
      ],
      [
        loadRequest(),
        localAuthorization,
        new DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(),
        new AbortController().signal,
        2_000,
      ],
      [loadRequest(), localAuthorization, worker.signer, AbortSignal.abort(), 2_000],
      [loadRequest(), localAuthorization, worker.signer, new AbortController().signal, 5_001],
    ] as const) {
      const transport = new RootTransport(api.root);
      const source =
        new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource(
          binding,
          transport,
          () => NOW,
        );
      const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
      const load = vi.spyOn(BoundedLinuxRetainedNativeSupervisorModuleLoader.prototype, 'load');
      await expect(
        loadLinuxNativeWorkerServiceAuthority(
          loader,
          request,
          source,
          authorization,
          signer,
          serviceRequest,
          binding,
          signal,
          () => NOW,
          timeoutMs,
        ),
      ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
      expect(transport.exchange).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
      load.mockRestore();
    }
  });

  it('normalizes root failure and source prototype forgery before loading a client', async () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    for (const source of [
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource(
        binding,
        new RootTransport({ ...api.root, principalRole: 'WORKER_CLIENT' }),
        () => NOW,
      ),
      Object.create(
        BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource.prototype,
      ) as BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
    ]) {
      const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
      const load = vi.spyOn(BoundedLinuxRetainedNativeSupervisorModuleLoader.prototype, 'load');
      await expect(
        loadLinuxNativeWorkerServiceAuthority(
          loader,
          loadRequest(),
          source,
          localAuthorization,
          worker.signer,
          serviceRequest,
          binding,
          new AbortController().signal,
          () => NOW,
        ),
      ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
      expect(load).not.toHaveBeenCalled();
      load.mockRestore();
    }
  });

  it('normalizes a malformed loaded client after closing the consumed root source', async () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    const transport = new RootTransport(api.root);
    const source =
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource(
        binding,
        transport,
        () => NOW,
      );
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const load = vi
      .spyOn(BoundedLinuxRetainedNativeSupervisorModuleLoader.prototype, 'load')
      .mockResolvedValue({
        ...loaded(nativeModule().native),
        runtimeConnection: 'CONNECTED',
      } as never);
    await expect(
      loadLinuxNativeWorkerServiceAuthority(
        loader,
        loadRequest(),
        source,
        localAuthorization,
        worker.signer,
        serviceRequest,
        binding,
        new AbortController().signal,
        () => NOW,
      ),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
    expect(transport.close).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    load.mockRestore();
  });
});
