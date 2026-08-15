# ADR-012: Stage 6 opportunity evidence-quality aggregation

Status: **Accepted for Stage 6 implementation**

Date: 2026-08-15

## Context

Commercial Validation Gate 2 requires a standalone evidence-quality score of at least 70. The existing master specification and policy engine define that threshold, but they do not define how multiple linked `EvidenceArtifact` records become one opportunity-level score. The existing evidence model deliberately left that aggregate for a later phase.

A commercial gate must not depend on an undocumented or hand-entered final number. The aggregation therefore needs a deterministic formula, explicit version, source provenance, missing-evidence behavior and tests before Stage 6 uses it.

## Decision

VentureOS uses formula version `opportunity-evidence-quality-v1`.

For every **unique evidence artifact linked to the opportunity**, calculate artifact quality as:

`quality = reliability × 0.50 + relevance × 0.30 + freshness × 0.20`

The opportunity-level score is the arithmetic mean of those unique artifact-quality scores, rounded to two decimal places.

Rules:

- One artifact counts once regardless of how many claims reference it. Claim count cannot inflate evidence quality.
- Reliability is weighted most heavily because provenance/source trust is the primary safety property for an evidence-backed commercial decision.
- Relevance is weighted second so a strong source that does not materially support the opportunity cannot dominate the gate.
- Freshness remains part of evidence quality at a lower weight and is also retained as its own Profit Confidence factor.
- An explicitly expired artifact remains in the denominator but contributes zero quality and zero freshness. Expired evidence cannot silently disappear and make the aggregate look stronger.
- No linked evidence produces no numeric score (`null`), and the gate must fail closed.
- Input dimensions outside 0-100 are invalid and must be rejected, not clamped.
- The Gate-2 minimum remains the master-spec threshold of **70**. This ADR defines aggregation only; it does not change the threshold.

## Persistence and provenance

The existing `OpportunityScore` history table will persist the aggregate using `scoreType = EVIDENCE_QUALITY`. Its existing `formulaVersion`, `score`, `factors` and `calculatedAt` fields are sufficient to record the versioned result and the exact artifact/component inputs without adding a duplicate score-history table.

The score history must record the unique artifact IDs and per-artifact component/result values used for the calculation. A board review must consume the authoritative calculated value; it must never accept a client-supplied final evidence-quality score.

## Compatibility

The seeded Phase-2 demo intentionally contains weak, assumption and unknown evidence and was designed with Profit Confidence below 70. Stage 6 must not reinterpret that seeded fixture as commercially validated merely to preserve its earlier mechanical board demonstration. A fresh real pilot is required by `docs/COMMERCIAL_VALIDATION.md`.

## Consequences

- Stage-6 intake/rescore can be implemented without a new database migration for evidence-quality history.
- Adding multiple claims from one source cannot game the score.
- Low-quality or explicitly expired evidence lowers the aggregate instead of being hidden.
- Formula changes require a new formula version and a new ADR/update; historical scores remain reproducible.
- This score is still only one Gate-2 condition. Opportunity Score, Profit Confidence, board threshold, critical vetoes and persisted founder approval remain independently required.
