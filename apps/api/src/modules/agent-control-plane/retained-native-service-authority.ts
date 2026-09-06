import { createHash } from 'node:crypto';

import type { OperationalEventCapability, WorkspaceContext } from '@ventureos/agent-control-plane';
import {
  canonicalJson,
  linuxRetainedNativeSupervisorServiceRequestHash,
  validateLinuxRetainedNativeSupervisorServiceRequest,
  type LinuxRetainedNativeSupervisorServiceAuthority,
  type LinuxRetainedNativeSupervisorServiceRequest,
} from '@ventureos/agent-bridge';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const AUTHORIZATION_LIFETIME_MS = 60_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

export class RetainedNativeSupervisorServiceAuthorityDeniedError extends Error {}

function deny(message: string): never {
  throw new RetainedNativeSupervisorServiceAuthorityDeniedError(message);
}

function reference(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value))
    return deny(`${field} must be a safe non-sensitive reference`);
  return value;
}

function request(input: unknown): Readonly<LinuxRetainedNativeSupervisorServiceRequest> {
  try {
    return validateLinuxRetainedNativeSupervisorServiceRequest(input);
  } catch {
    return deny('Native supervisor service request is invalid');
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/**
 * Converts one exact trusted Level-3 control-plane capability into a one-use service grant. It
 * selects no path, listener, worker, protocol, signer, key, or runtime composition.
 */
export class BoundedLevel3RetainedNativeSupervisorServiceAuthority implements LinuxRetainedNativeSupervisorServiceAuthority {
  readonly #expectedRequest: Readonly<LinuxRetainedNativeSupervisorServiceRequest>;
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
      deny('Cross-workspace native supervisor service authority denied');
  }

  async authorize(input: unknown): Promise<unknown> {
    if (this.#attempted) return deny('Native supervisor service authority is one-shot');
    this.#attempted = true;
    const actual = request(input);
    if (canonicalJson(actual) !== canonicalJson(this.#expectedRequest))
      return deny('Native supervisor service authority request drifted');
    const now = this.clock();
    if (
      !Number.isFinite(now) ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now > MAX_DATE_MS - AUTHORIZATION_LIFETIME_MS
    )
      return deny('Native supervisor service authority clock is invalid');
    const validFrom = new Date(now).toISOString();
    const validUntil = new Date(now + AUTHORIZATION_LIFETIME_MS).toISOString();
    const evidence = Object.freeze({
      evidencePurpose: 'RETAINED_NATIVE_SUPERVISOR_SERVICE_LEVEL3_AUTHORIZATION' as const,
      policyVersion: 1 as const,
      request: actual,
      authorizedByReference: this.#principalReference,
      actorKind: this.#actorKind,
      authorityLevel: 3 as const,
      validFrom,
      validUntil,
    });
    const approvalEvidenceHash = digest(evidence);
    return Object.freeze({
      ...actual,
      serviceRunId: `native-supervisor-service:${approvalEvidenceHash}`,
      requestHash: linuxRetainedNativeSupervisorServiceRequestHash(actual),
      approvalId: `level3-control-plane:${approvalEvidenceHash}`,
      approvalEvidenceHash,
      authorizedByReference: this.#principalReference,
      authorityLevel: 3,
      validFrom,
      validUntil,
    });
  }
}
