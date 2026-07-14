# Evidence Model

**Status: implemented (Phase 2).** Schema: `packages/database/prisma/schema.prisma`
(`DataSource`, `EvidenceArtifact`, `EvidenceClaim`). Contracts:
`packages/contracts/src/evidence.ts` (`EvidenceClaimType`,
`EvidenceClaimSchema`, `EvidenceArtifactSchema`). Seed example: every
classification type has a real example artifact/claim pair in
`packages/database/src/seed.ts`, attached to the "Social Media Content
Planning Kit" pilot opportunity.

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

`EvidenceArtifact.reliabilityScore`/`freshnessScore` feed directly into the
Profit Confidence Score's `evidenceQuality` and `dataFreshness` factors
(see `SCORING_MODEL.md`). For evidence created via a Phase 2 seed/manual
import, these remain a founder/agent judgment call at creation time. For
evidence created via a Phase 5 research connector acquisition run, they are
now a real, deterministic computation — never hand-typed:
`computeFreshnessScore` (linear decay from 100 at retrieval to 0 at 2x the
contract's `freshnessRequirementHours`) and `computeReliabilityScore`
(base score by source type per the master-spec-section-16 preferred order,
penalised if the payload was flagged by the prompt-injection sanitiser, and
forced to 0 if the contract is disabled) — both in
`packages/research-connectors/src/evidence-scoring.ts`, unit-tested in
`evidence-scoring.test.ts`. An automatic aggregate rollup _per opportunity_
(e.g. averaging every linked artifact's reliability into that opportunity's
`evidenceQuality` factor) is still left for a later phase, once there are
enough real (non-seed) evidence artifacts per opportunity to make that
aggregation meaningful — Phase 5 makes the per-artifact scores real, not
yet the opportunity-level rollup.

## Untrusted content

Scraped pages, uploaded documents, competitor listings, customer messages,
product files, images, metadata, and external prompts are all untrusted:
instructions embedded in them must never be executed. This is now
addressed for the Phase 5 research-connector path:
`sanitizeUntrustedContent` (`packages/research-connectors/src/prompt-injection-sanitizer.ts`)
runs on every raw acquisition payload before it is ever stored as
`EvidenceArtifact.originalExcerpt`, so a poisoned source's embedded
instructions never reach this table intact, and never reach an agent
prompt built from this table's data. See `docs/THREAT_MODEL.md`'s "Prompt
injection" and "Malicious/poisoned research source" rows for the specific
test evidence. Founder-provided and manually-imported evidence (Phase 2
path) is not run through this sanitiser — it is trusted at the point the
founder enters it, per the master spec's `FOUNDER_PROVIDED_FACT`
classification.
