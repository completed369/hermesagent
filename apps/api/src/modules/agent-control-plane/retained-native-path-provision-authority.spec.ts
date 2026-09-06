import { createHash } from 'node:crypto';

import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import {
  BoundedLinuxRetainedNativeSupervisorPathProvisioner,
  canonicalJson,
  linuxRetainedNativeSupervisorPathProvisionRequestHash,
  type LinuxRetainedNativeSupervisorPathProvisionGrant,
  type LinuxRetainedNativeSupervisorPathProvisionHost,
  type LinuxRetainedNativeSupervisorPathProvisionRequest,
  type ProvisionedLinuxRetainedNativeSupervisorPaths,
} from '@ventureos/agent-bridge';
import { describe, expect, it, vi } from 'vitest';

import {
  BoundedLevel3RetainedNativePathProvisionAuthority,
  RetainedNativePathProvisionAuthorityDeniedError,
} from './retained-native-path-provision-authority';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const context = Object.freeze({ workspaceId: 'workspace-1', principalId: 'control-plane-owner-1' });

function request(
  overrides: Partial<LinuxRetainedNativeSupervisorPathProvisionRequest> = {},
): LinuxRetainedNativeSupervisorPathProvisionRequest {
  return {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_PATH_PROVISION',
    workspaceId: context.workspaceId,
    supervisorInstanceId: 'native-supervisor-1',
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: 'LISTENER',
    sourceModulePath: '/usr/lib/ventureos/native/linux-retained-native-listener.node',
    sourceModuleSha256: 'a'.repeat(64),
    sourceModuleIdentityReference: 'linux:dev-1:ino-2',
    sourceModuleOwnerUid: 0,
    sourceModuleOwnerGid: 0,
    sourceModuleMode: 0o444,
    sourceModuleSizeBytes: 64_000,
    parentDirectoryProvisioningId: 'parent-directories-listener-1',
    parentDirectoryProvisionRequestHash: 'b'.repeat(64),
    parentDirectoryApprovalEvidenceHash: 'c'.repeat(64),
    moduleDirectory: '/var/lib/ventureos/native',
    moduleDirectoryIdentityReference: 'linux:dev-3:ino-4',
    canonicalModulePath: '/var/lib/ventureos/native/listener.node',
    socketDirectoryParent: '/run/ventureos',
    socketDirectoryParentIdentityReference: 'linux:dev-5:ino-6',
    socketDirectory: '/run/ventureos/supervisor',
    socketPath: '/run/ventureos/supervisor/recovery.sock',
    ownerUid: 65532,
    ownerGid: 65532,
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  };
}

function capability(
  authorityLevel: 0 | 1 | 2 | 3 | 4 = 3,
  actorKind: 'HUMAN' | 'AGENT' | 'RUNTIME' | 'SYSTEM' = 'SYSTEM',
  source: 'CONTROL_PLANE' | 'AI_COO' = 'CONTROL_PLANE',
) {
  return OperationalEventCapability.issue(source, [{ ...context, actorKind, authorityLevel }]);
}

