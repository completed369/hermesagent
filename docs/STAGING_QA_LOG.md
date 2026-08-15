# Staging QA Log

Initial functional QA: 2026-08-13
Final immutable release verification: 2026-08-15
Environment: private staging (`staging.ventureos.site` / `api-staging.ventureos.site`)
Current deployed source: `007e15b4ab93093b7a958150dabf1ba673c007c6`
Deployment workflow run: `31872798550`

## Infrastructure acceptance

- PASS: all required PostgreSQL, Temporal, API, worker, web and ingress containers healthy.
- PASS: zero restart counts during the original authenticated acceptance snapshot.
- PASS: canonical Compose configuration validated.
- PASS: only SSH exposed on the VPS host; application ports are not host-published.
- PASS: internal API ingress `/api/health/live` returned HTTP 200 during the original authenticated acceptance pass.
- PASS: internal web ingress `/login` returned HTTP 200 during the original authenticated acceptance pass.
- PASS: Cloudflare DNS/TLS edge reachable for both staging hostnames.
- PASS: unauthenticated external requests are redirected to Cloudflare Access rather than reaching the origin directly.
- PASS: authenticated browser login, hard refresh/session persistence, logout and post-logout refresh were exercised during the original functional QA pass.

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

Both defects were fixed with regression coverage in PR #14 and merged to protected `main`. The final Stage-5 release line also includes the completed Stage-5 validation work, governed memory foundation/persistence/capture, and the Nano ID 3.3.18 security remediation. Immutable source `007e15b4ab93093b7a958150dabf1ba673c007c6` was published by workflow run `31839508796` and deployed by protected private-staging workflow run `31872798550`.

## Stage 5 performance/concurrency gate

PASS for the automated pilot-scale concurrency and disposable staging load gate.

Authoritative merge-head evidence:

- CI workflow run: `31787343847`.
- Tested head: `d93b844be7b7e03ae84fb86ebdf23d39fae851d4`.
- Artifact: `staging-load-results-31787343847`.
- 20 simultaneous budget charges contend on one allocation and may not exceed the hard cap.
- concurrent paid-research reservations contend on the workspace serialization lock and may not exceed the daily cost cap before provider dispatch.
- 20 simultaneous login-failure admissions from one source IP across distinct accounts preserve all durable increments and activate the shared IP cooldown.
- board evidence required 20 **new** completed reviews above the pre-load baseline; observed result was 20 new completions.
- the deliberately capped Etsy research contract remained capped; throughput used the uncapped synthetic `Founder-provided market notes` contract rather than weakening policy.

Observed 20-concurrent-user results from `.staging/load-results.json`:

| Workload                     | Requests |        Success |    p50 |    p95 |    Max |
| ---------------------------- | -------: | -------------: | -----: | -----: | -----: |
| API liveness                 |       20 | 20/20 HTTP 200 |  39 ms |  47 ms |  48 ms |
| Authenticated workspace read |       20 | 20/20 HTTP 200 |  67 ms |  76 ms |  76 ms |
| Board-review start           |       20 | 20/20 HTTP 201 | 202 ms | 262 ms | 271 ms |
| Research acquisition         |       20 | 20/20 HTTP 201 | 245 ms | 270 ms | 274 ms |

The load runner also observed `boardReviewsCompletedBefore=0`, `boardReviewsCompletedAfter=20`, and `boardReviewsNewlyCompleted=20`.

## Immutable publication evidence

PASS. Publication workflow run `31839508796` completed successfully for source `007e15b4ab93093b7a958150dabf1ba673c007c6`.

- full validation, source secret/IaC scan and existing staging security gate passed;
- api, web, worker, tools and ingress images each passed vulnerability/EOL/secret policy gates;
- all five images were pushed by immutable digest, keyless-signed, provenance-attested and SBOM-attested;
- artifact `ventureos-images-007e15b4ab93093b7a958150dabf1ba673c007c6` contains the five-image digest manifest;
- manifest assembly required exactly five unique digest-pinned images and completed successfully.

## Final private-staging release verification

PASS. Protected deployment workflow run `31872798550` deployed the exact published source `007e15b4ab93093b7a958150dabf1ba673c007c6`.

- publication lookup resolved successful publication run `31839508796` for the exact source SHA;
- the five-image manifest validated and each API/web/worker/tools/ingress reference was digest-pinned;
- Compose validation and image pulls passed;
- Temporal schema maintenance passed;
- application migration `20260814090000_agent_memory` applied successfully and runtime grants passed;
- Temporal, API, worker, web and both ingress containers became healthy;
- exact deployed image identity passed;
- `ventureos-current` resolved to `/home/ventureos-admin/ventureos-releases/007e15b4ab93093b7a958150dabf1ba673c007c6` after deployment;
- the deployment retained the previous release path for rollback.

### UI defect release proof

The final staging web image is identity-verified against the exact release source above. That source contains both corrected UI conditions covered by the earlier regression tests:

- Command Centre uses `COMMAND_CENTRE_STATUS_COPY`, whose text says VentureOS core workflows are available in the current environment and accurately keeps real AI, live Etsy publication, real payments and advertising gated;
- `DashboardNav` defines Workflow Centre as unavailable with `statusLabel: 'Planned'`, replacing the obsolete `Phase 2+` badge.

A second logged-in browser visual pass is **not** claimed here: Cloudflare Access intentionally prevents an unauthenticated external automation probe. Stage-5 closeout therefore relies on the authenticated functional QA already completed on private staging plus the final exact-release source, regression-test and deployed-image identity chain. This preserves a truthful evidence boundary rather than fabricating a visual verification that automation could not perform.

## Stage 5 closeout status

Stage 5 is **CLOSED — PASS**.

The closeout evidence chain is complete:

1. PASS — functional Phases 1-8 private-staging QA;
2. PASS — pilot-scale 20-concurrent-user load/concurrency gate;
3. PASS — immutable publication for source `007e15b4ab93093b7a958150dabf1ba673c007c6` via run `31839508796`;
4. PASS — protected private-staging deployment of that exact source via run `31872798550`;
5. PASS — migration, runtime grants, service health, exact image identity and current-release symlink verification;
6. PASS — corrected UI source/regression proof is part of the exact deployed web image.

No real Etsy publication, real AI provider spend, payment processing, advertising spend, or paid integration was enabled during this QA pass. Stage 6 may now begin with the prerequisites tracked in Issue #24 and `docs/COMMERCIAL_VALIDATION.md`.
