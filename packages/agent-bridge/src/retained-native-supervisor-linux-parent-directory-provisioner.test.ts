import { describe, expect, it, vi } from 'vitest';

import {
  BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner,
  DenyLinuxRetainedNativeSupervisorParentDirectoryProvisionAuthority,
  type LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant,
  type LinuxRetainedNativeSupervisorParentDirectoryProvisionHost,
  type LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest,
  linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash,
  type ProvisionedLinuxRetainedNativeSupervisorParentDirectories,
  validateLinuxRetainedNativeSupervisorParentDirectoryProvisionRequest,
} from './retained-native-supervisor-linux-parent-directory-provisioner';

const now = Date.parse('2026-09-06T11:00:00.000Z');
const request: LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_PARENT_DIRECTORIES_PROVISION',
  workspaceId: 'workspace-one',
  supervisorInstanceId: 'supervisor-one',
  platform: 'LINUX',
  architecture: 'X64',
  runtimeRoot: '/var/lib/ventureos/runtime-one',
  runtimeRootIdentityReference: 'linux:dev-a:ino-b',
  runtimeRootOwnerUid: 65532,
  runtimeRootOwnerGid: 65532,
  runtimeRootMode: 0o700,
  moduleDirectory: '/var/lib/ventureos/runtime-one/native',
  socketDirectoryParent: '/var/lib/ventureos/runtime-one/run',
  ownerUid: 65532,
  ownerGid: 65532,
  runtimeConnection: 'NOT_CONFIGURED',
});

function grant(
  overrides: Partial<LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant> = {},
): LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant {
  return {
    ...request,
    provisioningId: 'parent-provision-one',
    requestHash: linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash(request),
    approvalId: 'level3-control-plane:parent-one',
    approvalEvidenceHash: 'a'.repeat(64),
    authorizedByReference: 'principal-one',
    authorityLevel: 3,
    validFrom: new Date(now - 1_000).toISOString(),
    validUntil: new Date(now + 60_000).toISOString(),
    ...overrides,
  };
}

function host(): LinuxRetainedNativeSupervisorParentDirectoryProvisionHost {
  return {
    platform: 'LINUX',
    architecture: 'X64',
    provision: vi.fn((authorized) =>
      Object.freeze({
        schemaVersion: 1 as const,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_PARENT_DIRECTORIES_PROVISION' as const,
        workspaceId: authorized.workspaceId,
        supervisorInstanceId: authorized.supervisorInstanceId,
        platform: 'LINUX' as const,
        architecture: 'X64' as const,
        provisioningId: authorized.provisioningId,
        requestHash: authorized.requestHash,
        approvalId: authorized.approvalId,
        approvalEvidenceHash: authorized.approvalEvidenceHash,
        authorizedByReference: authorized.authorizedByReference,
        authorityLevel: 3 as const,
        authorizedFrom: authorized.validFrom,
        authorizedUntil: authorized.validUntil,
        moduleDirectory: authorized.moduleDirectory,
        moduleDirectoryIdentityReference: 'linux:dev-a:ino-c',
        socketDirectoryParent: authorized.socketDirectoryParent,
        socketDirectoryParentIdentityReference: 'linux:dev-a:ino-d',
        ownerUid: authorized.ownerUid,
        ownerGid: authorized.ownerGid,
        directoryMode: 0o700 as const,
        runtimeConnection: 'NOT_CONFIGURED' as const,
      }),
    ),
  };
}

