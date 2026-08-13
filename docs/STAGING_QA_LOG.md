# Staging QA Log

Date: 2026-08-13
Environment: private staging (`staging.ventureos.site` / `api-staging.ventureos.site`)
Deployed source verified during QA: `3f79aaed000bf2bb19ad997ea3e63e5c236a2928`
Deployment workflow run: `31681638545`

## Infrastructure acceptance

- PASS: all required PostgreSQL, Temporal, API, worker, web and ingress containers healthy.
- PASS: zero restart counts during acceptance snapshot.
- PASS: canonical Compose configuration validated.
- PASS: only SSH exposed on the VPS host; application ports are not host-published.
- PASS: internal API ingress `/api/health/live` returned HTTP 200.
- PASS: internal web ingress `/login` returned HTTP 200.
- PASS: Cloudflare DNS/TLS edge reachable for both staging hostnames.
- PASS: unauthenticated external requests are redirected to Cloudflare Access rather than reaching the origin directly.
- PASS: authenticated browser login, hard refresh/session persistence, logout and post-logout refresh.

## Functional Phase 1-8 staging pass

### Phase 1 - Foundation

PASS. Command Centre rendered workspace data; onboarding save/refresh persistence was exercised; Audit Centre and Security Events were rechecked after saves/login; authenticated navigation and logout/session behavior worked.

### Phase 2 - Opportunity and Evidence

PASS. Seeded Social Media Content Planning Kit rendered Opportunity Score 71.5, Profit Confidence 61.75, Speculative indicator, target customer/channels/risks, and all six evidence classifications. Promotion to a Venture Proposal succeeded.

### Phase 3 - Board + Approval

PASS. Board review completed with 8/8 APPROVE, weighted score 100/75, no active critical veto, and Decision Synthesiser recommendation APPROVE. Distinct founder Venture Proposal approval was decided APPROVE and persisted.

### Phase 4 - Product + Listing Studio

PASS. Product reached `QA_PASSED`; seven generated assets carried sizes/content hashes; completeness, file integrity, naming convention, duplicate-asset and licence checks rendered; Etsy draft listing generated; SEO score 100/100; Product+Listing approval was decided APPROVE.

### Phase 5 - Research Connectors

PASS. Permitted Etsy public-listings research run completed and the Command Centre showed `research:etsy-public-listings-permitted-browse` as CONNECTED. Connected-integration count increased accordingly.

### Phase 6 - Marketplace Pilot (mock only)

PASS. Marketplace Publication explicitly remained MOCK-only. A distinct PUBLICATION approval was created and approved. Workflow resumed to the mock publication path; no real Etsy account was connected and no real marketplace write was performed.

### Phase 7 - Finance + Analytics

PASS. Forecast generated LOW/BASE/HIGH scenarios and break-even; EUR 5 staging expense and EUR 10 staging revenue persisted; forecast-vs-actual updated; controlled experiment ran; Gate 6 SCALE approval was created/approved and the SCALE decision completed.

### Phase 8 - Multi-Venture + SaaS

PASS for plan entitlement behavior, license export, white-label branding and tenant isolation. STARTER correctly blocked Agency-only license/white-label operations. AGENCY allowed license issue/revoke and live branding update; branding visibly changed the dashboard shell. A separate `test1` registration produced an isolated workspace with zero venture proposals, zero approvals and zero inherited integrations/data. A disposable Playwright registration test now verifies the TRIAL subscription/limits automatically in CI.

## Defects found during this pass

1. Command Centre contained stale copy claiming VentureOS was only a verified local-development build and that deployment remained pending.
2. Workflow Centre carried the obsolete `Phase 2+` badge.

Both are fixed with regression coverage on `fix/staging-status-copy` / PR #14. They must pass CI, merge, publish and redeploy before Stage 5 closes.

## Stage 5 performance/concurrency gate

In progress on `feat/stage5-validation`:

- 20-way atomic budget-cap race regression.
- concurrent research daily-cost-cap reservation regression.
- disposable staging HTTP/Temporal load run with 20 concurrent workers.
- machine-readable `.staging/load-results.json` with p50/p95/max latency and HTTP status distributions.

Stage 5 remains OPEN until those automated tests pass and the corrected UI release is deployed and re-verified.