describe('BoundedLevel3RetainedNativePathProvisionAuthority', () => {
  it('mints one exact tenant-scoped, supervisor-scoped, digest-only Level-3 grant', async () => {
    const expectedRequest = request();
    const authority = new BoundedLevel3RetainedNativePathProvisionAuthority(
      capability(),
      context,
      expectedRequest,
      () => NOW,
    );
    const result = (await authority.authorize(expectedRequest)) as Record<string, unknown>;
    const evidence = {
      evidencePurpose: 'RETAINED_NATIVE_PATH_PROVISION_LEVEL3_AUTHORIZATION',
      policyVersion: 1,
      request: expectedRequest,
      authorizedByReference: context.principalId,
      actorKind: 'SYSTEM',
      authorityLevel: 3,
      validFrom: '2030-01-01T12:00:00.000Z',
      validUntil: '2030-01-01T12:01:00.000Z',
    };
    const approvalEvidenceHash = createHash('sha256').update(canonicalJson(evidence)).digest('hex');
    expect(result).toEqual({
      ...expectedRequest,
      provisioningId: `native-path-provision:${approvalEvidenceHash}`,
      requestHash: linuxRetainedNativeSupervisorPathProvisionRequestHash(expectedRequest),
      approvalId: `level3-control-plane:${approvalEvidenceHash}`,
      approvalEvidenceHash,
      authorizedByReference: context.principalId,
      authorityLevel: 3,
      validFrom: '2030-01-01T12:00:00.000Z',
      validUntil: '2030-01-01T12:01:00.000Z',
    });
    expect(Object.isFrozen(result)).toBe(true);
    await expect(authority.authorize(expectedRequest)).rejects.toBeInstanceOf(
      RetainedNativePathProvisionAuthorityDeniedError,
    );
  });

  it.each([
    ['wrong source', capability(3, 'SYSTEM', 'AI_COO')],
    ['insufficient authority', capability(2)],
    ['Level-4 authority', capability(4)],
    ['runtime principal', capability(3, 'RUNTIME')],
  ])('rejects %s at construction', (_name, trustedCapability) => {
    expect(
      () =>
        new BoundedLevel3RetainedNativePathProvisionAuthority(
          trustedCapability,
          context,
          request(),
          () => NOW,
        ),
    ).toThrow();
  });

  it('rejects cross-workspace, malformed, drifted, and invalid-clock requests', async () => {
    expect(
      () =>
        new BoundedLevel3RetainedNativePathProvisionAuthority(
          capability(),
          context,
          request({ workspaceId: 'workspace-2' }),
          () => NOW,
        ),
    ).toThrow(/Cross-workspace/u);
    expect(
      () =>
        new BoundedLevel3RetainedNativePathProvisionAuthority(
          capability(),
          context,
          { ...request(), extra: true },
          () => NOW,
        ),
    ).toThrow(/invalid/u);
    const drifted = new BoundedLevel3RetainedNativePathProvisionAuthority(
      capability(),
      context,
      request(),
      () => NOW,
    );
    await expect(drifted.authorize(request({ ownerUid: 65531 }))).rejects.toThrow(/drifted/u);
    await expect(drifted.authorize(request())).rejects.toThrow(/one-shot/u);
    const invalidClock = new BoundedLevel3RetainedNativePathProvisionAuthority(
      capability(),
      context,
      request(),
      () => Number.NaN,
    );
    await expect(invalidClock.authorize(request())).rejects.toThrow(/clock/u);
  });

  it('is accepted by the one-shot path provisioner without gaining filesystem authority', async () => {
    const expectedRequest = request();
    const authority = new BoundedLevel3RetainedNativePathProvisionAuthority(
      capability(),
      context,
      expectedRequest,
      () => NOW,
    );
    const host: LinuxRetainedNativeSupervisorPathProvisionHost = {
      platform: 'LINUX',
      architecture: 'X64',
      provision: vi.fn(
        (
          grant: Readonly<LinuxRetainedNativeSupervisorPathProvisionGrant>,
        ): Readonly<ProvisionedLinuxRetainedNativeSupervisorPaths> => ({
          schemaVersion: 1,
          purpose: grant.purpose,
          workspaceId: grant.workspaceId,
          supervisorInstanceId: grant.supervisorInstanceId,
          platform: 'LINUX',
          architecture: 'X64',
          moduleKind: grant.moduleKind,
          provisioningId: grant.provisioningId,
          requestHash: grant.requestHash,
          approvalId: grant.approvalId,
          approvalEvidenceHash: grant.approvalEvidenceHash,
          authorizedByReference: grant.authorizedByReference,
          authorityLevel: 3,
          authorizedFrom: grant.validFrom,
          authorizedUntil: grant.validUntil,
          parentDirectoryProvisioningId: grant.parentDirectoryProvisioningId,
          parentDirectoryProvisionRequestHash: grant.parentDirectoryProvisionRequestHash,
          parentDirectoryApprovalEvidenceHash: grant.parentDirectoryApprovalEvidenceHash,
          canonicalModulePath: grant.canonicalModulePath,
          moduleSha256: grant.sourceModuleSha256,
          moduleIdentityReference: 'linux:dev-3:ino-4',
          moduleOwnerUid: grant.ownerUid,
          moduleOwnerGid: grant.ownerGid,
          moduleMode: 0o500,
          moduleSizeBytes: grant.sourceModuleSizeBytes,
          socketDirectory: grant.socketDirectory,
          socketDirectoryIdentityReference: 'linux:dev-5:ino-6',
          socketDirectoryOwnerUid: grant.ownerUid,
          socketDirectoryOwnerGid: grant.ownerGid,
          socketDirectoryMode: 0o700,
          socketPath: grant.socketPath,
          runtimeConnection: 'NOT_CONFIGURED',
        }),
      ),
    };
    const result = await new BoundedLinuxRetainedNativeSupervisorPathProvisioner(
      authority,
      host,
      () => NOW,
    ).provision(expectedRequest, new AbortController().signal);

    expect(result).toMatchObject({
      workspaceId: context.workspaceId,
      supervisorInstanceId: expectedRequest.supervisorInstanceId,
      authorityLevel: 3,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(host.provision).toHaveBeenCalledOnce();
  });
});
