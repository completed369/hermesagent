import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  type BigIntStats,
} from 'node:fs';
import { posix } from 'node:path';
import { arch, getegid, geteuid, platform } from 'node:process';

import { canonicalJson } from './codec';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';
import {
  linuxRetainedNativeSupervisorProvisioningPlanHash,
  validateLinuxRetainedNativeSupervisorProvisioningPlan,
  type LinuxRetainedNativeSupervisorProvisioningPlan,
  type LinuxRetainedNativeSupervisorSourceModuleEvidence,
} from './retained-native-supervisor-provisioning-controller';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const MAX_OBSERVATION_LIFETIME_MS = 5_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const LINUX_O_CLOEXEC = 0o2000000;
const SAFE_DIRECTORY_PATH = /^\/[A-Za-z0-9._/-]+$/u;
const SAFE_NATIVE_PATH = /^\/[A-Za-z0-9._/-]+\.node$/u;
const SAFE_ATTEMPT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const MAX_PATH_BYTES = 4_096;

export type LinuxRetainedNativeSupervisorTopologyObserverRole = 'API_LISTENER' | 'WORKER_CLIENT';

export interface LinuxRetainedNativeSupervisorTopologyObservationRequest {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION';
  readonly observerRole: LinuxRetainedNativeSupervisorTopologyObserverRole;
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly provisioningAttemptId: string;
  readonly provisioningPlanHash: string;
  readonly platform: 'LINUX';
  readonly architecture: 'X64';
  readonly runtimeRootParent: string;
  readonly runtimeRootParentIdentityReference: string;
  readonly runtimeRootParentOwnerUid: number;
  readonly runtimeRootParentOwnerGid: number;
  readonly runtimeRootParentMode: 448;
  readonly sourceModulePath: string;
  readonly sourceModuleSha256: string;
  readonly sourceModuleIdentityReference: string;
  readonly sourceModuleOwnerUid: number;
  readonly sourceModuleOwnerGid: number;
  readonly sourceModuleMode: number;
  readonly sourceModuleSizeBytes: number;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface LinuxRetainedNativeSupervisorTopologyObservation extends LinuxRetainedNativeSupervisorTopologyObservationRequest {
  readonly observationId: string;
  readonly requestHash: string;
  readonly evidenceAuthority: 'LINUX_RETAINED_DESCRIPTORS';
  readonly principalAuthority: 'LINUX_EFFECTIVE_IDENTITY';
  readonly observerUid: number;
  readonly observerGid: number;
  readonly observedAt: string;
  readonly validUntil: string;
  readonly topologyState: 'VISIBLE_NOT_PROVISIONED';
}

export interface LinuxRetainedNativeSupervisorTopologyObservationPort {
  observe(input: unknown, signal: AbortSignal): Promise<unknown>;
}

export class DenyLinuxRetainedNativeSupervisorTopologyObservationPort implements LinuxRetainedNativeSupervisorTopologyObservationPort {
  async observe(_input: unknown, _signal: AbortSignal): Promise<never> {
    return deny('NOT_CONFIGURED');
  }
}

export interface AttestedLinuxRetainedNativeSupervisorSharedRuntimeTopology {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_SUPERVISOR_SHARED_RUNTIME_TOPOLOGY';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly provisioningAttemptId: string;
  readonly provisioningPlanHash: string;
  readonly runtimeRootParent: string;
  readonly runtimeRootParentIdentityReference: string;
  readonly apiListener: Readonly<LinuxRetainedNativeSupervisorTopologyObservation>;
  readonly workerClient: Readonly<LinuxRetainedNativeSupervisorTopologyObservation>;
  readonly topologyState: 'SHARED_RUNTIME_VISIBLE_NOT_PROVISIONED';
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

const REQUEST_KEYS = [
  'architecture',
  'observerRole',
  'platform',
  'provisioningAttemptId',
  'provisioningPlanHash',
  'purpose',
  'runtimeConnection',
  'runtimeRootParent',
  'runtimeRootParentIdentityReference',
  'runtimeRootParentMode',
  'runtimeRootParentOwnerGid',
  'runtimeRootParentOwnerUid',
  'schemaVersion',
  'sourceModuleIdentityReference',
  'sourceModuleMode',
  'sourceModuleOwnerGid',
  'sourceModuleOwnerUid',
  'sourceModulePath',
  'sourceModuleSha256',
  'sourceModuleSizeBytes',
  'supervisorInstanceId',
  'workspaceId',
] as const;
const RESULT_KEYS = [
  ...REQUEST_KEYS,
  'evidenceAuthority',
  'observationId',
  'observerGid',
  'observerUid',
  'observedAt',
  'principalAuthority',
  'requestHash',
  'topologyState',
  'validUntil',
] as const;

function deny(code: 'NOT_CONFIGURED' | 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION'): never {
  throw new RetainedNativeSupervisorLocalIpcError(code);
}

function plainRecord(
  input: unknown,
  expected: readonly string[],
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
): Record<string, unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) deny(code);
    const value = input as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(value);
    const actual = Object.keys(value).sort();
    const keys = [...expected].sort();
    const ownKeys = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      actual.length !== keys.length ||
      ownKeys.length !== actual.length ||
      ownKeys.some((key) => typeof key !== 'string') ||
      actual.some((key, index) => key !== keys[index]) ||
      actual.some((key) => {
        const descriptor = descriptors[key];
        return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
      })
    )
      deny(code);
    return value;
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny(code);
  }
}

