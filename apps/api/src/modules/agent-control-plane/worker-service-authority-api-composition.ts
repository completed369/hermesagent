import {
  BoundedLinuxRetainedNativeSupervisorModuleLoader,
  BoundedLinuxRetainedNativeSupervisorNativeListenerBinding,
  BoundedLinuxRetainedNativeSupervisorServiceOwner,
  BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
  BoundedRetainedNativeSupervisorWorkerServiceAuthorityCoordinatorHandler,
  DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  Ed25519RetainedNativeSupervisorTopologyObservationCoordinatorEndpoint,
  RetainedNativeSupervisorLocalIpcError,
  authenticateBoundedLinuxRetainedNativeSupervisorServiceOwner,
  validateLinuxRetainedNativeSupervisorModuleLoadRequest,
  validateLinuxRetainedNativeSupervisorServiceRequest,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  type LoadedLinuxRetainedNativeSupervisorListenerModule,
  type RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
} from '@ventureos/agent-bridge';

import { BoundedLevel3RetainedNativeSupervisorServiceAuthority } from './retained-native-service-authority';
import { PostgresApiCoordinatorTopologyCarrierSignatureRootSource } from './topology-carrier-signature-root-source';
import type { TopologyCarrierSignatureRootSqlClient } from './topology-carrier-signature-root-registry';

const LOADED_LISTENER_MODULE_KEYS = [
  'moduleKind',
  'nativeModule',
  'runtimeConnection',
  'schemaVersion',
  'socketPath',
] as const;

function deny(): never {
  throw new RetainedNativeSupervisorLocalIpcError('INVALID_AUTHORIZATION');
}

function loadedListenerModule(
  input: unknown,
): Readonly<LoadedLinuxRetainedNativeSupervisorListenerModule> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) deny();
    const record = input as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(record);
    const actual = Object.keys(record).sort();
    const expected = [...LOADED_LISTENER_MODULE_KEYS].sort();
    const own = Reflect.ownKeys(record);
    const descriptors = Object.getOwnPropertyDescriptors(record);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      actual.length !== expected.length ||
      own.length !== actual.length ||
      own.some((key) => typeof key !== 'string') ||
      actual.some((key, index) => key !== expected[index]) ||
      actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value'))
    )
      deny();
    const values = Object.fromEntries(
      LOADED_LISTENER_MODULE_KEYS.map((key) => [key, descriptors[key]?.value]),
    );
    if (
      values.schemaVersion !== 1 ||
      values.moduleKind !== 'LISTENER' ||
      values.runtimeConnection !== 'NOT_CONFIGURED'
    )
      deny();
    return Object.freeze({
      schemaVersion: 1,
      moduleKind: 'LISTENER',
      socketPath: values.socketPath,
      runtimeConnection: 'NOT_CONFIGURED',
      nativeModule: values.nativeModule,
    }) as Readonly<LoadedLinuxRetainedNativeSupervisorListenerModule>;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny();
  }
}

/** Inertly binds one already-loaded listener to the distinct Level-3 API listener authority. */
export function createLoadedLinuxNativeWorkerServiceAuthorityApiServiceOwner(
  loadedModuleInput: unknown,
  listenerAuthority: BoundedLevel3RetainedNativeSupervisorServiceAuthority,
  listenerRequestInput: unknown,
  clock: () => number = Date.now,
): BoundedLinuxRetainedNativeSupervisorServiceOwner {
  const loaded = loadedListenerModule(loadedModuleInput);
  const request = validateLinuxRetainedNativeSupervisorServiceRequest(listenerRequestInput);
  if (
    !(listenerAuthority instanceof BoundedLevel3RetainedNativeSupervisorServiceAuthority) ||
    typeof clock !== 'function' ||
    request.serviceKind !== 'TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER' ||
    request.expectedPeerRole !== 'WORKER_CLIENT' ||
    request.socketPath !== loaded.socketPath
  )
    deny();
  return new BoundedLinuxRetainedNativeSupervisorServiceOwner(
    new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(loaded.nativeModule),
    listenerAuthority,
    clock,
  );
}

