import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport,
  AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyCarrierSigningTransport,
  authenticateRetainedNativeSupervisorLocalIpcAuthorization,
  BoundedLinuxRetainedNativeSupervisorModuleLoader,
  BoundedLinuxRetainedNativeSupervisorLocalIpcClient,
  BoundedLinuxRetainedNativeSupervisorNativeClientBinding,
  BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
  BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession,
  DenyLinuxRetainedNativeSupervisorTopologyObservationPort,
  RetainedNativeSupervisorLocalIpcError,
  RetainedDescriptorLinuxNativeSupervisorTopologyObserver,
  RootResolvedRetainedNativeSupervisorTopologyObservationWorker,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
  type LinuxRetainedNativeSupervisorTopologyObservationPort,
  type LoadedLinuxRetainedNativeSupervisorClientModule,
  type RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  type RetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport,
  type RetainedNativeSupervisorTopologyObservationCarrierWorkerByteSession,
  validateLinuxRetainedNativeSupervisorModuleLoadRequest,
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

/**
 * Joins the exact concrete worker root source to the root-resolved worker endpoint. Construction
 * performs no root lookup, observation, signing, native call, or application wiring.
 */
export function createRootResolvedLinuxNativeTopologyCarrierWorker(
  source: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  observer: LinuxRetainedNativeSupervisorTopologyObservationPort,
  signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  binding: unknown,
  clock: () => number = Date.now,
): RootResolvedRetainedNativeSupervisorTopologyObservationWorker {
  if (
    !(
      source instanceof
      BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource
    )
  ) {
    return denyInvalidAuthorization();
  }
  return new RootResolvedRetainedNativeSupervisorTopologyObservationWorker(
    source,
    observer,
    signer,
    binding,
    clock,
  );
}

/**
 * Wraps the exact root-resolved worker in the canonical one-use byte-frame endpoint. Construction
 * performs no frame handling, root lookup, observation, signing, native call, or channel activity.
 */
export function createFramedRootResolvedLinuxNativeTopologyCarrierWorker(
  source: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  observer: LinuxRetainedNativeSupervisorTopologyObservationPort,
  signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  binding: unknown,
  clock: () => number = Date.now,
  frameTimeoutMs = 5_000,
): BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint {
  const worker = createRootResolvedLinuxNativeTopologyCarrierWorker(
    source,
    observer,
    signer,
    binding,
    clock,
  );
  return new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(
    worker,
    frameTimeoutMs,
  );
}

/**
 * Constructs the exact worker-role bounded keyless signer and binds it to the framed root-resolved
 * endpoint. Construction performs no signing exchange, close, lookup, observation, or native call.
 */
export function createKeylessFramedRootResolvedLinuxNativeTopologyCarrierWorker(
  source: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  observer: LinuxRetainedNativeSupervisorTopologyObservationPort,
  signerKeyId: string,
  signingTransport: RetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport,
  binding: unknown,
  clock: () => number = Date.now,
  signingTimeoutMs = 2_000,
  frameTimeoutMs = 5_000,
): BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint {
  try {
    if (
      !(
        source instanceof
        BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource
      ) ||
      observer instanceof DenyLinuxRetainedNativeSupervisorTopologyObservationPort ||
      !observer ||
      typeof observer.observe !== 'function'
    ) {
      return denyInvalidAuthorization();
    }
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return denyInvalidAuthorization();
  }
  const signer = new BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(
    binding,
    'WORKER_CLIENT',
    signerKeyId,
    signingTransport,
    clock,
    signingTimeoutMs,
  );
  return createFramedRootResolvedLinuxNativeTopologyCarrierWorker(
    source,
    observer,
    signer,
    binding,
    clock,
    frameTimeoutMs,
  );
}

/**
 * Constructs the retained-descriptor WORKER_CLIENT observer inside the keyless framed worker.
 * Construction opens or reads no path and performs no lookup, signing, IPC, or native activity.
 */
