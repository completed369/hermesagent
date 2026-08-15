# Evidence Model

**Status: implemented.** Schema: `packages/database/prisma/schema.prisma`
(`DataSource`, `EvidenceArtifact`, `EvidenceClaim`). Contracts:
`packages/contracts/src/evidence.ts` (`EvidenceClaimType`,
`EvidenceClaimSchema`, `EvidenceArtifactSchema`). Seed example: every
classification type has a real example artifact/claim pair in
`packages/database/src/seed.ts`, attached to the "Social Media Content
Planning Kit" demo opportunity.

Every material business claim references an `EvidenceArtifact` with:
source type/name/identifier, retrieval date, region, language, collection
method + agent, original excerpt, reliability/freshness/relevance scores
(0-100), terms-of-use note, personal-data classification, content hash,
processing history, storage location, review/expiry date (master spec
section 15).

Claims are classified as exactly one of: `VERIFIED_FACT`,
`EXTERNAL_ESTIMATE`, `FOUNDER_PROVIDED_FACT`, `SYSTEM_CALCULATED_VALUE`,
`AGENT_ASSUMPTION`, `UNKNOWN` — enforced by `EvidenceClaimType` (a zod enum,
not a free-text field), so an agent assumption can never be silently
persisted as a verified fact. The Opportunity Feed UI
(`apps/web/src/app/dashboard/opportunities/[id]/page.tsx`) renders each
claim's classification as a coloured badge next to its statement, and
never merges or hides the distinction between types.

`EvidenceArtifact.contentHash` is computed via `hashContent()` from
`@ventureos/security` (SHA-256 of the canonical excerpt/source name) —
the same hashing utility already used for `AuditEvent.integrityHash`, so
evidence provenance and audit integrity share one trusted implementation.

## Per-artifact reliability and freshness

For evidence created via a Phase 5 research connector acquisition run,
`reliabilityScore` and `freshnessScore` are deterministic computations —
never hand-typed: `computeFreshnessScore` uses linear decay from 100 at
retrieval to 0 at 2x the contract's `freshnessRequirementHours`, while
`computeReliabilityScore` uses a base score by source type following the
master-spec-section-16 preferred order, penalises prompt-injection-flagged
content, and forces disabled sources to zero. Both live in
`packages/research-connectors/src/evidence-scoring.ts` and are unit-tested.

The Stage-6 founder/manual opportunity-intake path reuses those same
functions: the founder supplies the truthful source type, retrieval time,
freshness requirement and relevance; the server derives reliability and
freshness before the evidence is persisted. The create API does not accept a
final opportunity evidence-quality score or a client-provided freshness
score.

## Opportunity-level evidence quality

Commercial Validation Gate 2 requires evidence quality >= 70. The master
spec defines that threshold but not an aggregation formula, so ADR-012 makes
the project decision explicit and versioned.

Formula `opportunity-evidence-quality-v1` evaluates each **unique linked
evidence artifact** as:

`artifact quality = reliability * 0.50 + relevance * 0.30 + freshness * 0.20`

The opportunity-level score is the arithmetic mean of those unique artifact
scores, rounded to two decimals. Claim count cannot inflate the result: one
artifact counts once regardless of how many claims reference it. Explicitly
expired artifacts stay in the denominator with zero quality/freshness, and no
linked evidence returns no numeric score and fails closed.

The authoritative implementation is
`packages/policy-engine/src/evidence-quality.ts`. It is covered for exact
weighting, the >=70 boundary, below-threshold reliability, mixed-quality
sources, duplicate-source de-duplication, expired evidence, missing evidence
and invalid inputs.

Every Stage-6 rescore persists a versioned `OpportunityScore` history row with
`scoreType = EVIDENCE_QUALITY`, the formula version and the exact unique
artifact/component inputs. `packages/database/src/opportunity-scoring.ts`
then injects that server-derived evidence quality and data-freshness result
into the existing Profit Confidence calculation in the same transaction.
The opportunity detail UI renders the latest evidence-quality score and
formula version.

## Untrusted content

Scraped pages, uploaded documents, competitor listings, customer messages,
product files, images, metadata, and external prompts are all untrusted:
instructions embedded in them must never be executed. This is addressed for
the Phase 5 research-connector path:
`sanitizeUntrustedContent` (`packages/research-connectors/src/prompt-injection-sanitizer.ts`)
runs on every raw acquisition payload before it is ever stored as
`EvidenceArtifact.originalExcerpt`, so a poisoned source's embedded
instructions never reach this table intact, and never reach an agent prompt
built from this table's data. See `docs/THREAT_MODEL.md`'s "Prompt injection"
and "Malicious/poisoned research source" rows for the specific test evidence.

Founder-provided/manual Stage-6 evidence is an explicit founder-input path,
not an automated scraper. Its claim classification must still be selected
truthfully; the UI defaults the claim to `UNKNOWN` rather than silently
promoting it to a verified fact.
