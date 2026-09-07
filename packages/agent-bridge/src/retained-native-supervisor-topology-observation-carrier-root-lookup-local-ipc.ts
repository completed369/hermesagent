import {
  authenticateRetainedNativeSupervisorLocalIpcAuthorization,
  authenticateRetainedNativeSupervisorLocalIpcClientExchange,
  authenticateRetainedNativeSupervisorLocalIpcInboundExchange,
  DenyRetainedNativeSupervisorLocalIpcClient,
  RetainedNativeSupervisorLocalIpcError,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
  type RetainedNativeSupervisorLocalIpcAuthorization,
} from './retained-native-supervisor-local-ipc';
import {
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  type RetainedNativeSupervisorTopologyObservationCarrierBinding,
} from './retained-native-supervisor-topology-observation-carrier';
import {
  MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_REQUEST_BYTES,
  MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_RESPONSE_BYTES,
  type RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport,
  type RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransportAuthorization,
} from './retained-native-supervisor-topology-observation-carrier-root-lookup';
import {
  type BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler,
  type RetainedNativeSupervisorTopologyObservationCarrierRootLookupInboundAuthorization,
} from './retained-native-supervisor-topology-observation-carrier-root-lookup-handler';

const MAX_DATE_MS = 8_640_000_000_000_000;
const OUTBOUND_AUTHORIZATION_KEYS = [
  'authority',
  'bindingHash',
  'carrierId',
  'localPrincipalReference',
  'localPrincipalRole',
  'notAfter',
  'peerPrincipalReference',
  'peerPrincipalRole',
  'runtimeConnection',
] as const;

function deny(
  code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION' | 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function clockValue(clock: () => number): number {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_DATE_MS) deny('INVALID_AUTHORIZATION');
  return now;
}

function exactRecord(input: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
      deny('INVALID_AUTHORIZATION');
    const value = input as Record<string, unknown>;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    const own = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      actual.length !== expected.length ||
      own.length !== actual.length ||
      own.some((key) => typeof key !== 'string') ||
      actual.some((key, index) => key !== expected[index]) ||
      actual.some(
        (key) => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key]!, 'value'),
      )
    )
      deny('INVALID_AUTHORIZATION');
    return value;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_AUTHORIZATION');
  }
}

function bytes(
  input: unknown,
  maximum: number,
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
) {
  if (!(input instanceof Uint8Array) || input.byteLength < 2 || input.byteLength > maximum)
    deny(code);
  return Uint8Array.from(input);
}