function reference(value: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION') {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value))
    deny(code);
  return value;
}

function digest(value: unknown, code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION') {
  if (typeof value !== 'string' || !SHA256.test(value)) deny(code);
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') deny('INVALID_ATTESTATION');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    deny('INVALID_ATTESTATION');
  return value;
}

function path(
  value: unknown,
  pattern: RegExp,
  code: 'INVALID_AUTHORIZATION' | 'INVALID_ATTESTATION',
): string {
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    value === '/' ||
    value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..') ||
    Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES ||
    posix.normalize(value) !== value
  )
    deny(code);
  return value;
}

function positiveIdentity(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^linux:dev-([a-f0-9]+):ino-([a-f0-9]+)$/u.exec(value);
  if (!match) return false;
  const device = Number.parseInt(match[1]!, 16);
  const inode = Number.parseInt(match[2]!, 16);
  return Number.isSafeInteger(device) && device > 0 && Number.isSafeInteger(inode) && inode > 0;
}

function requestFor(
  plan: Readonly<LinuxRetainedNativeSupervisorProvisioningPlan>,
  observerRole: LinuxRetainedNativeSupervisorTopologyObserverRole,
  source: Readonly<LinuxRetainedNativeSupervisorSourceModuleEvidence>,
): Readonly<LinuxRetainedNativeSupervisorTopologyObservationRequest> {
  const root = plan.runtimeRootRequest;
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION',
    observerRole,
    workspaceId: root.workspaceId,
    supervisorInstanceId: root.supervisorInstanceId,
    provisioningAttemptId: root.provisioningAttemptId,
    provisioningPlanHash: linuxRetainedNativeSupervisorProvisioningPlanHash(plan),
    platform: 'LINUX',
    architecture: 'X64',
    runtimeRootParent: root.runtimeRootParent,
    runtimeRootParentIdentityReference: root.runtimeRootParentIdentityReference,
    runtimeRootParentOwnerUid: root.runtimeRootParentOwnerUid,
    runtimeRootParentOwnerGid: root.runtimeRootParentOwnerGid,
    runtimeRootParentMode: 0o700,
    sourceModulePath: source.sourceModulePath,
    sourceModuleSha256: source.sourceModuleSha256,
    sourceModuleIdentityReference: source.sourceModuleIdentityReference,
    sourceModuleOwnerUid: source.sourceModuleOwnerUid,
    sourceModuleOwnerGid: source.sourceModuleOwnerGid,
    sourceModuleMode: source.sourceModuleMode,
    sourceModuleSizeBytes: source.sourceModuleSizeBytes,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

export function linuxRetainedNativeSupervisorTopologyObservationRequestHash(
  input: unknown,
): string {
  return createHash('sha256')
    .update(canonicalJson(validateLinuxRetainedNativeSupervisorTopologyObservationRequest(input)))
    .digest('hex');
}

export function validateLinuxRetainedNativeSupervisorTopologyObservationRequest(
  input: unknown,
): Readonly<LinuxRetainedNativeSupervisorTopologyObservationRequest> {
  const value = plainRecord(input, REQUEST_KEYS, 'INVALID_AUTHORIZATION');
  if (
    value.schemaVersion !== 1 ||
    value.purpose !== 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION' ||
    (value.observerRole !== 'API_LISTENER' && value.observerRole !== 'WORKER_CLIENT') ||
    value.platform !== 'LINUX' ||
    value.architecture !== 'X64' ||
    value.runtimeRootParentMode !== 0o700 ||
    value.runtimeConnection !== 'NOT_CONFIGURED' ||
    !positiveIdentity(value.runtimeRootParentIdentityReference) ||
    !positiveIdentity(value.sourceModuleIdentityReference) ||
    typeof value.provisioningAttemptId !== 'string' ||
    !SAFE_ATTEMPT.test(value.provisioningAttemptId)
  )
    deny('INVALID_AUTHORIZATION');
  const sourceModuleMode = value.sourceModuleMode;
  if (
    !Number.isSafeInteger(sourceModuleMode) ||
    (sourceModuleMode as number) < 0 ||
    (sourceModuleMode as number) > 0o777 ||
    ((sourceModuleMode as number) & 0o222) !== 0 ||
    ((sourceModuleMode as number) & 0o400) !== 0o400
  )
    deny('INVALID_AUTHORIZATION');
  for (const key of [
    'runtimeRootParentOwnerUid',
    'runtimeRootParentOwnerGid',
    'sourceModuleOwnerUid',
    'sourceModuleOwnerGid',
  ] as const) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)
      deny('INVALID_AUTHORIZATION');
  }
  if (
    !Number.isSafeInteger(value.sourceModuleSizeBytes) ||
    (value.sourceModuleSizeBytes as number) < 1 ||
    (value.sourceModuleSizeBytes as number) > 8 * 1_024 * 1_024
  )
    deny('INVALID_AUTHORIZATION');
  const runtimeRootParent = path(
    value.runtimeRootParent,
    SAFE_DIRECTORY_PATH,
    'INVALID_AUTHORIZATION',
  );
  const sourceModulePath = path(value.sourceModulePath, SAFE_NATIVE_PATH, 'INVALID_AUTHORIZATION');
  const expectedModuleName =
    value.observerRole === 'API_LISTENER'
      ? 'linux-retained-native-listener.node'
      : 'linux-retained-native-client.node';
  if (posix.basename(sourceModulePath) !== expectedModuleName) deny('INVALID_AUTHORIZATION');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION',
    observerRole: value.observerRole,
    workspaceId: reference(value.workspaceId, 'INVALID_AUTHORIZATION'),
    supervisorInstanceId: reference(value.supervisorInstanceId, 'INVALID_AUTHORIZATION'),
    provisioningAttemptId: reference(value.provisioningAttemptId, 'INVALID_AUTHORIZATION'),
    provisioningPlanHash: digest(value.provisioningPlanHash, 'INVALID_AUTHORIZATION'),
    platform: 'LINUX',
    architecture: 'X64',
    runtimeRootParent,
    runtimeRootParentIdentityReference: value.runtimeRootParentIdentityReference,
    runtimeRootParentOwnerUid: value.runtimeRootParentOwnerUid as number,
    runtimeRootParentOwnerGid: value.runtimeRootParentOwnerGid as number,
    runtimeRootParentMode: 0o700,
    sourceModulePath,
    sourceModuleSha256: digest(value.sourceModuleSha256, 'INVALID_AUTHORIZATION'),
    sourceModuleIdentityReference: value.sourceModuleIdentityReference,
    sourceModuleOwnerUid: value.sourceModuleOwnerUid as number,
    sourceModuleOwnerGid: value.sourceModuleOwnerGid as number,
    sourceModuleMode: sourceModuleMode as number,
    sourceModuleSizeBytes: value.sourceModuleSizeBytes as number,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function validateObservation(
  input: unknown,
  request: Readonly<LinuxRetainedNativeSupervisorTopologyObservationRequest>,
  now: number,
): Readonly<LinuxRetainedNativeSupervisorTopologyObservation> {
  const value = plainRecord(input, RESULT_KEYS, 'INVALID_ATTESTATION');
  let candidate: Readonly<LinuxRetainedNativeSupervisorTopologyObservationRequest>;
  try {
    candidate = validateLinuxRetainedNativeSupervisorTopologyObservationRequest(
      Object.fromEntries(REQUEST_KEYS.map((key) => [key, value[key]])),
    );
  } catch {
    return deny('INVALID_ATTESTATION');
  }
  const observedAt = timestamp(value.observedAt);
  const validUntil = timestamp(value.validUntil);
  const observed = Date.parse(observedAt);
  const valid = Date.parse(validUntil);
  if (
    REQUEST_KEYS.some((key) => candidate[key] !== request[key]) ||
    value.evidenceAuthority !== 'LINUX_RETAINED_DESCRIPTORS' ||
    value.principalAuthority !== 'LINUX_EFFECTIVE_IDENTITY' ||
    value.observerUid !== request.runtimeRootParentOwnerUid ||
    value.observerGid !== request.runtimeRootParentOwnerGid ||
    value.topologyState !== 'VISIBLE_NOT_PROVISIONED' ||
    value.requestHash !== linuxRetainedNativeSupervisorTopologyObservationRequestHash(request) ||
    observed > now ||
    valid <= now ||
    valid <= observed ||
    valid - observed > MAX_OBSERVATION_LIFETIME_MS
  )
    deny('INVALID_ATTESTATION');
  return Object.freeze({
    ...candidate,
    observationId: reference(value.observationId, 'INVALID_ATTESTATION'),
    requestHash: digest(value.requestHash, 'INVALID_ATTESTATION'),
    evidenceAuthority: 'LINUX_RETAINED_DESCRIPTORS',
    principalAuthority: 'LINUX_EFFECTIVE_IDENTITY',
    observerUid: request.runtimeRootParentOwnerUid,
    observerGid: request.runtimeRootParentOwnerGid,
    observedAt,
    validUntil,
    topologyState: 'VISIBLE_NOT_PROVISIONED',
  });
}

