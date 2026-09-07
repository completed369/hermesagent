import { createHash, generateKeyPairSync } from 'node:crypto';

import {
  canonicalJson,
  BoundedLinuxRetainedNativeSupervisorModuleLoader,
  BoundedLinuxRetainedNativeSupervisorServiceOwner,
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler,
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  type LinuxRetainedNativeSupervisorModuleLoadRequest,
  type LinuxRetainedNativeSupervisorServiceRequest,
  type LoadedLinuxRetainedNativeSupervisorListenerModule,
} from '@ventureos/agent-bridge';
import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import { Prisma } from '@ventureos/database';
import { describe, expect, it, vi } from 'vitest';

import {
  createLoadedLinuxNativeTopologyCarrierRootLookupServiceOwner,
  createPostgresApiCoordinatorLinuxLocalTopologyCarrierRootLookupHandler,
  createPostgresApiCoordinatorTopologyCarrierRootLookupHandler,
  loadLinuxNativeTopologyCarrierRootLookupServiceOwner,
  runPostgresApiCoordinatorTopologyCarrierRootLookupServiceOne,
} from './topology-carrier-root-lookup-composition';
import { BoundedLevel3RetainedNativeSupervisorServiceAuthority } from './retained-native-service-authority';
import type { TopologyCarrierSignatureRootSqlClient } from './topology-carrier-signature-root-registry';

vi.mock('@ventureos/database', () => ({
  Prisma: {
    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      return { strings: [...strings], values };
    },
  },
}));

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const binding = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER' as const,
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' as const,
  carrierId: 'carrier-composed-root-lookup',
  coordinatorPrincipalReference: 'service:api:composed-root-lookup',
  workerPrincipalReference: 'service:worker:composed-root-lookup',
  workspaceId: 'workspace-composed-root-lookup',
  supervisorInstanceId: 'supervisor-composed-root-lookup',
  provisioningAttemptId: 'attempt-composed-root-lookup',
  provisioningPlanHash: 'd'.repeat(64),
  issuedAt: new Date(NOW - 100).toISOString(),
  expiresAt: new Date(NOW + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED' as const,
});
const bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding);
const publicSpki = generateKeyPairSync('ed25519').publicKey.export({
  format: 'der',
  type: 'spki',
});
const root = Object.freeze({
  schemaVersion: 1 as const,
  rootRecordId: 'root:api:composed-root-lookup',
  rootRecordVersion: 1 as const,
  signerKeyId: 'key:api:composed-root-lookup',
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
const socketPath = '/run/ventureos/carrier-root-lookup.sock';
const endpoint = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_LSTAT_UNIX_SOCKET',
  fileType: 'SOCKET',
  socketPath,
  socketDevice: 43,
  socketInode: 9_301,
  socketOwnerUid: 700,
  socketOwnerGid: 701,
  socketMode: 0o600,
});
const workerPeer = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_SO_PEERCRED',
  peerPid: 830,
  peerUid: 702,
  peerGid: 703,
});
const serverAuthorization = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  socketPath,
  socketDevice: endpoint.socketDevice,
  socketInode: endpoint.socketInode,
  socketOwnerUid: endpoint.socketOwnerUid,
  socketOwnerGid: endpoint.socketOwnerGid,
  socketMode: endpoint.socketMode,
  expectedPeerPid: workerPeer.peerPid,
  expectedPeerUid: workerPeer.peerUid,
  expectedPeerGid: workerPeer.peerGid,
  runtimeConnection: 'NOT_CONFIGURED',
});

const serviceContext = Object.freeze({
  workspaceId: binding.workspaceId,
  principalId: 'control-plane:carrier-root-listener',
});

