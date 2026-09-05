import { describe, expect, it, vi } from 'vitest';

import {
  BoundedLinuxRetainedNativeSupervisorPathProvisioner,
  DenyLinuxRetainedNativeSupervisorPathProvisionAuthority,
  type LinuxRetainedNativeSupervisorPathProvisionAuthority,
  type LinuxRetainedNativeSupervisorPathProvisionGrant,
  type LinuxRetainedNativeSupervisorPathProvisionHost,
  type LinuxRetainedNativeSupervisorPathProvisionRequest,
  linuxRetainedNativeSupervisorPathProvisionRequestHash,
  type ProvisionedLinuxRetainedNativeSupervisorPaths,
} from './retained-native-supervisor-linux-path-provisioner';

const NOW = Date.parse('2026-09-05T20:00:00.000Z');

function request(): LinuxRetainedNativeSupervisorPathProvisionRequest {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: 'CLIENT',
    sourceModulePath: '/build/ventureos/client.node',
    sourceModuleSha256: 'a'.repeat(64),
    sourceModuleIdentityReference: 'linux:dev-1:ino-2',
    sourceModuleOwnerUid: 1000,
    sourceModuleOwnerGid: 1000,
    sourceModuleMode: 0o500,
    sourceModuleSizeBytes: 64_000,
    moduleDirectory: '/opt/ventureos/native',
    canonicalModulePath: '/opt/ventureos/native/client.node',
    socketDirectoryParent: '/run/ventureos',
    socketDirectory: '/run/ventureos/supervisor',
    socketPath: '/run/ventureos/supervisor/recovery.sock',
    ownerUid: 1000,
    ownerGid: 1000,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function grant(
  provisionRequest: LinuxRetainedNativeSupervisorPathProvisionRequest = request(),
  override: Partial<LinuxRetainedNativeSupervisorPathProvisionGrant> = {},
): LinuxRetainedNativeSupervisorPathProvisionGrant {
  return {
    ...provisionRequest,
    provisioningId: 'native-paths-1',
    requestHash: linuxRetainedNativeSupervisorPathProvisionRequestHash(provisionRequest),
    validFrom: new Date(NOW - 1_000).toISOString(),
    validUntil: new Date(NOW + 60_000).toISOString(),
    ...override,
  };
}

function result(
  provisionGrant: LinuxRetainedNativeSupervisorPathProvisionGrant = grant(),
  override: Partial<ProvisionedLinuxRetainedNativeSupervisorPaths> = {},
): ProvisionedLinuxRetainedNativeSupervisorPaths {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: provisionGrant.moduleKind,
    provisioningId: provisionGrant.provisioningId,
    requestHash: provisionGrant.requestHash,
    canonicalModulePath: provisionGrant.canonicalModulePath,
    moduleSha256: provisionGrant.sourceModuleSha256,
    moduleIdentityReference: 'linux:dev-3:ino-4',
    moduleOwnerUid: provisionGrant.ownerUid,
    moduleOwnerGid: provisionGrant.ownerGid,
    moduleMode: 0o500,
    moduleSizeBytes: provisionGrant.sourceModuleSizeBytes,
    socketDirectory: provisionGrant.socketDirectory,
    socketDirectoryIdentityReference: 'linux:dev-5:ino-6',
    socketDirectoryOwnerUid: provisionGrant.ownerUid,
    socketDirectoryOwnerGid: provisionGrant.ownerGid,
    socketDirectoryMode: 0o700,
    socketPath: provisionGrant.socketPath,
    runtimeConnection: 'NOT_CONFIGURED',
    ...override,
  };
}

function authority(value: unknown): LinuxRetainedNativeSupervisorPathProvisionAuthority & {
  authorize: ReturnType<typeof vi.fn>;
} {
  return { authorize: vi.fn(async () => value) };
}

function host(value: unknown): LinuxRetainedNativeSupervisorPathProvisionHost & {
  provision: ReturnType<typeof vi.fn>;
} {
  return {
    platform: 'LINUX',
    architecture: 'X64',
    provision: vi.fn(() => value as ProvisionedLinuxRetainedNativeSupervisorPaths),
  };
}