/** Loads exactly one injected LISTENER module without selecting or starting application lifecycle. */
export async function loadLinuxNativeWorkerServiceAuthorityApiServiceOwner(
  loader: BoundedLinuxRetainedNativeSupervisorModuleLoader,
  moduleLoadRequestInput: unknown,
  signal: AbortSignal,
  listenerAuthority: BoundedLevel3RetainedNativeSupervisorServiceAuthority,
  listenerRequestInput: unknown,
  clock: () => number = Date.now,
): Promise<BoundedLinuxRetainedNativeSupervisorServiceOwner> {
  if (
    !(loader instanceof BoundedLinuxRetainedNativeSupervisorModuleLoader) ||
    !(signal instanceof AbortSignal) ||
    signal.aborted ||
    !(listenerAuthority instanceof BoundedLevel3RetainedNativeSupervisorServiceAuthority) ||
    typeof clock !== 'function'
  )
    deny();
  const loadRequest =
    validateLinuxRetainedNativeSupervisorModuleLoadRequest(moduleLoadRequestInput);
  const listenerRequest = validateLinuxRetainedNativeSupervisorServiceRequest(listenerRequestInput);
  if (
    loadRequest.moduleKind !== 'LISTENER' ||
    listenerRequest.serviceKind !== 'TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER' ||
    loadRequest.socketPath !== listenerRequest.socketPath
  )
    deny();
  const loaded = await loader.load(loadRequest, signal);
  if (signal.aborted) deny();
  return createLoadedLinuxNativeWorkerServiceAuthorityApiServiceOwner(
    loaded,
    listenerAuthority,
    listenerRequest,
    clock,
  );
}

/**
 * Composes one durable worker public root, API signer, exact worker-grant issuer, and distinct
 * listener owner for a single authenticated frame. Nothing is registered with Nest or startup.
 */
export async function runPostgresApiCoordinatorWorkerServiceAuthorityOne(
  ownerInput: BoundedLinuxRetainedNativeSupervisorServiceOwner,
  database: TopologyCarrierSignatureRootSqlClient,
  listenerRequestInput: unknown,
  workerServiceRequestInput: unknown,
  workerServiceAuthority: BoundedLevel3RetainedNativeSupervisorServiceAuthority,
  signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  carrierBindingInput: unknown,
  signal: AbortSignal,
  clock: () => number = Date.now,
  timeoutMs = 2_000,
): Promise<void> {
  if (
    !(signal instanceof AbortSignal) ||
    signal.aborted ||
    !(workerServiceAuthority instanceof BoundedLevel3RetainedNativeSupervisorServiceAuthority) ||
    signer instanceof DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner ||
    typeof signer?.sign !== 'function' ||
    typeof clock !== 'function' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 5_000
  )
    deny();
  const owner = authenticateBoundedLinuxRetainedNativeSupervisorServiceOwner(ownerInput);
  const binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
    carrierBindingInput,
    clock(),
  );
  const listenerRequest = validateLinuxRetainedNativeSupervisorServiceRequest(listenerRequestInput);
  const workerRequest =
    validateLinuxRetainedNativeSupervisorServiceRequest(workerServiceRequestInput);
  if (
    listenerRequest.serviceKind !== 'TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER' ||
    listenerRequest.expectedPeerRole !== 'WORKER_CLIENT' ||
    workerRequest.serviceKind !== 'TOPOLOGY_CARRIER_WORKER_LISTENER' ||
    workerRequest.expectedPeerRole !== 'API_COORDINATOR' ||
    listenerRequest.workspaceId !== binding.workspaceId ||
    listenerRequest.supervisorInstanceId !== binding.supervisorInstanceId ||
    workerRequest.workspaceId !== binding.workspaceId ||
    workerRequest.supervisorInstanceId !== binding.supervisorInstanceId
  )
    deny();
  let workerRoot: unknown;
  try {
    const rootSource = new PostgresApiCoordinatorTopologyCarrierSignatureRootSource(
      database,
      binding,
      clock,
    );
    workerRoot = await rootSource.read(binding, 'WORKER_CLIENT', signal);
  } catch {
    return deny();
  }
  if (signal.aborted) deny();
  const protocol = new BoundedRetainedNativeSupervisorWorkerServiceAuthorityCoordinatorHandler(
    workerServiceAuthority,
    workerRequest,
    binding,
    clock,
  );
  const authenticatedEndpoint =
    new Ed25519RetainedNativeSupervisorTopologyObservationCoordinatorEndpoint(
      protocol,
      signer,
      workerRoot,
      binding,
      clock,
    );
  const frameEndpoint =
    new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
      authenticatedEndpoint,
      timeoutMs,
    );
  return owner.runTopologyCarrierWorkerServiceAuthorityApiOne(
    listenerRequest,
    frameEndpoint,
    binding,
    signal,
  );
}
