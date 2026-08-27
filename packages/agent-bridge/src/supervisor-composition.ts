import { createHash } from 'node:crypto';

import { canonicalJson } from './codec';
import {
  linuxExecutableAuthorizationHash,
  type LinuxExecutableAuthorization,
  validateLinuxExecutableAuthorization,
} from './supervision-authorization';
import { LinuxExecutableEvidenceReader } from './supervision-evidence-reader';
import {
  createSupervisorProcessBinding,
  type SupervisorProcessBinding,
  validateSupervisorProcessBinding,
} from './supervision-lifecycle';
import type { RuntimeProcessLauncher, RuntimeProcessLaunchRequest } from './policy';
import {
  type RuntimeLaunchManifest,
  type TrustedSupervisorAdmissionEvidence,
  type ValidatedSupervisorAdmission,
  validateSupervisorAdmission,
  validateSupervisorManifest,
} from './supervision-policy';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const SECRET_LIKE =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk|gh[opusr]|github_pat|glpat|xox[baprs]|AKIA)[_-]?[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/u;
type LaunchCapabilityStatus = 'PENDING' | 'ACTIVE' | 'CONSUMED';
interface LaunchPlanState {
  status: LaunchCapabilityStatus;
  readonly request: object;
  readonly expiresAt: number;
}
interface LaunchRequestState {
  status: LaunchCapabilityStatus;
  readonly plan: object;
  readonly expiresAt: number;
}
const launchPlanStates = new WeakMap<object, LaunchPlanState>();
const launchRequestStates = new WeakMap<object, LaunchRequestState>();
const consumedDecisionIds = new Map<string, number>();
const consumedSupervisionIds = new Map<string, number>();
const consumedLaunchNonces = new Map<string, number>();

export const TRUSTED_SUPERVISOR_AUTHORIZATION_SOURCE = Symbol(
  'TRUSTED_SUPERVISOR_AUTHORIZATION_SOURCE',
);
export const RUNTIME_PROCESS_LAUNCHER = Symbol('RUNTIME_PROCESS_LAUNCHER');

export type TrustedSupervisorCompositionErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_PLATFORM'
  | 'AUTHORIZATION_NOT_CONFIGURED'
  | 'AUTHORIZATION_DENIED'
  | 'EVIDENCE_DENIED'
  | 'BINDING_MISMATCH';

export class TrustedSupervisorCompositionError extends Error {
  constructor(readonly code: TrustedSupervisorCompositionErrorCode) {
    super(`Trusted runtime supervision denied: ${code}`);
  }
}

export interface TrustedSupervisorAuthorizationRequest {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly adapterKind: string;
  readonly platform: 'LINUX';
  readonly testOnly: boolean;
  readonly manifestHash: string;
  readonly manifest: Readonly<RuntimeLaunchManifest>;
}

export interface TrustedSupervisorAuthorizationDecision {
  readonly schemaVersion: 1;
  readonly decisionId: string;
  readonly requestHash: string;
  readonly supervisionId: string;
  readonly launchNonce: string;
  readonly authorization: Readonly<LinuxExecutableAuthorization>;
}

export interface TrustedSupervisorAuthorizationSource {
  read(request: Readonly<TrustedSupervisorAuthorizationRequest>): Promise<unknown>;
}

export class DenyTrustedSupervisorAuthorizationSource implements TrustedSupervisorAuthorizationSource {
  async read(_request: Readonly<TrustedSupervisorAuthorizationRequest>): Promise<never> {
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_NOT_CONFIGURED');
  }
}

export interface PerAdmissionSupervisorEvidenceReader {
  read(
    manifest: Readonly<RuntimeLaunchManifest>,
    authorization: Readonly<LinuxExecutableAuthorization>,
  ): Promise<Readonly<TrustedSupervisorAdmissionEvidence>>;
}

export class PerAdmissionLinuxExecutableEvidenceReader implements PerAdmissionSupervisorEvidenceReader {
  async read(
    manifest: Readonly<RuntimeLaunchManifest>,
    authorization: Readonly<LinuxExecutableAuthorization>,
  ): Promise<Readonly<TrustedSupervisorAdmissionEvidence>> {
    return new LinuxExecutableEvidenceReader([authorization]).read(manifest);
  }
}

export interface PrepareTrustedSupervisorLaunchInput {
  readonly schemaVersion: 1;
  readonly manifest: unknown;
}

export interface TrustedSupervisorLaunchPlan {
  readonly schemaVersion: 1;
  readonly admission: Readonly<ValidatedSupervisorAdmission>;
  readonly processBinding: Readonly<SupervisorProcessBinding>;
  readonly launchRequest: Readonly<RuntimeProcessLaunchRequest>;
  readonly authorizationDecision: Readonly<TrustedSupervisorAuthorizationDecision>;
  readonly authorizationRequestHash: string;
  readonly expiresAt: string;
  readonly planHash: string;
}

function exactObject(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TrustedSupervisorCompositionError('INVALID_REQUEST');
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index]))
    throw new TrustedSupervisorCompositionError('INVALID_REQUEST');
  return record;
}

