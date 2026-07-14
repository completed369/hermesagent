# Etsy Open API v3 — Integration Notes (Phase 6 research)

**Status: research complete, mock-only implementation (Phase 6).** Founder
decision (2026-07-14): continue mock-only for Phase 6; no real Etsy account
is connected. These notes exist so the mock adapter and schema are shaped
like the real API from day one — connecting a real account later should only
ever mean swapping the adapter behind `MarketplaceClient`, never
re-architecting the schema, approval gate, or workflow.

Sources (fetched live, since this postdates the May 2025 knowledge cutoff):
[Authentication](https://developers.etsy.com/documentation/essentials/authentication),
[Rate Limits](https://developers.etsy.com/documentation/essentials/rate-limits),
[Listings Tutorial](https://developers.etsy.com/documentation/tutorials/listings),
[API Reference](https://developers.etsy.com/documentation/reference), and a
[community discussion](https://github.com/etsy/open-api/discussions/1296) on
publish/update flakiness.

## Authentication

OAuth 2.0 Authorization Code Grant with **mandatory PKCE** (no plain
authorization-code-only flow). Flow: (1) redirect the seller to
`https://www.etsy.com/oauth/connect` with `client_id`, `redirect_uri`,
`scope`, `state`, `code_challenge`, `code_challenge_method=S256`; (2) seller
approves, Etsy redirects back with `code`; (3) POST to
`https://api.etsy.com/v3/public/oauth/token` with `grant_type=authorization_code`,
the `code`, and the PKCE `code_verifier` to receive `access_token` (1 hour
TTL) + `refresh_token` (90-day TTL). Refresh via `grant_type=refresh_token`.
Relevant scopes for this phase: `listings_r`, `listings_w`, `shops_r`. Every
request also needs an `x-api-key` header carrying the app's API key
keystring alongside the bearer token — this detail should be re-verified
against the live Developer Portal at real-integration time, since API header
conventions are exactly the kind of detail that drifts between doc
snapshots.

**Design implication**: `MarketplaceAccount` needs `accessToken`,
`refreshToken`, `accessTokenExpiresAt`, and `scopes` fields — never logged in
plaintext (reuse `redactSecrets`), and in the mock-only build these are
simply never populated with real values.

## Listing creation and publish flow

- `POST /v3/application/shops/{shop_id}/listings` (`createDraftListing`,
  scope `listings_w`) creates a **draft** listing. For digital products,
  `type: "download"` and `is_digital: true`.
- `POST /v3/application/shops/{shop_id}/listings/{listing_id}/images`
  (`uploadListingImage`) attaches an image to the draft.
- Digital product files use the analogous `uploadListingFile` endpoint.
- `PATCH /v3/application/shops/{shop_id}/listings/{listing_id}`
  (`updateListing`) with `state: "active"` is the **actual publish step** —
  a distinct, separate call from draft creation.

**Design implication**: this maps directly onto the existing
`PublicationAttempt` model's already-blocked-by-default shape from Phase 4 —
Phase 6 adds a real (mock-adapter) two-step flow (draft → publish) rather
than a single call, which is exactly why "publication preparation" (task
#66, readiness checks after draft creation) and "publish" (gated by the
second approval, task #67) are kept as separate pipeline stages.

**Known flakiness** (community-reported, not an official Etsy statement):
some sellers report intermittent save/update failures on listings created
via the API, sometimes correlated with special characters or unit-field
mismatches in the payload — never fully root-caused in the thread. Not
something to hard-code a workaround for, but it's real-world evidence that
publish/update calls can fail non-deterministically even with a
well-formed payload, which is why reconciliation + error recovery (task #69)
needs to treat "call succeeded" and "call is now reflected on Etsy's side"
as two separate facts to verify, not one.

## Rate limits

Application-level (not per-seller): Queries Per Second (QPS) and Queries Per
Day (QPD, sliding 24-hour window, not midnight-aligned). Every response
carries `x-limit-per-second` / `x-remaining-this-second` /
`x-limit-per-day` / `x-remaining-today` headers. Exceeding either returns
`429` with a `retry-after` header. QPS is checked before QPD.

**Design implication**: `MarketplaceAccount` (or a shared config) should
carry per-account rate-limit fields mirroring `DataAcquisitionContract`'s
`rateLimitPerMinute`/`rateLimitPerDay` pattern from Phase 5, so the same
fail-closed rate-limit-check shape can be reused for marketplace writes.

## What this means for the mock-only build

No live network calls exist anywhere in Phase 6, matching every prior
phase's mock-by-default discipline. `MarketplaceClient` (the new
`@ventureos/marketplace-connectors` or an addition to
`@ventureos/product-studio`, to be decided at implementation time) exposes
the same method shape a real client would (`createDraftListing`,
`uploadListingImage`, `uploadListingFile`, `publishListing`) but only the
mock implementation exists. Switching to a real account later is additive:
implement the real methods behind the same interface, populate real
`MarketplaceAccount` credentials, and flip a mode switch — never touch the
approval gate, idempotency, reconciliation, or workflow logic built around
the mock.
