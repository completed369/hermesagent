import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  DenyLinuxRetainedNativeSupervisorServiceAuthority,
  linuxRetainedNativeSupervisorServiceRequestHash,
  validateLinuxRetainedNativeSupervisorServiceGrant,
  validateLinuxRetainedNativeSupervisorServiceRequest,
  type LinuxRetainedNativeSupervisorServiceAuthority,
  type LinuxRetainedNativeSupervisorServiceGrant,
  type LinuxRetainedNativeSupervisorServiceRequest,
} from './retained-native-supervisor-service-owner';
import {
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  type RetainedNativeSupervisorTopologyObservationCarrierBinding,
} from './retained-native-supervisor-topology-observation-carrier';
import {
  authenticateEd25519AuthenticatedRetainedNativeSupervisorTopologyObservationWorkerCarrier,
  Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationWorkerCarrier,
} from './retained-native-supervisor-topology-observation-carrier-signature';

const REQUEST_KEYS = [
  'bindingHash',
  'direction',
  'purpose',
  'request',
  'requestHash',
  'runtimeConnection',
  'schemaVersion',
] as const;
const RESPONSE_KEYS = [
  'bindingHash',
  'direction',
  'grant',
  'purpose',
  'requestHash',
  'runtimeConnection',
  'schemaVersion',
] as const;
const AUTHENTICATED_KEYS = ['delivery', 'message'] as const;
const MAX_AUTHORIZATION_LIFETIME_MS = 60_000;

export interface RetainedNativeSupervisorWorkerServiceAuthorityCarrierRequest {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_WORKER_SERVICE_AUTHORITY_REQUEST';
  readonly direction: 'WORKER_TO_COORDINATOR';
  readonly bindingHash: string;
  readonly requestHash: string;
  readonly request: Readonly<LinuxRetainedNativeSupervisorServiceRequest>;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface RetainedNativeSupervisorWorkerServiceAuthorityCarrierResponse {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_WORKER_SERVICE_AUTHORITY_RESPONSE';
  readonly direction: 'COORDINATOR_TO_WORKER';
  readonly bindingHash: string;
  readonly requestHash: string;
  readonly grant: Readonly<LinuxRetainedNativeSupervisorServiceGrant>;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

function deny(
  code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION' | 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(
  input: unknown,
  keys: readonly string[],
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) deny(code);
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
      deny(code);
    return value;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny(code);
  }
}

function exactRequest(
  input: unknown,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
): Readonly<LinuxRetainedNativeSupervisorServiceRequest> {
  const request = validateLinuxRetainedNativeSupervisorServiceRequest(input);
  if (
    request.serviceKind !== 'TOPOLOGY_CARRIER_WORKER_LISTENER' ||
    request.workspaceId !== binding.workspaceId ||
    request.supervisorInstanceId !== binding.supervisorInstanceId ||
    request.expectedPeerRole !== 'API_COORDINATOR'
  )
    deny('INVALID_AUTHORIZATION');
  return request;
}

function requestMessage(
  input: unknown,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
): Readonly<RetainedNativeSupervisorWorkerServiceAuthorityCarrierRequest> {
  const value = plainRecord(input, REQUEST_KEYS, 'INVALID_ATTESTATION');
  const request = exactRequest(value.request, binding);
  const requestHash = linuxRetainedNativeSupervisorServiceRequestHash(request);
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_WORKER_SERVICE_AUTHORITY_REQUEST' ||
    value.direction !== 'WORKER_TO_COORDINATOR' ||
    value.bindingHash !== retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding) ||
    value.requestHash !== requestHash ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_WORKER_SERVICE_AUTHORITY_REQUEST',
    direction: 'WORKER_TO_COORDINATOR',
    bindingHash: value.bindingHash,
    requestHash,
    request,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function freshGrant(
  input: unknown,
  expected: Readonly<LinuxRetainedNativeSupervisorServiceRequest>,
  now: number,
): Readonly<LinuxRetainedNativeSupervisorServiceGrant> {
  const grant = validateLinuxRetainedNativeSupervisorServiceGrant(input);
  const validFrom = Date.parse(grant.validFrom);
  const validUntil = Date.parse(grant.validUntil);
  const grantedRequest = Object.fromEntries(
    Object.keys(expected).map((key) => [key, grant[key as keyof typeof grant]]),
  );
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    canonicalJson(expected) !== canonicalJson(grantedRequest) ||
    grant.requestHash !== linuxRetainedNativeSupervisorServiceRequestHash(expected) ||
    validFrom > now ||
    validUntil <= now ||
    validUntil <= validFrom ||
    validUntil - validFrom > MAX_AUTHORIZATION_LIFETIME_MS
  )
    deny('INVALID_AUTHORIZATION');
  return grant;
}

