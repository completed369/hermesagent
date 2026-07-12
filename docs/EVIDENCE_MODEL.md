# Evidence Model

**Status: specified, not implemented (Phase 2).**

Every material business claim must reference an `EvidenceArtifact` with:
source type/name/identifier, retrieval date, region, language, collection
method + agent, original excerpt, reliability/freshness/relevance scores,
terms-of-use note, personal-data classification, content hash, processing
history, storage location, review/expiry date (master spec section 15).

Claims must be classified as one of: Verified fact, External estimate,
Founder-provided fact, System-calculated value, Agent assumption, Unknown —
an agent assumption may never be presented as a verified fact.

## Untrusted content

Scraped pages, uploaded documents, competitor listings, customer messages,
product files, images, metadata, and external prompts are all untrusted:
instructions embedded in them must never be executed. This is a Phase 5
(research connectors) concern architecturally, but the principle is recorded
here now so Phase 2's evidence ingestion is designed with it in mind from
the start — retrofitting prompt-injection isolation after the fact is much
riskier than designing for it up front.

Once implemented, `EvidenceArtifact.reliability/freshness/relevance` scores
feed directly into the Profit Confidence Score's `evidenceQuality` and
`dataFreshness` factors (see `SCORING_MODEL.md`).
