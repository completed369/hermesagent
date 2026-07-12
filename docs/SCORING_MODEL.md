# Scoring Model

**Implemented and unit-tested**: `packages/scoring-engine`. Two
deliberately separate scores (master spec sections 17–18) — never merged.

## Opportunity Score (`opportunity-score-v1`)

Ten factors, weighted sum, each factor pre-normalised 0–100 by the caller
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
`isSpeculative: true` whenever opportunity ≥ 70 but profit confidence < 70 —
the concrete mechanism behind master spec section 18's "a high opportunity
score with low profit confidence must be clearly labelled as speculative."

## Reproducibility

Both functions record a `formulaVersion` and `calculatedAt` timestamp in
their output and are pure (same input → same output, unit-tested). No
Opportunity/OpportunityScore Prisma models exist yet — Phase 2.
