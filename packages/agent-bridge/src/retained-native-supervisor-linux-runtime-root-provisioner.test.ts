import { describe, expect, it, vi } from 'vitest';

import {
  BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner,
  DenyLinuxRetainedNativeSupervisorRuntimeRootProvisionAuthority,
  type LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant,
  type LinuxRetainedNativeSupervisorRuntimeRootProvisionHost,
  type LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest,
  linuxRetainedNativeSupervisorRuntimeRootProvisionRequestHash,
  validateLinuxRetainedNativeSupervisorRuntimeRootProvisionRequest,
} from './retained-native-supervisor-linux-runtime-root-provisioner';

const now = Date.parse('2026-09-06T12:00:00.000Z');
const request: LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_RUNTIME_ROOT_PROVISION',
  workspaceId: 'workspace-one',
  supervisorInstanceId: 'supervisor-one',
  provisioningAttemptId: 'attempt-0001',
  platform: 'LINUX',
  architecture: 'X64',
  runtimeRootParent: '/var/lib/ventureos/runtime/workspace-one/supervisor-one',
  runtimeRootParentIdentityReference: 'linux:dev-a:ino-b',
  runtimeRootParentOwnerUid: 65532,
  runtimeRootParentOwnerGid: 65532,
  runtimeRootParentMode: 0o700,
  runtimeRoot: '/var/lib/ventureos/runtime/workspace-one/supervisor-one/attempt-0001',
  ownerUid: 65532,
  ownerGid: 65532,
  runtimeConnection: 'NOT_CONFIGURED',
});

function grant(
  overrides: Partial<LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant> = {},
): LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant {
  return {
    ...request,
    provisioningId: 'runtime-root-provision-one',
    requestHash: linuxRetainedNativeSupervisorRuntimeRootProvisionRequestHash(request),
    approvalId: 'level3-control-plane:runtime-root-one',
    approvalEvidenceHash: 'a'.repeat(64),
    authorizedByReference: 'principal-one',
    authorityLevel: 3,
    validFrom: new Date(now - 1_000).toISOString(),
    validUntil: new Date(now + 60_000).toISOString(),
    ...overrides,
  };
}

function host(): LinuxRetainedNativeSupervisorRuntimeRootProvisionHost {
  return {
    platform: 'LINUX',
    architecture: 'X64',
    provision: vi.fn((authorized) =>
      Object.freeze({
        schemaVersion: 1 as const,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_RUNTIME_ROOT_PROVISION' as const,
        workspaceId: authorized.workspaceId,
        supervisorInstanceId: authorized.supervisorInstanceId,
        provisioningAttemptId: authorized.provisioningAttemptId,
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
        runtimeRoot: authorized.runtimeRoot,
        runtimeRootIdentityReference: 'linux:dev-a:ino-c',
        ownerUid: authorized.ownerUid,
        ownerGid: authorized.ownerGid,
        directoryMode: 0o700 as const,
        runtimeConnection: 'NOT_CONFIGURED' as const,
      }),
    ),
  };
}

describe('bounded Linux retained-native runtime-root provisioner', () => {
  it('requires an explicitly configured host', () => {
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner(
          new DenyLinuxRetainedNativeSupervisorRuntimeRootProvisionAuthority(),
        ),
    ).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
  });

  it('accepts one exact fresh Level-3 grant and returns frozen inert evidence', async () => {
    const configuredHost = host();
    const provisioner = new BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner(
      { authorize: async () => grant() },
      configuredHost,
      () => now,
    );
    const result = await provisioner.provision(request, new AbortController().signal);

    expect(result).toMatchObject({
      workspaceId: request.workspaceId,
      supervisorInstanceId: request.supervisorInstanceId,
      provisioningAttemptId: request.provisioningAttemptId,
      runtimeRootIdentityReference: 'linux:dev-a:ino-c',
      authorityLevel: 3,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(configuredHost.provision).toHaveBeenCalledOnce();
  });

  it.each([
    ['workspace drift', { workspaceId: 'workspace-two' }],
    ['supervisor drift', { supervisorInstanceId: 'supervisor-two' }],
    ['attempt drift', { provisioningAttemptId: 'attempt-0002' }],
    ['parent identity drift', { runtimeRootParentIdentityReference: 'linux:dev-a:ino-c' }],
    ['runtime truth drift', { runtimeConnection: 'CONFIGURED' }],
  ])('denies %s before the host', async (_label, override) => {
    const configuredHost = host();
    const provisioner = new BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner(
      { authorize: async () => grant(override as never) },
      configuredHost,
      () => now,
    );
    await expect(
      provisioner.provision(request, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
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
    const provisioner = new BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner(
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
    ['attempt', { provisioningAttemptId: 'attempt-0002' }],
    ['root identity', { runtimeRootIdentityReference: 'linux:dev-a:ino-0' }],
    ['runtime truth', { runtimeConnection: 'CONFIGURED' }],
  ])('rejects host %s attestation drift', async (_label, override) => {
    const validHost = host();
    const configuredHost: LinuxRetainedNativeSupervisorRuntimeRootProvisionHost = {
      platform: 'LINUX',
      architecture: 'X64',
      provision: vi.fn(
        (authorized) => ({ ...validHost.provision(authorized), ...override }) as never,
      ),
    };
    const provisioner = new BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner(
      { authorize: async () => grant() },
      configuredHost,
      () => now,
    );
    await expect(
      provisioner.provision(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
  });

  it('requires the root to be the exact attempt child and rejects sensitive/accessor input', () => {
    expect(() =>
      validateLinuxRetainedNativeSupervisorRuntimeRootProvisionRequest({
        ...request,
        runtimeRoot: `${request.runtimeRootParent}/attempt-elsewhere`,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(() =>
      validateLinuxRetainedNativeSupervisorRuntimeRootProvisionRequest({
        ...request,
        provisioningAttemptId: 'secret-attempt',
        runtimeRoot: `${request.runtimeRootParent}/secret-attempt`,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    const accessor = { ...request } as Record<string, unknown>;
    Object.defineProperty(accessor, 'workspaceId', {
      enumerable: true,
      get: () => 'workspace-one',
    });
    expect(() =>
      validateLinuxRetainedNativeSupervisorRuntimeRootProvisionRequest(accessor),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
  });

  it('consumes a denied or cancelled attempt without retrying authority', async () => {
    const authorize = vi.fn(async () => ({ ...grant(), extra: true }));
    const provisioner = new BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner(
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

  it('denies pre-cancelled calls before authority', async () => {
    const authorize = vi.fn(async () => grant());
    const provisioner = new BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner(
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
