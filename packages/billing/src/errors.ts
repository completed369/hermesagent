export class PlanNotFoundError extends Error {}

export class SubscriptionNotFoundError extends Error {}

/** Thrown when creating a venture, inviting a member, or connecting a
 * marketplace account would exceed the workspace's current plan limit.
 * Fail-closed by design (same posture as every other quota/budget guard in
 * this codebase, e.g. `assertWithinBudget` in Phase 7): the caller always
 * gets a clear, typed rejection, never a silent partial success. */
export class PlanLimitExceededError extends Error {}

export class LicenseKeyNotFoundError extends Error {}

export class LicenseKeyInvalidError extends Error {}

export class SubscriptionAlreadyExistsError extends Error {}
