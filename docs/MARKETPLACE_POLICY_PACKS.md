# Marketplace Policy Packs

**Status: specified, not implemented (Phase 4).**

Initial pack: **Etsy Digital Products — Development Pack**, mock and
draft-only. It must define: supported product types, listing-field
requirements, image requirements, digital-file requirements, file-count/
size limits, restricted categories, IP checks, pricing rules, API
capabilities, draft mode, publication requirements, rate limits, approval
requirements, last-verified/review dates, freshness state (master spec
section 21).

**Do not claim live Etsy integration exists** until it has been configured
and tested with an approved account and permitted API access — the
`Integration` model's `mode` field defaults to `MOCK` precisely to make this
distinction explicit and queryable (`apps/api` seed creates an `etsy`
integration row with `mode: MOCK`, `writeEnabled: false`).

Versioning: `MarketplacePolicyPack` + `MarketplacePolicyPackVersion` Prisma
models (Phase 4) will let POL-010 ("expired marketplace policy pack blocks
publication" — already implemented in the policy engine as a boolean input)
check a real expiry/review date instead of a stubbed boolean.
