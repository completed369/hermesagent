import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler,
  BoundedLinuxRetainedNativeSupervisorNativeListenerBinding,
  BoundedLinuxRetainedNativeSupervisorServiceOwner,
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler,
  RetainedNativeSupervisorLocalIpcError,
  validateLinuxRetainedNativeSupervisorServiceRequest,
  type LoadedLinuxRetainedNativeSupervisorListenerModule,
} from '@ventureos/agent-bridge';

import { BoundedLevel3RetainedNativeSupervisorServiceAuthority } from './retained-native-service-authority';
import { PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource } from './topology-carrier-signature-root-source';
import type { TopologyCarrierSignatureRootSqlClient } from './topology-carrier-signature-root-registry';

const LOADED_LISTENER_MODULE_KEYS = [
  'moduleKind',
  'nativeModule',
  'runtimeConnection',
  'schemaVersion',
  'socketPath',
] as const;

function denyInvalidAuthorization(): never {
  throw new RetainedNativeSupervisorLocalIpcError('INVALID_AUTHORIZATION');
}

function authenticateLoadedListenerModule(
  input: unknown,
): Readonly<LoadedLinuxRetainedNativeSupervisorListenerModule> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return denyInvalidAuthorization();
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return denyInvalidAuthorization();
    const record = input as Record<string, unknown>;
    const actual = Object.keys(record).sort();
    const expected = [...LOADED_LISTENER_MODULE_KEYS].sort();
    const ownKeys = Reflect.ownKeys(record);
    const descriptors = Object.getOwnPropertyDescriptors(record);
    if (
      actual.length !== expected.length ||
      ownKeys.length !== actual.length ||
      ownKeys.some((key) => typeof key !== 'string') ||
      actual.some((key, index) => key !== expected[index]) ||
      actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value'))
    ) {
      return denyInvalidAuthorization();
    }
    const values = Object.fromEntries(
      LOADED_LISTENER_MODULE_KEYS.map((key) => [key, descriptors[key]?.value]),
    );
    if (
      values.schemaVersion !== 1 ||
      values.moduleKind !== 'LISTENER' ||
      values.runtimeConnection !== 'NOT_CONFIGURED'
    ) {
      return denyInvalidAuthorization();
    }
    return Object.freeze({
      schemaVersion: 1,
      moduleKind: 'LISTENER',
      socketPath: values.socketPath,
      runtimeConnection: 'NOT_CONFIGURED',
      nativeModule: values.nativeModule,
    }) as Readonly<LoadedLinuxRetainedNativeSupervisorListenerModule>;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return denyInvalidAuthorization();
  }
}

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

/**
 * Extends the inert database-to-protocol composition through one Linux kernel-authenticated inbound
 * endpoint. The local IPC authorization is still injected, and construction opens no listener,
 * socket, route, mount, native module, or application service.
 */
export function createPostgresApiCoordinatorLinuxLocalTopologyCarrierRootLookupHandler(
  database: TopologyCarrierSignatureRootSqlClient,
  binding: unknown,
  localIpcAuthorization: unknown,
  clock: () => number = Date.now,
  timeoutMs = 2_000,
): AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler {
  const handler = createPostgresApiCoordinatorTopologyCarrierRootLookupHandler(
    database,
    binding,
    clock,
    timeoutMs,
  );
  return new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
    handler,
    binding,
    localIpcAuthorization,
    clock,
  );
}

/**
 * Binds one already-authorized loaded LISTENER module to the strict native ABI and the exact
 * Level-3 carrier-root service authority. Construction invokes neither native code nor authority,
 * and the returned owner remains one-use and absent from application composition.
 */
export function createLoadedLinuxNativeTopologyCarrierRootLookupServiceOwner(
  loadedModuleInput: unknown,
  authority: BoundedLevel3RetainedNativeSupervisorServiceAuthority,
  serviceRequestInput: unknown,
  clock: () => number = Date.now,
): BoundedLinuxRetainedNativeSupervisorServiceOwner {
  const loadedModule = authenticateLoadedListenerModule(loadedModuleInput);
  const serviceRequest = validateLinuxRetainedNativeSupervisorServiceRequest(serviceRequestInput);
  if (
    !(authority instanceof BoundedLevel3RetainedNativeSupervisorServiceAuthority) ||
    typeof clock !== 'function' ||
    serviceRequest.serviceKind !== 'TOPOLOGY_CARRIER_ROOT_LOOKUP_API_LISTENER' ||
    serviceRequest.socketPath !== loadedModule.socketPath
  ) {
    return denyInvalidAuthorization();
  }
  const nativeBinding = new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(
    loadedModule.nativeModule,
  );
  return new BoundedLinuxRetainedNativeSupervisorServiceOwner(nativeBinding, authority, clock);
}
