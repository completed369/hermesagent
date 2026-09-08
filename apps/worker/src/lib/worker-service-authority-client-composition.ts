import {
  AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority,
  BoundedLinuxRetainedNativeSupervisorLocalIpcClient,
  BoundedLinuxRetainedNativeSupervisorModuleLoader,
  BoundedLinuxRetainedNativeSupervisorNativeClientBinding,
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel,
  DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationWorkerCarrier,
  MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES,
  RetainedNativeSupervisorLocalIpcError,
  authenticateRetainedNativeSupervisorLocalIpcAuthorization,
  authenticateRetainedNativeSupervisorLocalIpcClientExchange,
  validateLinuxRetainedNativeSupervisorModuleLoadRequest,
  validateLinuxRetainedNativeSupervisorServiceRequest,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  type LoadedLinuxRetainedNativeSupervisorClientModule,
  type RetainedNativeSupervisorLocalIpcAuthorization,
  type RetainedNativeSupervisorTopologyObservationCarrierByteChannel,
  type RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
} from '@ventureos/agent-bridge';

const LOADED_CLIENT_MODULE_KEYS = [
  'moduleKind',
  'nativeModule',
  'runtimeConnection',
  'schemaVersion',
  'socketPath',
] as const;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const RAW_STAT_KEYS = ['device', 'fileType', 'inode', 'mode', 'ownerGid', 'ownerUid'] as const;
const RAW_PEER_KEYS = ['gid', 'pid', 'uid'] as const;

function deny(): never {
  throw new RetainedNativeSupervisorLocalIpcError('INVALID_AUTHORIZATION');
}

function denyInvalidAttestation(): never {
  throw new RetainedNativeSupervisorLocalIpcError('INVALID_ATTESTATION');
}

function timeout(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < MIN_TIMEOUT_MS ||
    (value as number) > MAX_TIMEOUT_MS
  )
    deny();
  return value as number;
}

function exactRecord(input: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
      denyInvalidAttestation();
    const record = input as Record<string, unknown>;
    const actual = Object.keys(record).sort();
    const expected = [...keys].sort();
    const own = Reflect.ownKeys(record);
    const descriptors = Object.getOwnPropertyDescriptors(record);
    if (
      (Object.getPrototypeOf(record) !== Object.prototype &&
        Object.getPrototypeOf(record) !== null) ||
      actual.length !== expected.length ||
      own.length !== actual.length ||
      own.some((key) => typeof key !== 'string') ||
      actual.some((key, index) => key !== expected[index]) ||
      actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value'))
    )
      denyInvalidAttestation();
    return Object.fromEntries(actual.map((key) => [key, descriptors[key]?.value]));
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return denyInvalidAttestation();
  }
}

function exactRawStat(
  input: unknown,
  authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>,
): unknown {
  const value = exactRecord(input, RAW_STAT_KEYS);
  if (
    value.fileType !== 'SOCKET' ||
    value.device !== authorization.socketDevice ||
    value.inode !== authorization.socketInode ||
    value.ownerUid !== authorization.socketOwnerUid ||
    value.ownerGid !== authorization.socketOwnerGid ||
    value.mode !== authorization.socketMode
  )
    denyInvalidAttestation();
  return input;
}

function exactRawPeer(
  input: unknown,
  authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>,
): unknown {
  const value = exactRecord(input, RAW_PEER_KEYS);
  if (
    value.pid !== authorization.expectedPeerPid ||
    value.uid !== authorization.expectedPeerUid ||
    value.gid !== authorization.expectedPeerGid
  )
    denyInvalidAttestation();
  return input;
}

