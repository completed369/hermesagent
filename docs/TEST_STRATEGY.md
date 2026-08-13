# Test Strategy

## Current automated coverage

VentureOS now has an executed, layered validation pipeline rather than a
paper-only test plan. Pull requests to `main` run the complete CI workflow in
`.github/workflows/ci.yml`.

### Unit tests

Vitest suites cover deterministic engines and pure security/business logic,
including configuration parsing, contracts, scoring, policy, finance,
security/hashing, observability, auth/RBAC, storage, agent-runtime behavior,
research sanitization/scoring/cost guards, marketplace idempotency, billing,
and focused API/worker logic.

The project intentionally puts the heaviest unit-test investment around
arithmetic and fail-closed policy logic: an agent's prose can be imperfect,
but a wrong budget, scoring, approval, or break-even calculation must not
silently pass.

### Integration tests

`pnpm test:integration` runs the real integration suites against PostgreSQL.
Coverage includes authentication, workspace isolation, opportunities,
board/approval hash binding, product/listing generation, research controls,
marketplace publication/idempotency, finance/analytics, billing, capability
policy, audit behavior, and cross-workspace denial paths.

Stage 5 adds explicit concurrency regressions:

- 20 simultaneous budget charges contend on one allocation; exactly the
  allowed charges may commit and spend may never exceed the hard limit.
- two simultaneous paid-research reservations contend on the workspace
  serialization lock; the daily cap permits exactly one reservation and
  blocks the other before provider dispatch.

These tests exist specifically to prevent check-then-charge races from
turning cost caps into advisory limits under concurrent traffic.

### End-to-end tests

Playwright (`apps/web/e2e/`) exercises the real built web/API stack. The suite
covers unauthenticated redirects, login, dashboard rendering, wrong-password
handling, navigation to audit/security pages, and Stage 5 registration/tenant
isolation.

The registration test creates a disposable unique workspace, logs in with the
new account, verifies the `Trial` plan/limits, and proves that the seeded
founder workspace's opportunity is not visible to the new tenant.

## Disposable staging security gate

The `staging-security-gate` CI job builds the production-shaped Docker staging
topology from scratch with randomly generated synthetic secrets. It verifies:

- the full migration chain and seed path;
- API/web/worker/Temporal/PostgreSQL/storage health;
- health endpoints do not create Temporal workflows;
- application E2E before and after API/worker restart;
- persistence across restart;
- API-container external network egress is unavailable;
- forbidden real-provider hostnames do not appear in runtime logs;
- expected immutable/image topology rules.

No real provider credentials, real marketplace account, payment processor, or
production data are used by this gate.

## Stage 5 load testing

`scripts/staging-load-test.mjs` runs inside the disposable staging topology
after the first E2E pass. It uses the generated synthetic founder account and
drives the actual API/Temporal worker with 20 concurrent workers.

Current workloads:

- 200 API liveness requests, concurrency 20;
- 100 authenticated workspace reads, concurrency 20;
- 20 simultaneous board-review workflow starts followed by a requirement that
  all 20 reviews reach `COMPLETED` within 120 seconds;
- 20 simultaneous research-acquisition requests.

The runner records request counts, HTTP status distributions, p50, p95, and
maximum latency to `.staging/load-results.json`. CI uploads that file as a
30-day `staging-load-results-*` artifact even when a threshold fails.

Initial pre-pilot thresholds are deliberately conservative for the expected
small pilot scale:

- API liveness p95 <= 1000 ms;
- authenticated workspace-read p95 <= 1500 ms;
- board-review start p95 <= 3000 ms;
- research-acquisition p95 <= 3000 ms;
- zero unexpected HTTP status codes;
- all 20 board reviews complete within 120 seconds.

Observed results are copied into `docs/STAGING_QA_LOG.md` after a successful
CI run so Stage 5 has durable evidence rather than only transient workflow
logs.

## Real private-staging validation

The private VPS deployment is separately validated through the protected
immutable-deployment workflow and manual/browser acceptance recorded in
`docs/STAGING_QA_LOG.md`. This proves DNS/TLS/Cloudflare Access, session
cookies, real network latency, the deployed database/Temporal stack, and
Phase 1-8 product workflows in the actual private staging environment.

A future Cloudflare Access service token can make the same browser/load checks
fully unattended against the public staging hostnames. Until such a token is
stored in the protected environment, CI deliberately does not weaken or bypass
Cloudflare Access merely to automate the last external hop.

## Mocking policy

External providers are always tested against explicit interfaces and mock
implementations unless a founder-approved real integration exists. Mock mode
must be visible in state/UI and must never be described as live provider
validation. Integration, E2E, concurrency, Docker staging, and VPS acceptance
use real local infrastructure while keeping AI/Etsy/payment/advertising
network effects disabled.
