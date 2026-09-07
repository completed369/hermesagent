import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport,
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
} from '@ventureos/agent-bridge';

/**
 * Binds one injected closable Linux IPC client to the worker's one-use carrier-root source.
 * Construction performs no exchange and discovers no client, path, socket, native module, mount,
 * principal, service lifecycle, or application wiring.
 */
export function createLinuxLocalTopologyCarrierRootSource(
  client: ClosableRetainedNativeSupervisorLocalIpcClient,
  binding: unknown,
  localIpcAuthorization: unknown,
  clock: () => number = Date.now,
  timeoutMs = 2_000,
): BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource {
  const transport =
    new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport(
      client,
      binding,
      localIpcAuthorization,
      clock,
    );
  return new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource(
    binding,
    transport,
    clock,
    timeoutMs,
  );
}
