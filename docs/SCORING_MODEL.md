# Scoring Model

**Implemented and unit-tested**: `packages/scoring-engine`. Two
deliberately separate scores (master spec sections 17–18) — never merged.

## Opportunity Score (`opportunity-score-v1`)

Eleven factors, weighted sum, each factor pre-normalised 0–100 by the caller
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
their output and are pure (same input → same output, unit-tested).

## Persistence and wiring (Phase 2, implemented)

`OpportunityScore` (schema: `packages/database/prisma/schema.prisma`) stores
one row per calculation — `scoreType` (`OPPORTUNITY` or `PROFIT_CONFIDENCE`),
`formulaVersion`, the raw `score`, the `factors` object that produced it,
`factorContributions` (opportunity score only), and `isSpeculative` (profit
confidence only). `Opportunity.latestOpportunityScore` /
`latestProfitConfidence` / `isSpeculative` are denormalized copies of the
most recent scores, kept in sync by whatever wrote the `OpportunityScore`
rows, so the Opportunity Feed list page can render them without an extra
join per row.

`packages/database/src/seed.ts` calls `calculateOpportunityScore()` and
`calculateProfitConfidenceScore()` directly (never hand-computes a score)
for the "Social Media Content Planning Kit" pilot opportunity, with factor
inputs deliberately tuned so the opportunity score lands ≥70 while the
profit confidence score lands <70 — a concrete, seeded example of the
`isSpeculative` flag in action, visible as a "Speculative" badge on both
the Opportunity Feed list and detail pages
(`apps/web/src/app/dashboard/opportunities/`).

Nothing in `apps/api`'s Opportunities module recomputes scores — recording
new `OpportunityScore` rows (e.g. on evidence changes or a founder-triggered
re-score) is left for a later phase once there's a real evidence-ingestion
pipeline driving changed inputs.
