export class ContractNotFoundError extends Error {}

/** Thrown when a run is blocked before any (mock) provider call happens --
 * disabled contract, rate limit, or cost cap. Fail-closed by design (master
 * spec sections 8/16): the caller always gets a real DataAcquisitionRun row
 * recording the block, never a silent no-op. */
export class DataAcquisitionBlockedError extends Error {}

export class ResearchCostCapExceededError extends Error {}