function reference(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !SAFE_REFERENCE.test(value) ||
    PRIVATE_TEXT.test(value) ||
    SECRET_LIKE.test(value)
  )
    throw new TrustedSupervisorCompositionError('INVALID_REQUEST');
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value as Readonly<T>;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function authorizationRequestFor(
  manifest: Readonly<RuntimeLaunchManifest>,
  manifestHash: string,
): Readonly<TrustedSupervisorAuthorizationRequest> {
  if (manifest.platform !== 'LINUX')
    throw new TrustedSupervisorCompositionError('UNSUPPORTED_PLATFORM');
  return deepFreeze({
    schemaVersion: 1,
    workspaceId: manifest.workspaceId,
    runtimeId: manifest.runtimeId,
    connectionId: manifest.connectionId,
    adapterKind: manifest.adapterKind,
    platform: 'LINUX',
    testOnly: manifest.testOnly,
    manifestHash,
    manifest,
  });
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  return value;
}

function validateAuthorizationDecision(
  input: unknown,
  requestHash: string,
): Readonly<TrustedSupervisorAuthorizationDecision> {
  const record = exactObject(input, [
    'authorization',
    'decisionId',
    'launchNonce',
    'requestHash',
    'schemaVersion',
    'supervisionId',
  ]);
  if (record.schemaVersion !== 1 || digest(record.requestHash) !== requestHash)
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  return deepFreeze({
    schemaVersion: 1,
    decisionId: reference(record.decisionId),
    requestHash,
    supervisionId: reference(record.supervisionId),
    launchNonce: reference(record.launchNonce),
    authorization: validateLinuxExecutableAuthorization(record.authorization),
  });
}

function consumeAuthorizationDecision(
  decision: Readonly<TrustedSupervisorAuthorizationDecision>,
): void {
  const now = Date.now();
  for (const consumed of [consumedDecisionIds, consumedSupervisionIds, consumedLaunchNonces])
    for (const [key, expiresAt] of consumed) if (expiresAt <= now) consumed.delete(key);
  if (
    consumedDecisionIds.has(decision.decisionId) ||
    consumedSupervisionIds.has(decision.supervisionId) ||
    consumedLaunchNonces.has(decision.launchNonce)
  )
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  const expiresAt = Date.parse(decision.authorization.validUntil);
  consumedDecisionIds.set(decision.decisionId, expiresAt);
  consumedSupervisionIds.set(decision.supervisionId, expiresAt);
  consumedLaunchNonces.set(decision.launchNonce, expiresAt);
}

function validateRuntimeProcessLaunchRequestShape(
  input: unknown,
): Readonly<RuntimeProcessLaunchRequest> {
  const record = exactObject(input, ['manifest', 'processBinding', 'schemaVersion']);
  if (record.schemaVersion !== 1) throw new TrustedSupervisorCompositionError('INVALID_REQUEST');
  const validatedManifest = validateSupervisorManifest(record.manifest);
  const binding = validateSupervisorProcessBinding(record.processBinding);
  if (
    binding.workspaceId !== validatedManifest.manifest.workspaceId ||
    binding.runtimeId !== validatedManifest.manifest.runtimeId ||
    binding.connectionId !== validatedManifest.manifest.connectionId ||
    binding.platform !== validatedManifest.manifest.platform ||
    binding.testOnly !== validatedManifest.manifest.testOnly ||
    binding.manifestHash !== validatedManifest.manifestHash
  )
    throw new TrustedSupervisorCompositionError('BINDING_MISMATCH');
  return deepFreeze({
    schemaVersion: 1,
    processBinding: binding,
    manifest: validatedManifest.manifest,
  });
}

function consumeRuntimeProcessLaunchRequest(input: unknown): Readonly<RuntimeProcessLaunchRequest> {
  if (typeof input !== 'object' || input === null)
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  const state = launchRequestStates.get(input);
  if (state?.status !== 'ACTIVE')
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  if (Date.now() >= state.expiresAt) {
    state.status = 'CONSUMED';
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  }
  const request = validateRuntimeProcessLaunchRequestShape(input);
  if (Date.now() >= state.expiresAt) {
    state.status = 'CONSUMED';
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  }
  state.status = 'CONSUMED';
  return request;
}

export class TrustedSupervisorComposition {
  constructor(
    private readonly authorizationSource: TrustedSupervisorAuthorizationSource,
    private readonly evidenceReader: PerAdmissionSupervisorEvidenceReader,
    private readonly launcher: RuntimeProcessLauncher,
  ) {}