describe('bounded Linux retained-native parent-directory provisioner', () => {
  it('requires an explicitly configured host', () => {
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner(
          new DenyLinuxRetainedNativeSupervisorParentDirectoryProvisionAuthority(),
        ),
    ).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
  });

  it('accepts one exact fresh Level-3 grant and returns only frozen evidence', async () => {
    const configuredHost = host();
    const provisioner = new BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner(
      { authorize: async () => grant() },
      configuredHost,
      () => now,
    );

    const result = await provisioner.provision(request, new AbortController().signal);

    expect(result).toMatchObject({
      workspaceId: request.workspaceId,
      supervisorInstanceId: request.supervisorInstanceId,
      moduleDirectoryIdentityReference: 'linux:dev-a:ino-c',
      socketDirectoryParentIdentityReference: 'linux:dev-a:ino-d',
      authorityLevel: 3,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(configuredHost.provision).toHaveBeenCalledOnce();
  });

  it.each([
    ['workspace drift', { workspaceId: 'workspace-two' }],
    ['supervisor drift', { supervisorInstanceId: 'supervisor-two' }],
    ['runtime truth drift', { runtimeConnection: 'CONFIGURED' }],
    ['root identity drift', { runtimeRootIdentityReference: 'linux:dev-a:ino-c' }],
    ['module target drift', { moduleDirectory: '/var/lib/ventureos/runtime-one/elsewhere' }],
    ['socket target drift', { socketDirectoryParent: '/var/lib/ventureos/runtime-one/other' }],
  ])('denies %s before the host', async (_label, override) => {
    const configuredHost = host();
    const provisioner = new BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner(
      { authorize: async () => grant(override as never) },
      configuredHost,
      () => now,
    );

    await expect(
      provisioner.provision(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(configuredHost.provision).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', { validUntil: new Date(now).toISOString() }],
    ['future', { validFrom: new Date(now + 1).toISOString() }],
    ['too long', { validUntil: new Date(now + 300_001).toISOString() }],
    ['wrong level', { authorityLevel: 4 }],
    ['wrong request hash', { requestHash: 'b'.repeat(64) }],
  ])('denies an %s grant before the host', async (_label, override) => {
    const configuredHost = host();
    const provisioner = new BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner(
      { authorize: async () => grant(override as never) },
      configuredHost,
      () => now,
    );

    await expect(
      provisioner.provision(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(configuredHost.provision).not.toHaveBeenCalled();
  });

  it('consumes the first denied attempt and never retries authority', async () => {
    const authorize = vi.fn(async () => ({ ...grant(), extra: 'denied' }));
    const provisioner = new BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner(
      { authorize },
      host(),
      () => now,
    );
    const signal = new AbortController().signal;

    await expect(provisioner.provision(request, signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
    await expect(provisioner.provision(request, signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
    expect(authorize).toHaveBeenCalledOnce();
  });

  it('rejects host attestation drift after authority', async () => {
    const validHost = host();
    const configuredHost: LinuxRetainedNativeSupervisorParentDirectoryProvisionHost = {
      platform: 'LINUX',
      architecture: 'X64',
      provision: vi.fn(
        (authorized) =>
          ({
            ...validHost.provision(authorized),
            workspaceId: 'workspace-two',
          }) as ProvisionedLinuxRetainedNativeSupervisorParentDirectories,
      ),
    };
    const provisioner = new BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner(
      { authorize: async () => grant() },
      configuredHost,
      () => now,
    );
    await expect(
      provisioner.provision(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
  });

  it('rejects malformed, accessor-bearing, sensitive and traversal requests', () => {
    expect(() =>
      validateLinuxRetainedNativeSupervisorParentDirectoryProvisionRequest({
        ...request,
        runtimeRoot: '/var/lib/ventureos/../runtime-one',
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(() =>
      validateLinuxRetainedNativeSupervisorParentDirectoryProvisionRequest({
        ...request,
        workspaceId: 'workspace-secret-token',
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    const accessor = { ...request } as Record<string, unknown>;
    Object.defineProperty(accessor, 'workspaceId', {
      enumerable: true,
      get: () => 'workspace-one',
    });
    expect(() =>
      validateLinuxRetainedNativeSupervisorParentDirectoryProvisionRequest(accessor),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
  });

  it('denies pre-cancelled calls before authority', async () => {
    const authorize = vi.fn(async () => grant());
    const provisioner = new BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner(
      { authorize },
      host(),
      () => now,
    );
    const controller = new AbortController();
    controller.abort();

    await expect(provisioner.provision(request, controller.signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
    expect(authorize).not.toHaveBeenCalled();
  });
});
