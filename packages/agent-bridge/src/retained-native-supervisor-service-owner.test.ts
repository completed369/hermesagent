import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import type {
  LinuxRetainedNativeSupervisorListenerCreationRequest,
  LinuxRetainedNativeSupervisorListenerLifecycleBinding,
  LinuxRetainedNativeSupervisorOwnedListener,
} from './retained-native-supervisor-listener-lifecycle';
import type {
  LinuxRetainedNativeSupervisorAcceptedSession,
  LinuxRetainedNativeSupervisorWorkerCredentials,
} from './retained-native-supervisor-linux-session';
import {
  DenyRetainedNativeSupervisorRecoveryTransport,
  type RetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';
import {
  BoundedLinuxRetainedNativeSupervisorServiceOwner,
  DenyLinuxRetainedNativeSupervisorServiceAuthority,
  linuxRetainedNativeSupervisorServiceRequestHash,
  type LinuxRetainedNativeSupervisorServiceAuthority,
  type LinuxRetainedNativeSupervisorServiceGrant,
  type LinuxRetainedNativeSupervisorServiceRequest,
} from './retained-native-supervisor-service-owner';
import {
  DenyLinuxRetainedNativeSupervisorTopologyObservationPort,
  linuxRetainedNativeSupervisorTopologyObservationRequestHash,
  type LinuxRetainedNativeSupervisorTopologyObservationPort,
  type LinuxRetainedNativeSupervisorTopologyObservationRequest,
  type LinuxRetainedNativeSupervisorTopologyObserverRole,
} from './retained-native-supervisor-shared-runtime-topology';

const now = Date.parse('2026-09-06T10:00:00.000Z');
const socketPath = '/run/ventureos/supervisor/recovery.sock';
const parentIdentity = Object.freeze({
  fileType: 'DIRECTORY',
  device: 0x28,
  inode: 0x1f40,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o700,
});
const listenerIdentity = Object.freeze({
  fileType: 'SOCKET',
  device: 41,
  inode: 9001,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o600,
});
const workerCredentials: Readonly<LinuxRetainedNativeSupervisorWorkerCredentials> = Object.freeze({
  pid: 811,
  uid: 710,
  gid: 711,
});
const recoveryRequest = Object.freeze({
  schemaVersion: 1,
  requestId: 'native-service-request',
  requestHash: 'a'.repeat(64),
  challengeNonce: 'native-service-challenge',
  runtimeConnection: 'NOT_CONFIGURED',
}) as unknown as Readonly<RetainedNativeSupervisorRecoveryRequest>;
const recoveryResponse = Object.freeze({
  schemaVersion: 1,
  responseId: 'native-service-response',
  requestId: recoveryRequest.requestId,
  requestHash: recoveryRequest.requestHash,
  runtimeConnection: 'NOT_CONFIGURED',
});

function request(
  drift: Partial<LinuxRetainedNativeSupervisorServiceRequest> = {},
): LinuxRetainedNativeSupervisorServiceRequest {
  return {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_ONE_SESSION_SERVICE',
    workspaceId: 'workspace-native-service',
    supervisorInstanceId: 'supervisor-native-service',
    serviceKind: 'RECOVERY',
    provisioningId: 'provisioning-native-service',
    pathProvisionRequestHash: 'b'.repeat(64),
    pathApprovalEvidenceHash: 'c'.repeat(64),
    socketDirectory: '/run/ventureos/supervisor',
    socketDirectoryIdentityReference: 'linux:dev-28:ino-1f40',
    socketDirectoryOwnerUid: parentIdentity.ownerUid,
    socketDirectoryOwnerGid: parentIdentity.ownerGid,
    socketDirectoryMode: 0o700,
    socketPath,
    expectedWorkerPid: workerCredentials.pid,
    expectedWorkerUid: workerCredentials.uid,
    expectedWorkerGid: workerCredentials.gid,
    maximumSessionDurationMs: 2_000,
    runtimeConnection: 'NOT_CONFIGURED',
    ...drift,
  };
}

function grant(
  serviceRequest: LinuxRetainedNativeSupervisorServiceRequest,
  drift: Partial<LinuxRetainedNativeSupervisorServiceGrant> = {},
): LinuxRetainedNativeSupervisorServiceGrant {
  return {
    ...serviceRequest,
    serviceRunId: 'service-run-native',
    requestHash: linuxRetainedNativeSupervisorServiceRequestHash(serviceRequest),
    approvalId: 'approval-native-service',
    approvalEvidenceHash: 'd'.repeat(64),
    authorizedByReference: 'operator-native-service',
    authorityLevel: 3,
    validFrom: new Date(now - 1_000).toISOString(),
    validUntil: new Date(now + 30_000).toISOString(),
    ...drift,
  };
}

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

function topologyRequest(
  observerRole: LinuxRetainedNativeSupervisorTopologyObserverRole,
): LinuxRetainedNativeSupervisorTopologyObservationRequest {
  return {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION',
    observerRole,
    workspaceId: 'workspace-native-service',
    supervisorInstanceId: 'supervisor-native-service',
    provisioningAttemptId: 'attempt-native-service',
    provisioningPlanHash: 'e'.repeat(64),
    platform: 'LINUX',
    architecture: 'X64',
    runtimeRootParent: '/var/lib/ventureos/runtime/workspace-native-service',
    runtimeRootParentIdentityReference: 'linux:dev-28:ino-1f40',
    runtimeRootParentOwnerUid: parentIdentity.ownerUid,
    runtimeRootParentOwnerGid: parentIdentity.ownerGid,
    runtimeRootParentMode: 0o700,
    sourceModulePath:
      observerRole === 'API_LISTENER'
        ? '/usr/lib/ventureos/native/linux-retained-native-listener.node'
        : '/usr/lib/ventureos/native/linux-retained-native-client.node',
    sourceModuleSha256: 'f'.repeat(64),
    sourceModuleIdentityReference: 'linux:dev-29:ino-2329',
    sourceModuleOwnerUid: 0,
    sourceModuleOwnerGid: 0,
    sourceModuleMode: 0o444,
    sourceModuleSizeBytes: 4096,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function topologyObservation(request: LinuxRetainedNativeSupervisorTopologyObservationRequest) {
  return {
    ...request,
    observationId: `observation-${request.observerRole.toLowerCase()}`,
    requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(request),
    evidenceAuthority: 'LINUX_RETAINED_DESCRIPTORS',
    principalAuthority: 'LINUX_EFFECTIVE_IDENTITY',
    observerUid: request.runtimeRootParentOwnerUid,
    observerGid: request.runtimeRootParentOwnerGid,
    observedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 4_000).toISOString(),
    topologyState: 'VISIBLE_NOT_PROVISIONED',
  };
}

function topologyFrame(
  direction: 'COORDINATOR_TO_OBSERVER' | 'OBSERVER_TO_COORDINATOR',
  request: LinuxRetainedNativeSupervisorTopologyObservationRequest,
  message: unknown,
): Buffer {
  return Buffer.from(
    `${canonicalJson({
      schemaVersion: 1,
      protocol: 'VENTUREOS_RETAINED_NATIVE_TOPOLOGY_OBSERVATION_IPC',
      direction,
      observerRole: request.observerRole,
      requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(request),
      message,
      runtimeConnection: 'NOT_CONFIGURED',
    })}\n`,
  );
}

class FixtureAcceptedSession implements LinuxRetainedNativeSupervisorAcceptedSession {
  readonly peerCredentials = vi.fn(async () => workerCredentials);
  readonly readToEof = vi.fn(async () => frame('WORKER_TO_SUPERVISOR', recoveryRequest));
  readonly writeAndShutdown = vi.fn(
    async (_frame: Readonly<Uint8Array>, _signal: AbortSignal) => undefined,
  );
  readonly close = vi.fn(async () => undefined);
}

class FixtureOwnedListener implements LinuxRetainedNativeSupervisorOwnedListener {
  readonly platform = 'LINUX' as const;
  readonly accepted = new FixtureAcceptedSession();
  readonly creationEvidence = vi.fn(async () => ({
    schemaVersion: 1,
    pathStateBefore: 'ABSENT',
    bindDisposition: 'CREATED_WITHOUT_REPLACEMENT',
    parentIdentity,
    listenerIdentity,
  }));
  readonly lstatUnixSocket = vi.fn(async () => listenerIdentity);
  readonly acceptAuthorizedUnixSocket = vi.fn(
    async (_socketPath: string, _signal: AbortSignal) => this.accepted,
  );
  readonly closeAndUnlinkOwned = vi.fn(() => ({
    schemaVersion: 1,
    listenerClosed: true,
    disposition: 'OWNED_SOCKET_REMOVED',
    expectedDevice: listenerIdentity.device,
    expectedInode: listenerIdentity.inode,
  }));
}

class FixtureBinding implements LinuxRetainedNativeSupervisorListenerLifecycleBinding {
  readonly platform = 'LINUX' as const;
  readonly listener = new FixtureOwnedListener();
  readonly createOwnedListener = vi.fn(
    async (_request: Readonly<LinuxRetainedNativeSupervisorListenerCreationRequest>) =>
      this.listener,
  );
}

class FixtureAuthority implements LinuxRetainedNativeSupervisorServiceAuthority {
  constructor(
    private readonly result: (request: LinuxRetainedNativeSupervisorServiceRequest) => unknown,
  ) {}

  readonly authorize = vi.fn(
    async (candidate: Readonly<LinuxRetainedNativeSupervisorServiceRequest>) =>
      this.result(candidate as LinuxRetainedNativeSupervisorServiceRequest),
  );
}

function fixture(
  serviceRequest = request(),
  grantDrift: Partial<LinuxRetainedNativeSupervisorServiceGrant> = {},
) {
  const binding = new FixtureBinding();
  const authority = new FixtureAuthority((candidate) => grant(candidate, grantDrift));
  const peer: RetainedNativeSupervisorRecoveryTransport = {
    exchange: vi.fn(async () => recoveryResponse),
  };
  return {
    authority,
    binding,
    owner: new BoundedLinuxRetainedNativeSupervisorServiceOwner(binding, authority, () => now),
    peer,
    serviceRequest,
  };
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

describe('bounded retained-native supervisor service owner', () => {
  it('binds one authorized service request to one listener lifecycle and cleanup', async () => {
    const { authority, binding, owner, peer, serviceRequest } = fixture();
    binding.listener.accepted.writeAndShutdown.mockImplementation(async (candidate) => {
      expect(Buffer.from(candidate)).toEqual(frame('SUPERVISOR_TO_WORKER', recoveryResponse));
    });

    await expect(
      owner.runRecoveryOne(serviceRequest, peer, new AbortController().signal),
    ).resolves.toBeUndefined();

    expect(authority.authorize).toHaveBeenCalledOnce();
    expect(authority.authorize.mock.calls[0]?.[0]).toEqual(serviceRequest);
    expect(Object.isFrozen(authority.authorize.mock.calls[0]?.[0])).toBe(true);
    expect(binding.createOwnedListener).toHaveBeenCalledOnce();
    expect(binding.createOwnedListener.mock.calls[0]?.[0]).toEqual({
      schemaVersion: 1,
      platform: 'LINUX',
      socketPath,
      socketMode: 0o600,
      listenBacklog: 1,
      pathDisposition: 'FAIL_IF_PRESENT',
    });
    expect(peer.exchange).toHaveBeenCalledOnce();
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it('denies absent service authority before listener creation', async () => {
    const binding = new FixtureBinding();
    const owner = new BoundedLinuxRetainedNativeSupervisorServiceOwner(
      binding,
      new DenyLinuxRetainedNativeSupervisorServiceAuthority(),
      () => now,
    );
    await expect(
      owner.runRecoveryOne(
        request(),
        { exchange: vi.fn(async () => recoveryResponse) },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(binding.createOwnedListener).not.toHaveBeenCalled();
  });

  it('denies a missing recovery peer before consulting authority', async () => {
    const { authority, binding, owner, serviceRequest } = fixture();
    await expect(
      owner.runRecoveryOne(
        serviceRequest,
        new DenyRetainedNativeSupervisorRecoveryTransport(),
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(authority.authorize).not.toHaveBeenCalled();
    expect(binding.createOwnedListener).not.toHaveBeenCalled();
  });

  it.each([
    ['cross-tenant scope', { workspaceId: 'workspace-other' }],
    ['cross-supervisor scope', { supervisorInstanceId: 'supervisor-other' }],
    ['socket drift', { socketPath: '/run/ventureos/supervisor/other.sock' }],
    ['socket directory drift', { socketDirectory: '/run/ventureos/other' }],
    ['worker PID drift', { expectedWorkerPid: 812 }],
    ['path evidence drift', { pathApprovalEvidenceHash: 'e'.repeat(64) }],
  ])('denies grant request drift: %s', async (_label, drift) => {
    const { binding, owner, peer, serviceRequest } = fixture(
      request(),
      drift as Partial<LinuxRetainedNativeSupervisorServiceGrant>,
    );
    await expect(
      owner.runRecoveryOne(serviceRequest, peer, new AbortController().signal),
    ).rejects.toEqual(expectCode('INVALID_AUTHORIZATION'));
    expect(binding.createOwnedListener).not.toHaveBeenCalled();
  });

  it.each([
    ['runtime promotion', { runtimeConnection: 'CONNECTED' }],
    ['unbounded duration', { maximumSessionDurationMs: 5_001 }],
    ['unsafe directory mode', { socketDirectoryMode: 0o750 }],
    ['socket outside directory', { socketPath: '/run/ventureos/other/recovery.sock' }],
    ['invalid directory identity', { socketDirectoryIdentityReference: 'caller:asserted' }],
    ['sensitive reference', { provisioningId: 'secret-reference' }],
    ['invalid worker PID', { expectedWorkerPid: 0 }],
  ])('denies malformed service requests: %s', async (_label, drift) => {
    const { authority, binding, owner, peer } = fixture();
    await expect(
      owner.runRecoveryOne(request(drift as never), peer, new AbortController().signal),
    ).rejects.toEqual(expectCode('INVALID_AUTHORIZATION'));
    expect(authority.authorize).not.toHaveBeenCalled();
    expect(binding.createOwnedListener).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', { validUntil: new Date(now).toISOString() }],
    [
      'overlong',
      {
        validFrom: new Date(now - 1_000).toISOString(),
        validUntil: new Date(now + 60_001).toISOString(),
      },
    ],
    ['wrong authority level', { authorityLevel: 4 }],
    ['request hash drift', { requestHash: 'f'.repeat(64) }],
  ])('denies invalid service grants: %s', async (_label, drift) => {
    const { binding, owner, peer, serviceRequest } = fixture(request(), drift as never);
    await expect(
      owner.runRecoveryOne(serviceRequest, peer, new AbortController().signal),
    ).rejects.toEqual(expectCode('INVALID_AUTHORIZATION'));
    expect(binding.createOwnedListener).not.toHaveBeenCalled();
  });

  it('rejects protocol switching before consulting authority', async () => {
    const { authority, binding, owner, serviceRequest } = fixture();
    await expect(
      owner.runSigningOne(
        serviceRequest,
        'signer-native',
        { platform: 'LINUX', createOne: () => ({}) },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_AUTHORIZATION'));
    expect(authority.authorize).not.toHaveBeenCalled();
    expect(binding.createOwnedListener).not.toHaveBeenCalled();
  });

  it('dispatches an exactly authorized signing service into the signing lifecycle', async () => {
    const serviceRequest = request({ serviceKind: 'MODULE_AUTHORIZATION_SIGNING' });
    const { authority, binding, owner } = fixture(serviceRequest);
    const createOne = vi.fn((_request: unknown) => ({}));
    await expect(
      owner.runSigningOne(
        serviceRequest,
        'native-module-signer-v1',
        { platform: 'LINUX', createOne },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(authority.authorize).toHaveBeenCalledOnce();
    expect(createOne).toHaveBeenCalledOnce();
    expect(createOne.mock.calls[0]?.[0]).toMatchObject({
      signerKeyId: 'native-module-signer-v1',
      socketPath,
      expectedWorkerPid: workerCredentials.pid,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it.each([
    ['API_LISTENER', 'TOPOLOGY_OBSERVATION_API_LISTENER'],
    ['WORKER_CLIENT', 'TOPOLOGY_OBSERVATION_WORKER_CLIENT'],
  ] as const)(
    'binds an authorized %s observation to one protected listener lifecycle',
    async (observerRole, serviceKind) => {
      const serviceRequest = request({
        serviceKind,
        socketPath: `/run/ventureos/supervisor/topology-${observerRole.toLowerCase()}.sock`,
      });
      const { authority, binding, owner } = fixture(serviceRequest);
      const observationRequest = topologyRequest(observerRole);
      const observer: LinuxRetainedNativeSupervisorTopologyObservationPort = {
        observe: vi.fn(async () => topologyObservation(observationRequest)),
      };
      binding.listener.accepted.readToEof.mockResolvedValue(
        topologyFrame('COORDINATOR_TO_OBSERVER', observationRequest, observationRequest),
      );
      binding.listener.accepted.writeAndShutdown.mockImplementation(async (candidate) => {
        expect(Buffer.from(candidate)).toEqual(
          topologyFrame(
            'OBSERVER_TO_COORDINATOR',
            observationRequest,
            topologyObservation(observationRequest),
          ),
        );
      });

      await expect(
        owner.runTopologyObservationOne(
          serviceRequest,
          observer,
          observerRole,
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();

      expect(authority.authorize).toHaveBeenCalledOnce();
      expect(observer.observe).toHaveBeenCalledWith(observationRequest, expect.any(AbortSignal));
      expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
    },
  );

  it('rejects topology role switching and absent observation before authority or listener access', async () => {
    const serviceRequest = request({ serviceKind: 'TOPOLOGY_OBSERVATION_API_LISTENER' });
    const first = fixture(serviceRequest);
    await expect(
      first.owner.runTopologyObservationOne(
        serviceRequest,
        { observe: vi.fn() },
        'WORKER_CLIENT',
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_AUTHORIZATION'));
    expect(first.authority.authorize).not.toHaveBeenCalled();
    expect(first.binding.createOwnedListener).not.toHaveBeenCalled();

    const second = fixture(serviceRequest);
    await expect(
      second.owner.runTopologyObservationOne(
        serviceRequest,
        new DenyLinuxRetainedNativeSupervisorTopologyObservationPort(),
        'API_LISTENER',
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(second.authority.authorize).not.toHaveBeenCalled();
    expect(second.binding.createOwnedListener).not.toHaveBeenCalled();
  });

  it.each([
    ['workspace', { workspaceId: 'workspace-other' }],
    ['supervisor', { supervisorInstanceId: 'supervisor-other' }],
  ])('denies topology %s drift before reaching the retained observer', async (_label, drift) => {
    const serviceRequest = request({ serviceKind: 'TOPOLOGY_OBSERVATION_API_LISTENER' });
    const { binding, owner } = fixture(serviceRequest);
    const observationRequest = { ...topologyRequest('API_LISTENER'), ...drift };
    const observe = vi.fn(async () => topologyObservation(topologyRequest('API_LISTENER')));
    binding.listener.accepted.readToEof.mockResolvedValue(
      topologyFrame(
        'COORDINATOR_TO_OBSERVER',
        observationRequest as LinuxRetainedNativeSupervisorTopologyObservationRequest,
        observationRequest,
      ),
    );

    await expect(
      owner.runTopologyObservationOne(
        serviceRequest,
        { observe },
        'API_LISTENER',
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_AUTHORIZATION'));
    expect(observe).not.toHaveBeenCalled();
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it('captures the topology observer method before awaiting authority', async () => {
    const serviceRequest = request({ serviceKind: 'TOPOLOGY_OBSERVATION_API_LISTENER' });
    const binding = new FixtureBinding();
    const observationRequest = topologyRequest('API_LISTENER');
    binding.listener.accepted.readToEof.mockResolvedValue(
      topologyFrame('COORDINATOR_TO_OBSERVER', observationRequest, observationRequest),
    );
    const original = vi.fn(async () => topologyObservation(observationRequest));
    const observer: LinuxRetainedNativeSupervisorTopologyObservationPort = { observe: original };
    const authority = new FixtureAuthority((candidate) => {
      observer.observe = vi.fn(async () => ({ substituted: true }));
      return grant(candidate);
    });
    const owner = new BoundedLinuxRetainedNativeSupervisorServiceOwner(
      binding,
      authority,
      () => now,
    );

    await expect(
      owner.runTopologyObservationOne(
        serviceRequest,
        observer,
        'API_LISTENER',
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    expect(original).toHaveBeenCalledOnce();
    expect(observer.observe).not.toHaveBeenCalled();
  });

  it('aborts a pending accepted session at its bounded deadline and still cleans the listener', async () => {
    vi.useFakeTimers();
    try {
      const serviceRequest = request({ maximumSessionDurationMs: 100 });
      const { binding, owner, peer } = fixture(serviceRequest);
      binding.listener.acceptAuthorizedUnixSocket.mockImplementation(
        async (_path: string, signal: AbortSignal) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
          }),
      );
      const attempt = owner.runRecoveryOne(serviceRequest, peer, new AbortController().signal);
      const denied = expect(attempt).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
      await vi.waitFor(() =>
        expect(binding.listener.acceptAuthorizedUnixSocket).toHaveBeenCalled(),
      );
      await vi.advanceTimersByTimeAsync(100);
      await denied;
      expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('denies a reversed service clock after exact listener cleanup', async () => {
    const serviceRequest = request();
    const binding = new FixtureBinding();
    const authority = new FixtureAuthority((candidate) => grant(candidate));
    const observations = [now, now, now - 1];
    const owner = new BoundedLinuxRetainedNativeSupervisorServiceOwner(
      binding,
      authority,
      () => observations.shift() ?? now - 1,
    );
    await expect(
      owner.runRecoveryOne(
        serviceRequest,
        { exchange: vi.fn(async () => recoveryResponse) },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(binding.listener.closeAndUnlinkOwned).toHaveBeenCalledOnce();
  });

  it('consumes the owner across failed and repeated attempts', async () => {
    const { authority, binding, owner, peer, serviceRequest } = fixture();
    await expect(
      owner.runRecoveryOne(
        { ...serviceRequest, workspaceId: 'invalid workspace' },
        peer,
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_AUTHORIZATION'));
    await expect(
      owner.runRecoveryOne(serviceRequest, peer, new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(authority.authorize).not.toHaveBeenCalled();
    expect(binding.createOwnedListener).not.toHaveBeenCalled();
  });

  it('denies cancellation after authority without opening a listener', async () => {
    const serviceRequest = request();
    const controller = new AbortController();
    const binding = new FixtureBinding();
    const authority = new FixtureAuthority((candidate) => {
      controller.abort();
      return grant(candidate);
    });
    const owner = new BoundedLinuxRetainedNativeSupervisorServiceOwner(
      binding,
      authority,
      () => now,
    );
    await expect(
      owner.runRecoveryOne(
        serviceRequest,
        { exchange: vi.fn(async () => recoveryResponse) },
        controller.signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_AUTHORIZATION'));
    expect(binding.createOwnedListener).not.toHaveBeenCalled();
  });
});