function identity(stat: { readonly dev: bigint; readonly ino: bigint }): string {
  return `linux:dev-${stat.dev.toString(16)}:ino-${stat.ino.toString(16)}`;
}

function mode(stat: { readonly mode: bigint }): number {
  return Number(stat.mode & 0o7777n);
}

function safeClose(descriptor: number | undefined): void {
  if (descriptor === undefined) return;
  try {
    closeSync(descriptor);
  } catch {
    // Preserve the primary fail-closed result.
  }
}

function verifyDirectory(
  stat: BigIntStats,
  request: Readonly<LinuxRetainedNativeSupervisorTopologyObservationRequest>,
) {
  if (
    !stat.isDirectory() ||
    Number(stat.uid) !== request.runtimeRootParentOwnerUid ||
    Number(stat.gid) !== request.runtimeRootParentOwnerGid ||
    mode(stat) !== request.runtimeRootParentMode ||
    identity(stat) !== request.runtimeRootParentIdentityReference
  )
    deny('INVALID_ATTESTATION');
}

function verifySource(
  stat: BigIntStats,
  request: Readonly<LinuxRetainedNativeSupervisorTopologyObservationRequest>,
) {
  if (
    !stat.isFile() ||
    Number(stat.uid) !== request.sourceModuleOwnerUid ||
    Number(stat.gid) !== request.sourceModuleOwnerGid ||
    mode(stat) !== request.sourceModuleMode ||
    Number(stat.size) !== request.sourceModuleSizeBytes ||
    identity(stat) !== request.sourceModuleIdentityReference
  )
    deny('INVALID_ATTESTATION');
}

