# Scoring Model

The core Opportunity Score and Profit Confidence Score are implemented and
unit-tested in `packages/scoring-engine`. Stage 6 adds a separate,
policy-gate-specific opportunity Evidence Quality score in
`packages/policy-engine`; the three values remain distinct and are never
merged into one opaque score.

## Opportunity Score (`opportunity-score-v1`)

Eleven factors, weighted sum, each factor pre-normalised 0-100 by the caller
(risk-type factors like competition/policy/IP risk must already be inverted
so higher = better everywhere):

demand 15 · trendStrength 10 · competitionAttractiveness 10 ·
expectedMargin 15 · productDifferentiation 10 · productionFeasibility 10 ·
organicMarketingPotential 10 · marketplacePolicyRisk 5 ·
intellectualPropertyRisk 5 · evidenceConfidence 5 · timeToLaunch 5 (=100).

Weights sum to 100 is enforced at module load time (throws if not).

## Profit Confidence Score (`profit-confidence-v1`)

Separate ten factors: evidenceQuality 15 · sampleSize 10 · costCertainty 15 ·
marketplaceFeeCertainty 10 · comparableProductQuality 10 ·
forecastRangeWidth 10 · historicalModelAccuracy 10 · channelMaturity 10 ·
assumptionSensitivity 5 · dataFreshness 5 (=100).

`calculateProfitConfidenceScore(factors, opportunityScore)` flags
`isSpeculative: true` whenever opportunity >= 70 but profit confidence < 70 —
the concrete mechanism behind master spec section 18's "a high opportunity
score with low profit confidence must be clearly labelled as speculative."

For the Stage-6 intake/rescore path, `evidenceQuality` and `dataFreshness`
are not client inputs. `packages/database/src/opportunity-scoring.ts` derives
both from the currently linked evidence artifacts and injects them into this
calculation server-side.

## Evidence Quality (`opportunity-evidence-quality-v1`)

Commercial Validation Gate 2 independently requires evidence quality >= 70.
The master spec defines the threshold but does not define how multiple
artifacts aggregate, so ADR-012 records the project formula before the gate is
used:

`artifact quality = reliability * 0.50 + relevance * 0.30 + freshness * 0.20`

The opportunity result is the arithmetic mean of the unique linked artifact
scores, rounded to two decimals. Duplicate claims from one artifact do not
increase its weight. Explicitly expired artifacts remain in the denominator
with zero contribution. Missing evidence produces `null` and fails closed.

The pure implementation lives in
`packages/policy-engine/src/evidence-quality.ts`; tests cover weighting,
exactly-70 and below-70 boundaries, weak reliability, mixed quality,
duplicate-artifact de-duplication, expiry, missing evidence and invalid
inputs.

## Reproducibility and persistence

Opportunity Score and Profit Confidence remain pure/versioned scoring-engine
functions. Evidence Quality has its own formula version. Stage-6 rescoring
writes all three histories atomically to `OpportunityScore`:

- `scoreType = EVIDENCE_QUALITY` stores its formula version, aggregate score,
  unique artifact IDs/component inputs and derived data-freshness score;
- `scoreType = OPPORTUNITY` stores the existing opportunity formula, factors
  and factor contributions;
- `scoreType = PROFIT_CONFIDENCE` stores the existing profit-confidence
  formula, effective factors and speculative flag.

`Opportunity.latestOpportunityScore`, `latestProfitConfidence` and
`isSpeculative` are updated in that same transaction. A rescore is allowed
only while the opportunity is `NEW` or `UNDER_REVIEW`; once promoted or moved
to a terminal state the score snapshot is frozen so a Venture Proposal cannot
silently drift away from the score state it captured.

The Stage-6 create/rescore API never accepts final score values. It accepts
normalized non-evidence factor inputs, validates them 0-100, derives evidence
quality/freshness from authoritative evidence state, calls the existing score
engines, persists the histories, and records audit events.

## Board Gate 2 wiring

`calculateBoardVotingResult` already enforced evidence quality below 70 when
an `evidenceQualityScore` is supplied. Stage 6 now makes `runBoardReview`
load the latest persisted `EVIDENCE_QUALITY` history for the proposal's
opportunity and pass that score into the existing fail-closed board rule.

Legacy seeded/demo opportunities predate `EVIDENCE_QUALITY` history and retain
their earlier mechanical board-regression behavior. They are not thereby
commercially validated; Stage 6 requires a fresh real opportunity and real
evidence.

## Seed/demo compatibility

`packages/database/src/seed.ts` still calls the Opportunity and Profit
Confidence score engines directly for the "Social Media Content Planning Kit"
demo, deliberately producing Opportunity Score 71.5 and Profit Confidence
61.75 with `isSpeculative = true`. That fixture remains a mechanical/reference
example and is not a Stage-6 commercial gate result.