interface NativeClientConnection {
  peerCredentials(signal: AbortSignal): Promise<unknown>;
  writeAndShutdown(request: Readonly<Uint8Array>, signal: AbortSignal): Promise<void>;
  readToEof(maximumBytes: number, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

function authorizedConnection(
  input: unknown,
  authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>,
): NativeClientConnection {
  if (typeof input !== 'object' || input === null) deny();
  const connection = input as NativeClientConnection;
  if (
    typeof connection.peerCredentials !== 'function' ||
    typeof connection.writeAndShutdown !== 'function' ||
    typeof connection.readToEof !== 'function' ||
    typeof connection.close !== 'function'
  )
    deny();
  const peerCredentials = connection.peerCredentials.bind(connection);
  const writeAndShutdown = connection.writeAndShutdown.bind(connection);
  const readToEof = connection.readToEof.bind(connection);
  const close = connection.close.bind(connection);
  return {
    async peerCredentials(signal) {
      return exactRawPeer(await peerCredentials(signal), authorization);
    },
    writeAndShutdown,
    readToEof,
    close,
  };
}

/** Enforces constructor-bound endpoint and peer evidence before request bytes can be written. */
class AuthorizedLinuxNativeClientBinding {
  readonly platform = 'LINUX' as const;

  constructor(
    private readonly binding: BoundedLinuxRetainedNativeSupervisorNativeClientBinding,
    private readonly authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>,
  ) {}

  async lstatUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown> {
    if (socketPath !== this.authorization.socketPath) deny();
    const candidate =
      await BoundedLinuxRetainedNativeSupervisorNativeClientBinding.prototype.lstatUnixSocket.call(
        this.binding,
        socketPath,
        signal,
      );
    return exactRawStat(candidate, this.authorization);
  }

  async connectUnixSocket(socketPath: string, signal: AbortSignal): Promise<unknown> {
    if (socketPath !== this.authorization.socketPath) deny();
    const candidate =
      await BoundedLinuxRetainedNativeSupervisorNativeClientBinding.prototype.connectUnixSocket.call(
        this.binding,
        socketPath,
        signal,
      );
    return authorizedConnection(candidate, this.authorization);
  }
}

function loadedClientModule(
  input: unknown,
): Readonly<LoadedLinuxRetainedNativeSupervisorClientModule> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) deny();
    const record = input as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(record);
    const actual = Object.keys(record).sort();
    const expected = [...LOADED_CLIENT_MODULE_KEYS].sort();
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
      LOADED_CLIENT_MODULE_KEYS.map((key) => [key, descriptors[key]?.value]),
    );
    if (
      values.schemaVersion !== 1 ||
      values.moduleKind !== 'CLIENT' ||
      values.runtimeConnection !== 'NOT_CONFIGURED'
    )
      deny();
    return Object.freeze({
      schemaVersion: 1,
      moduleKind: 'CLIENT',
      socketPath: values.socketPath,
      runtimeConnection: 'NOT_CONFIGURED',
      nativeModule: values.nativeModule,
    }) as Readonly<LoadedLinuxRetainedNativeSupervisorClientModule>;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny();
  }
}

/** Exact kernel-authenticated byte channel over one internally constructed native client. */
class AuthenticatedLinuxNativeWorkerServiceAuthorityByteChannel implements RetainedNativeSupervisorTopologyObservationCarrierByteChannel {
  #attempted = false;
  #closePromise: Promise<void> | undefined;

  constructor(
    private readonly client: BoundedLinuxRetainedNativeSupervisorLocalIpcClient,
    private readonly authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>,
  ) {}

  async exchange(requestInput: Uint8Array, signal: AbortSignal): Promise<unknown> {
    if (
      this.#attempted ||
      this.#closePromise !== undefined ||
      !(signal instanceof AbortSignal) ||
      signal.aborted ||
      !(requestInput instanceof Uint8Array) ||
      requestInput.byteLength < 2 ||
      requestInput.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES
    )
      deny();
    this.#attempted = true;
    const request = Uint8Array.from(requestInput);
    try {
      const candidate =
        await BoundedLinuxRetainedNativeSupervisorLocalIpcClient.prototype.exchange.call(
          this.client,
          this.authorization.socketPath,
          request,
          signal,
        );
      if (signal.aborted) deny();
      const response = authenticateRetainedNativeSupervisorLocalIpcClientExchange(
        candidate,
        this.authorization,
      );
      if (
        !(response instanceof Uint8Array) ||
        response.byteLength < 2 ||
        response.byteLength > MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES
      )
        deny();
      return Uint8Array.from(response);
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny();
    } finally {
      request.fill(0);
    }
  }

  close(): Promise<void> {
    this.#closePromise ??= BoundedLinuxRetainedNativeSupervisorLocalIpcClient.prototype.close.call(
      this.client,
    );
    return this.#closePromise;
  }
}

/**
 * Inertly binds one loaded native CLIENT to the authenticated authority-delivery protocol. No
 * native method, socket, signer, or authority is used until the returned authority is invoked.
 */
