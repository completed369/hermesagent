import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import {
  BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner,
  linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash,
  type LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant,
  type LinuxRetainedNativeSupervisorParentDirectoryProvisionHost,
  type LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest,
  type ProvisionedLinuxRetainedNativeSupervisorParentDirectories,
} from '@ventureos/agent-bridge';
import { describe, expect, it, vi } from 'vitest';

import {
  BoundedLevel3RetainedNativeParentDirectoryAuthority,
  RetainedNativeParentDirectoryAuthorityDeniedError,
} from './retained-native-parent-directory-authority';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const context = Object.freeze({ workspaceId: 'workspace-one', principalId: 'principal-one' });
const expectedRequest: LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest = Object.freeze(
  {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_PARENT_DIRECTORIES_PROVISION',
    workspaceId: context.workspaceId,
    supervisorInstanceId: 'supervisor-one',
    platform: 'LINUX',
    architecture: 'X64',
    runtimeRoot: '/var/lib/ventureos/runtime-one',
    runtimeRootIdentityReference: 'linux:dev-1:ino-2',
    runtimeRootProvisioningId: 'runtime-root-provision-one',
    runtimeRootProvisionRequestHash: 'd'.repeat(64),
    runtimeRootApprovalEvidenceHash: 'e'.repeat(64),
    runtimeRootOwnerUid: 65532,
    runtimeRootOwnerGid: 65532,
    runtimeRootMode: 0o700,
    moduleDirectory: '/var/lib/ventureos/runtime-one/native',
    socketDirectoryParent: '/var/lib/ventureos/runtime-one/run',
    socketDirectory: '/var/lib/ventureos/runtime-one/run/supervisor',
    ownerUid: 65532,
    ownerGid: 65532,
    runtimeConnection: 'NOT_CONFIGURED',
  },
);

function capability(
  level: 0 | 1 | 2 | 3 | 4 = 3,
  actorKind: 'HUMAN' | 'AGENT' | 'RUNTIME' | 'SYSTEM' = 'SYSTEM',
  source: 'CONTROL_PLANE' | 'AI_COO' = 'CONTROL_PLANE',
) {
  return OperationalEventCapability.issue(source, [
    { ...context, actorKind, authorityLevel: level },
  ]);
}

describe('BoundedLevel3RetainedNativeParentDirectoryAuthority', () => {
  it('mints one exact tenant-bound digest-only Level-3 grant', async () => {
    const authority = new BoundedLevel3RetainedNativeParentDirectoryAuthority(
      capability(),
      context,
      expectedRequest,
      () => NOW,
    );
    const result = (await authority.authorize(
      expectedRequest,
    )) as LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant;
    expect(result).toMatchObject({
      ...expectedRequest,
      requestHash:
        linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash(expectedRequest),
      authorizedByReference: context.principalId,
      authorityLevel: 3,
      validFrom: new Date(NOW).toISOString(),
      validUntil: new Date(NOW + 60_000).toISOString(),
    });
    expect(result.approvalEvidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
    await expect(authority.authorize(expectedRequest)).rejects.toBeInstanceOf(
      RetainedNativeParentDirectoryAuthorityDeniedError,
    );
  });

  it.each([
    ['AI-COO source', capability(3, 'SYSTEM', 'AI_COO')],
    ['Level 2', capability(2)],
    ['Level 4', capability(4)],
    ['runtime actor', capability(3, 'RUNTIME')],
  ])('rejects %s at construction', (_label, candidate) => {
    expect(
      () =>
        new BoundedLevel3RetainedNativeParentDirectoryAuthority(
          candidate,
          context,
          expectedRequest,
          () => NOW,
        ),
    ).toThrow();
  });

  it('rejects cross-workspace scope, request drift, and invalid clocks', async () => {
    expect(
      () =>
        new BoundedLevel3RetainedNativeParentDirectoryAuthority(
          capability(),
          context,
          { ...expectedRequest, workspaceId: 'workspace-two' },
          () => NOW,
        ),
    ).toThrow(/Cross-workspace/u);
    const drift = new BoundedLevel3RetainedNativeParentDirectoryAuthority(
      capability(),
      context,
      expectedRequest,
      () => NOW,
    );
    await expect(
      drift.authorize({ ...expectedRequest, supervisorInstanceId: 'supervisor-two' }),
    ).rejects.toThrow(/drifted/u);
    const invalidClock = new BoundedLevel3RetainedNativeParentDirectoryAuthority(
      capability(),
      context,
      expectedRequest,
      () => Number.NaN,
    );
    await expect(invalidClock.authorize(expectedRequest)).rejects.toThrow(/clock/u);
  });

  it('is accepted by the one-shot boundary without gaining filesystem authority', async () => {
    const authority = new BoundedLevel3RetainedNativeParentDirectoryAuthority(
      capability(),
      context,
      expectedRequest,
      () => NOW,
    );
    const host: LinuxRetainedNativeSupervisorParentDirectoryProvisionHost = {
      platform: 'LINUX',
      architecture: 'X64',
      provision: vi.fn((grant): ProvisionedLinuxRetainedNativeSupervisorParentDirectories => ({
        schemaVersion: 1,
        purpose: grant.purpose,
        workspaceId: grant.workspaceId,
        supervisorInstanceId: grant.supervisorInstanceId,
        platform: 'LINUX',
        architecture: 'X64',
        provisioningId: grant.provisioningId,
        requestHash: grant.requestHash,
        approvalId: grant.approvalId,
        approvalEvidenceHash: grant.approvalEvidenceHash,
        authorizedByReference: grant.authorizedByReference,
        authorityLevel: 3,
        authorizedFrom: grant.validFrom,
        authorizedUntil: grant.validUntil,
        moduleDirectory: grant.moduleDirectory,
        moduleDirectoryIdentityReference: 'linux:dev-1:ino-3',
        socketDirectoryParent: grant.socketDirectoryParent,
        socketDirectoryParentIdentityReference: 'linux:dev-1:ino-4',
        socketDirectory: grant.socketDirectory,
        socketDirectoryIdentityReference: 'linux:dev-1:ino-5',
        ownerUid: grant.ownerUid,
        ownerGid: grant.ownerGid,
        directoryMode: 0o700,
        runtimeConnection: 'NOT_CONFIGURED',
      })),
    };
    const result = await new BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner(
      authority,
      host,
      () => NOW,
    ).provision(expectedRequest, new AbortController().signal);
    expect(result).toMatchObject({
      workspaceId: context.workspaceId,
      authorityLevel: 3,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(host.provision).toHaveBeenCalledOnce();
  });
});
