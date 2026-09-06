import { createHash } from 'node:crypto';

import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  DenyLinuxRetainedNativeSupervisorTopologyObservationPort,
  linuxRetainedNativeSupervisorTopologyObservationRequestHash,
  validateLinuxRetainedNativeSupervisorTopologyObservation,
  validateLinuxRetainedNativeSupervisorTopologyObservationRequest,
  type LinuxRetainedNativeSupervisorTopologyObservation,
  type LinuxRetainedNativeSupervisorTopologyObservationPort,
} from './retained-native-supervisor-shared-runtime-topology';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;

const BINDING_KEYS = [
  'authority',
  'carrierId',
  'coordinatorPrincipalReference',
  'expiresAt',
  'issuedAt',
  'provisioningAttemptId',
  'provisioningPlanHash',
  'purpose',
  'runtimeConnection',
  'schemaVersion',
  'supervisorInstanceId',
  'workerPrincipalReference',
  'workspaceId',
] as const;
const REQUEST_KEYS = [
  'bindingHash',
  'carrierAttemptId',
  'direction',
  'request',
  'requestHash',
  'runtimeConnection',
  'schemaVersion',
] as const;
const RESPONSE_KEYS = [
  'bindingHash',
  'carrierAttemptId',
  'direction',
  'observation',
  'requestHash',
  'runtimeConnection',
  'schemaVersion',
] as const;
const DELIVERY_KEYS = [
  'authority',
  'bindingHash',
  'carrierId',
  'deliveredAt',
  'messageHash',
  'peerPrincipalReference',
  'runtimeConnection',
  'schemaVersion',
] as const;
const AUTHENTICATED_MESSAGE_KEYS = ['delivery', 'message'] as const;

