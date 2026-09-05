import { createHash } from 'node:crypto';

import type { OperationalEventCapability, WorkspaceContext } from '@ventureos/agent-control-plane';
import {
  canonicalJson,
  retainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequestHash,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthority,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest,
} from '@ventureos/agent-bridge';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const AUTHORIZATION_LIFETIME_MS = 60_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const REQUEST_KEYS = [
  'issuanceRequestHash',
  'purpose',
  'runtimeConnection',
  'schemaVersion',
  'signerKeyId',
  'snapshotId',
  'snapshotVersion',
  'supervisorInstanceId',
  'workspaceId',
] as const;

export class RetainedNativeModuleAuthorizationIssuanceAuthorityDeniedError extends Error {}

function deny(message: string): never {
  throw new RetainedNativeModuleAuthorizationIssuanceAuthorityDeniedError(message);
}

function reference(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value)) {
    return deny(`${field} must be a safe non-sensitive reference`);
  }
  return value;
}

function exactKeys(value: Record<string, unknown>): void {
  const keys = Object.keys(value).sort();
  if (canonicalJson(keys) !== canonicalJson(REQUEST_KEYS))
    deny('Authority request shape is invalid');
}

function request(
  value: unknown,
): Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return deny('Authority request is invalid');
  const candidate = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(candidate);
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(candidate).some((key) => typeof key !== 'string') ||
    Object.values(descriptors).some(
      (descriptor) => !descriptor.enumerable || !('value' in descriptor),
    )
  )
    return deny('Authority request must be an inert plain record');
  exactKeys(candidate);
  if (
    candidate.schemaVersion !== 1 ||
    candidate.purpose !== 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_ISSUANCE' ||
    candidate.runtimeConnection !== 'NOT_CONFIGURED' ||
    !Number.isInteger(candidate.snapshotVersion) ||
    (candidate.snapshotVersion as number) < 1 ||
    (candidate.snapshotVersion as number) > 1_000_000 ||
    typeof candidate.issuanceRequestHash !== 'string' ||
    !SHA256.test(candidate.issuanceRequestHash)
  )
    return deny('Authority request binding is invalid');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_ISSUANCE',
    workspaceId: reference(candidate.workspaceId, 'workspaceId'),
    supervisorInstanceId: reference(candidate.supervisorInstanceId, 'supervisorInstanceId'),
    snapshotId: reference(candidate.snapshotId, 'snapshotId'),
    snapshotVersion: candidate.snapshotVersion as number,
    signerKeyId: reference(candidate.signerKeyId, 'signerKeyId'),
    issuanceRequestHash: candidate.issuanceRequestHash,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/**
 * Converts one trusted, exact Level-3 control-plane capability into one short-lived issuance grant.
 * It cannot decide Founder approval, sign a snapshot, publish it, or promote runtime truth.
 */
export class BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority implements RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthority {
  readonly #expectedRequest: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest>;
  readonly #principalReference: string;
  readonly #actorKind: 'HUMAN' | 'AGENT' | 'SYSTEM';
  #attempted = false;

  constructor(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    expectedRequest: unknown,
    private readonly clock: () => number = Date.now,
  ) {
    const boundContext = Object.freeze({
      workspaceId: reference(context.workspaceId, 'workspaceId'),
      principalId: reference(context.principalId, 'principalId'),
    });
    capability.assertSource('CONTROL_PLANE');
    const actorKind = capability.actorKindFor(boundContext);
    if (actorKind === 'RUNTIME' || capability.authorityLevelFor(boundContext) !== 3)
      deny('Exact Level-3 trusted control-plane authority is required');
    this.#principalReference = boundContext.principalId;
    this.#actorKind = actorKind;
    this.#expectedRequest = request(expectedRequest);
    if (this.#expectedRequest.workspaceId !== boundContext.workspaceId)
      deny('Cross-workspace issuance authority denied');
  }

  async authorize(input: unknown): Promise<unknown> {
    if (this.#attempted) return deny('Issuance authority is one-shot');
    this.#attempted = true;
    const actual = request(input);
    if (canonicalJson(actual) !== canonicalJson(this.#expectedRequest))
      return deny('Issuance authority request drifted');
    const now = this.clock();
    if (
      !Number.isFinite(now) ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now > MAX_DATE_MS - AUTHORIZATION_LIFETIME_MS
    )
      return deny('Issuance authority clock is invalid');
    const validFrom = new Date(now).toISOString();
    const validUntil = new Date(now + AUTHORIZATION_LIFETIME_MS).toISOString();
    const binding = Object.freeze({
      evidencePurpose: 'RETAINED_NATIVE_MODULE_SNAPSHOT_LEVEL3_AUTHORIZATION' as const,
      policyVersion: 1 as const,
      request: actual,
      authorizedByReference: this.#principalReference,
      actorKind: this.#actorKind,
      authorityLevel: 3 as const,
      validFrom,
      validUntil,
    });
    const approvalEvidenceHash = digest(binding);
    return Object.freeze({
      ...actual,
      issuanceAuthorizationId: `native-module-issuance:${approvalEvidenceHash}`,
      authorityRequestHash:
        retainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequestHash(actual),
      approvalId: `level3-control-plane:${approvalEvidenceHash}`,
      approvalEvidenceHash,
      authorizedByReference: this.#principalReference,
      authorityLevel: 3,
      validFrom,
      validUntil,
    });
  }
}
