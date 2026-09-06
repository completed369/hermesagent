import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  BoundedLinuxRetainedNativeSupervisorProvisioningController,
  linuxRetainedNativeSupervisorProvisioningPlanHash,
  validateLinuxRetainedNativeSupervisorProvisioningPlan,
  type LinuxRetainedNativeSupervisorProvisioningPlan,
  type ProvisionedLinuxRetainedNativeSupervisorBundle,
} from './retained-native-supervisor-provisioning-controller';
import {
  BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler,
  type AttestedLinuxRetainedNativeSupervisorSharedRuntimeTopology,
} from './retained-native-supervisor-shared-runtime-topology';

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 10_000;

export interface TopologyGatedProvisionedLinuxRetainedNativeSupervisorBundle {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_GATED_PROVISIONING';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly provisioningAttemptId: string;
  readonly provisioningPlanHash: string;
  readonly topology: Readonly<AttestedLinuxRetainedNativeSupervisorSharedRuntimeTopology>;
  readonly provisioning: Readonly<ProvisionedLinuxRetainedNativeSupervisorBundle>;
  readonly provisioningState: 'TOPOLOGY_ATTESTED_PROVISIONED_NOT_ACTIVATED';
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

function deny(code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function exactBaseInstance<T extends object>(
  value: unknown,
  constructor: abstract new (...args: never[]) => T,
): value is T {
  try {
    return (
      typeof value === 'object' &&
      value !== null &&
      Object.getPrototypeOf(value) === constructor.prototype
    );
  } catch {
    return false;
  }
}

/**
 * One-use fail-closed composition boundary. It proves the exact shared parent first, then permits
 * the existing provisioning controller to act only while both role-local observations remain fresh.
 * It supplies no transport, mount, authority, activation, process, or connection state.
 */
export class BoundedLinuxRetainedNativeSupervisorTopologyGatedProvisioningController {
  readonly #attest: (
    input: unknown,
    signal: AbortSignal,
  ) => Promise<Readonly<AttestedLinuxRetainedNativeSupervisorSharedRuntimeTopology>>;
  readonly #provision: (
    input: unknown,
    signal: AbortSignal,
  ) => Promise<Readonly<ProvisionedLinuxRetainedNativeSupervisorBundle>>;
  #attempted = false;
  #lastNow = -1;

  constructor(
    topology: BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler,
    provisioning: BoundedLinuxRetainedNativeSupervisorProvisioningController,
    private readonly clock: () => number = Date.now,
    private readonly timeoutMs = MAX_TIMEOUT_MS,
  ) {
    if (
      !exactBaseInstance(
        topology,
        BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler,
      ) ||
      !exactBaseInstance(provisioning, BoundedLinuxRetainedNativeSupervisorProvisioningController)
    )
      deny('NOT_CONFIGURED');
    if (
      typeof clock !== 'function' ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < MIN_TIMEOUT_MS ||
      timeoutMs > MAX_TIMEOUT_MS
    )
      deny('INVALID_AUTHORIZATION');
    this.#attest =
      BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler.prototype.attest.bind(
        topology,
      );
    this.#provision =
      BoundedLinuxRetainedNativeSupervisorProvisioningController.prototype.provision.bind(
        provisioning,
      );
  }