function unchangedMetadata(left: BigIntStats, right: BigIntStats) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/**
 * One-use role-local observer. It retains both filesystem objects while hashing and rechecking
 * their canonical identities, performs no mutation, and emits no file contents.
 */
export class RetainedDescriptorLinuxNativeSupervisorTopologyObserver implements LinuxRetainedNativeSupervisorTopologyObservationPort {
  #attempted = false;

  constructor(
    private readonly observerRole: LinuxRetainedNativeSupervisorTopologyObserverRole,
    private readonly clock: () => number = Date.now,
  ) {
    if (
      platform !== 'linux' ||
      arch !== 'x64' ||
      (observerRole !== 'API_LISTENER' && observerRole !== 'WORKER_CLIENT') ||
      typeof clock !== 'function'
    )
      deny('NOT_CONFIGURED');
    Object.freeze(this);
  }

  async observe(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<LinuxRetainedNativeSupervisorTopologyObservation>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('INVALID_AUTHORIZATION');
    const request = validateLinuxRetainedNativeSupervisorTopologyObservationRequest(input);
    if (request.observerRole !== this.observerRole) deny('INVALID_AUTHORIZATION');
    let parentDescriptor: number | undefined;
    let sourceDescriptor: number | undefined;
    try {
      if (
        typeof geteuid !== 'function' ||
        typeof getegid !== 'function' ||
        geteuid() !== request.runtimeRootParentOwnerUid ||
        getegid() !== request.runtimeRootParentOwnerGid
      )
        deny('INVALID_ATTESTATION');
      parentDescriptor = openSync(
        request.runtimeRootParent,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const parentStat = fstatSync(parentDescriptor, { bigint: true });
      verifyDirectory(parentStat, request);
      sourceDescriptor = openSync(
        request.sourceModulePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | LINUX_O_CLOEXEC,
      );
      const sourceStat = fstatSync(sourceDescriptor, { bigint: true });
      verifySource(sourceStat, request);
      const bytes = readFileSync(sourceDescriptor);
      try {
        if (
          signal.aborted ||
          createHash('sha256').update(bytes).digest('hex') !== request.sourceModuleSha256
        )
          deny('INVALID_ATTESTATION');
      } finally {
        bytes.fill(0);
      }
      const parentAfter = lstatSync(request.runtimeRootParent, { bigint: true });
      const sourceAfter = lstatSync(request.sourceModulePath, { bigint: true });
      verifyDirectory(parentAfter, request);
      verifySource(sourceAfter, request);
      if (
        !unchangedMetadata(parentStat, parentAfter) ||
        !unchangedMetadata(sourceStat, sourceAfter)
      )
        deny('INVALID_ATTESTATION');
      const now = this.clock();
      if (!Number.isSafeInteger(now) || now < 0 || signal.aborted) deny('INVALID_ATTESTATION');
      return Object.freeze({
        ...request,
        observationId: `topology-observation-${randomUUID()}`,
        requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(request),
        evidenceAuthority: 'LINUX_RETAINED_DESCRIPTORS',
        principalAuthority: 'LINUX_EFFECTIVE_IDENTITY',
        observerUid: request.runtimeRootParentOwnerUid,
        observerGid: request.runtimeRootParentOwnerGid,
        observedAt: new Date(now).toISOString(),
        validUntil: new Date(now + MAX_OBSERVATION_LIFETIME_MS).toISOString(),
        topologyState: 'VISIBLE_NOT_PROVISIONED',
      });
    } catch (error) {
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_ATTESTATION');
    } finally {
      safeClose(sourceDescriptor);
      safeClose(parentDescriptor);
    }
  }
}

function bindPort(port: LinuxRetainedNativeSupervisorTopologyObservationPort) {
  try {
    if (port instanceof DenyLinuxRetainedNativeSupervisorTopologyObservationPort)
      deny('NOT_CONFIGURED');
    const observe = port.observe;
    if (typeof observe !== 'function') deny('NOT_CONFIGURED');
    return observe.bind(port);
  } catch (error) {
    if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
    return deny('NOT_CONFIGURED');
  }
}

/** Reconciles two separately obtained role-local observations without supplying their transport. */
export class BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler {
  readonly #observeApi: (input: unknown, signal: AbortSignal) => Promise<unknown>;
  readonly #observeWorker: (input: unknown, signal: AbortSignal) => Promise<unknown>;
  #attempted = false;
  #lastNow = 0;