function bindClient(client: ClosableRetainedNativeSupervisorLocalIpcClient) {
  try {
    if (client instanceof DenyRetainedNativeSupervisorLocalIpcClient) deny('NOT_CONFIGURED');
    const exchange = client?.exchange;
    const close = client?.close;
    if (typeof exchange !== 'function' || typeof close !== 'function') deny('NOT_CONFIGURED');
    return Object.freeze({ exchange: exchange.bind(client), close: close.bind(client) });
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

function bindHandler(
  handler: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler,
) {
  try {
    const handle = handler?.handle;
    if (typeof handle !== 'function') deny('NOT_CONFIGURED');
    return handle.bind(handler);
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

function exactOutboundAuthorization(
  input: unknown,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
): void {
  const value = exactRecord(input, OUTBOUND_AUTHORIZATION_KEYS);
  if (
    value.authority !== 'INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT' ||
    value.localPrincipalRole !== 'WORKER_CLIENT' ||
    value.localPrincipalReference !== binding.workerPrincipalReference ||
    value.peerPrincipalRole !== 'API_COORDINATOR' ||
    value.peerPrincipalReference !== binding.coordinatorPrincipalReference ||
    value.carrierId !== binding.carrierId ||
    value.bindingHash !== retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding) ||
    value.notAfter !== binding.expiresAt ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    deny('INVALID_AUTHORIZATION');
}

/**
 * One-use worker-side root-lookup transport over the existing Linux native IPC port. The native
 * result must authenticate the exact socket before and after exchange and the API peer through
 * SO_PEERCRED. This adapter discovers no path and owns no socket or listener implementation.
 */
export class AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport implements RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>;
  readonly #exchangeClient: ClosableRetainedNativeSupervisorLocalIpcClient['exchange'];
  readonly #closeClient: ClosableRetainedNativeSupervisorLocalIpcClient['close'];
  #state: 'READY' | 'IN_FLIGHT' | 'ATTEMPTED' | 'CLOSED' = 'READY';

  constructor(
    client: ClosableRetainedNativeSupervisorLocalIpcClient,
    bindingInput: unknown,
    authorizationInput: unknown,
    private readonly clock: () => number = Date.now,
  ) {
    if (typeof clock !== 'function') deny('NOT_CONFIGURED');
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      bindingInput,
      clockValue(clock),
    );
    this.#authorization =
      authenticateRetainedNativeSupervisorLocalIpcAuthorization(authorizationInput);
    const bound = bindClient(client);
    this.#exchangeClient = bound.exchange;
    this.#closeClient = bound.close;
  }

  async exchange(
    requestInput: Uint8Array,
    authorizationInput: Readonly<RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransportAuthorization>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.#state !== 'READY') deny('EXCHANGE_DENIED');
    this.#state = 'IN_FLIGHT';
    let request: Uint8Array | undefined;
    try {
      if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
      validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
        this.#binding,
        clockValue(this.clock),
      );
      exactOutboundAuthorization(authorizationInput, this.#binding);
      request = bytes(
        requestInput,
        MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_REQUEST_BYTES,
        'INVALID_AUTHORIZATION',
      );
      const candidate = await this.#exchangeClient(this.#authorization.socketPath, request, signal);
      if (signal.aborted) deny('EXCHANGE_DENIED');
      const response = authenticateRetainedNativeSupervisorLocalIpcClientExchange(
        candidate,
        this.#authorization,
      );
      validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
        this.#binding,
        clockValue(this.clock),
      );
      return bytes(
        response,
        MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_RESPONSE_BYTES,
        'INVALID_ATTESTATION',
      );
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('EXCHANGE_DENIED');
    } finally {
      request?.fill(0);
      if (this.#state === 'IN_FLIGHT') this.#state = 'ATTEMPTED';
    }
  }

  async close(): Promise<void> {
    if (this.#state !== 'ATTEMPTED' && this.#state !== 'IN_FLIGHT') deny('EXCHANGE_DENIED');
    this.#state = 'CLOSED';
    try {
      await this.#closeClient();
    } catch {
      deny('EXCHANGE_DENIED');
    }
  }
}

/**
 * API-side endpoint for one already-accepted Linux local IPC exchange. It derives handler sideband
 * identity only after the socket identity and worker SO_PEERCRED principal match the constructor-
 * bound authorization; request bytes remain untrusted until the inner handler validates them.
 */
export class AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #authorization: Readonly<RetainedNativeSupervisorLocalIpcAuthorization>;
  readonly #handle: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler['handle'];
  #attempted = false;

  constructor(
    handler: BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler,
    bindingInput: unknown,
    authorizationInput: unknown,
    private readonly clock: () => number = Date.now,
  ) {
    if (typeof clock !== 'function') deny('NOT_CONFIGURED');
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      bindingInput,
      clockValue(clock),
    );
    this.#authorization =
      authenticateRetainedNativeSupervisorLocalIpcAuthorization(authorizationInput);
    this.#handle = bindHandler(handler);
  }

  async handle(inboundInput: unknown, signal: AbortSignal): Promise<Readonly<Uint8Array>> {
    if (this.#attempted) deny('EXCHANGE_DENIED');
    this.#attempted = true;
    try {
      if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
      const request = bytes(
        authenticateRetainedNativeSupervisorLocalIpcInboundExchange(
          inboundInput,
          this.#authorization,
        ),
        MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_REQUEST_BYTES,
        'INVALID_ATTESTATION',
      );
      const now = clockValue(this.clock);
      validateRetainedNativeSupervisorTopologyObservationCarrierBinding(this.#binding, now);
      const inboundAuthorization: Readonly<RetainedNativeSupervisorTopologyObservationCarrierRootLookupInboundAuthorization> =
        Object.freeze({
          authority: 'INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT',
          localPrincipalRole: 'API_COORDINATOR',
          localPrincipalReference: this.#binding.coordinatorPrincipalReference,
          peerPrincipalRole: 'WORKER_CLIENT',
          peerPrincipalReference: this.#binding.workerPrincipalReference,
          carrierId: this.#binding.carrierId,
          bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(this.#binding),
          authenticatedAt: new Date(now).toISOString(),
          notAfter: this.#binding.expiresAt,
          runtimeConnection: 'NOT_CONFIGURED',
        });
      try {
        const response = await this.#handle(request, inboundAuthorization, signal);
        if (signal.aborted) deny('EXCHANGE_DENIED');
        validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
          this.#binding,
          clockValue(this.clock),
        );
        return bytes(
          response,
          MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_RESPONSE_BYTES,
          'INVALID_ATTESTATION',
        );
      } finally {
        request.fill(0);
      }
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('EXCHANGE_DENIED');
    }
  }
}