export function createRetainedDescriptorKeylessFramedLinuxNativeTopologyCarrierWorker(
  source: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  signerKeyId: string,
  signingTransport: RetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport,
  binding: unknown,
  clock: () => number = Date.now,
  signingTimeoutMs = 2_000,
  frameTimeoutMs = 5_000,
): BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint {
  try {
    if (
      !(
        source instanceof
        BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource
      )
    ) {
      return denyInvalidAuthorization();
    }
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return denyInvalidAuthorization();
  }
  const observer = new RetainedDescriptorLinuxNativeSupervisorTopologyObserver(
    'WORKER_CLIENT',
    clock,
  );
  return createKeylessFramedRootResolvedLinuxNativeTopologyCarrierWorker(
    source,
    observer,
    signerKeyId,
    signingTransport,
    binding,
    clock,
    signingTimeoutMs,
    frameTimeoutMs,
  );
}

/**
 * Fixes carrier signing to the exact bounded Linux local client and authenticated transport.
 * Construction performs no signing, lookup, observation, frame, IPC, or native activity.
 */
export function createAuthenticatedSigningRetainedDescriptorKeylessFramedLinuxNativeTopologyCarrierWorker(
  source: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  signingClient: BoundedLinuxRetainedNativeSupervisorLocalIpcClient,
  signingAuthorization: unknown,
  signerKeyId: string,
  binding: unknown,
  clock: () => number = Date.now,
  signingTimeoutMs = 2_000,
  frameTimeoutMs = 5_000,
): BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint {
  try {
    if (
      !(
        source instanceof
        BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource
      ) ||
      !(signingClient instanceof BoundedLinuxRetainedNativeSupervisorLocalIpcClient)
    ) {
      return denyInvalidAuthorization();
    }
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return denyInvalidAuthorization();
  }
  const signingTransport =
    new AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyCarrierSigningTransport(
      signingClient,
      signingAuthorization,
    );
  return createRetainedDescriptorKeylessFramedLinuxNativeTopologyCarrierWorker(
    source,
    signerKeyId,
    signingTransport,
    binding,
    clock,
    signingTimeoutMs,
    frameTimeoutMs,
  );
}

/**
 * Binds one already-authorized loaded CLIENT module to the carrier signing path. Construction
 * loads no code and performs no signing, lookup, observation, frame, IPC, filesystem, or native
 * activity.
 */
export function createLoadedAuthenticatedSigningRetainedDescriptorKeylessFramedLinuxNativeTopologyCarrierWorker(
  source: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  loadedSigningModuleInput: unknown,
  signingAuthorizationInput: unknown,
  signerKeyId: string,
  binding: unknown,
  clock: () => number = Date.now,
  signingTimeoutMs = 2_000,
  frameTimeoutMs = 5_000,
): BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint {
  try {
    if (
      !(
        source instanceof
        BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource
      )
    ) {
      return denyInvalidAuthorization();
    }
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return denyInvalidAuthorization();
  }
  const loadedSigningModule = authenticateLoadedClientModule(loadedSigningModuleInput);
  const signingAuthorization =
    authenticateRetainedNativeSupervisorLocalIpcAuthorization(signingAuthorizationInput);
  if (loadedSigningModule.socketPath !== signingAuthorization.socketPath) {
    return denyInvalidAuthorization();
  }
  const nativeBinding = new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(
    loadedSigningModule.nativeModule,
  );
  const signingClient = new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(nativeBinding);
  return createAuthenticatedSigningRetainedDescriptorKeylessFramedLinuxNativeTopologyCarrierWorker(
    source,
    signingClient,
    signingAuthorization,
    signerKeyId,
    binding,
    clock,
    signingTimeoutMs,
    frameTimeoutMs,
  );
}

/**
 * Joins the loaded, authenticated signer worker to one already-accepted carrier byte session.
 * Construction performs no load, read, write, close, frame, signing, IPC, filesystem, or native
 * activity and discovers no listener or transport.
 */
