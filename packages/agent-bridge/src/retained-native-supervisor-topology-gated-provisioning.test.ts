import { describe, expect, it, vi } from 'vitest';

import { linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash } from './retained-native-supervisor-linux-parent-directory-provisioner';
import { linuxRetainedNativeSupervisorPathProvisionRequestHash } from './retained-native-supervisor-linux-path-provisioner';
import { linuxRetainedNativeSupervisorRuntimeRootProvisionRequestHash } from './retained-native-supervisor-linux-runtime-root-provisioner';
import {
  BoundedLinuxRetainedNativeSupervisorProvisioningController,
  type LinuxRetainedNativeSupervisorProvisioningPlan,
  type LinuxRetainedNativeSupervisorProvisioningPort,
} from './retained-native-supervisor-provisioning-controller';
import {
  BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler,
  linuxRetainedNativeSupervisorTopologyObservationRequestHash,
  type LinuxRetainedNativeSupervisorTopologyObservationPort,
  type LinuxRetainedNativeSupervisorTopologyObservationRequest,
} from './retained-native-supervisor-shared-runtime-topology';
import { BoundedLinuxRetainedNativeSupervisorTopologyGatedProvisioningController } from './retained-native-supervisor-topology-gated-provisioning';

const now = Date.parse('2030-01-01T12:00:00.000Z');
const from = new Date(now - 1_000).toISOString();
const until = new Date(now + 60_000).toISOString();
const plan: LinuxRetainedNativeSupervisorProvisioningPlan = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_PROVISIONING',
  runtimeRootRequest: Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_RUNTIME_ROOT_PROVISION',
    workspaceId: 'workspace-one',
    supervisorInstanceId: 'supervisor-one',
    provisioningAttemptId: 'attempt-0001',
    platform: 'LINUX',
    architecture: 'X64',
    runtimeRootParent: '/var/lib/ventureos/runtime/workspace-one/supervisor-one',
    runtimeRootParentIdentityReference: 'linux:dev-a:ino-10',
    runtimeRootParentOwnerUid: 65532,
    runtimeRootParentOwnerGid: 65532,
    runtimeRootParentMode: 0o700,
    runtimeRoot: '/var/lib/ventureos/runtime/workspace-one/supervisor-one/attempt-0001',
    ownerUid: 65532,
    ownerGid: 65532,
    runtimeConnection: 'NOT_CONFIGURED',
  }),
  clientSource: Object.freeze({
    moduleKind: 'CLIENT',
    sourceModulePath: '/usr/lib/ventureos/native/linux-retained-native-client.node',
    sourceModuleSha256: 'a'.repeat(64),
    sourceModuleIdentityReference: 'linux:dev-b:ino-20',
    sourceModuleOwnerUid: 0,
    sourceModuleOwnerGid: 0,
    sourceModuleMode: 0o444,
    sourceModuleSizeBytes: 4096,
  }),
  listenerSource: Object.freeze({
    moduleKind: 'LISTENER',
    sourceModulePath: '/usr/lib/ventureos/native/linux-retained-native-listener.node',
    sourceModuleSha256: 'b'.repeat(64),
    sourceModuleIdentityReference: 'linux:dev-c:ino-30',
    sourceModuleOwnerUid: 0,
    sourceModuleOwnerGid: 0,
    sourceModuleMode: 0o444,
    sourceModuleSizeBytes: 4096,
  }),
  socketPath:
    '/var/lib/ventureos/runtime/workspace-one/supervisor-one/attempt-0001/run/supervisor/service.sock',
  runtimeConnection: 'NOT_CONFIGURED',
});

function observation(request: LinuxRetainedNativeSupervisorTopologyObservationRequest) {
  return {
    ...request,
    observationId: `observation-${request.observerRole.toLowerCase()}`,
    requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(request),
    evidenceAuthority: 'LINUX_RETAINED_DESCRIPTORS',
    principalAuthority: 'LINUX_EFFECTIVE_IDENTITY',
    observerUid: request.runtimeRootParentOwnerUid,
    observerGid: request.runtimeRootParentOwnerGid,
    observedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 5_000).toISOString(),
    topologyState: 'VISIBLE_NOT_PROVISIONED',
  };
}

