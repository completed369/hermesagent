# Integrations

## Phase 6 update: Etsy marketplace (mock-only, per explicit founder decision)

**Founder decision recorded 2026-07-14: mock-only.** No real Etsy account is
connected, and none was requested -- per spec section 21's explicit rule,
this document will state "verified working with a real account on [date]"
only once that has literally happened, never before. See
`docs/ETSY_API_INTEGRATION.md` for the real Etsy Open API v3 research
(OAuth 2.0 + PKCE, `createDraftListing`/`uploadListingImage`/
`uploadListingFile`/`updateListing(state=active)` sequence, rate limits)
that the mock adapter's shapes are modeled on, and `docs/DECISIONS.md`
(ADR-007) for the decision record.

`@ventureos/marketplace-connectors` implements the full publish pipeline --
draft creation, image/file upload, idempotent external writes, fail-closed
gating (disabled account / rate limit), a second founder approval distinct
from Phase 4's product/listing approval, and reconciliation via retry-in-
place -- entirely against `fetchMockCreateDraftListing`/
`fetchMockUploadListingImage`/`fetchMockUploadListingFile`/
`fetchMockPublishListing` (`mock-etsy-client.ts`). Zero live network calls
occur anywhere in this phase. A `MarketplaceAccount` row (`mode: 'MOCK'`) is
auto-provisioned per workspace on first use, linked to the `etsy`
`Integration` row below; switching to a real account later means adding a
real Etsy API client behind the same interface and populating real OAuth
credentials as `SecretReference` pointers -- not rewriting the pipeline.

## Phase 1 integrations (all seeded as disconnected/mock)

| Provider | Mode      | Write enabled | Purpose                                                               |
| -------- | --------- | ------------- | --------------------------------------------------------------------- |
| minio    | READ_ONLY | No            | Object storage health check                                           |
| etsy     | MOCK      | No            | Marketplace adapter (Phase 6) -- mock-only, no real account connected |
| ai-mock  | MOCK      | No            | Placeholder for Phase 3 AI provider                                   |

All three are visible on the Command Centre "Integration status" table,
sourced from the real `Integration` table (not hardcoded UI).

## Adapter pattern

`packages/integrations/src/storage` is the reference implementation: a
`StorageProvider` interface, a real `MinioStorageProvider`, and a
`MockStorageProvider` used in tests. The same shape has now been applied
twice more: `AiProvider` (Phase 3, `packages/agent-runtime` — mock board-
agent provider only) and the marketplace adapter (Phase 6,
`packages/marketplace-connectors` — mock Etsy client only, real client not
yet written). Both follow the identical pattern: an interface, a mock
implementation used everywhere today, and a real implementation to be added
later behind the same interface, with credentials supplied as
`SecretReference` pointers rather than inline values.

## Write-enabled integrations start disabled

Per master spec policy POL-013 (not yet in `evaluateCorePolicies` since no
integration triggers a write today, but enforced structurally):
`Integration.writeEnabled` defaults to `false` in the Prisma schema and the
seed script never sets it to `true`. This includes the `etsy` row above:
Phase 6's mock publish pipeline writes to the mock Etsy client directly
(gated by its own fail-closed checks and the `PUBLICATION` approval), not
through the `Integration.writeEnabled` flag, so that flag stays `false`
until a real, write-enabled Etsy connection is deliberately turned on.
