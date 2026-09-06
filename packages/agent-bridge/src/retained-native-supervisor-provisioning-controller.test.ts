import { describe, expect, it, vi } from 'vitest';

import {
  BoundedLinuxRetainedNativeSupervisorProvisioningController,
  DenyLinuxRetainedNativeSupervisorProvisioningPort,
  type LinuxRetainedNativeSupervisorProvisioningPlan,
  type LinuxRetainedNativeSupervisorProvisioningPort,
} from './retained-native-supervisor-provisioning-controller';
import { linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash } from './retained-native-supervisor-linux-parent-directory-provisioner';
import { linuxRetainedNativeSupervisorPathProvisionRequestHash } from './retained-native-supervisor-linux-path-provisioner';
import { linuxRetainedNativeSupervisorRuntimeRootProvisionRequestHash } from './retained-native-supervisor-linux-runtime-root-provisioner';

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

function rootResult(request: Record<string, unknown>): Record<string, unknown> {
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

function parentResult(request: Record<string, unknown>): Record<string, unknown> {
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

function pathResult(request: Record<string, unknown>): Record<string, unknown> {
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

function port(
  factory: (request: Record<string, unknown>) => unknown,
): LinuxRetainedNativeSupervisorProvisioningPort & { provision: ReturnType<typeof vi.fn> } {
  return { provision: vi.fn(async (request) => factory(request as Record<string, unknown>)) };
}

function fixture() {
  return fixtureWithClock(() => now);
}

function fixtureWithClock(clock: () => number) {
  const root = port(rootResult);
  const parents = port(parentResult);
  const client = port(pathResult);
  const listener = port(pathResult);
  const controller = new BoundedLinuxRetainedNativeSupervisorProvisioningController(
    root,
    parents,
    client,
    listener,
    clock,
  );
  return { root, parents, client, listener, controller };
}

describe('bounded retained-native supervisor provisioning controller', () => {
  it('denies construction unless every independent provisioning port is configured', () => {
    const configured = port(rootResult);
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorProvisioningController(
          configured,
          configured,
          configured,
          new DenyLinuxRetainedNativeSupervisorProvisioningPort(),
        ),
    ).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
  });

  it('derives and sequences root, parent, CLIENT, and LISTENER requests from retained evidence', async () => {
    const { root, parents, client, listener, controller } = fixture();
    const result = await controller.provision(plan, new AbortController().signal);
    expect(result).toMatchObject({
      workspaceId: 'workspace-one',
      supervisorInstanceId: 'supervisor-one',
      provisioningAttemptId: 'attempt-0001',
      provisioningState: 'PROVISIONED_NOT_ACTIVATED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(root.provision).toHaveBeenCalledOnce();
    expect(parents.provision).toHaveBeenCalledOnce();
    expect(client.provision).toHaveBeenCalledOnce();
    expect(listener.provision).toHaveBeenCalledOnce();
    expect(parents.provision.mock.calls[0]?.[0]).toMatchObject({
      runtimeRootProvisioningId: 'runtime-root-provision-one',
      runtimeRootApprovalEvidenceHash: 'c'.repeat(64),
    });
    expect(client.provision.mock.calls[0]?.[0]).toMatchObject({
      moduleKind: 'CLIENT',
      parentDirectoryProvisioningId: 'parent-provision-one',
      socketDirectoryIdentityReference: 'linux:dev-a:ino-14',
    });
    expect(listener.provision.mock.calls[0]?.[0]).toMatchObject({
      moduleKind: 'LISTENER',
      parentDirectoryProvisioningId: 'parent-provision-one',
      socketDirectoryIdentityReference: 'linux:dev-a:ino-14',
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ['root workspace drift', 'root', { workspaceId: 'workspace-two' }],
    ['parent identity drift', 'parents', { socketDirectoryIdentityReference: 'linux:dev-a:ino-0' }],
    ['client module drift', 'client', { moduleSha256: '9'.repeat(64) }],
    [
      'listener socket drift',
      'listener',
      { socketDirectoryIdentityReference: 'linux:dev-a:ino-99' },
    ],
  ])('denies %s and never returns a partial bundle', async (_label, target, drift) => {
    const root = port((request) => ({
      ...rootResult(request),
      ...(target === 'root' ? drift : {}),
    }));
    const parents = port((request) => ({
      ...parentResult(request),
      ...(target === 'parents' ? drift : {}),
    }));
    const client = port((request) => ({
      ...pathResult(request),
      ...(target === 'client' ? drift : {}),
    }));
    const listener = port((request) => ({
      ...pathResult(request),
      ...(target === 'listener' ? drift : {}),
    }));
    const controller = new BoundedLinuxRetainedNativeSupervisorProvisioningController(
      root,
      parents,
      client,
      listener,
      () => now,
    );
    await expect(controller.provision(plan, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
    if (target === 'root') expect(parents.provision).not.toHaveBeenCalled();
    if (target === 'parents') expect(client.provision).not.toHaveBeenCalled();
    if (target === 'client') expect(listener.provision).not.toHaveBeenCalled();
  });

  it('consumes a failed attempt and requires a fresh controller plus attempt root for retry', async () => {
    const { controller } = fixture();
    const malformed = { ...plan, extra: true };
    await expect(
      controller.provision(malformed, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    await expect(controller.provision(plan, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
  });

  it('stops before downstream provisioning when cancellation arrives between boundaries', async () => {
    const abort = new AbortController();
    const root = port((request) => {
      abort.abort();
      return rootResult(request);
    });
    const parents = port(parentResult);
    const configured = port(pathResult);
    const controller = new BoundedLinuxRetainedNativeSupervisorProvisioningController(
      root,
      parents,
      configured,
      configured,
      () => now,
    );
    await expect(controller.provision(plan, abort.signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
    expect(parents.provision).not.toHaveBeenCalled();
  });

  it('rejects accessor-bearing plan and swapped module roles before any port', async () => {
    const { root, controller } = fixture();
    const accessor = { ...plan } as Record<string, unknown>;
    Object.defineProperty(accessor, 'socketPath', { enumerable: true, get: () => plan.socketPath });
    await expect(
      controller.provision(accessor, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(root.provision).not.toHaveBeenCalled();

    const next = fixture();
    await expect(
      next.controller.provision(
        { ...plan, clientSource: plan.listenerSource },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(next.root.provision).not.toHaveBeenCalled();
  });

  it.each([
    [
      'non-canonical source path',
      { clientSource: { ...plan.clientSource, sourceModulePath: '/usr/lib/../client.node' } },
    ],
    [
      'zero source identity',
      {
        clientSource: { ...plan.clientSource, sourceModuleIdentityReference: 'linux:dev-0:ino-20' },
      },
    ],
    ['writable source mode', { clientSource: { ...plan.clientSource, sourceModuleMode: 0o644 } }],
    [
      'oversized source',
      { clientSource: { ...plan.clientSource, sourceModuleSizeBytes: 8 * 1_024 * 1_024 + 1 } },
    ],
    ['non-canonical socket path', { socketPath: '/var/lib/ventureos/runtime/../service.sock' }],
    ['socket outside the attempt root', { socketPath: '/run/ventureos/service.sock' }],
  ])('rejects %s before invoking a provisioning port', async (_label, mutation) => {
    const { root, controller } = fixture();
    await expect(
      controller.provision({ ...plan, ...mutation }, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
    expect(root.provision).not.toHaveBeenCalled();
  });

  it('normalizes invalid result timestamps and zero identities as attestation failures', async () => {
    const invalidTimestampRoot = port((request) => ({
      ...rootResult(request),
      authorizedUntil: 'not-a-timestamp',
    }));
    const downstream = port(parentResult);
    const configured = port(pathResult);
    const first = new BoundedLinuxRetainedNativeSupervisorProvisioningController(
      invalidTimestampRoot,
      downstream,
      configured,
      configured,
      () => now,
    );
    await expect(first.provision(plan, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
    expect(downstream.provision).not.toHaveBeenCalled();

    const second = fixture();
    second.root.provision.mockImplementation(async (request) => ({
      ...rootResult(request as Record<string, unknown>),
      runtimeRootIdentityReference: 'linux:dev-0:ino-11',
    }));
    await expect(
      second.controller.provision(plan, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
    expect(second.parents.provision).not.toHaveBeenCalled();
  });

  it('captures configured port methods and denies regressing or expired final time', async () => {
    const captured = fixture();
    captured.root.provision = vi.fn(async () => ({ replaced: true }));
    await expect(
      captured.controller.provision(plan, new AbortController().signal),
    ).resolves.toMatchObject({
      provisioningState: 'PROVISIONED_NOT_ACTIVATED',
    });
    expect(captured.root.provision).not.toHaveBeenCalled();

    const times = [now, now - 1];
    const regressing = fixtureWithClock(() => times.shift() ?? now);
    await expect(
      regressing.controller.provision(plan, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });

    const expiringTimes = [now, now, now, now, now + 61_000];
    const expiring = fixtureWithClock(() => expiringTimes.shift() ?? now + 61_000);
    await expect(
      expiring.controller.provision(plan, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
  });
});
