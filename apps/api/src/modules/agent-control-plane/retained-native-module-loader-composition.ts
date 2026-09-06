import {
  createRetainedDescriptorLinuxNativeSupervisorModuleLoader,
  type BoundedLinuxRetainedNativeSupervisorModuleLoader,
} from '@ventureos/agent-bridge';

import {
  PostgresRetainedNativeModuleAuthorizationTrustComposition,
  type RetainedNativeModuleAuthorizationTrustTransactionClient,
} from './retained-native-module-authorization-trust-composition';

/**
 * Constructs one Linux-x64 retained-descriptor loader whose only positive
 * authorization source is the audited, checkpointed PostgreSQL trust chain.
 * Construction selects no path and performs no database, filesystem, native,
 * socket, or service action. The returned loader still consumes one explicit
 * request and remains absent from all application composition roots.
 */
export function createPostgresRetainedDescriptorLinuxNativeSupervisorModuleLoader(
  database: RetainedNativeModuleAuthorizationTrustTransactionClient,
  workspaceId: string,
  supervisorInstanceId: string,
): BoundedLinuxRetainedNativeSupervisorModuleLoader {
  const clock = Date.now;
  const authorizationSource = new PostgresRetainedNativeModuleAuthorizationTrustComposition(
    database,
    workspaceId,
    supervisorInstanceId,
    clock,
  );
  return createRetainedDescriptorLinuxNativeSupervisorModuleLoader(authorizationSource, clock);
}
