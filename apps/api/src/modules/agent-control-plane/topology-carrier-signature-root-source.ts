import {
  canonicalJson,
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
  type RetainedNativeSupervisorTopologyObservationCarrierBinding,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
} from '@ventureos/agent-bridge';

import {
  PostgresTopologyCarrierSignatureRootRegistry,
  type TopologyCarrierSignatureRootSqlClient,
} from './topology-carrier-signature-root-registry';

const MAX_DATE_MS = 8_640_000_000_000_000;

export class TopologyCarrierSignatureRootSourceDeniedError extends Error {}

function deny(): never {
  throw new TopologyCarrierSignatureRootSourceDeniedError(
    'Topology carrier signature root source denied',
  );
}

function clockValue(clock: () => number): number {
  const now = clock();
  if (!Number.isFinite(now) || !Number.isSafeInteger(now) || now < 0 || now > MAX_DATE_MS) deny();
  return now;
}

function assertExactRoot(
  input: unknown,
  binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
  principalRole: 'API_COORDINATOR' | 'WORKER_CLIENT',
): Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord> {
  const root = validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord(input);
  const principalReference =
    principalRole === 'API_COORDINATOR'
      ? binding.coordinatorPrincipalReference
      : binding.workerPrincipalReference;
  if (
    root.rootRecordVersion !== 1 ||
    root.principalRole !== principalRole ||
    root.principalReference !== principalReference ||
    root.bindingHash !== retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding) ||
    root.revokedAt !== null ||
    Date.parse(root.validFrom) > Date.parse(binding.issuedAt) ||
    Date.parse(root.validUntil) < Date.parse(binding.expiresAt)
  )
    deny();
  return root;
}

/**
 * One-use API-coordinator adapter for the opposite worker's durable public verification grant.
 * It is intentionally not a worker source and remains absent from the API service graph.
 */
export class PostgresApiCoordinatorTopologyCarrierSignatureRootSource implements RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #registry: PostgresTopologyCarrierSignatureRootRegistry;
  #attempted = false;

  constructor(
    database: TopologyCarrierSignatureRootSqlClient,
    bindingInput: unknown,
    private readonly clock: () => number = Date.now,
  ) {
    try {
      if (!database || typeof database.$queryRaw !== 'function' || typeof clock !== 'function')
        deny();
      this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
        bindingInput,
        clockValue(clock),
      );
      this.#registry = new PostgresTopologyCarrierSignatureRootRegistry(database);
      Object.freeze(this);
    } catch {
      return deny();
    }
  }

  async read(
    bindingInput: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
    principalRole: 'API_COORDINATOR' | 'WORKER_CLIENT',
    signal: AbortSignal,
  ): Promise<Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord>> {
    if (this.#attempted) deny();
    this.#attempted = true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectInterruption: (() => void) | undefined;
    const interrupt = () => rejectInterruption?.();
    try {
      if (!(signal instanceof AbortSignal) || signal.aborted || principalRole !== 'WORKER_CLIENT')
        deny();
      const now = clockValue(this.clock);
      const supplied = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
        bindingInput,
        now,
      );
      if (canonicalJson(supplied) !== canonicalJson(this.#binding)) deny();
      const remaining = Date.parse(this.#binding.expiresAt) - now;
      if (!Number.isSafeInteger(remaining) || remaining < 1) deny();

      const interruption = new Promise<never>((_resolve, reject) => {
        rejectInterruption = () => reject(new TopologyCarrierSignatureRootSourceDeniedError());
        timer = setTimeout(rejectInterruption, remaining);
        timer.unref?.();
      });
      signal.addEventListener('abort', interrupt, { once: true });
      if (signal.aborted) interrupt();

      const candidate = await Promise.race([
        Promise.resolve().then(() =>
          this.#registry.read(this.#binding, 'WORKER_CLIENT', this.clock),
        ),
        interruption,
      ]);
      if (signal.aborted || candidate === null) deny();
      validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
        this.#binding,
        clockValue(this.clock),
      );
      return assertExactRoot(candidate, this.#binding, 'WORKER_CLIENT');
    } catch {
      return deny();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener?.('abort', interrupt);
      rejectInterruption = undefined;
    }
  }
}

/**
 * One-use API-local adapter for the coordinator's own durable public verification grant.
 * It is intended only for the authenticated lookup handler and remains absent from the API graph.
 */
export class PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource implements RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource {
  readonly #binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly #registry: PostgresTopologyCarrierSignatureRootRegistry;
  #attempted = false;

  constructor(
    database: TopologyCarrierSignatureRootSqlClient,
    bindingInput: unknown,
    private readonly clock: () => number = Date.now,
  ) {
    try {
      if (!database || typeof database.$queryRaw !== 'function' || typeof clock !== 'function')
        deny();
      this.#binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
        bindingInput,
        clockValue(clock),
      );
      this.#registry = new PostgresTopologyCarrierSignatureRootRegistry(database);
      Object.freeze(this);
    } catch {
      return deny();
    }
  }

  async read(
    bindingInput: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>,
    principalRole: 'API_COORDINATOR' | 'WORKER_CLIENT',
    signal: AbortSignal,
  ): Promise<Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord>> {
    if (this.#attempted) deny();
    this.#attempted = true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectInterruption: (() => void) | undefined;
    const interrupt = () => rejectInterruption?.();
    try {
      if (!(signal instanceof AbortSignal) || signal.aborted || principalRole !== 'API_COORDINATOR')
        deny();
      const now = clockValue(this.clock);
      const supplied = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
        bindingInput,
        now,
      );
      if (canonicalJson(supplied) !== canonicalJson(this.#binding)) deny();
      const remaining = Date.parse(this.#binding.expiresAt) - now;
      if (!Number.isSafeInteger(remaining) || remaining < 1) deny();

      const interruption = new Promise<never>((_resolve, reject) => {
        rejectInterruption = () => reject(new TopologyCarrierSignatureRootSourceDeniedError());
        timer = setTimeout(rejectInterruption, remaining);
        timer.unref?.();
      });
      signal.addEventListener('abort', interrupt, { once: true });
      if (signal.aborted) interrupt();

      const candidate = await Promise.race([
        Promise.resolve().then(() =>
          this.#registry.read(this.#binding, 'API_COORDINATOR', this.clock),
        ),
        interruption,
      ]);
      if (signal.aborted || candidate === null) deny();
      validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
        this.#binding,
        clockValue(this.clock),
      );
      return assertExactRoot(candidate, this.#binding, 'API_COORDINATOR');
    } catch {
      return deny();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener?.('abort', interrupt);
      rejectInterruption = undefined;
    }
  }
}
