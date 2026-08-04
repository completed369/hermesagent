import { ApplicationFailure } from '@temporalio/activity';
import {
  enforceWorkspaceCapability,
  isCapabilityPolicyDeniedError,
  type EnforceCapabilityParams,
} from '@ventureos/database';

function rethrowAsNonRetryablePolicyDenial(error: unknown): never {
  if (isCapabilityPolicyDeniedError(error)) {
    throw ApplicationFailure.nonRetryable('Operation is not available', 'CAPABILITY_POLICY_DENIED');
  }
  throw error;
}

/**
 * Revalidates authoritative policy at activity execution and also translates a
 * later denial from a nested runner/provider-boundary recheck. Temporal may
 * retry transient provider failures, but must never retry deterministic policy
 * denial.
 */
export async function runWithActivityCapability<T>(
  params: EnforceCapabilityParams,
  execute: () => Promise<T>,
): Promise<T> {
  try {
    await enforceWorkspaceCapability(params);
    return await execute();
  } catch (error) {
    rethrowAsNonRetryablePolicyDenial(error);
  }
}
