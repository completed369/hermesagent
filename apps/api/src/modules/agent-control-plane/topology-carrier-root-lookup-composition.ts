import { BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler } from '@ventureos/agent-bridge';

import { PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource } from './topology-carrier-signature-root-source';
import type { TopologyCarrierSignatureRootSqlClient } from './topology-carrier-signature-root-registry';

/**
 * Binds one live carrier authorization to the API coordinator's least-authority
 * public-root source and authenticated lookup handler. Construction is inert:
 * it performs no database read, accepts no request, and selects no listener,
 * transport, route, key, socket, mount, process, or application composition.
 */
export function createPostgresApiCoordinatorTopologyCarrierRootLookupHandler(
  database: TopologyCarrierSignatureRootSqlClient,
  binding: unknown,
  clock: () => number = Date.now,
  timeoutMs = 2_000,
): BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler {
  const source = new PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource(
    database,
    binding,
    clock,
  );
  return new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
    binding,
    source,
    clock,
    timeoutMs,
  );
}