  async prepare(
    input: PrepareTrustedSupervisorLaunchInput,
  ): Promise<Readonly<TrustedSupervisorLaunchPlan>> {
    const request = exactObject(input, ['manifest', 'schemaVersion']);
    if (request.schemaVersion !== 1) throw new TrustedSupervisorCompositionError('INVALID_REQUEST');
    let validatedManifest;
    try {
      validatedManifest = validateSupervisorManifest(request.manifest);
    } catch {
      throw new TrustedSupervisorCompositionError('INVALID_REQUEST');
    }
    const manifest = validatedManifest.manifest;
    const authorizationRequest = authorizationRequestFor(manifest, validatedManifest.manifestHash);
    const authorizationRequestHash = sha256(authorizationRequest);
    let authorizationDecision: Readonly<TrustedSupervisorAuthorizationDecision>;
    try {
      authorizationDecision = validateAuthorizationDecision(
        await this.authorizationSource.read(authorizationRequest),
        authorizationRequestHash,
      );
    } catch (error) {
      if (
        error instanceof TrustedSupervisorCompositionError &&
        error.code === 'AUTHORIZATION_NOT_CONFIGURED'
      )
        throw error;
      throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
    }
    consumeAuthorizationDecision(authorizationDecision);
    const authorization = authorizationDecision.authorization;
    if (
      authorization.adapterKind !== authorizationRequest.adapterKind ||
      authorization.testOnly !== authorizationRequest.testOnly ||
      authorization.canonicalPath !== manifest.executable.canonicalPath ||
      authorization.sha256 !== manifest.executable.sha256 ||
      authorization.identityReference !== manifest.executable.identityReference ||
      authorization.authorizedWorktreeRoot !== manifest.worktreeRoot ||
      authorization.argumentPolicyReference !== manifest.argumentPolicyReference ||
      manifest.platformPolicy.kind !== 'LINUX' ||
      authorization.ownerUid !== manifest.platformPolicy.ownerUid ||
      authorization.ownerGid !== manifest.platformPolicy.ownerGid ||
      authorization.mode !== manifest.platformPolicy.mode
    )
      throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
    let evidence: Readonly<TrustedSupervisorAdmissionEvidence>;
    try {
      evidence = await this.evidenceReader.read(manifest, authorization);
    } catch {
      throw new TrustedSupervisorCompositionError('EVIDENCE_DENIED');
    }
    let admission: Readonly<ValidatedSupervisorAdmission>;
    let processBinding: Readonly<SupervisorProcessBinding>;
    try {
      admission = validateSupervisorAdmission(manifest, evidence);
      if (
        admission.evidence.authorizationId !== authorization.authorizationId ||
        admission.evidence.authorizationVersion !== authorization.authorizationVersion ||
        admission.evidence.authorizationSignerKeyId !== authorization.signerKeyId ||
        admission.evidence.authorizationHash !== linuxExecutableAuthorizationHash(authorization)
      )
        throw new Error('authorization evidence mismatch');
      processBinding = createSupervisorProcessBinding(
        manifest,
        evidence,
        authorizationDecision.supervisionId,
        authorizationDecision.launchNonce,
      );
    } catch {
      throw new TrustedSupervisorCompositionError('BINDING_MISMATCH');
    }
    const launchRequest = validateRuntimeProcessLaunchRequestShape({
      schemaVersion: 1,
      processBinding,
      manifest,
    });
    const expiresAtMilliseconds = Math.min(
      Date.parse(authorization.validUntil),
      Date.parse(admission.evidence.expiresAt),
    );
    const expiresAt = new Date(expiresAtMilliseconds).toISOString();
    const planWithoutHash = {
      schemaVersion: 1 as const,
      admission,
      processBinding,
      launchRequest,
      authorizationDecision,
      authorizationRequestHash,
      expiresAt,
    };
    const plan = deepFreeze({ ...planWithoutHash, planHash: sha256(planWithoutHash) });
    launchPlanStates.set(plan, {
      status: 'PENDING',
      request: launchRequest,
      expiresAt: expiresAtMilliseconds,
    });
    launchRequestStates.set(launchRequest, {
      status: 'PENDING',
      plan,
      expiresAt: expiresAtMilliseconds,
    });
    return plan;
  }

  async execute(plan: unknown): Promise<never> {
    const launchRequest = activateTrustedSupervisorLaunchPlan(plan);
    return this.launcher.launch(consumeRuntimeProcessLaunchRequest(launchRequest));
  }
}