  constructor(
    apiListener: LinuxRetainedNativeSupervisorTopologyObservationPort = new DenyLinuxRetainedNativeSupervisorTopologyObservationPort(),
    workerClient: LinuxRetainedNativeSupervisorTopologyObservationPort = new DenyLinuxRetainedNativeSupervisorTopologyObservationPort(),
    private readonly clock: () => number = Date.now,
    private readonly timeoutMs = MAX_TIMEOUT_MS,
  ) {
    if (
      apiListener === workerClient ||
      typeof clock !== 'function' ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < MIN_TIMEOUT_MS ||
      timeoutMs > MAX_TIMEOUT_MS
    )
      deny('INVALID_AUTHORIZATION');
    this.#observeApi = bindPort(apiListener);
    this.#observeWorker = bindPort(workerClient);
  }

  async attest(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<AttestedLinuxRetainedNativeSupervisorSharedRuntimeTopology>> {
    if (this.#attempted) deny('INVALID_AUTHORIZATION');
    this.#attempted = true;
    if (!(signal instanceof AbortSignal) || signal.aborted) deny('INVALID_AUTHORIZATION');
    const plan = validateLinuxRetainedNativeSupervisorProvisioningPlan(input);
    const apiRequest = validateLinuxRetainedNativeSupervisorTopologyObservationRequest(
      requestFor(plan, 'API_LISTENER', plan.listenerSource),
    );
    const workerRequest = validateLinuxRetainedNativeSupervisorTopologyObservationRequest(
      requestFor(plan, 'WORKER_CLIENT', plan.clientSource),
    );
    this.now(signal);
    const attempt = new AbortController();
    const cancel = () => attempt.abort();
    signal.addEventListener('abort', cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          attempt.abort();
          reject(new RetainedNativeSupervisorLocalIpcError('INVALID_ATTESTATION'));
        }, this.timeoutMs);
      });
      const observations = Promise.all([
        this.#observeApi(apiRequest, attempt.signal),
        this.#observeWorker(workerRequest, attempt.signal),
      ]);
      const [apiInput, workerInput] = await Promise.race([observations, timeout]);
      const now = this.now(signal);
      const apiListener = validateObservation(apiInput, apiRequest, now);
      const workerClient = validateObservation(workerInput, workerRequest, now);
      if (
        apiListener.runtimeRootParentIdentityReference !==
          workerClient.runtimeRootParentIdentityReference ||
        apiListener.runtimeRootParent !== workerClient.runtimeRootParent ||
        apiListener.runtimeRootParentOwnerUid !== workerClient.runtimeRootParentOwnerUid ||
        apiListener.runtimeRootParentOwnerGid !== workerClient.runtimeRootParentOwnerGid ||
        apiListener.observationId === workerClient.observationId
      )
        deny('INVALID_ATTESTATION');
      return Object.freeze({
        schemaVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_SHARED_RUNTIME_TOPOLOGY',
        workspaceId: plan.runtimeRootRequest.workspaceId,
        supervisorInstanceId: plan.runtimeRootRequest.supervisorInstanceId,
        provisioningAttemptId: plan.runtimeRootRequest.provisioningAttemptId,
        provisioningPlanHash: linuxRetainedNativeSupervisorProvisioningPlanHash(plan),
        runtimeRootParent: plan.runtimeRootRequest.runtimeRootParent,
        runtimeRootParentIdentityReference:
          plan.runtimeRootRequest.runtimeRootParentIdentityReference,
        apiListener,
        workerClient,
        topologyState: 'SHARED_RUNTIME_VISIBLE_NOT_PROVISIONED',
        runtimeConnection: 'NOT_CONFIGURED',
      });
    } catch (error) {
      attempt.abort();
      if (error instanceof RetainedNativeSupervisorLocalIpcError) throw error;
      return deny('INVALID_ATTESTATION');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  }

  private now(signal: AbortSignal): number {
    if (signal.aborted) deny('INVALID_AUTHORIZATION');
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0 || now < this.#lastNow) deny('INVALID_ATTESTATION');
    this.#lastNow = now;
    return now;
  }
}