describe('bounded Linux retained-native path provisioner', () => {
  it('defaults to denial and consumes the single attempt', async () => {
    const provisioner = new BoundedLinuxRetainedNativeSupervisorPathProvisioner();

    await expect(
      provisioner.provision(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(
      provisioner.provision(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    await expect(
      new DenyLinuxRetainedNativeSupervisorPathProvisionAuthority().authorize(request()),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('returns only exact owner-only attestation after explicit fresh authority', async () => {
    const provisionRequest = request();
    const provisionGrant = grant(provisionRequest);
    const source = authority(provisionGrant);
    const nativeHost = host(result(provisionGrant));
    const provisioner = new BoundedLinuxRetainedNativeSupervisorPathProvisioner(
      source,
      nativeHost,
      () => NOW,
    );

    const provisioned = await provisioner.provision(provisionRequest, new AbortController().signal);

    expect(provisioned).toMatchObject({
      moduleMode: 0o500,
      socketDirectoryMode: 0o700,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(Object.isFrozen(provisioned)).toBe(true);
    expect(source.authorize).toHaveBeenCalledOnce();
    expect(Object.isFrozen(source.authorize.mock.calls[0]![0])).toBe(true);
    expect(nativeHost.provision).toHaveBeenCalledOnce();
    expect(Object.isFrozen(nativeHost.provision.mock.calls[0]![0])).toBe(true);
  });

  it.each([
    { unexpected: true },
    { runtimeConnection: 'CONNECTED' },
    { platform: 'WINDOWS' },
    { sourceModulePath: '/build/ventureos/../client.node' },
    { sourceModuleMode: 0o700 },
    { sourceModuleSizeBytes: 0 },
    { canonicalModulePath: '/opt/ventureos/native/listener.node' },
    { canonicalModulePath: '/opt/elsewhere/client.node' },
    { socketDirectory: '/run/ventureos/../supervisor' },
    { socketPath: '/run/ventureos/recovery.sock' },
    { moduleDirectory: '/' },
    { socketDirectoryParent: '/' },
  ])('rejects malformed or over-broad paths before consulting authority: %o', async (override) => {
    const source = authority(grant());
    const provisioner = new BoundedLinuxRetainedNativeSupervisorPathProvisioner(
      source,
      host(result()),
      () => NOW,
    );

    await expect(
      provisioner.provision({ ...request(), ...override }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(source.authorize).not.toHaveBeenCalled();
  });

  it.each([
    { requestHash: 'b'.repeat(64) },
    { ownerUid: 1001 },
    { sourceModuleSha256: 'b'.repeat(64) },
    { validFrom: new Date(NOW + 1).toISOString() },
    { validUntil: new Date(NOW).toISOString() },
    {
      validFrom: new Date(NOW - 1_000).toISOString(),
      validUntil: new Date(NOW + 5 * 60_000).toISOString(),
    },
  ])('rejects stale or request-substituted authority: %o', async (override) => {
    const nativeHost = host(result());
    const provisioner = new BoundedLinuxRetainedNativeSupervisorPathProvisioner(
      authority(grant(request(), override)),
      nativeHost,
      () => NOW,
    );

    await expect(
      provisioner.provision(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(nativeHost.provision).not.toHaveBeenCalled();
  });

  it.each([
    { runtimeConnection: 'CONNECTED' },
    { moduleMode: 0o555 },
    { socketDirectoryMode: 0o755 },
    { moduleIdentityReference: 'invalid' },
    { moduleSha256: 'b'.repeat(64) },
    { socketPath: '/run/ventureos/supervisor/other.sock' },
    { extra: true },
  ])('rejects host attestation drift: %o', async (override) => {
    const provisionGrant = grant();
    const provisioner = new BoundedLinuxRetainedNativeSupervisorPathProvisioner(
      authority(provisionGrant),
      host({ ...result(provisionGrant), ...override }),
      () => NOW,
    );

    await expect(
      provisioner.provision(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
  });

  it('denies cancellation, host failure detail, and clock rollback', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    const source = authority(grant());
    await expect(
      new BoundedLinuxRetainedNativeSupervisorPathProvisioner(
        source,
        host(result()),
        () => NOW,
      ).provision(request(), cancelled.signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(source.authorize).not.toHaveBeenCalled();

    await expect(
      new BoundedLinuxRetainedNativeSupervisorPathProvisioner(
        authority(grant()),
        {
          platform: 'LINUX',
          architecture: 'X64',
          provision: vi.fn(() => {
            throw new Error('private path detail');
          }),
        },
        () => NOW,
      ).provision(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });

    const rollbackClock = vi
      .fn()
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW - 1);
    await expect(
      new BoundedLinuxRetainedNativeSupervisorPathProvisioner(
        authority(grant()),
        host(result()),
        rollbackClock,
      ).provision(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
  });
});
