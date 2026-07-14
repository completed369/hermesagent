# Data Acquisition Contracts

**Status: implemented (Phase 5 — Research Connectors).**

Every data connector documents: source, purpose, access method,
authentication, allowed/prohibited operations, rate limits, expected
schema, freshness, retry policy, failure handling, retention, personal-data
classification, ToS considerations, geographic limitations, monitoring, and
a disable switch (master spec section 16). These fields are the
`DataAcquisitionContract` Prisma model (`packages/database/prisma/schema.prisma`),
not just a documentation convention — every acquisition run
(`runDataAcquisition` in `@ventureos/research-connectors`) reads the real
row and fails closed if the contract is disabled, rate-limited, or would
exceed the workspace's research cost caps.

Preferred sources, in order: official APIs → public exports →
founder-provided data → permitted browser research → permitted manual
imports. Never: bypass access restrictions, authentication, or CAPTCHAs;
masquerade as a user to access private data; collect unnecessary personal
data; store credentials in source code; ignore marketplace terms. These
hard prohibitions are captured per-contract in `prohibitedOperations` and
enforced architecturally: the only provider implemented in Phase 5 is a
mock adapter (`fetchMockResearchResult` in
`packages/research-connectors/src/mock-adapter.ts`) — no live network calls
exist anywhere in this phase, so none of the prohibited operations are even
reachable yet. Real permitted adapters (official APIs, public exports) are
additive work for a later hardening pass; wiring one in only ever changes
the adapter behind `runDataAcquisition`, never the contract-checking or
sanitisation pipeline around it.

## Real seeded contracts

Two contracts are seeded (`packages/database/src/seed.ts`), covering
opposite ends of the preferred source order:

### Etsy public listings (permitted browse)

| Field                        | Value                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source type                  | `PERMITTED_BROWSER_RESEARCH`                                                                                                                       |
| Purpose                      | Gather publicly visible price/review/rating signals for comparable digital-product listings                                                        |
| Access method                | `MANUAL_IMPORT`                                                                                                                                    |
| Authentication               | `NONE`                                                                                                                                             |
| Allowed operations           | `READ_PUBLIC_LISTING_TITLE`, `READ_PUBLIC_LISTING_PRICE`, `READ_PUBLIC_REVIEW_COUNT`, `READ_PUBLIC_RATING`                                         |
| Prohibited operations        | `BYPASS_AUTH`, `BYPASS_CAPTCHA`, `COLLECT_PERSONAL_DATA`, `MASQUERADE_AS_USER`, `SCRAPE_BEYOND_PUBLIC_PAGES`                                       |
| Rate limits                  | 5/minute, 100/day                                                                                                                                  |
| Freshness requirement        | 720h (30 days)                                                                                                                                     |
| Retry policy                 | `EXPONENTIAL_BACKOFF_3_ATTEMPTS`                                                                                                                   |
| Failure handling             | `FAIL_CLOSED`                                                                                                                                      |
| Retention                    | 365 days                                                                                                                                           |
| Personal-data classification | `NONE`                                                                                                                                             |
| ToS note                     | Publicly browsable listing pages only; single manual/permitted visits, never bulk scraping, never bypassing Etsy's Terms of Service or rate limits |
| Geographic limitations       | Global (Etsy public storefront, no geo-restriction known)                                                                                          |
| Monitoring                   | Health surfaced in Integration Health as `research:etsy-public-listings-permitted-browse`                                                          |
| Disable switch               | Enabled by default; `disabled`/`disabledReason` fields ready for a founder to flip                                                                 |

### Founder-provided market notes

| Field                        | Value                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Source type                  | `FOUNDER_PROVIDED`                                                                                                                             |
| Purpose                      | Capture informal founder observations/conversations as classified `FOUNDER_PROVIDED_FACT` evidence, never silently upgraded to `VERIFIED_FACT` |
| Access method                | `FOUNDER_PROVIDED`                                                                                                                             |
| Authentication               | `NONE`                                                                                                                                         |
| Allowed operations           | `READ_FOUNDER_NOTE`                                                                                                                            |
| Prohibited operations        | `COLLECT_PERSONAL_DATA`, `BYPASS_AUTH`                                                                                                         |
| Rate limits                  | none                                                                                                                                           |
| Freshness requirement        | 2160h (90 days — informal notes stay relevant longer)                                                                                          |
| Retention                    | 730 days                                                                                                                                       |
| Personal-data classification | `NONE`                                                                                                                                         |
| Monitoring                   | Health surfaced in Integration Health as `research:founder-provided-market-notes`                                                              |

## Real enforcement, not just documentation

Every acquisition run (`packages/research-connectors/src/acquisition-runner.ts`)
goes through, in order, before any (mock) provider call happens:

1. **Disable switch** — a disabled contract blocks the run (`BLOCKED_DISABLED`), recorded as a real `DataAcquisitionRun` row, and writes an `ERROR` Integration Health row.
2. **Rate limit** — `rateLimitPerMinute` is checked against real run counts in the last 60 seconds (`BLOCKED_RATE_LIMIT` if exceeded).
3. **Cost cap** — `assertWithinResearchCostCaps` (`packages/research-connectors/src/cost-guard.ts`) checks both a per-run cap and a per-workspace-per-day cap against today's already-succeeded spend (`BLOCKED_COST_CAP` if exceeded).

Only after all three pass does the mock adapter run, its raw payload gets
sanitised (see `docs/THREAT_MODEL.md`'s prompt-injection row), and a real
`EvidenceArtifact` is persisted with freshness/reliability computed from the
contract's own fields — never hand-typed (see `docs/EVIDENCE_MODEL.md`).

All of this is covered by both unit tests
(`packages/research-connectors/src/__tests__/`) and integration tests against
a real Postgres (`apps/api/test/research-connectors.integration.spec.ts`),
including the disabled/rate-limit/cost-cap blocks and the prompt-injection
security proof.