function serviceRequest(
  overrides: Partial<LinuxRetainedNativeSupervisorServiceRequest> = {},
): LinuxRetainedNativeSupervisorServiceRequest {
  return {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_ONE_SESSION_SERVICE',
    workspaceId: binding.workspaceId,
    supervisorInstanceId: binding.supervisorInstanceId,
    serviceKind: 'TOPOLOGY_CARRIER_ROOT_LOOKUP_API_LISTENER',
    provisioningId: 'path-provision:carrier-root-listener',
    pathProvisionRequestHash: 'a'.repeat(64),
    pathApprovalEvidenceHash: 'b'.repeat(64),
    socketDirectory: '/run/ventureos',
    socketDirectoryIdentityReference: 'linux:dev-2b:ino-2455',
    socketDirectoryOwnerUid: 700,
    socketDirectoryOwnerGid: 701,
    socketDirectoryMode: 0o700,
    socketPath,
    expectedPeerRole: 'WORKER_CLIENT',
    expectedPeerPid: workerPeer.peerPid,
    expectedPeerUid: workerPeer.peerUid,
    expectedPeerGid: workerPeer.peerGid,
    maximumSessionDurationMs: 2_000,
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  };
}

function serviceAuthority(request: LinuxRetainedNativeSupervisorServiceRequest) {
  return new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
    OperationalEventCapability.issue('CONTROL_PLANE', [
      { ...serviceContext, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]),
    serviceContext,
    request,
    () => NOW,
  );
}

function loadedListenerModule(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    moduleKind: 'LISTENER',
    socketPath,
    runtimeConnection: 'NOT_CONFIGURED',
    nativeModule: {
      abiVersion: 1,
      platform: 'LINUX',
      createOwnedListener: vi.fn(),
    },
    ...overrides,
  };
}

function moduleLoadRequest(
  overrides: Partial<LinuxRetainedNativeSupervisorModuleLoadRequest> = {},
): LinuxRetainedNativeSupervisorModuleLoadRequest {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: 'LISTENER',
    canonicalModulePath: '/opt/ventureos/carrier-root-listener.node',
    socketPath,
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  };
}

class ScriptedSqlClient implements TopologyCarrierSignatureRootSqlClient {
  readonly queries: Prisma.Sql[] = [];

  constructor(private readonly responses: unknown[]) {}

  async $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> {
    this.queries.push(query);
    if (this.responses.length === 0) throw new Error('Unexpected SQL call');
    return this.responses.shift() as T;
  }
}

function request() {
  return {
    protocolVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_ROOT_LOOKUP_REQUEST',
    requesterPrincipalRole: 'WORKER_CLIENT',
    requesterPrincipalReference: binding.workerPrincipalReference,
    requestedPrincipalRole: 'API_COORDINATOR',
    requestedPrincipalReference: binding.coordinatorPrincipalReference,
    carrierId: binding.carrierId,
    binding,
    bindingHash,
    challenge: Buffer.alloc(32, 11).toString('base64url'),
    runtimeConnection: 'NOT_CONFIGURED',
  } as const;
}

function authorization() {
  return {
    authority: 'INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT',
    localPrincipalRole: 'API_COORDINATOR',
    localPrincipalReference: binding.coordinatorPrincipalReference,
    peerPrincipalRole: 'WORKER_CLIENT',
    peerPrincipalReference: binding.workerPrincipalReference,
    carrierId: binding.carrierId,
    bindingHash,
    authenticatedAt: new Date(NOW).toISOString(),
    notAfter: binding.expiresAt,
    runtimeConnection: 'NOT_CONFIGURED',
  } as const;
}

