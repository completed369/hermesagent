import {
  BoundedLinuxRetainedNativeSupervisorModuleLoader,
  BoundedLinuxRetainedNativeSupervisorNativeListenerBinding,
  BoundedLinuxRetainedNativeSupervisorServiceOwner,
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  DenyLinuxRetainedNativeSupervisorServiceAuthority,
  RetainedNativeSupervisorLocalIpcError,
  authenticateBoundedLinuxRetainedNativeSupervisorServiceOwner,
  validateLinuxRetainedNativeSupervisorModuleLoadRequest,
  validateLinuxRetainedNativeSupervisorServiceRequest,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  type LinuxRetainedNativeSupervisorServiceAuthority,
  type LoadedLinuxRetainedNativeSupervisorListenerModule,
} from '@ventureos/agent-bridge';

import { loadAuthenticatedSigningRetainedDescriptorKeylessRootResolvedLinuxNativeTopologyCarrierWorker } from './topology-carrier-root-lookup-composition';

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
    if (typeof input !== 'object' || input === null || Array.isArray(input))
      return denyInvalidAuthorization();
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
    )
      return denyInvalidAuthorization();
    const values = Object.fromEntries(
      LOADED_LISTENER_MODULE_KEYS.map((key) => [key, descriptors[key]?.value]),
    );
    if (
      values.schemaVersion !== 1 ||
      values.moduleKind !== 'LISTENER' ||
      values.runtimeConnection !== 'NOT_CONFIGURED'
    )
      return denyInvalidAuthorization();
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
 * Binds one already-authorized loaded LISTENER module to an explicitly supplied service authority.
 * Construction invokes neither native code nor authority and leaves the owner one-use.
 */
export function createLoadedLinuxNativeTopologyCarrierWorkerListenerServiceOwner(
  loadedModuleInput: unknown,
  authority: LinuxRetainedNativeSupervisorServiceAuthority,
  serviceRequestInput: unknown,
  clock: () => number = Date.now,
): BoundedLinuxRetainedNativeSupervisorServiceOwner {
  const loadedModule = authenticateLoadedListenerModule(loadedModuleInput);
  const serviceRequest = validateLinuxRetainedNativeSupervisorServiceRequest(serviceRequestInput);
  if (
    authority instanceof DenyLinuxRetainedNativeSupervisorServiceAuthority ||
    !authority ||
    typeof authority.authorize !== 'function' ||
    typeof clock !== 'function' ||
    serviceRequest.serviceKind !== 'TOPOLOGY_CARRIER_WORKER_LISTENER' ||
    serviceRequest.socketPath !== loadedModule.socketPath
  )
    return denyInvalidAuthorization();
  const nativeBinding = new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(
    loadedModule.nativeModule,
  );
  return new BoundedLinuxRetainedNativeSupervisorServiceOwner(nativeBinding, authority, clock);
}

/** Loads exactly one authorized LISTENER module without running the resulting service owner. */
export async function loadLinuxNativeTopologyCarrierWorkerListenerServiceOwner(
  loader: BoundedLinuxRetainedNativeSupervisorModuleLoader,
  moduleLoadRequestInput: unknown,
  signal: AbortSignal,
  authority: LinuxRetainedNativeSupervisorServiceAuthority,
  serviceRequestInput: unknown,
  clock: () => number = Date.now,
): Promise<BoundedLinuxRetainedNativeSupervisorServiceOwner> {
  if (
    !(loader instanceof BoundedLinuxRetainedNativeSupervisorModuleLoader) ||
    !(signal instanceof AbortSignal) ||
    signal.aborted ||
    authority instanceof DenyLinuxRetainedNativeSupervisorServiceAuthority ||
    !authority ||
    typeof authority.authorize !== 'function' ||
    typeof clock !== 'function'
  )
    return denyInvalidAuthorization();
  const moduleLoadRequest =
    validateLinuxRetainedNativeSupervisorModuleLoadRequest(moduleLoadRequestInput);
  const serviceRequest = validateLinuxRetainedNativeSupervisorServiceRequest(serviceRequestInput);
  if (
    moduleLoadRequest.moduleKind !== 'LISTENER' ||
    serviceRequest.serviceKind !== 'TOPOLOGY_CARRIER_WORKER_LISTENER' ||
    moduleLoadRequest.socketPath !== serviceRequest.socketPath
  )
    return denyInvalidAuthorization();
  const loadedModule = await loader.load(moduleLoadRequest, signal);
  if (signal.aborted) return denyInvalidAuthorization();
  return createLoadedLinuxNativeTopologyCarrierWorkerListenerServiceOwner(
    loadedModule,
    authority,
    serviceRequest,
    clock,
  );
}

/**
 * Loads the exact signer CLIENT, composes the retained-descriptor root-resolved worker, and runs one
 * explicitly supplied worker-listener owner. No dependency, identity, path, or startup wiring is
 * discovered here.
 */
export async function runLoadedRetainedDescriptorKeylessLinuxNativeTopologyCarrierWorkerServiceOne(
  owner: BoundedLinuxRetainedNativeSupervisorServiceOwner,
  signerLoader: BoundedLinuxRetainedNativeSupervisorModuleLoader,
  signerModuleLoadRequestInput: unknown,
  signingAuthorizationInput: unknown,
  signerKeyId: string,
  source: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  serviceRequestInput: unknown,
  carrierBindingInput: unknown,
  signal: AbortSignal,
  clock: () => number = Date.now,
  signingTimeoutMs = 2_000,
): Promise<void> {
  if (
    !(signerLoader instanceof BoundedLinuxRetainedNativeSupervisorModuleLoader) ||
    !(
      source instanceof
      BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource
    ) ||
    !(signal instanceof AbortSignal) ||
    signal.aborted ||
    typeof clock !== 'function'
  )
    return denyInvalidAuthorization();
  const authenticatedOwner = authenticateBoundedLinuxRetainedNativeSupervisorServiceOwner(owner);
  const serviceRequest = validateLinuxRetainedNativeSupervisorServiceRequest(serviceRequestInput);
  let carrierBinding;
  try {
    carrierBinding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      carrierBindingInput,
      clock(),
    );
  } catch {
    return denyInvalidAuthorization();
  }
  if (
    serviceRequest.serviceKind !== 'TOPOLOGY_CARRIER_WORKER_LISTENER' ||
    serviceRequest.workspaceId !== carrierBinding.workspaceId ||
    serviceRequest.supervisorInstanceId !== carrierBinding.supervisorInstanceId
  )
    return denyInvalidAuthorization();
  const worker =
    await loadAuthenticatedSigningRetainedDescriptorKeylessRootResolvedLinuxNativeTopologyCarrierWorker(
      signerLoader,
      signerModuleLoadRequestInput,
      signal,
      source,
      signingAuthorizationInput,
      signerKeyId,
      carrierBinding,
      clock,
      signingTimeoutMs,
    );
  try {
    return await BoundedLinuxRetainedNativeSupervisorServiceOwner.prototype.runTopologyCarrierWorkerOne.call(
      authenticatedOwner,
      serviceRequest,
      worker,
      carrierBinding,
      signal,
    );
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return denyInvalidAuthorization();
  }
}
