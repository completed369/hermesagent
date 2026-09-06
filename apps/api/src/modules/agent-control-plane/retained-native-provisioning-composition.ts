import type { OperationalEventCapability, WorkspaceContext } from '@ventureos/agent-control-plane';
import {
  createRetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner,
  createRetainedDescriptorLinuxNativeSupervisorPathProvisioner,
  type BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner,
  type BoundedLinuxRetainedNativeSupervisorPathProvisioner,
  type LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest,
  type LinuxRetainedNativeSupervisorPathProvisionRequest,
} from '@ventureos/agent-bridge';

import { BoundedLevel3RetainedNativeParentDirectoryAuthority } from './retained-native-parent-directory-authority';
import { BoundedLevel3RetainedNativePathProvisionAuthority } from './retained-native-path-provision-authority';

/**
 * Joins one exact Level-3 control-plane authority to the real retained-descriptor
 * Linux parent-directory host. Construction performs no filesystem operation;
 * the returned provisioner remains one-attempt and absent from application roots.
 */
export function createLevel3RetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner(
  capability: OperationalEventCapability,
  context: WorkspaceContext,
  expectedRequest: Readonly<LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest>,
  clock: () => number = Date.now,
): BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner {
  const authority = new BoundedLevel3RetainedNativeParentDirectoryAuthority(
    capability,
    context,
    expectedRequest,
    clock,
  );
  return createRetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner(authority, clock);
}

/**
 * Joins one exact Level-3 control-plane authority to the real retained-descriptor
 * Linux module-path host. Construction performs no filesystem operation; the
 * returned provisioner remains one-attempt and cannot own the shared directory.
 */
export function createLevel3RetainedDescriptorLinuxNativeSupervisorPathProvisioner(
  capability: OperationalEventCapability,
  context: WorkspaceContext,
  expectedRequest: Readonly<LinuxRetainedNativeSupervisorPathProvisionRequest>,
  clock: () => number = Date.now,
): BoundedLinuxRetainedNativeSupervisorPathProvisioner {
  const authority = new BoundedLevel3RetainedNativePathProvisionAuthority(
    capability,
    context,
    expectedRequest,
    clock,
  );
  return createRetainedDescriptorLinuxNativeSupervisorPathProvisioner(authority, clock);
}