function rootResult(request: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    purpose: request.purpose,
    workspaceId: request.workspaceId,
    supervisorInstanceId: request.supervisorInstanceId,
    provisioningAttemptId: request.provisioningAttemptId,
    platform: 'LINUX',
    architecture: 'X64',
    provisioningId: 'runtime-root-provision-one',
    requestHash: linuxRetainedNativeSupervisorRuntimeRootProvisionRequestHash(request as never),
    approvalId: 'level3-control-plane:root-one',
    approvalEvidenceHash: 'c'.repeat(64),
    authorizedByReference: 'principal-one',
    authorityLevel: 3,
    authorizedFrom: from,
    authorizedUntil: until,
    runtimeRoot: request.runtimeRoot,
    runtimeRootIdentityReference: 'linux:dev-a:ino-11',
    ownerUid: request.ownerUid,
    ownerGid: request.ownerGid,
    directoryMode: 0o700,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function parentResult(request: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    purpose: request.purpose,
    workspaceId: request.workspaceId,
    supervisorInstanceId: request.supervisorInstanceId,
    platform: 'LINUX',
    architecture: 'X64',
    provisioningId: 'parent-provision-one',
    requestHash: linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash(request as never),
    approvalId: 'level3-control-plane:parent-one',
    approvalEvidenceHash: 'd'.repeat(64),
    authorizedByReference: 'principal-one',
    authorityLevel: 3,
    authorizedFrom: from,
    authorizedUntil: until,
    moduleDirectory: request.moduleDirectory,
    moduleDirectoryIdentityReference: 'linux:dev-a:ino-12',
    socketDirectoryParent: request.socketDirectoryParent,
    socketDirectoryParentIdentityReference: 'linux:dev-a:ino-13',
    socketDirectory: request.socketDirectory,
    socketDirectoryIdentityReference: 'linux:dev-a:ino-14',
    ownerUid: request.ownerUid,
    ownerGid: request.ownerGid,
    directoryMode: 0o700,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function pathResult(request: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    purpose: request.purpose,
    workspaceId: request.workspaceId,
    supervisorInstanceId: request.supervisorInstanceId,
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: request.moduleKind,
    provisioningId: `path-provision-${String(request.moduleKind).toLowerCase()}`,
    requestHash: linuxRetainedNativeSupervisorPathProvisionRequestHash(request as never),
    approvalId: `level3-control-plane:${String(request.moduleKind).toLowerCase()}`,
    approvalEvidenceHash: request.moduleKind === 'CLIENT' ? 'e'.repeat(64) : 'f'.repeat(64),
    authorizedByReference: 'principal-one',
    authorityLevel: 3,
    authorizedFrom: from,
    authorizedUntil: until,
    parentDirectoryProvisioningId: request.parentDirectoryProvisioningId,
    parentDirectoryProvisionRequestHash: request.parentDirectoryProvisionRequestHash,
    parentDirectoryApprovalEvidenceHash: request.parentDirectoryApprovalEvidenceHash,
    canonicalModulePath: request.canonicalModulePath,
    moduleSha256: request.sourceModuleSha256,
    moduleIdentityReference:
      request.moduleKind === 'CLIENT' ? 'linux:dev-a:ino-15' : 'linux:dev-a:ino-16',
    moduleOwnerUid: request.ownerUid,
    moduleOwnerGid: request.ownerGid,
    moduleMode: 0o500,
    moduleSizeBytes: request.sourceModuleSizeBytes,
    socketDirectory: request.socketDirectory,
    socketDirectoryIdentityReference: request.socketDirectoryIdentityReference,
    socketDirectoryOwnerUid: request.ownerUid,
    socketDirectoryOwnerGid: request.ownerGid,
    socketDirectoryMode: 0o700,
    socketPath: request.socketPath,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function fixture(
  options: { gateClock?: () => number; blockingRoot?: boolean; topologyDrift?: boolean } = {},
) {
  const calls: string[] = [];
  const observer = (role: string): LinuxRetainedNativeSupervisorTopologyObservationPort => ({
    async observe(input) {
      calls.push(role);
      const result = observation(input as LinuxRetainedNativeSupervisorTopologyObservationRequest);
      return options.topologyDrift && role === 'topology-api'
        ? { ...result, runtimeRootParentIdentityReference: 'linux:dev-a:ino-99' }
        : result;
    },
  });
  const topology = new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(
    observer('topology-api'),
    observer('topology-worker'),
    () => now,
  );
  const port = (
    name: string,
    factory: (request: Record<string, unknown>) => unknown,
  ): LinuxRetainedNativeSupervisorProvisioningPort => ({
    async provision(input, signal) {
      calls.push(name);
      if (options.blockingRoot && name === 'root') {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      return factory(input as Record<string, unknown>);
    },
  });
  const provisioning = new BoundedLinuxRetainedNativeSupervisorProvisioningController(
    port('root', rootResult),
    port('parents', parentResult),
    port('client', pathResult),
    port('listener', pathResult),
    () => now,
  );
  const controller = new BoundedLinuxRetainedNativeSupervisorTopologyGatedProvisioningController(
    topology,
    provisioning,
    options.gateClock ?? (() => now),
    options.blockingRoot ? 100 : 10_000,
  );
  return { calls, topology, provisioning, controller };
}

describe('topology-gated retained-native provisioning', () => {
  it('requires both topology observations before any provisioning boundary', async () => {
    const { calls, controller } = fixture();
    await expect(controller.provision(plan, new AbortController().signal)).resolves.toMatchObject({
      workspaceId: 'workspace-one',
      provisioningState: 'TOPOLOGY_ATTESTED_PROVISIONED_NOT_ACTIVATED',
      topology: { topologyState: 'SHARED_RUNTIME_VISIBLE_NOT_PROVISIONED' },
      provisioning: { provisioningState: 'PROVISIONED_NOT_ACTIVATED' },
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(calls).toEqual([
      'topology-api',
      'topology-worker',
      'root',
      'parents',
      'client',
      'listener',
    ]);
  });

  it('validates the complete plan before topology or provisioning', async () => {
    const { calls, controller } = fixture();
    await expect(
      controller.provision({ ...plan, extra: true }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(calls).toEqual([]);
  });

  it('makes every provisioning boundary unreachable when either topology view drifts', async () => {
    const { calls, controller } = fixture({ topologyDrift: true });
    await expect(controller.provision(plan, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
    expect(calls).toEqual(['topology-api', 'topology-worker']);
  });

  it('rejects non-canonical controller instances and invalid timeout policy', () => {
    const configured = fixture();
    class DerivedTopology extends BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler {}
    const observer = (): LinuxRetainedNativeSupervisorTopologyObservationPort => ({
      async observe(input) {
        return observation(input as LinuxRetainedNativeSupervisorTopologyObservationRequest);
      },
    });
    const derived = new DerivedTopology(observer(), observer(), () => now);
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorTopologyGatedProvisioningController(
          derived,
          configured.provisioning,
        ),
    ).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorTopologyGatedProvisioningController(
          configured.topology,
          configured.provisioning,
          () => now,
          99,
        ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
  });

  it('captures the hardened controller methods against later substitution', async () => {
    const configured = fixture();
    const replacedTopology = vi.fn();
    const replacedProvisioning = vi.fn();
    configured.topology.attest = replacedTopology as never;
    configured.provisioning.provision = replacedProvisioning as never;
    await expect(
      configured.controller.provision(plan, new AbortController().signal),
    ).resolves.toMatchObject({
      provisioningState: 'TOPOLOGY_ATTESTED_PROVISIONED_NOT_ACTIVATED',
    });
    expect(replacedTopology).not.toHaveBeenCalled();
    expect(replacedProvisioning).not.toHaveBeenCalled();
  });

  it('returns no success when topology expires before provisioning completes', async () => {
    const times = [now, now, now + 5_000];
    const { calls, controller } = fixture({ gateClock: () => times.shift() ?? now + 5_000 });
    await expect(controller.provision(plan, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
    expect(calls).toContain('listener');
  });

  it('bounds a provisioning port that ignores completion and consumes the attempt', async () => {
    const { calls, controller } = fixture({ blockingRoot: true });
    await expect(controller.provision(plan, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
    expect(calls).toEqual(['topology-api', 'topology-worker', 'root']);
    await expect(controller.provision(plan, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
  });

  it('propagates cancellation without reaching provisioning', async () => {
    const abort = new AbortController();
    const calls: string[] = [];
    const cancelling = (role: string): LinuxRetainedNativeSupervisorTopologyObservationPort => ({
      async observe(input) {
        calls.push(role);
        abort.abort();
        return observation(input as LinuxRetainedNativeSupervisorTopologyObservationRequest);
      },
    });
    const base = fixture();
    const topology = new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(
      cancelling('api'),
      cancelling('worker'),
      () => now,
    );
    const controller = new BoundedLinuxRetainedNativeSupervisorTopologyGatedProvisioningController(
      topology,
      base.provisioning,
      () => now,
    );
    await expect(controller.provision(plan, abort.signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
    expect(calls).toEqual(['api', 'worker']);
    expect(base.calls).toEqual([]);
  });
});