export function createLoadedAuthenticatedSigningRetainedDescriptorKeylessFramedLinuxNativeTopologyCarrierWorkerSession(
  source: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  loadedSigningModuleInput: unknown,
  signingAuthorizationInput: unknown,
  signerKeyId: string,
  binding: unknown,
  carrierSession: RetainedNativeSupervisorTopologyObservationCarrierWorkerByteSession,
  clock: () => number = Date.now,
  signingTimeoutMs = 2_000,
  frameTimeoutMs = 5_000,
  sessionTimeoutMs = 5_000,
): BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession {
  const endpoint =
    createLoadedAuthenticatedSigningRetainedDescriptorKeylessFramedLinuxNativeTopologyCarrierWorker(
      source,
      loadedSigningModuleInput,
      signingAuthorizationInput,
      signerKeyId,
      binding,
      clock,
      signingTimeoutMs,
      frameTimeoutMs,
    );
  return new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerSession(
    endpoint,
    carrierSession,
    sessionTimeoutMs,
  );
}

/**
 * Consumes one explicitly injected module loader only after an exact CLIENT request, abort signal,
 * concrete worker source, and signer socket authorization agree. It discovers no loader, module,
 * path, identity, key, listener, or lifecycle.
 */
export async function loadAuthenticatedSigningRetainedDescriptorKeylessFramedLinuxNativeTopologyCarrierWorker(
  loader: BoundedLinuxRetainedNativeSupervisorModuleLoader,
  moduleLoadRequestInput: unknown,
  signal: AbortSignal,
  source: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  signingAuthorizationInput: unknown,
  signerKeyId: string,
  binding: unknown,
  clock: () => number = Date.now,
  signingTimeoutMs = 2_000,
  frameTimeoutMs = 5_000,
): Promise<BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint> {
  if (
    !(loader instanceof BoundedLinuxRetainedNativeSupervisorModuleLoader) ||
    !(signal instanceof AbortSignal) ||
    signal.aborted ||
    !(
      source instanceof
      BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource
    )
  ) {
    return denyInvalidAuthorization();
  }
  const moduleLoadRequest =
    validateLinuxRetainedNativeSupervisorModuleLoadRequest(moduleLoadRequestInput);
  const signingAuthorization =
    authenticateRetainedNativeSupervisorLocalIpcAuthorization(signingAuthorizationInput);
  if (
    moduleLoadRequest.moduleKind !== 'CLIENT' ||
    moduleLoadRequest.socketPath !== signingAuthorization.socketPath
  ) {
    return denyInvalidAuthorization();
  }
  const loadedSigningModule = await loader.load(moduleLoadRequest, signal);
  if (signal.aborted) return denyInvalidAuthorization();
  return createLoadedAuthenticatedSigningRetainedDescriptorKeylessFramedLinuxNativeTopologyCarrierWorker(
    source,
    loadedSigningModule,
    signingAuthorization,
    signerKeyId,
    binding,
    clock,
    signingTimeoutMs,
    frameTimeoutMs,
  );
}

/**
 * Consumes one explicitly injected module loader only after the exact CLIENT request, abort
 * signal, and local socket authorization agree. It does not discover authority or wire the
 * resulting source into the worker lifecycle.
 */
export async function loadLinuxNativeTopologyCarrierRootSource(
  loader: BoundedLinuxRetainedNativeSupervisorModuleLoader,
  moduleLoadRequestInput: unknown,
  signal: AbortSignal,
  binding: unknown,
  localIpcAuthorizationInput: unknown,
  clock: () => number = Date.now,
  timeoutMs = 2_000,
): Promise<BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource> {
  if (
    !(loader instanceof BoundedLinuxRetainedNativeSupervisorModuleLoader) ||
    !(signal instanceof AbortSignal) ||
    signal.aborted
  ) {
    return denyInvalidAuthorization();
  }
  const moduleLoadRequest =
    validateLinuxRetainedNativeSupervisorModuleLoadRequest(moduleLoadRequestInput);
  const localIpcAuthorization = authenticateRetainedNativeSupervisorLocalIpcAuthorization(
    localIpcAuthorizationInput,
  );
  if (
    moduleLoadRequest.moduleKind !== 'CLIENT' ||
    moduleLoadRequest.socketPath !== localIpcAuthorization.socketPath
  ) {
    return denyInvalidAuthorization();
  }
  const loadedModule = await loader.load(moduleLoadRequest, signal);
  if (signal.aborted) return denyInvalidAuthorization();
  return createLoadedLinuxNativeTopologyCarrierRootSource(
    loadedModule,
    binding,
    localIpcAuthorization,
    clock,
    timeoutMs,
  );
}