export interface RetainedNativeSupervisorTopologyObservationCarrierBinding {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER';
  readonly authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL';
  readonly carrierId: string;
  readonly coordinatorPrincipalReference: string;
  readonly workerPrincipalReference: string;
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly provisioningAttemptId: string;
  readonly provisioningPlanHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface RetainedNativeSupervisorTopologyObservationCarrierDelivery {
  readonly schemaVersion: 1;
  readonly authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL';
  readonly carrierId: string;
  readonly bindingHash: string;
  readonly peerPrincipalReference: string;
  readonly messageHash: string;
  readonly deliveredAt: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface RetainedNativeSupervisorTopologyObservationCarrierRequest {
  readonly schemaVersion: 1;
  readonly direction: 'COORDINATOR_TO_WORKER';
  readonly carrierAttemptId: string;
  readonly bindingHash: string;
  readonly requestHash: string;
  readonly request: unknown;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface RetainedNativeSupervisorTopologyObservationCarrierResponse {
  readonly schemaVersion: 1;
  readonly direction: 'WORKER_TO_COORDINATOR';
  readonly carrierAttemptId: string;
  readonly bindingHash: string;
  readonly requestHash: string;
  readonly observation: unknown;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface ClosableRetainedNativeSupervisorTopologyObservationCarrier {
  exchange(input: unknown, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export interface RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator {
  authenticate(
    input: unknown,
    binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
    expectedPeerPrincipalReference: string,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class DenyRetainedNativeSupervisorTopologyObservationCarrier implements ClosableRetainedNativeSupervisorTopologyObservationCarrier {
  async exchange(_input: unknown, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }

  async close(): Promise<void> {}
}

export class DenyRetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator implements RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator {
  async authenticate(
    _input: unknown,
    _binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
    _expectedPeerPrincipalReference: string,
    _signal: AbortSignal,
  ): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

function deny(
  code:
    | 'NOT_CONFIGURED'
    | 'INVALID_AUTHORIZATION'
    | 'INVALID_ATTESTATION'
    | 'CONCURRENT_EXCHANGE'
    | 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(
  input: unknown,
  keys: readonly string[],
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
) {
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

function reference(input: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): string {
  if (typeof input !== 'string' || !SAFE_REFERENCE.test(input) || PRIVATE_TEXT.test(input))
    deny(code);
  return input;
}

function digest(input: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): string {
  if (typeof input !== 'string' || !SHA256.test(input)) deny(code);
  return input;
}

function timestamp(input: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): string {
  if (typeof input !== 'string') deny(code);
  const parsed = new Date(input);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== input) deny(code);
  return input;
}

function hash(input: unknown): string {
  try {
    return createHash('sha256').update(canonicalJson(input)).digest('hex');
  } catch {
    return deny('INVALID_ATTESTATION');
  }
}

function activeNow(
  clock: () => number,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
  signal: AbortSignal,
): number {
  if (signal.aborted) deny('EXCHANGE_DENIED');
  const value = clock();
  if (
    !Number.isSafeInteger(value) ||
    value < Date.parse(binding.issuedAt) ||
    value >= Date.parse(binding.expiresAt)
  )
    deny('INVALID_ATTESTATION');
  return value;
}

export function validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
  input: unknown,
  now: number,
): Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding> {
  const value = plainRecord(input, BINDING_KEYS, 'INVALID_AUTHORIZATION');
  const issuedAt = timestamp(value.issuedAt, 'INVALID_AUTHORIZATION');
  const expiresAt = timestamp(value.expiresAt, 'INVALID_AUTHORIZATION');
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER' ||
    value.authority !== 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    issued > now ||
    expires <= now ||
    expires <= issued ||
    expires - issued > MAX_TIMEOUT_MS
  )
    deny('INVALID_AUTHORIZATION');
  const coordinator = reference(value.coordinatorPrincipalReference, 'INVALID_AUTHORIZATION');
  const worker = reference(value.workerPrincipalReference, 'INVALID_AUTHORIZATION');
  if (coordinator === worker) deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER',
    authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL',
    carrierId: reference(value.carrierId, 'INVALID_AUTHORIZATION'),
    coordinatorPrincipalReference: coordinator,
    workerPrincipalReference: worker,
    workspaceId: reference(value.workspaceId, 'INVALID_AUTHORIZATION'),
    supervisorInstanceId: reference(value.supervisorInstanceId, 'INVALID_AUTHORIZATION'),
    provisioningAttemptId: reference(value.provisioningAttemptId, 'INVALID_AUTHORIZATION'),
    provisioningPlanHash: digest(value.provisioningPlanHash, 'INVALID_AUTHORIZATION'),
    issuedAt,
    expiresAt,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

export function retainedNativeSupervisorTopologyObservationCarrierBindingHash(
  input: unknown,
): string {
  const value = plainRecord(input, BINDING_KEYS, 'INVALID_AUTHORIZATION');
  return hash(value);
}

function validateRequest(
  input: unknown,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
) {
  const value = plainRecord(input, REQUEST_KEYS, 'INVALID_AUTHORIZATION');
  const request = validateLinuxRetainedNativeSupervisorTopologyObservationRequest(value.request);
  const requestHash = linuxRetainedNativeSupervisorTopologyObservationRequestHash(request);
  const bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding);
  if (
    value.schemaVersion !== 1 ||
    value.direction !== 'COORDINATOR_TO_WORKER' ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    value.bindingHash !== bindingHash ||
    value.requestHash !== requestHash ||
    request.observerRole !== 'WORKER_CLIENT' ||
    request.workspaceId !== binding.workspaceId ||
    request.supervisorInstanceId !== binding.supervisorInstanceId ||
    request.provisioningAttemptId !== binding.provisioningAttemptId ||
    request.provisioningPlanHash !== binding.provisioningPlanHash
  )
    deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1 as const,
    direction: 'COORDINATOR_TO_WORKER' as const,
    carrierAttemptId: reference(value.carrierAttemptId, 'INVALID_AUTHORIZATION'),
    bindingHash,
    requestHash,
    request,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  });
}

function validateDelivery(
  input: unknown,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
  expectedPeer: string,
  message: unknown,
  now: number,
) {
  const value = plainRecord(input, DELIVERY_KEYS, 'INVALID_ATTESTATION');
  const deliveredAt = timestamp(value.deliveredAt, 'INVALID_ATTESTATION');
  const delivered = Date.parse(deliveredAt);
  if (
    value.schemaVersion !== 1 ||
    value.authority !== 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' ||
    value.carrierId !== binding.carrierId ||
    value.bindingHash !== retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding) ||
    value.peerPrincipalReference !== expectedPeer ||
    value.messageHash !== hash(message) ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    delivered > now ||
    delivered < Date.parse(binding.issuedAt) ||
    delivered >= Date.parse(binding.expiresAt)
  )
    deny('INVALID_ATTESTATION');
  return value;
}

function bindCarrier(carrier: ClosableRetainedNativeSupervisorTopologyObservationCarrier) {
  if (carrier instanceof DenyRetainedNativeSupervisorTopologyObservationCarrier)
    deny('NOT_CONFIGURED');
  const exchange = carrier.exchange;
  const close = carrier.close;
  if (typeof exchange !== 'function' || typeof close !== 'function') deny('NOT_CONFIGURED');
  return Object.freeze({ exchange: exchange.bind(carrier), close: close.bind(carrier) });
}

function bindObserver(observer: LinuxRetainedNativeSupervisorTopologyObservationPort) {
  if (observer instanceof DenyLinuxRetainedNativeSupervisorTopologyObservationPort)
    deny('NOT_CONFIGURED');
  const observe = observer.observe;
  if (typeof observe !== 'function') deny('NOT_CONFIGURED');
  return observe.bind(observer);
}

function bindInboundAuthenticator(
  authenticator: RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator,
) {
  if (
    authenticator instanceof
    DenyRetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator
  )
    deny('NOT_CONFIGURED');
  const authenticate = authenticator.authenticate;
  if (typeof authenticate !== 'function') deny('NOT_CONFIGURED');
  return authenticate.bind(authenticator);
}

/** One-use coordinator-side worker observation over an authenticated cross-container carrier. */
export class AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationTransport implements LinuxRetainedNativeSupervisorTopologyObservationPort {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #exchange: ClosableRetainedNativeSupervisorTopologyObservationCarrier['exchange'];
  readonly #close: ClosableRetainedNativeSupervisorTopologyObservationCarrier['close'];
  #attempted = false;
  #closePromise: Promise<void> | undefined;
  #lastNow: number;

  constructor(
    carrier: ClosableRetainedNativeSupervisorTopologyObservationCarrier,
    binding: unknown,
    private readonly carrierAttemptId: string,
    private readonly clock: () => number = Date.now,
    private readonly timeoutMs = MAX_TIMEOUT_MS,
  ) {
    if (
      typeof clock !== 'function' ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < MIN_TIMEOUT_MS ||
      timeoutMs > MAX_TIMEOUT_MS
    )
      deny('NOT_CONFIGURED');
    const constructedAt = clock();
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      binding,
      constructedAt,
    );
    this.#lastNow = constructedAt;
    reference(carrierAttemptId, 'INVALID_AUTHORIZATION');
    const bound = bindCarrier(carrier);
    this.#exchange = bound.exchange;
    this.#close = bound.close;
  }

  async observe(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<LinuxRetainedNativeSupervisorTopologyObservation>> {
    if (this.#attempted) deny('CONCURRENT_EXCHANGE');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
    const request = validateLinuxRetainedNativeSupervisorTopologyObservationRequest(input);
    const message = validateRequest(
      {
        schemaVersion: 1,
        direction: 'COORDINATOR_TO_WORKER',
        carrierAttemptId: this.carrierAttemptId,
        bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(this.#binding),
        requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(request),
        request,
        runtimeConnection: 'NOT_CONFIGURED',
      },
      this.#binding,
    );
    const startedAt = this.now(signal);
    const attempt = new AbortController();
    let rejectInterruption: ((error: RetainedNativeSupervisorLocalIpcError) => void) | undefined;
    const interrupt = () => {
      attempt.abort();
      rejectInterruption?.(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED'));
    };
    signal.addEventListener('abort', interrupt, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failure: unknown;
    let result: Readonly<LinuxRetainedNativeSupervisorTopologyObservation> | undefined;
    try {
      const interruption = new Promise<never>((_resolve, reject) => {
        rejectInterruption = reject;
        timer = setTimeout(
          () => {
            attempt.abort();
            reject(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED'));
          },
          Math.min(this.timeoutMs, Date.parse(this.#binding.expiresAt) - startedAt),
        );
        timer.unref?.();
      });
      if (signal.aborted) interrupt();
      const raw = await Promise.race([this.#exchange(message, attempt.signal), interruption]);
      const authenticated = plainRecord(raw, AUTHENTICATED_MESSAGE_KEYS, 'INVALID_ATTESTATION');
      const response = plainRecord(authenticated.message, RESPONSE_KEYS, 'INVALID_ATTESTATION');
      const now = this.now(signal);
      validateDelivery(
        authenticated.delivery,
        this.#binding,
        this.#binding.workerPrincipalReference,
        response,
        now,
      );
      if (
        response.schemaVersion !== 1 ||
        response.direction !== 'WORKER_TO_COORDINATOR' ||
        response.carrierAttemptId !== this.carrierAttemptId ||
        response.bindingHash !== message.bindingHash ||
        response.requestHash !== message.requestHash ||
        response.runtimeConnection !== 'NOT_CONFIGURED'
      )
        deny('INVALID_ATTESTATION');
      result = validateLinuxRetainedNativeSupervisorTopologyObservation(
        response.observation,
        request,
        now,
      );
      if (Date.parse(result.validUntil) > Date.parse(this.#binding.expiresAt))
        deny('INVALID_ATTESTATION');
    } catch (error) {
      failure = error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      attempt.abort();
      signal.removeEventListener('abort', interrupt);
      rejectInterruption = undefined;
      try {
        await this.closeCarrier();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) {
      if (failure instanceof RetainedNativeSupervisorLocalIpcError) throw failure;
      deny('EXCHANGE_DENIED');
    }
    if (result === undefined || signal.aborted) deny('EXCHANGE_DENIED');
    return result;
  }

  private closeCarrier(): Promise<void> {
    this.#closePromise ??= this.closeBounded();
    return this.#closePromise;
  }

  private now(signal: AbortSignal): number {
    const value = activeNow(this.clock, this.#binding, signal);
    if (value < this.#lastNow) deny('INVALID_ATTESTATION');
    this.#lastNow = value;
    return value;
  }

  private async closeBounded(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#close(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED')),
            this.timeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/** Worker-side terminal for one authenticated carrier delivery. */
export class AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #authenticate: RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator['authenticate'];
  readonly #observe: LinuxRetainedNativeSupervisorTopologyObservationPort['observe'];
  #attempted = false;
  #lastNow: number;

  constructor(
    observer: LinuxRetainedNativeSupervisorTopologyObservationPort,
    authenticator: RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator,
    binding: unknown,
    private readonly clock: () => number = Date.now,
  ) {
    if (typeof clock !== 'function') deny('NOT_CONFIGURED');
    const constructedAt = clock();
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      binding,
      constructedAt,
    );
    this.#lastNow = constructedAt;
    this.#authenticate = bindInboundAuthenticator(authenticator);
    this.#observe = bindObserver(observer);
  }

  async handle(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<RetainedNativeSupervisorTopologyObservationCarrierResponse>> {
    if (this.#attempted) deny('CONCURRENT_EXCHANGE');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
    const startedAt = this.now(signal);
    const attempt = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectInterruption: ((error: RetainedNativeSupervisorLocalIpcError) => void) | undefined;
    const interrupt = () => {
      attempt.abort();
      rejectInterruption?.(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED'));
    };
    signal.addEventListener('abort', interrupt, { once: true });
    try {
      const interruption = new Promise<never>((_resolve, reject) => {
        rejectInterruption = reject;
        timer = setTimeout(
          () => {
            attempt.abort();
            reject(new RetainedNativeSupervisorLocalIpcError('EXCHANGE_DENIED'));
          },
          Date.parse(this.#binding.expiresAt) - startedAt,
        );
        timer.unref?.();
      });
      if (signal.aborted) interrupt();
      const authenticated = plainRecord(
        await Promise.race([
          this.#authenticate(
            input,
            this.#binding,
            this.#binding.coordinatorPrincipalReference,
            attempt.signal,
          ),
          interruption,
        ]),
        AUTHENTICATED_MESSAGE_KEYS,
        'INVALID_AUTHORIZATION',
      );
      const request = validateRequest(authenticated.message, this.#binding);
      validateDelivery(
        authenticated.delivery,
        this.#binding,
        this.#binding.coordinatorPrincipalReference,
        request,
        this.now(signal),
      );
      const candidate = await Promise.race([
        this.#observe(request.request, attempt.signal),
        interruption,
      ]);
      const completedAt = this.now(signal);
      const observation = validateLinuxRetainedNativeSupervisorTopologyObservation(
        candidate,
        request.request,
        completedAt,
      );
      if (Date.parse(observation.validUntil) > Date.parse(this.#binding.expiresAt))
        deny('INVALID_ATTESTATION');
      return Object.freeze({
        schemaVersion: 1 as const,
        direction: 'WORKER_TO_COORDINATOR' as const,
        carrierAttemptId: request.carrierAttemptId,
        bindingHash: request.bindingHash,
        requestHash: request.requestHash,
        observation,
        runtimeConnection: 'NOT_CONFIGURED' as const,
      });
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('EXCHANGE_DENIED');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      attempt.abort();
      signal.removeEventListener('abort', interrupt);
      rejectInterruption = undefined;
    }
  }

  private now(signal: AbortSignal): number {
    const value = activeNow(this.clock, this.#binding, signal);
    if (value < this.#lastNow) deny('INVALID_ATTESTATION');
    this.#lastNow = value;
    return value;
  }
}