function responseMessage(
  input: unknown,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
  expected: Readonly<LinuxRetainedNativeSupervisorServiceRequest>,
  now: number,
): Readonly<RetainedNativeSupervisorWorkerServiceAuthorityCarrierResponse> {
  const value = plainRecord(input, RESPONSE_KEYS, 'INVALID_ATTESTATION');
  const requestHash = linuxRetainedNativeSupervisorServiceRequestHash(expected);
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_WORKER_SERVICE_AUTHORITY_RESPONSE' ||
    value.direction !== 'COORDINATOR_TO_WORKER' ||
    value.bindingHash !== retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding) ||
    value.requestHash !== requestHash ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_WORKER_SERVICE_AUTHORITY_RESPONSE',
    direction: 'COORDINATOR_TO_WORKER',
    bindingHash: value.bindingHash,
    requestHash,
    grant: freshGrant(value.grant, expected, now),
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

/** API-side one-shot protocol handler for exactly one worker carrier-listener service grant. */
export class BoundedRetainedNativeSupervisorWorkerServiceAuthorityCoordinatorHandler {
  readonly #authority: LinuxRetainedNativeSupervisorServiceAuthority['authorize'];
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #expected: Readonly<LinuxRetainedNativeSupervisorServiceRequest>;
  #attempted = false;

  constructor(
    authority: LinuxRetainedNativeSupervisorServiceAuthority,
    expectedRequest: unknown,
    binding: unknown,
    private readonly clock: () => number = Date.now,
  ) {
    if (
      authority instanceof DenyLinuxRetainedNativeSupervisorServiceAuthority ||
      typeof authority?.authorize !== 'function' ||
      typeof clock !== 'function'
    )
      deny('NOT_CONFIGURED');
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      binding,
      clock(),
    );
    this.#expected = exactRequest(expectedRequest, this.#binding);
    this.#authority = authority.authorize.bind(authority);
    Object.freeze(this);
  }

  async handle(input: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.#attempted) deny('EXCHANGE_DENIED');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
    const message = requestMessage(input, this.#binding);
    if (canonicalJson(message.request) !== canonicalJson(this.#expected))
      deny('INVALID_AUTHORIZATION');
    let issued: unknown;
    try {
      issued = await this.#authority(message.request);
    } catch {
      return deny('INVALID_AUTHORIZATION');
    }
    const grant = freshGrant(issued, this.#expected, this.clock());
    if (signal.aborted) deny('EXCHANGE_DENIED');
    return Object.freeze({
      schemaVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_WORKER_SERVICE_AUTHORITY_RESPONSE',
      direction: 'COORDINATOR_TO_WORKER',
      bindingHash: message.bindingHash,
      requestHash: message.requestHash,
      grant,
      runtimeConnection: 'NOT_CONFIGURED',
    });
  }
}

/** Worker-side one-shot service authority backed only by the canonical authenticated carrier. */
export class AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority implements LinuxRetainedNativeSupervisorServiceAuthority {
  readonly #carrier: Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationWorkerCarrier;
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #expected: Readonly<LinuxRetainedNativeSupervisorServiceRequest>;
  #attempted = false;

  constructor(
    carrier: Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationWorkerCarrier,
    expectedRequest: unknown,
    binding: unknown,
    private readonly signal: AbortSignal,
    private readonly clock: () => number = Date.now,
  ) {
    if (!(signal instanceof AbortSignal) || signal.aborted || typeof clock !== 'function')
      deny('NOT_CONFIGURED');
    this.#carrier =
      authenticateEd25519AuthenticatedRetainedNativeSupervisorTopologyObservationWorkerCarrier(
        carrier,
      );
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      binding,
      clock(),
    );
    this.#expected = exactRequest(expectedRequest, this.#binding);
    Object.freeze(this);
  }

  async authorize(input: unknown): Promise<unknown> {
    if (this.#attempted) deny('EXCHANGE_DENIED');
    this.#attempted = true;
    try {
      const request = exactRequest(input, this.#binding);
      if (canonicalJson(request) !== canonicalJson(this.#expected) || this.signal.aborted)
        deny('INVALID_AUTHORIZATION');
      const requestHash = linuxRetainedNativeSupervisorServiceRequestHash(request);
      const message = Object.freeze({
        schemaVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_WORKER_SERVICE_AUTHORITY_REQUEST',
        direction: 'WORKER_TO_COORDINATOR',
        bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(this.#binding),
        requestHash,
        request,
        runtimeConnection: 'NOT_CONFIGURED',
      });
      const authenticated = plainRecord(
        await Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationWorkerCarrier.prototype.exchange.call(
          this.#carrier,
          message,
          this.signal,
        ),
        AUTHENTICATED_KEYS,
        'INVALID_ATTESTATION',
      );
      return responseMessage(authenticated.message, this.#binding, this.#expected, this.clock())
        .grant;
    } finally {
      await Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationWorkerCarrier.prototype.close.call(
        this.#carrier,
      );
    }
  }
}
