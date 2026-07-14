# @ventureos/product-studio

**Status: IMPLEMENTED (Phase 4).**

Houses the mock product-generation and listing-generation pipeline (master
spec sections 21/22/25/30):

- `mock-product-generator.ts` — `generateProductAssets()`: deterministic
  mock file generation (PDF guide, spreadsheet planner, editable template,
  two preview images, licence file, README), uploaded through a
  caller-provided `StorageProvider` (real MinIO in dev/prod, `MockStorageProvider`
  in tests) so `contentHash`/`sizeBytes` always come from the real upload,
  never hand-typed. No live model calls.
- `qa-checker.ts` — `runQualityChecks()`/`persistQualityChecks()`:
  Operations and Quality Officer's domain, now against real generated files
  (Phase 3 could only stub this). Five deterministic check types:
  completeness, file integrity, naming convention, duplicate-asset
  detection, licence completeness.
- `marketplace-policy-pack.ts` — the Etsy Digital Products Development Pack
  content (mock, draft-only — see `docs/MARKETPLACE_POLICY_PACKS.md`).
- `listing-generator.ts` — `generateListing()`: deterministic mock Etsy
  draft-listing generation (title/description/tags/category/price), pulling
  images/files directly from the product's current generated assets.
- `seo-evaluator.ts` — `evaluateSeoContent()`/`runSeoEvaluation()`:
  deterministic SEO checks against listing content.
- `product-listing-runner.ts` — the DB-touching orchestration:
  `generateProduct()` (fails closed unless the venture proposal already has
  a founder-approved Phase 3 `ApprovalRequest`) and
  `generateListingAndApprovalRequest()` (fails closed unless QA passed;
  always records a blocked `PublicationAttempt` since Phase 4 never
  publishes; creates the second founder `ApprovalRequest`, `kind:
'PRODUCT_LISTING'`).

Like `@ventureos/agent-runtime`, these are plain async functions that import
`prisma` directly from `@ventureos/database` — callable identically from
`apps/api` (REST endpoints) and `apps/worker` (Temporal activities), one
source of truth instead of duplicated business logic.

## The second approval gate

The `PRODUCT_LISTING` kind is decided by the SAME `decideApprovalRequest()`
function `@ventureos/agent-runtime` already built and tested for Phase 3's
`VENTURE_PROPOSAL` kind — extended with a branch that re-validates hash
binding against the latest `ProductPackage` for the `ProductVersion` instead
of the latest `VentureProposalVersion`. One state machine, two artefact
kinds; the Phase 3 branch is untouched.
