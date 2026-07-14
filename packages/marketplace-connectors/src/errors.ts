export class MarketplaceAccountNotFoundError extends Error {}

/** Thrown when a publication step is blocked before any (mock) marketplace
 * call happens -- disabled account or rate limit. Fail-closed by design,
 * mirroring DataAcquisitionBlockedError from Phase 5: the caller always gets
 * a real PublicationAttempt row recording the block, never a silent no-op. */
export class MarketplaceBlockedError extends Error {}

/** A reused idempotency key with a DIFFERENT request payload is a genuine
 * caller error -- never silently treated as a retry of the same operation
 * (master spec: "duplicate external execution" threat). A key reused with
 * an in-flight (PENDING) or already-succeeded operation also raises this;
 * callers distinguish those cases via the message. */
export class IdempotencyKeyConflictError extends Error {}
