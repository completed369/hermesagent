import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport,
  authenticateRetainedNativeSupervisorLocalIpcAuthorization,
  BoundedLinuxRetainedNativeSupervisorLocalIpcClient,
  BoundedLinuxRetainedNativeSupervisorNativeClientBinding,
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  RetainedNativeSupervisorLocalIpcError,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
  type LoadedLinuxRetainedNativeSupervisorClientModule,
} from '@ventureos/agent-bridge';

const LOADED_CLIENT_MODULE_KEYS = [
  'moduleKind',
  'nativeModule',
  'runtimeConnection',
  'schemaVersion',
  'socketPath',
] as const;

function denyInvalidAuthorization(): never {
  throw new RetainedNativeSupervisorLocalIpcError('INVALID_AUTHORIZATION');
}

function authenticateLoadedClientModule(
  input: unknown,
): Readonly<LoadedLinuxRetainedNativeSupervisorClientModule> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return denyInvalidAuthorization();
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return denyInvalidAuthorization();
    const record = input as Record<string, unknown>;
    const actual = Object.keys(record).sort();
    const expected = [...LOADED_CLIENT_MODULE_KEYS].sort();
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
      LOADED_CLIENT_MODULE_KEYS.map((key) => [key, descriptors[key]?.value]),
    );
    if (
      values.schemaVersion !== 1 ||
      values.moduleKind !== 'CLIENT' ||
      values.runtimeConnection !== 'NOT_CONFIGURED'
    ) {
      return denyInvalidAuthorization();
    }
    return Object.freeze({
      schemaVersion: 1,
      moduleKind: 'CLIENT',
      socketPath: values.socketPath,
      runtimeConnection: 'NOT_CONFIGURED',
      nativeModule: values.nativeModule,
    }) as Readonly<LoadedLinuxRetainedNativeSupervisorClientModule>;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return denyInvalidAuthorization();
  }
}

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

/**
 * Binds one already-authorized loaded CLIENT module to the strict native ABI, closable Linux
 * client, and worker root source. Construction loads no code and performs no native or IPC call.
 */
export function createLoadedLinuxNativeTopologyCarrierRootSource(
  loadedModuleInput: unknown,
  binding: unknown,
  localIpcAuthorizationInput: unknown,
  clock: () => number = Date.now,
  timeoutMs = 2_000,
): BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource {
  const loadedModule = authenticateLoadedClientModule(loadedModuleInput);
  const localIpcAuthorization = authenticateRetainedNativeSupervisorLocalIpcAuthorization(
    localIpcAuthorizationInput,
  );
  if (loadedModule.socketPath !== localIpcAuthorization.socketPath) {
    return denyInvalidAuthorization();
  }
  const nativeBinding = new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(
    loadedModule.nativeModule,
  );
  const client = new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(nativeBinding);
  return createLinuxLocalTopologyCarrierRootSource(
    client,
    binding,
    localIpcAuthorization,
    clock,
    timeoutMs,
  );
}
