import type { SupervisorPlatform, ValidatedSupervisorAdmission } from './supervision-policy';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const SECRET_LIKE =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk|gh[opusr]|github_pat|glpat|xox[baprs]|AKIA)[_-]?[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export type SupervisorProcessState =
  | 'ADMITTED'
  | 'STARTING'
  | 'RUNNING'
  | 'CANCEL_REQUESTED'
  | 'TERMINATING'
  | 'KILLING'
  | 'EXITED'
  | 'FAILED';

export const SUPERVISOR_PROCESS_TRANSITIONS: Readonly<
  Record<SupervisorProcessState, readonly SupervisorProcessState[]>
> = {
  ADMITTED: ['STARTING', 'FAILED'],
  STARTING: ['RUNNING', 'CANCEL_REQUESTED', 'FAILED'],
  RUNNING: ['CANCEL_REQUESTED', 'EXITED', 'FAILED'],
  CANCEL_REQUESTED: ['TERMINATING', 'KILLING', 'EXITED', 'FAILED'],
  TERMINATING: ['KILLING', 'EXITED', 'FAILED'],
  KILLING: ['EXITED', 'FAILED'],
  EXITED: [],
  FAILED: [],
};

export interface SupervisorProcessBinding {
  readonly schemaVersion: 1;
  readonly supervisionId: string;
  readonly launchNonce: string;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly platform: SupervisorPlatform;
  readonly manifestHash: string;
  readonly admissionEvidenceHash: string;
  readonly admissionBindingHash: string;
  readonly testOnly: boolean;
}

export type SupervisorCancellationCode =
  'FOUNDER_REQUEST' | 'POLICY_REVOKED' | 'RUNTIME_LIMIT' | 'SHUTDOWN';

export interface SupervisorCancellationRequest extends SupervisorProcessBinding {
  readonly cancellationId: string;
  readonly code: SupervisorCancellationCode;
}

export type SupervisorLifecycleErrorCode =
  'INVALID_BINDING' | 'INVALID_CANCELLATION' | 'BINDING_MISMATCH' | 'ILLEGAL_TRANSITION';

export class SupervisorLifecycleError extends Error {
  constructor(readonly code: SupervisorLifecycleErrorCode) {
    super(`Runtime supervision lifecycle denied: ${code}`);
  }
}

function reference(value: unknown, code: SupervisorLifecycleErrorCode): string {
  if (
    typeof value !== 'string' ||
    !SAFE_REFERENCE.test(value) ||
    PRIVATE_TEXT.test(value) ||
    SECRET_LIKE.test(value)
  )
    throw new SupervisorLifecycleError(code);
  return value;
}

function digest(value: unknown, code: SupervisorLifecycleErrorCode): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new SupervisorLifecycleError(code);
  return value;
}

function exactObject(value: unknown, keys: readonly string[], code: SupervisorLifecycleErrorCode) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new SupervisorLifecycleError(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new SupervisorLifecycleError(code);
  return value as Record<string, unknown>;
}

const BINDING_KEYS = [
  'admissionBindingHash',
  'admissionEvidenceHash',
  'connectionId',
  'launchNonce',
  'manifestHash',
  'platform',
  'runtimeId',
  'schemaVersion',
  'supervisionId',
  'testOnly',
  'workspaceId',
] as const;

const CANCELLATION_KEYS = [...BINDING_KEYS, 'cancellationId', 'code'] as const;

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze({ ...value });
}

export function createSupervisorProcessBinding(
  admission: ValidatedSupervisorAdmission,
  supervisionId: string,
  launchNonce: string,
): Readonly<SupervisorProcessBinding> {
  return validateSupervisorProcessBinding({
    schemaVersion: 1,
    supervisionId,
    launchNonce,
    workspaceId: admission.manifest.workspaceId,
    runtimeId: admission.manifest.runtimeId,
    connectionId: admission.manifest.connectionId,
    platform: admission.manifest.platform,
    manifestHash: admission.manifestHash,
    admissionEvidenceHash: admission.evidenceHash,
    admissionBindingHash: admission.bindingHash,
    testOnly: admission.manifest.testOnly,
  });
}

export function validateSupervisorProcessBinding(
  input: unknown,
): Readonly<SupervisorProcessBinding> {
  const record = exactObject(input, BINDING_KEYS, 'INVALID_BINDING');
  if (
    record.schemaVersion !== 1 ||
    (record.platform !== 'WIN32' && record.platform !== 'LINUX') ||
    typeof record.testOnly !== 'boolean'
  )
    throw new SupervisorLifecycleError('INVALID_BINDING');
  return freeze({
    schemaVersion: 1,
    supervisionId: reference(record.supervisionId, 'INVALID_BINDING'),
    launchNonce: reference(record.launchNonce, 'INVALID_BINDING'),
    workspaceId: reference(record.workspaceId, 'INVALID_BINDING'),
    runtimeId: reference(record.runtimeId, 'INVALID_BINDING'),
    connectionId: reference(record.connectionId, 'INVALID_BINDING'),
    platform: record.platform,
    manifestHash: digest(record.manifestHash, 'INVALID_BINDING'),
    admissionEvidenceHash: digest(record.admissionEvidenceHash, 'INVALID_BINDING'),
    admissionBindingHash: digest(record.admissionBindingHash, 'INVALID_BINDING'),
    testOnly: record.testOnly,
  });
}

export function validateSupervisorCancellation(
  binding: SupervisorProcessBinding,
  input: unknown,
): Readonly<SupervisorCancellationRequest> {
  const trusted = validateSupervisorProcessBinding(binding);
  const record = exactObject(input, CANCELLATION_KEYS, 'INVALID_CANCELLATION');
  const candidateBinding = validateSupervisorProcessBinding(
    Object.fromEntries(BINDING_KEYS.map((key) => [key, record[key]])),
  );
  for (const key of BINDING_KEYS) {
    if (candidateBinding[key] !== trusted[key])
      throw new SupervisorLifecycleError('BINDING_MISMATCH');
  }
  if (
    record.code !== 'FOUNDER_REQUEST' &&
    record.code !== 'POLICY_REVOKED' &&
    record.code !== 'RUNTIME_LIMIT' &&
    record.code !== 'SHUTDOWN'
  )
    throw new SupervisorLifecycleError('INVALID_CANCELLATION');
  return freeze({
    ...trusted,
    cancellationId: reference(record.cancellationId, 'INVALID_CANCELLATION'),
    code: record.code,
  });
}

export function assertSupervisorProcessTransition(
  current: SupervisorProcessState,
  next: SupervisorProcessState,
): void {
  if (!SUPERVISOR_PROCESS_TRANSITIONS[current]?.includes(next))
    throw new SupervisorLifecycleError('ILLEGAL_TRANSITION');
}
