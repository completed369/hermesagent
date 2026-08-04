import { ForbiddenException } from '@nestjs/common';
import {
  CapabilityPolicyDeniedError,
  enforceWorkspaceCapability,
  type ProtectedCapability,
} from '@ventureos/database';

export async function enforceCapabilityAdmission(
  workspaceId: string,
  capability: ProtectedCapability,
  providerMode?: string,
): Promise<void> {
  try {
    await enforceWorkspaceCapability({
      workspaceId,
      capability,
      stage: 'ADMISSION',
      providerMode,
    });
  } catch (error) {
    if (error instanceof CapabilityPolicyDeniedError) {
      throw new ForbiddenException('Operation is not available');
    }
    throw error;
  }
}

export function rethrowCapabilityPolicyDenial(error: unknown): void {
  if (error instanceof CapabilityPolicyDeniedError) {
    throw new ForbiddenException('Operation is not available');
  }
}