export function createLoadedLinuxNativeWorkerServiceAuthority(
  loadedModuleInput: unknown,
  localIpcAuthorizationInput: unknown,
  signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  coordinatorRootInput: unknown,
  serviceRequestInput: unknown,
  carrierBindingInput: unknown,
  signal: AbortSignal,
  clock: () => number = Date.now,
  timeoutMs = 2_000,
): AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority {
  if (
    !(signal instanceof AbortSignal) ||
    signal.aborted ||
    signer instanceof DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner ||
    typeof signer?.sign !== 'function' ||
    typeof clock !== 'function'
  )
    deny();
  const boundedTimeout = timeout(timeoutMs);
  const loaded = loadedClientModule(loadedModuleInput);
  const authorization = authenticateRetainedNativeSupervisorLocalIpcAuthorization(
    localIpcAuthorizationInput,
  );
  const binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
    carrierBindingInput,
    clock(),
  );
  const request = validateLinuxRetainedNativeSupervisorServiceRequest(serviceRequestInput);
  if (
    loaded.socketPath !== authorization.socketPath ||
    request.serviceKind !== 'TOPOLOGY_CARRIER_WORKER_LISTENER' ||
    request.expectedPeerRole !== 'API_COORDINATOR' ||
    request.workspaceId !== binding.workspaceId ||
    request.supervisorInstanceId !== binding.supervisorInstanceId
  )
    deny();
  const nativeBinding = new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(
    loaded.nativeModule,
  );
  const nativeClient = new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(
    new AuthorizedLinuxNativeClientBinding(nativeBinding, authorization),
  );
  const byteChannel = new AuthenticatedLinuxNativeWorkerServiceAuthorityByteChannel(
    nativeClient,
    authorization,
  );
  const carrier = new BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel(
    byteChannel,
    boundedTimeout,
  );
  const authenticatedCarrier =
    new Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationWorkerCarrier(
      carrier,
      signer,
      coordinatorRootInput,
      binding,
      clock,
    );
  return new AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority(
    authenticatedCarrier,
    request,
    binding,
    signal,
    clock,
  );
}

/**
 * Resolves the exact API root and loads only the explicitly authorized native CLIENT before
 * returning one inactive authority. It discovers no path, identity, signer, lifecycle, or route.
 */
export async function loadLinuxNativeWorkerServiceAuthority(
  loader: BoundedLinuxRetainedNativeSupervisorModuleLoader,
  moduleLoadRequestInput: unknown,
  source: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  localIpcAuthorizationInput: unknown,
  signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  serviceRequestInput: unknown,
  carrierBindingInput: unknown,
  signal: AbortSignal,
  clock: () => number = Date.now,
  timeoutMs = 2_000,
): Promise<AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority> {
  if (
    !(loader instanceof BoundedLinuxRetainedNativeSupervisorModuleLoader) ||
    !(
      source instanceof
      BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource
    ) ||
    !(signal instanceof AbortSignal) ||
    signal.aborted ||
    signer instanceof DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner ||
    typeof signer?.sign !== 'function' ||
    typeof clock !== 'function'
  )
    deny();
  timeout(timeoutMs);
  const binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
    carrierBindingInput,
    clock(),
  );
  const request = validateLinuxRetainedNativeSupervisorServiceRequest(serviceRequestInput);
  const authorization = authenticateRetainedNativeSupervisorLocalIpcAuthorization(
    localIpcAuthorizationInput,
  );
  const moduleLoadRequest =
    validateLinuxRetainedNativeSupervisorModuleLoadRequest(moduleLoadRequestInput);
  if (
    moduleLoadRequest.moduleKind !== 'CLIENT' ||
    moduleLoadRequest.socketPath !== authorization.socketPath ||
    request.serviceKind !== 'TOPOLOGY_CARRIER_WORKER_LISTENER' ||
    request.expectedPeerRole !== 'API_COORDINATOR' ||
    request.workspaceId !== binding.workspaceId ||
    request.supervisorInstanceId !== binding.supervisorInstanceId
  )
    deny();
  let coordinatorRoot: unknown;
  let loaded: unknown;
  try {
    coordinatorRoot =
      await BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource.prototype.read.call(
        source,
        binding,
        'API_COORDINATOR',
        signal,
      );
    if (signal.aborted) deny();
    loaded = await BoundedLinuxRetainedNativeSupervisorModuleLoader.prototype.load.call(
      loader,
      moduleLoadRequest,
      signal,
    );
  } catch {
    return deny();
  }
  if (signal.aborted) deny();
  try {
    return createLoadedLinuxNativeWorkerServiceAuthority(
      loaded,
      authorization,
      signer,
      coordinatorRoot,
      request,
      binding,
      signal,
      clock,
      timeoutMs,
    );
  } catch {
    return deny();
  }
}