  async provision(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<TopologyGatedProvisionedLinuxRetainedNativeSupervisorBundle>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('INVALID_AUTHORIZATION');
    const plan = validateLinuxRetainedNativeSupervisorProvisioningPlan(input);
    const planHash = linuxRetainedNativeSupervisorProvisioningPlanHash(plan);
    const startedAt = this.now(signal);
    const attempt = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let freshnessTimeout: ReturnType<typeof setTimeout> | undefined;
    let cancelReject: ((error: RetainedNativeSupervisorLocalIpcError) => void) | undefined;
    const cancel = () => {
      attempt.abort();
      cancelReject?.(new RetainedNativeSupervisorLocalIpcError('INVALID_AUTHORIZATION'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    const interruption = new Promise<never>((_resolve, reject) => {
      cancelReject = reject;
      timeout = setTimeout(() => {
        attempt.abort();
        reject(new RetainedNativeSupervisorLocalIpcError('INVALID_ATTESTATION'));
      }, this.timeoutMs);
    });
    if (signal.aborted) cancel();
    try {
      const topology = await Promise.race([this.#attest(plan, attempt.signal), interruption]);
      const topologyAcceptedAt = this.now(signal);
      this.assertTopology(topology, plan, planHash, topologyAcceptedAt);
      const validUntil = Math.min(
        Date.parse(topology.apiListener.validUntil),
        Date.parse(topology.workerClient.validUntil),
      );
      const remainingFreshnessMs = validUntil - topologyAcceptedAt;
      if (
        !Number.isSafeInteger(remainingFreshnessMs) ||
        remainingFreshnessMs < 1 ||
        topologyAcceptedAt - startedAt > this.timeoutMs
      )
        deny('INVALID_ATTESTATION');
      const freshness = new Promise<never>((_resolve, reject) => {
        freshnessTimeout = setTimeout(() => {
          attempt.abort();
          reject(new RetainedNativeSupervisorLocalIpcError('INVALID_ATTESTATION'));
        }, remainingFreshnessMs);
      });
      const provisioning = await Promise.race([
        this.#provision(plan, attempt.signal),
        interruption,
        freshness,
      ]);
      const completedAt = this.now(signal);
      if (
        attempt.signal.aborted ||
        completedAt >= validUntil ||
        completedAt - startedAt > this.timeoutMs
      )
        deny('INVALID_ATTESTATION');
      this.assertProvisioning(provisioning, plan);
      return Object.freeze({
        schemaVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_GATED_PROVISIONING',
        workspaceId: plan.runtimeRootRequest.workspaceId,
        supervisorInstanceId: plan.runtimeRootRequest.supervisorInstanceId,
        provisioningAttemptId: plan.runtimeRootRequest.provisioningAttemptId,
        provisioningPlanHash: planHash,
        topology,
        provisioning,
        provisioningState: 'TOPOLOGY_ATTESTED_PROVISIONED_NOT_ACTIVATED',
        runtimeConnection: 'NOT_CONFIGURED',
      });
    } catch (error) {
      attempt.abort();
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_ATTESTATION');
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (freshnessTimeout !== undefined) clearTimeout(freshnessTimeout);
      signal.removeEventListener('abort', cancel);
      cancelReject = undefined;
    }
  }

  private assertTopology(
    topology: Readonly<AttestedLinuxRetainedNativeSupervisorSharedRuntimeTopology>,
    plan: Readonly<LinuxRetainedNativeSupervisorProvisioningPlan>,
    planHash: string,
    now: number,
  ): void {
    const root = plan.runtimeRootRequest;
    if (
      topology.schemaVersion !== 1 ||
      topology.purpose !== 'RETAINED_NATIVE_SUPERVISOR_SHARED_RUNTIME_TOPOLOGY' ||
      topology.workspaceId !== root.workspaceId ||
      topology.supervisorInstanceId !== root.supervisorInstanceId ||
      topology.provisioningAttemptId !== root.provisioningAttemptId ||
      topology.provisioningPlanHash !== planHash ||
      topology.runtimeRootParent !== root.runtimeRootParent ||
      topology.runtimeRootParentIdentityReference !== root.runtimeRootParentIdentityReference ||
      topology.apiListener.observerRole !== 'API_LISTENER' ||
      topology.workerClient.observerRole !== 'WORKER_CLIENT' ||
      topology.apiListener.observerUid !== root.runtimeRootParentOwnerUid ||
      topology.apiListener.observerGid !== root.runtimeRootParentOwnerGid ||
      topology.workerClient.observerUid !== root.runtimeRootParentOwnerUid ||
      topology.workerClient.observerGid !== root.runtimeRootParentOwnerGid ||
      Date.parse(topology.apiListener.validUntil) <= now ||
      Date.parse(topology.workerClient.validUntil) <= now ||
      topology.topologyState !== 'SHARED_RUNTIME_VISIBLE_NOT_PROVISIONED' ||
      topology.runtimeConnection !== 'NOT_CONFIGURED'
    )
      deny('INVALID_ATTESTATION');
  }

  private assertProvisioning(
    provisioning: Readonly<ProvisionedLinuxRetainedNativeSupervisorBundle>,
    plan: Readonly<LinuxRetainedNativeSupervisorProvisioningPlan>,
  ): void {
    const root = plan.runtimeRootRequest;
    if (
      provisioning.schemaVersion !== 1 ||
      provisioning.purpose !== 'RETAINED_NATIVE_SUPERVISOR_PROVISIONING' ||
      provisioning.workspaceId !== root.workspaceId ||
      provisioning.supervisorInstanceId !== root.supervisorInstanceId ||
      provisioning.provisioningAttemptId !== root.provisioningAttemptId ||
      provisioning.runtimeRoot.runtimeRoot !== root.runtimeRoot ||
      provisioning.runtimeRoot.ownerUid !== root.ownerUid ||
      provisioning.runtimeRoot.ownerGid !== root.ownerGid ||
      provisioning.client.moduleKind !== 'CLIENT' ||
      provisioning.listener.moduleKind !== 'LISTENER' ||
      provisioning.client.socketPath !== plan.socketPath ||
      provisioning.listener.socketPath !== plan.socketPath ||
      provisioning.provisioningState !== 'PROVISIONED_NOT_ACTIVATED' ||
      provisioning.runtimeConnection !== 'NOT_CONFIGURED'
    )
      deny('INVALID_ATTESTATION');
  }

  private now(signal: AbortSignal): number {
    if (signal.aborted) deny('INVALID_AUTHORIZATION');
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0 || now < this.#lastNow) deny('INVALID_ATTESTATION');
    this.#lastNow = now;
    return now;
  }
}
