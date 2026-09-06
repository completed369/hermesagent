import type { OperationalEventCapability, WorkspaceContext } from '@ventureos/agent-control-plane';
import {
  createRetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner,
  createRetainedDescriptorLinuxNativeSupervisorPathProvisioner,
  createRetainedDescriptorLinuxNativeSupervisorRuntimeRootProvisioner,
  type BoundedLinuxRetainedNativeSupervisorParentDirectoryProvisioner,
  type BoundedLinuxRetainedNativeSupervisorPathProvisioner,
  type BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner,
  type LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest,
  type LinuxRetainedNativeSupervisorPathProvisionRequest,
  type LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest,
} from '@ventureos/agent-bridge';

import { BoundedLevel3RetainedNativeParentDirectoryAuthority } from './retained-native-parent-directory-authority';
import { BoundedLevel3RetainedNativePathProvisionAuthority } from './retained-native-path-provision-authority';
import { BoundedLevel3RetainedNativeRuntimeRootAuthority } from './retained-native-runtime-root-authority';

/**
 * Joins one exact Level-3 authority to the real retained-descriptor attempt-root
 * host. The caller must supply an already-attested owner-only parent and a fresh
 * attempt ID; construction is inert and performs no filesystem operation.
 */
export function createLevel3RetainedDescriptorLinuxNativeSupervisorRuntimeRootProvisioner(
  capability: OperationalEventCapability,
  context: WorkspaceContext,
  expectedRequest: Readonly<LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest>,
  clock: () => number = Date.now,
): BoundedLinuxRetainedNativeSupervisorRuntimeRootProvisioner {
  const authority = new BoundedLevel3RetainedNativeRuntimeRootAuthority(
    capability,
    context,
    expectedRequest,
    clock,
  );
  return createRetainedDescriptorLinuxNativeSupervisorRuntimeRootProvisioner(authority, clock);
}

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