describe('PostgreSQL API coordinator carrier-root lookup composition', () => {
  it('inertly binds one exact loaded listener to the Level-3 carrier-root service owner', () => {
    const request = serviceRequest();
    const loaded = loadedListenerModule();
    const owner = createLoadedLinuxNativeTopologyCarrierRootLookupServiceOwner(
      loaded,
      serviceAuthority(request),
      request,
      () => NOW,
    );

    expect(owner).toBeInstanceOf(BoundedLinuxRetainedNativeSupervisorServiceOwner);
    expect(loaded.nativeModule.createOwnedListener).not.toHaveBeenCalled();
  });

  it('rejects listener envelope, authority purpose, and socket drift before native use', () => {
    const cases: readonly [unknown, LinuxRetainedNativeSupervisorServiceRequest, unknown][] = [
      [loadedListenerModule({ moduleKind: 'CLIENT' }), serviceRequest(), undefined],
      [loadedListenerModule({ runtimeConnection: 'CONNECTED' }), serviceRequest(), undefined],
      [loadedListenerModule({ unexpected: true }), serviceRequest(), undefined],
      [
        loadedListenerModule(),
        serviceRequest({ socketPath: '/run/ventureos/other.sock' }),
        undefined,
      ],
      [loadedListenerModule(), serviceRequest({ serviceKind: 'RECOVERY' }), undefined],
      [loadedListenerModule(), serviceRequest(), {}],
    ];

    for (const [loaded, request, authorityOverride] of cases) {
      const native = (loaded as ReturnType<typeof loadedListenerModule>).nativeModule;
      expect(() =>
        createLoadedLinuxNativeTopologyCarrierRootLookupServiceOwner(
          loaded,
          (authorityOverride ??
            serviceAuthority(request)) as BoundedLevel3RetainedNativeSupervisorServiceAuthority,
          request,
          () => NOW,
        ),
      ).toThrow();
      expect(native.createOwnedListener).not.toHaveBeenCalled();
    }

    const native = loadedListenerModule().nativeModule;
    let getterCalls = 0;
    const accessorEnvelope = loadedListenerModule() as Record<string, unknown>;
    Object.defineProperty(accessorEnvelope, 'nativeModule', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return native;
      },
    });
    const request = serviceRequest();
    expect(() =>
      createLoadedLinuxNativeTopologyCarrierRootLookupServiceOwner(
        accessorEnvelope,
        serviceAuthority(request),
        request,
        () => NOW,
      ),
    ).toThrow();
    expect(getterCalls).toBe(0);
    expect(native.createOwnedListener).not.toHaveBeenCalled();
  });

  it('loads one exact listener request before inert service-owner construction', async () => {
    const loaded = loadedListenerModule();
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const load = vi
      .spyOn(loader, 'load')
      .mockResolvedValue(
        loaded as unknown as Readonly<LoadedLinuxRetainedNativeSupervisorListenerModule>,
      );
    const request = serviceRequest();
    const loadRequest = moduleLoadRequest();
    const signal = new AbortController().signal;

    const owner = await loadLinuxNativeTopologyCarrierRootLookupServiceOwner(
      loader,
      loadRequest,
      signal,
      serviceAuthority(request),
      request,
      () => NOW,
    );

    expect(owner).toBeInstanceOf(BoundedLinuxRetainedNativeSupervisorServiceOwner);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(loadRequest, signal);
    expect(loaded.nativeModule.createOwnedListener).not.toHaveBeenCalled();
  });

  it('denies loader, request, purpose, socket, and cancellation drift before loading', async () => {
    const request = serviceRequest();
    const cases: readonly [
      unknown,
      LinuxRetainedNativeSupervisorModuleLoadRequest,
      AbortSignal,
      unknown,
      LinuxRetainedNativeSupervisorServiceRequest,
    ][] = [
      [{}, moduleLoadRequest(), new AbortController().signal, serviceAuthority(request), request],
      [
        new BoundedLinuxRetainedNativeSupervisorModuleLoader(),
        moduleLoadRequest({ moduleKind: 'CLIENT' }),
        new AbortController().signal,
        serviceAuthority(request),
        request,
      ],
      [
        new BoundedLinuxRetainedNativeSupervisorModuleLoader(),
        moduleLoadRequest(),
        AbortSignal.abort(),
        serviceAuthority(request),
        request,
      ],
      [
        new BoundedLinuxRetainedNativeSupervisorModuleLoader(),
        moduleLoadRequest(),
        new AbortController().signal,
        {},
        request,
      ],
      [
        new BoundedLinuxRetainedNativeSupervisorModuleLoader(),
        moduleLoadRequest(),
        new AbortController().signal,
        serviceAuthority(request),
        serviceRequest({ serviceKind: 'RECOVERY' }),
      ],
      [
        new BoundedLinuxRetainedNativeSupervisorModuleLoader(),
        moduleLoadRequest({ socketPath: '/run/ventureos/other.sock' }),
        new AbortController().signal,
        serviceAuthority(request),
        request,
      ],
    ];

    for (const [candidateLoader, loadRequest, signal, authority, service] of cases) {
      const load =
        candidateLoader instanceof BoundedLinuxRetainedNativeSupervisorModuleLoader
          ? vi.spyOn(candidateLoader, 'load')
          : undefined;
      await expect(
        loadLinuxNativeTopologyCarrierRootLookupServiceOwner(
          candidateLoader as BoundedLinuxRetainedNativeSupervisorModuleLoader,
          loadRequest,
          signal,
          authority as BoundedLevel3RetainedNativeSupervisorServiceAuthority,
          service,
          () => NOW,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
      if (load !== undefined) expect(load).not.toHaveBeenCalled();
    }
  });

  it('rechecks cancellation and the loaded envelope after loader consumption', async () => {
    const request = serviceRequest();
    const loaded = loadedListenerModule();
    const controller = new AbortController();
    const cancelledLoader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const cancelledLoad = vi.spyOn(cancelledLoader, 'load').mockImplementation(async () => {
      controller.abort();
      return loaded as unknown as Readonly<LoadedLinuxRetainedNativeSupervisorListenerModule>;
    });
    await expect(
      loadLinuxNativeTopologyCarrierRootLookupServiceOwner(
        cancelledLoader,
        moduleLoadRequest(),
        controller.signal,
        serviceAuthority(request),
        request,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(cancelledLoad).toHaveBeenCalledOnce();

    const driftedLoader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const driftedLoad = vi.spyOn(driftedLoader, 'load').mockResolvedValue({
      ...(loaded as unknown as Readonly<LoadedLinuxRetainedNativeSupervisorListenerModule>),
      socketPath: '/run/ventureos/substituted.sock',
    });
    await expect(
      loadLinuxNativeTopologyCarrierRootLookupServiceOwner(
        driftedLoader,
        moduleLoadRequest(),
        new AbortController().signal,
        serviceAuthority(request),
        request,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(driftedLoad).toHaveBeenCalledOnce();
    expect(loaded.nativeModule.createOwnedListener).not.toHaveBeenCalled();
  });

  it('joins one exact live carrier and durable root handler to an injected service owner', async () => {
    const request = serviceRequest();
    const owner = createLoadedLinuxNativeTopologyCarrierRootLookupServiceOwner(
      loadedListenerModule(),
      serviceAuthority(request),
      request,
      () => NOW,
    );
    const run = vi.spyOn(owner, 'runTopologyCarrierRootLookupOne').mockResolvedValue();
    const database = new ScriptedSqlClient([]);
    const signal = new AbortController().signal;

    await runPostgresApiCoordinatorTopologyCarrierRootLookupServiceOne(
      owner,
      database,
      request,
      binding,
      signal,
      () => NOW,
    );

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      request,
      expect.any(
        BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler,
      ),
      binding,
      signal,
    );
    expect(database.queries).toHaveLength(0);
  });

  it('denies carrier scope and cancellation before consuming the service owner', async () => {
    const request = serviceRequest();
    const owner = createLoadedLinuxNativeTopologyCarrierRootLookupServiceOwner(
      loadedListenerModule(),
      serviceAuthority(request),
      request,
      () => NOW,
    );
    const run = vi.spyOn(owner, 'runTopologyCarrierRootLookupOne');
    const database = new ScriptedSqlClient([]);

    await expect(
      runPostgresApiCoordinatorTopologyCarrierRootLookupServiceOne(
        owner,
        database,
        serviceRequest({ workspaceId: 'workspace-other' }),
        binding,
        new AbortController().signal,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    await expect(
      runPostgresApiCoordinatorTopologyCarrierRootLookupServiceOne(
        owner,
        database,
        request,
        binding,
        AbortSignal.abort(),
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(run).not.toHaveBeenCalled();
    expect(database.queries).toHaveLength(0);
  });

  it('is inert at construction and releases only the exact coordinator root after authentication', async () => {
    const database = new ScriptedSqlClient([
      [
        {
          ...root,
          validFrom: new Date(root.validFrom),
          validUntil: new Date(root.validUntil),
        },
      ],
    ]);
    const handler = createPostgresApiCoordinatorTopologyCarrierRootLookupHandler(
      database,
      binding,
      () => NOW,
    );
    expect(database.queries).toHaveLength(0);

    const exactRequest = request();
    const response = await handler.handle(
      new TextEncoder().encode(canonicalJson(exactRequest)),
      authorization(),
      new AbortController().signal,
    );
    expect(JSON.parse(new TextDecoder().decode(response))).toMatchObject({
      purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_ROOT_LOOKUP_RESPONSE',
      requestHash: createHash('sha256').update(canonicalJson(exactRequest)).digest('hex'),
      root,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]!.values).toContain('API_COORDINATOR');
    await expect(
      handler.handle(
        new TextEncoder().encode(canonicalJson(exactRequest)),
        authorization(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(database.queries).toHaveLength(1);
  });

  it('fails closed on invalid durable access, binding, clock, or timeout before database use', () => {
    const database = new ScriptedSqlClient([]);
    const cases: readonly [unknown, unknown, unknown, unknown][] = [
      [null, binding, () => NOW, 2_000],
      [database, { ...binding, runtimeConnection: 'CONNECTED' }, () => NOW, 2_000],
      [database, binding, () => Number.NaN, 2_000],
      [database, binding, () => NOW, 99],
    ];
    for (const [candidateDatabase, candidateBinding, clock, timeoutMs] of cases) {
      expect(() =>
        createPostgresApiCoordinatorTopologyCarrierRootLookupHandler(
          candidateDatabase as TopologyCarrierSignatureRootSqlClient,
          candidateBinding,
          clock as () => number,
          timeoutMs as number,
        ),
      ).toThrow();
    }
    expect(database.queries).toHaveLength(0);
  });

  it('derives protocol identity from exact Linux endpoint and worker peer evidence before lookup', async () => {
    const storedRoot = {
      ...root,
      validFrom: new Date(root.validFrom),
      validUntil: new Date(root.validUntil),
    };
    const database = new ScriptedSqlClient([[storedRoot]]);
    const handler = createPostgresApiCoordinatorLinuxLocalTopologyCarrierRootLookupHandler(
      database,
      binding,
      serverAuthorization,
      () => NOW,
    );
    expect(database.queries).toHaveLength(0);
    const exactRequest = request();
    const response = await handler.handle(
      {
        endpointIdentity: endpoint,
        peerCredentials: workerPeer,
        requestFrame: Buffer.from(canonicalJson(exactRequest)),
      },
      new AbortController().signal,
    );
    expect(JSON.parse(new TextDecoder().decode(response))).toMatchObject({
      root,
      requestHash: createHash('sha256').update(canonicalJson(exactRequest)).digest('hex'),
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(database.queries).toHaveLength(1);

    const deniedDatabase = new ScriptedSqlClient([[storedRoot]]);
    const deniedHandler = createPostgresApiCoordinatorLinuxLocalTopologyCarrierRootLookupHandler(
      deniedDatabase,
      binding,
      serverAuthorization,
      () => NOW,
    );
    await expect(
      deniedHandler.handle(
        {
          endpointIdentity: endpoint,
          peerCredentials: { ...workerPeer, peerUid: workerPeer.peerUid + 1 },
          requestFrame: Buffer.from(canonicalJson(exactRequest)),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(deniedDatabase.queries).toHaveLength(0);
  });
});