function activateTrustedSupervisorLaunchPlan(plan: unknown): Readonly<RuntimeProcessLaunchRequest> {
  if (typeof plan !== 'object' || plan === null)
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  const planState = launchPlanStates.get(plan);
  if (planState?.status !== 'PENDING')
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  if (Date.now() >= planState.expiresAt) {
    planState.status = 'CONSUMED';
    const expiredRequestState = launchRequestStates.get(planState.request);
    if (expiredRequestState) expiredRequestState.status = 'CONSUMED';
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  }
  const record = exactObject(plan, [
    'admission',
    'authorizationDecision',
    'authorizationRequestHash',
    'expiresAt',
    'launchRequest',
    'planHash',
    'processBinding',
    'schemaVersion',
  ]);
  if (record.schemaVersion !== 1) throw new TrustedSupervisorCompositionError('INVALID_REQUEST');
  const issuedLaunchRequest = record.launchRequest as object;
  const requestState = launchRequestStates.get(issuedLaunchRequest);
  if (
    planState.request !== issuedLaunchRequest ||
    requestState?.status !== 'PENDING' ||
    requestState.plan !== plan ||
    requestState.expiresAt !== planState.expiresAt
  )
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  let launchRequest: Readonly<RuntimeProcessLaunchRequest>;
  let binding: Readonly<SupervisorProcessBinding>;
  try {
    if (
      typeof record.launchRequest !== 'object' ||
      record.launchRequest === null ||
      !launchRequestStates.has(record.launchRequest)
    )
      throw new Error('launch request was not issued');
    launchRequest = validateRuntimeProcessLaunchRequestShape(record.launchRequest);
    binding = validateSupervisorProcessBinding(record.processBinding);
  } catch {
    throw new TrustedSupervisorCompositionError('BINDING_MISMATCH');
  }
  const admissionRecord = exactObject(record.admission, [
    'bindingHash',
    'evidence',
    'evidenceHash',
    'manifest',
    'manifestHash',
  ]);
  let admission: Readonly<ValidatedSupervisorAdmission>;
  try {
    admission = validateSupervisorAdmission(admissionRecord.manifest, admissionRecord.evidence);
  } catch {
    throw new TrustedSupervisorCompositionError('BINDING_MISMATCH');
  }
  if (
    admission.manifestHash !== admissionRecord.manifestHash ||
    admission.evidenceHash !== admissionRecord.evidenceHash ||
    admission.bindingHash !== admissionRecord.bindingHash ||
    canonicalJson(admission.manifest) !== canonicalJson(launchRequest.manifest) ||
    admission.manifestHash !== binding.manifestHash ||
    admission.evidenceHash !== binding.admissionEvidenceHash ||
    admission.bindingHash !== binding.admissionBindingHash ||
    canonicalJson(binding) !== canonicalJson(launchRequest.processBinding)
  )
    throw new TrustedSupervisorCompositionError('BINDING_MISMATCH');
  const authorizationRequestHash = sha256(
    authorizationRequestFor(admission.manifest, admission.manifestHash),
  );
  if (record.authorizationRequestHash !== authorizationRequestHash)
    throw new TrustedSupervisorCompositionError('BINDING_MISMATCH');
  let authorizationDecision: Readonly<TrustedSupervisorAuthorizationDecision>;
  try {
    authorizationDecision = validateAuthorizationDecision(
      record.authorizationDecision,
      authorizationRequestHash,
    );
  } catch {
    throw new TrustedSupervisorCompositionError('BINDING_MISMATCH');
  }
  if (
    authorizationDecision.supervisionId !== binding.supervisionId ||
    authorizationDecision.launchNonce !== binding.launchNonce ||
    authorizationDecision.authorization.authorizationId !== admission.evidence.authorizationId ||
    authorizationDecision.authorization.authorizationVersion !==
      admission.evidence.authorizationVersion ||
    authorizationDecision.authorization.signerKeyId !==
      admission.evidence.authorizationSignerKeyId ||
    linuxExecutableAuthorizationHash(authorizationDecision.authorization) !==
      admission.evidence.authorizationHash
  )
    throw new TrustedSupervisorCompositionError('BINDING_MISMATCH');
  const expectedPlanHash = sha256({
    schemaVersion: 1,
    admission,
    processBinding: binding,
    launchRequest,
    authorizationDecision,
    authorizationRequestHash,
    expiresAt: new Date(planState.expiresAt).toISOString(),
  });
  if (
    record.expiresAt !== new Date(planState.expiresAt).toISOString() ||
    record.planHash !== expectedPlanHash
  )
    throw new TrustedSupervisorCompositionError('BINDING_MISMATCH');
  if (Date.now() >= planState.expiresAt) {
    planState.status = 'CONSUMED';
    requestState.status = 'CONSUMED';
    throw new TrustedSupervisorCompositionError('AUTHORIZATION_DENIED');
  }
  planState.status = 'CONSUMED';
  requestState.status = 'ACTIVE';
  return issuedLaunchRequest as unknown as Readonly<RuntimeProcessLaunchRequest>;
}
