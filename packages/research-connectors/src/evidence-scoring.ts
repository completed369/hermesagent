/**
 * Real, deterministic evidence freshness/reliability computation (Phase 5
 * deliverable #3) replacing the Phase 2 stub where these scores were only
 * ever hand-typed by a founder/agent at seed time. Both functions are pure
 * -- no DB access -- so they are directly unit-testable and safely reusable
 * from both the acquisition runner and any future re-scoring job.
 */

export interface FreshnessScoreInput {
  retrievedAt: Date;
  freshnessRequirementHours: number;
  /** Injection point for deterministic tests; defaults to real "now". */
  now?: Date;
}

/**
 * 100 at the moment of retrieval, decaying linearly to 0 once the artifact's
 * age reaches 2x its contract's freshness requirement. Never negative, never
 * above 100.
 */
export function computeFreshnessScore(input: FreshnessScoreInput): number {
  const now = input.now ?? new Date();
  const ageHours = (now.getTime() - input.retrievedAt.getTime()) / (1000 * 60 * 60);
  if (ageHours <= 0) return 100;

  const maxAgeHours = Math.max(input.freshnessRequirementHours, 1) * 2;
  if (ageHours >= maxAgeHours) return 0;

  const score = 100 * (1 - ageHours / maxAgeHours);
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Base reliability by source type, per master spec section 16's preferred
 * source order (official APIs are the most trusted, manual import the
 * least). */
const SOURCE_TYPE_BASE_RELIABILITY: Record<string, number> = {
  OFFICIAL_API: 90,
  FOUNDER_PROVIDED: 85,
  PUBLIC_EXPORT: 80,
  PERMITTED_BROWSER_RESEARCH: 60,
  MANUAL_IMPORT: 50,
};

export interface ReliabilityScoreInput {
  sourceType: string;
  /** true if the raw payload matched the prompt-injection sanitizer -- a
   * source that tried to smuggle instructions is never as trustworthy as one
   * that didn't, even after sanitisation. */
  promptInjectionFlagged: boolean;
  disabled: boolean;
}

export function computeReliabilityScore(input: ReliabilityScoreInput): number {
  if (input.disabled) return 0;

  let score = SOURCE_TYPE_BASE_RELIABILITY[input.sourceType] ?? 40;
  if (input.promptInjectionFlagged) score -= 30;

  return Math.round(Math.max(0, Math.min(100, score)));
}
