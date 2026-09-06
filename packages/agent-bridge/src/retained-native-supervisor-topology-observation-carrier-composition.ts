import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler,
  AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationTransport,
  DenyRetainedNativeSupervisorTopologyObservationCarrier,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  type ClosableRetainedNativeSupervisorTopologyObservationCarrier,
  type RetainedNativeSupervisorTopologyObservationCarrierBinding,
} from './retained-native-supervisor-topology-observation-carrier';
import {
  DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationCarrier,
  Ed25519RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator,
  Ed25519RetainedNativeSupervisorTopologyObservationWorkerEndpoint,
  validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
  type RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
} from './retained-native-supervisor-topology-observation-carrier-signature';
import {
  DenyLinuxRetainedNativeSupervisorTopologyObservationPort,
  type LinuxRetainedNativeSupervisorTopologyObservation,
  type LinuxRetainedNativeSupervisorTopologyObservationPort,
} from './retained-native-supervisor-shared-runtime-topology';

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(bearer|token|secret|password|private[-_ ]?key|authorization|credential|cookie|session)/iu;

export interface RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource {
  read(
    binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
    principalRole: 'API_COORDINATOR' | 'WORKER_CLIENT',
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class DenyRetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource implements RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource {
  async read(
    _binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
    _principalRole: 'API_COORDINATOR' | 'WORKER_CLIENT',
    _signal: AbortSignal,
  ): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

function deny(
  code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION' | 'EXCHANGE_DENIED',
): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function timeout(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < MIN_TIMEOUT_MS ||
    (value as number) > MAX_TIMEOUT_MS
  )
    deny('INVALID_AUTHORIZATION');
  return value as number;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value))
    deny('INVALID_AUTHORIZATION');
  return value;
}

function bindRootSource(
  source: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
) {
  if (
    source instanceof DenyRetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource ||
    typeof source?.read !== 'function'
  )
    deny('NOT_CONFIGURED');
  return source.read.bind(source);
}

function assertSigner(signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner) {
  if (
    signer instanceof DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner ||
    typeof signer?.sign !== 'function'
  )
    deny('NOT_CONFIGURED');
}

async function resolveRoot(
  read: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource['read'],
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
  principalRole: 'API_COORDINATOR' | 'WORKER_CLIENT',
  signal: AbortSignal,
  clock: () => number,
): Promise<Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord>> {
  if (!(signal instanceof AbortSignal) || signal.aborted) deny('EXCHANGE_DENIED');
  const now = clock();
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding(binding, now);
  const remaining = Date.parse(binding.expiresAt) - now;
  if (!Number.isSafeInteger(remaining) || remaining < 1) deny('INVALID_AUTHORIZATION');
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
      timer = setTimeout(() => {
        attempt.abort();
        reject(new RetainedNativeSupervisorLocalIpcError('INVALID_AUTHORIZATION'));
      }, remaining);
      timer.unref?.();
    });
    if (signal.aborted) interrupt();
    const root = await Promise.race([read(binding, principalRole, attempt.signal), interruption]);
    if (signal.aborted || attempt.signal.aborted) deny('EXCHANGE_DENIED');
    return validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord(root);
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('INVALID_AUTHORIZATION');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    attempt.abort();
    signal.removeEventListener('abort', interrupt);
    rejectInterruption = undefined;
  }
}

class OneCloseTopologyCarrier implements ClosableRetainedNativeSupervisorTopologyObservationCarrier {
  readonly #exchange: ClosableRetainedNativeSupervisorTopologyObservationCarrier['exchange'];
  readonly #close: ClosableRetainedNativeSupervisorTopologyObservationCarrier['close'];
  #closePromise: Promise<void> | undefined;

  constructor(
    carrier: ClosableRetainedNativeSupervisorTopologyObservationCarrier,
    private readonly timeoutMs: number,
  ) {
    if (
      carrier instanceof DenyRetainedNativeSupervisorTopologyObservationCarrier ||
      typeof carrier?.exchange !== 'function' ||
      typeof carrier?.close !== 'function'
    )
      deny('NOT_CONFIGURED');
    this.#exchange = carrier.exchange.bind(carrier);
    this.#close = carrier.close.bind(carrier);
  }

  exchange(input: unknown, signal: AbortSignal): Promise<unknown> {
    return this.#exchange(input, signal);
  }

  close(): Promise<void> {
    this.#closePromise ??= this.closeBounded();
    return this.#closePromise;
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

/** Resolves the exact worker root before one signed coordinator observation. */
export class RootResolvedRetainedNativeSupervisorTopologyObservationCoordinator {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #read: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource['read'];
  readonly #carrier: OneCloseTopologyCarrier;
  readonly #carrierAttemptId: string;
  #attempted = false;

  constructor(
    rootSource: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
    carrier: ClosableRetainedNativeSupervisorTopologyObservationCarrier,
    private readonly signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
    binding: unknown,
    carrierAttemptId: string,
    private readonly clock: () => number = Date.now,
    timeoutMs = MAX_TIMEOUT_MS,
  ) {
    if (typeof clock !== 'function') deny('NOT_CONFIGURED');
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      binding,
      clock(),
    );
    this.#read = bindRootSource(rootSource);
    assertSigner(signer);
    this.#carrierAttemptId = reference(carrierAttemptId);
    this.#carrier = new OneCloseTopologyCarrier(carrier, timeout(timeoutMs));
  }

  async observe(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<LinuxRetainedNativeSupervisorTopologyObservation>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    let failure: unknown;
    let result: Readonly<LinuxRetainedNativeSupervisorTopologyObservation> | undefined;
    try {
      const root = await resolveRoot(
        this.#read,
        this.#binding,
        'WORKER_CLIENT',
        signal,
        this.clock,
      );
      const signed = new Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationCarrier(
        this.#carrier,
        this.signer,
        root,
        this.#binding,
        this.clock,
      );
      result =
        await new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationTransport(
          signed,
          this.#binding,
          this.#carrierAttemptId,
          this.clock,
        ).observe(input, signal);
    } catch (error) {
      failure = error;
    } finally {
      try {
        await this.#carrier.close();
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
}

/** Resolves the exact coordinator root before one worker authenticate/observe/sign operation. */
export class RootResolvedRetainedNativeSupervisorTopologyObservationWorker {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #read: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource['read'];
  #attempted = false;

  constructor(
    rootSource: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
    private readonly observer: LinuxRetainedNativeSupervisorTopologyObservationPort,
    private readonly signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
    binding: unknown,
    private readonly clock: () => number = Date.now,
  ) {
    if (typeof clock !== 'function') deny('NOT_CONFIGURED');
    this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      binding,
      clock(),
    );
    this.#read = bindRootSource(rootSource);
    if (
      observer instanceof DenyLinuxRetainedNativeSupervisorTopologyObservationPort ||
      typeof observer?.observe !== 'function'
    )
      deny('NOT_CONFIGURED');
    assertSigner(signer);
  }

  async handle(input: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    const root = await resolveRoot(
      this.#read,
      this.#binding,
      'API_COORDINATOR',
      signal,
      this.clock,
    );
    const authenticator =
      new Ed25519RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator(
        root,
        this.clock,
      );
    const handler =
      new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler(
        this.observer,
        authenticator,
        this.#binding,
        this.clock,
      );
    return new Ed25519RetainedNativeSupervisorTopologyObservationWorkerEndpoint(
      handler,
      this.signer,
      this.#binding,
      this.clock,
    ).handle(input, signal);
  }
}
