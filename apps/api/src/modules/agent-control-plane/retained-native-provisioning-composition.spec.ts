import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import type {
  BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner,
  BoundedLinuxRetainedNativeSupervisorPathProvisioner,
  LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest,
  LinuxRetainedNativeSupervisorPathProvisionRequest,
} from '@ventureos/agent-bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BoundedLevel3RetainedNativeParentDirectoryAuthority } from './retained-native-parent-directory-authority';
import { BoundedLevel3RetainedNativePathProvisionAuthority } from './retained-native-path-provision-authority';
import {
  createLevel3RetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner,
  createLevel3RetainedDescriptorLinuxNativeSupervisorPathProvisioner,
} from './retained-native-provisioning-composition';

const mocks = vi.hoisted(() => ({
  createParent: vi.fn(),
  createPath: vi.fn(),
}));

vi.mock('@ventureos/agent-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ventureos/agent-bridge')>()),
  createRetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner: mocks.createParent,
  createRetainedDescriptorLinuxNativeSupervisorPathProvisioner: mocks.createPath,
}));

const clock = () => Date.parse('2030-01-01T12:00:00.000Z');
const context = Object.freeze({ workspaceId: 'workspace-one', principalId: 'principal-one' });

function capability(
  authorityLevel: 0 | 1 | 2 | 3 | 4 = 3,
  actorKind: 'HUMAN' | 'AGENT' | 'RUNTIME' | 'SYSTEM' = 'SYSTEM',
  source: 'CONTROL_PLANE' | 'AI_COO' = 'CONTROL_PLANE',
  boundContext: Readonly<{ workspaceId: string; principalId: string }> = context,
): OperationalEventCapability {
  return OperationalEventCapability.issue(source, [{ ...boundContext, actorKind, authorityLevel }]);
}

const parentRequest: LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_PARENT_DIRECTORIES_PROVISION',
  workspaceId: context.workspaceId,
  supervisorInstanceId: 'native-supervisor-1',
  platform: 'LINUX',
  architecture: 'X64',
  runtimeRoot: '/var/lib/ventureos/runtime/workspace-one/native-supervisor-1',
  runtimeRootIdentityReference: 'linux:dev-1:ino-64',
  runtimeRootOwnerUid: 10001,
  runtimeRootOwnerGid: 10001,
  runtimeRootMode: 448,
  moduleDirectory: '/var/lib/ventureos/runtime/workspace-one/native-supervisor-1/native',
  socketDirectoryParent: '/var/lib/ventureos/runtime/workspace-one/native-supervisor-1/run',
  socketDirectory: '/var/lib/ventureos/runtime/workspace-one/native-supervisor-1/run/supervisor',
  ownerUid: 10001,
  ownerGid: 10001,
  runtimeConnection: 'NOT_CONFIGURED',
});

const pathRequest: LinuxRetainedNativeSupervisorPathProvisionRequest = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_PATH_PROVISION',
  workspaceId: context.workspaceId,
  supervisorInstanceId: 'native-supervisor-1',
  platform: 'LINUX',
  architecture: 'X64',
  moduleKind: 'CLIENT',
  sourceModulePath: '/reviewed/linux-retained-native-client.node',
  sourceModuleIdentityReference: 'linux:dev-1:ino-c8',
  sourceModuleOwnerUid: 0,
  sourceModuleOwnerGid: 0,
  sourceModuleSha256: 'a'.repeat(64),
  sourceModuleSizeBytes: 4096,
  sourceModuleMode: 320,
  parentDirectoryProvisioningId: 'native-parent-directories:parent-evidence',
  parentDirectoryProvisionRequestHash: 'b'.repeat(64),
  parentDirectoryApprovalEvidenceHash: 'c'.repeat(64),
  moduleDirectory: parentRequest.moduleDirectory,
  moduleDirectoryIdentityReference: 'linux:dev-1:ino-65',
  canonicalModulePath: `${parentRequest.moduleDirectory}/client.node`,
  socketDirectoryParent: parentRequest.socketDirectoryParent,
  socketDirectoryParentIdentityReference: 'linux:dev-1:ino-66',
  socketDirectory: parentRequest.socketDirectory,
  socketDirectoryIdentityReference: 'linux:dev-1:ino-67',
  socketPath: `${parentRequest.socketDirectory}/supervisor.sock`,
  ownerUid: parentRequest.ownerUid,
  ownerGid: parentRequest.ownerGid,
  runtimeConnection: 'NOT_CONFIGURED',
});

describe('retained-native Level-3 provisioning composition', () => {
  beforeEach(() => {
    mocks.createParent.mockReset();
    mocks.createPath.mockReset();
  });

  it('binds the real parent host factory only to exact Level-3 authority and one clock', () => {
    const provisioner = Object.freeze(
      {},
    ) as BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner;
    mocks.createParent.mockReturnValueOnce(provisioner);

    expect(
      createLevel3RetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner(
        capability(),
        context,
        parentRequest,
        clock,
      ),
    ).toBe(provisioner);
    expect(mocks.createParent).toHaveBeenCalledWith(
      expect.any(BoundedLevel3RetainedNativeParentDirectoryAuthority),
      clock,
    );
  });

  it('binds the real path host factory only to exact Level-3 authority and one clock', () => {
    const provisioner = Object.freeze({}) as BoundedLinuxRetainedNativeSupervisorPathProvisioner;
    mocks.createPath.mockReturnValueOnce(provisioner);

    expect(
      createLevel3RetainedDescriptorLinuxNativeSupervisorPathProvisioner(
        capability(),
        context,
        pathRequest,
        clock,
      ),
    ).toBe(provisioner);
    expect(mocks.createPath).toHaveBeenCalledWith(
      expect.any(BoundedLevel3RetainedNativePathProvisionAuthority),
      clock,
    );
  });

  it('rejects cross-workspace parent authority before constructing a real host', () => {
    const otherContext = { ...context, workspaceId: 'workspace-two' };
    expect(() =>
      createLevel3RetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner(
        capability(3, 'SYSTEM', 'CONTROL_PLANE', otherContext),
        otherContext,
        parentRequest,
        clock,
      ),
    ).toThrow('Cross-workspace parent-directory authority denied');
    expect(mocks.createParent).not.toHaveBeenCalled();
  });

  it('rejects cross-workspace path authority before constructing a real host', () => {
    const otherContext = { ...context, workspaceId: 'workspace-two' };
    expect(() =>
      createLevel3RetainedDescriptorLinuxNativeSupervisorPathProvisioner(
        capability(3, 'SYSTEM', 'CONTROL_PLANE', otherContext),
        otherContext,
        pathRequest,
        clock,
      ),
    ).toThrow('Cross-workspace path-provision authority denied');
    expect(mocks.createPath).not.toHaveBeenCalled();
  });

  it('rejects Level-4 and AI-COO authority before constructing either real host', () => {
    expect(() =>
      createLevel3RetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner(
        capability(4),
        context,
        parentRequest,
        clock,
      ),
    ).toThrow('Exact Level-3 trusted control-plane authority is required');
    expect(() =>
      createLevel3RetainedDescriptorLinuxNativeSupervisorPathProvisioner(
        capability(3, 'SYSTEM', 'AI_COO'),
        context,
        pathRequest,
        clock,
      ),
    ).toThrow();
    expect(mocks.createParent).not.toHaveBeenCalled();
    expect(mocks.createPath).not.toHaveBeenCalled();
  });
});
