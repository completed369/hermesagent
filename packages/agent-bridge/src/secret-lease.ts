import { timingSafeEqual } from 'node:crypto';

import { digestSecretReference } from './auth';

export const MIN_BRIDGE_SECRET_BYTES = 32;
export const MAX_BRIDGE_SECRET_BYTES = 4_096;

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt)/iu;
const SECRET_LIKE =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk|gh[opusr]|github_pat|glpat|xox[baprs]|AKIA)[_-]?[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/u;

export type BridgeSecretLeasePurpose = 'PROVISION' | 'AUTHENTICATE' | 'VERIFY_FRAME' | 'SIGN_FRAME';

export interface BridgeSecretLeaseRequest {
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly secretReference: string;
  readonly expectedDigest?: string;
  readonly authGeneration: number;
  readonly purpose: BridgeSecretLeasePurpose;
}

export interface BridgeSecretByteSource {
  /**
   * Trusted backend adapter boundary. Implementations must authorize the full
   * scope and return fresh bytes. No concrete production adapter exists yet.
   */
  resolve(request: Readonly<BridgeSecretLeaseRequest>): Promise<Uint8Array>;
}

export interface BridgeSecretLeaseResolver {
  /**
   * Supplies a short-lived owned copy to a trusted in-process consumer. The
   * copy is zeroed in finally; JavaScript cannot guarantee physical erasure.
   * Source and lease-validation failures are sanitized. The trusted consumer
   * owns the semantics and sanitization of its own errors.
   */
  withSecret<T>(
    request: Readonly<BridgeSecretLeaseRequest>,
    consumer: (secret: Uint8Array) => Promise<T> | T,
  ): Promise<T>;
}

export type BridgeSecretLeaseErrorCode =
  | 'INVALID_REQUEST'
  | 'SOURCE_UNAVAILABLE'
  | 'INVALID_MATERIAL'
  | 'DIGEST_MISMATCH'
  | 'NOT_CONFIGURED';

export class BridgeSecretLeaseError extends Error {
  constructor(readonly code: BridgeSecretLeaseErrorCode) {
    super(`Bridge secret lease denied: ${code}`);
  }
}

function reference(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !SAFE_REFERENCE.test(value) ||
    PRIVATE_TEXT.test(value) ||
    SECRET_LIKE.test(value)
  )
    throw new BridgeSecretLeaseError('INVALID_REQUEST');
}

function validateRequest(request: Readonly<BridgeSecretLeaseRequest>): void {
  for (const value of [
    request.workspaceId,
    request.runtimeId,
    request.connectionId,
    request.secretReference,
  ])
    reference(value);
  if (!Number.isSafeInteger(request.authGeneration) || request.authGeneration < 1)
    throw new BridgeSecretLeaseError('INVALID_REQUEST');
  if (!['PROVISION', 'AUTHENTICATE', 'VERIFY_FRAME', 'SIGN_FRAME'].includes(request.purpose))
    throw new BridgeSecretLeaseError('INVALID_REQUEST');
  if (request.purpose === 'PROVISION') {
    if (request.expectedDigest !== undefined) throw new BridgeSecretLeaseError('INVALID_REQUEST');
    return;
  }
  if (typeof request.expectedDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(request.expectedDigest))
    throw new BridgeSecretLeaseError('INVALID_REQUEST');
}

function exactDigestMatch(actual: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

export class ScopedBridgeSecretLeaseResolver implements BridgeSecretLeaseResolver {
  constructor(private readonly source: BridgeSecretByteSource) {}

  async withSecret<T>(
    request: Readonly<BridgeSecretLeaseRequest>,
    consumer: (secret: Uint8Array) => Promise<T> | T,
  ): Promise<T> {
    validateRequest(request);
    let resolved: Uint8Array;
    try {
      resolved = await this.source.resolve(Object.freeze({ ...request }));
    } catch {
      throw new BridgeSecretLeaseError('SOURCE_UNAVAILABLE');
    }
    if (!(resolved instanceof Uint8Array)) throw new BridgeSecretLeaseError('INVALID_MATERIAL');
    if (
      resolved.byteLength < MIN_BRIDGE_SECRET_BYTES ||
      resolved.byteLength > MAX_BRIDGE_SECRET_BYTES
    )
      throw new BridgeSecretLeaseError('INVALID_MATERIAL');
    const leased = Uint8Array.from(resolved);
    try {
      if (
        request.expectedDigest !== undefined &&
        !exactDigestMatch(digestSecretReference(leased), request.expectedDigest)
      )
        throw new BridgeSecretLeaseError('DIGEST_MISMATCH');
      return await consumer(leased);
    } finally {
      leased.fill(0);
    }
  }
}

export class DenyBridgeSecretLeaseResolver implements BridgeSecretLeaseResolver {
  async withSecret<T>(
    _request: Readonly<BridgeSecretLeaseRequest>,
    _consumer: (secret: Uint8Array) => Promise<T> | T,
  ): Promise<T> {
    throw new BridgeSecretLeaseError('NOT_CONFIGURED');
  }
}

export const BRIDGE_SECRET_LEASE_RESOLVER = Symbol('BRIDGE_SECRET_LEASE_RESOLVER');
