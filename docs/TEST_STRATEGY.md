# Test Strategy

## Current-state note

This document began during the original Phase 1 sandbox authoring period, when source existed but had not yet been installed or executed. That historical state is preserved in `docs/SANDBOX_LIMITATIONS.md`. It is no longer the current repository evidence: local, GitHub CI, disposable staging-gate, and private-staging records now exist. Evidence types remain distinct; a successful local/container gate is not by itself proof of an external deployment or production readiness.

## Current automated coverage

VentureOS has an executed, layered validation pipeline. Pull requests to `main` run the complete CI workflow in `.github/workflows/ci.yml`.

### Unit tests

Vitest suites cover deterministic engines and pure security/business logic, including configuration parsing, contracts, scoring, policy, finance, security/hashing, observability, auth/RBAC, storage, agent-runtime behavior, research sanitization/scoring/cost guards, marketplace idempotency, billing, and focused API/worker logic.

The heaviest unit-test investment is intentionally around arithmetic and fail-closed policy logic: an agent's prose can be imperfect, but a wrong budget, scoring, approval, quota, tenant filter, or break-even calculation must not silently pass.

### Integration tests

`pnpm test:integration` runs the real integration suites against PostgreSQL. Coverage includes authentication, workspace isolation, opportunities, board/approval hash binding, product/listing generation, research controls, marketplace publication/idempotency, finance/analytics, billing, capability policy, audit behavior, and cross-workspace denial paths.

Stage 5 adds explicit pilot-scale concurrency regressions:

- 20 simultaneous budget charges contend on one allocation; exactly the allowed charges may commit and spend may never exceed the hard limit.
- simultaneous paid-research reservations contend on the workspace serialization lock; the daily cap admits only the permitted reservation before provider dispatch.
- 20 simultaneous login-failure admissions from one source IP across distinct account identifiers preserve all durable counter increments and activate the shared source-IP cooldown; separate auth-abuse tests also verify the account threshold, cooldown expiry, and cross-instance durability.

These tests exist specifically to prevent check-then-charge and check-then-block races from turning cost/security controls into advisory limits under load.

### End-to-end tests

Playwright (`apps/web/e2e/`) exercises the real built web/API stack. The suite covers unauthenticated redirects, login, dashboard rendering, wrong-password handling, navigation to audit/security pages, and Stage 5 registration/tenant isolation.

The registration test creates a disposable unique workspace, logs in with the new account, verifies the `Trial` plan/limits, and proves that the seeded founder workspace's opportunity is not visible to the new tenant.

### Build and artifact checks

Turbo/TypeScript/Next/Nest/worker builds run in clean CI together with scripts that assert expected entrypoints/artifacts exist and stale local build state has not masked a broken build.

## Disposable staging security gate

The `staging-security-gate` CI job builds the production-shaped Docker staging topology from scratch with randomly generated synthetic secrets. It verifies:

- the full migration chain and seed path;
- API/web/worker/Temporal/PostgreSQL/storage health;
- health endpoints do not create Temporal workflows;
- application E2E before and after API/worker restart;
- persistence across restart;
- API-container external network egress is unavailable;
- forbidden real-provider hostnames do not appear in runtime logs;
- expected immutable/image topology rules.

No real provider credentials, real marketplace account, payment processor, or production data are used by this gate. This is local/container staging evidence, not an external deployment or production-readiness claim.

## Stage 5 load testing

The committed workload is `load-tests/staging.mjs`. It runs inside the disposable production-shaped staging topology after the first E2E pass and uses the generated synthetic founder account to drive the actual API/Temporal worker.

The gate first waits one configured global API-rate-limit window because all localhost synthetic traffic intentionally shares one limiter key when proxy trust is disabled. This isolates the measured workload from setup/E2E traffic without weakening or bypassing the real limiter. Cookie-authenticated unsafe requests send the configured web origin, matching the browser's global CSRF-origin boundary rather than bypassing it.

Current workloads are one pilot-scale wave each:

- 20 API liveness requests at concurrency 20;
- 20 authenticated workspace reads at concurrency 20;
- 20 simultaneous board-review workflow starts, followed by a requirement that 20 **new** reviews above the pre-test baseline reach `COMPLETED` within 120 seconds;
- 20 simultaneous research-acquisition requests against the seeded uncapped synthetic founder-notes contract.

The deliberately capped Etsy research contract is not weakened to make the throughput workload pass. Contract-level research cost/rate-cap behavior is proved separately by the concurrency integration tests described above.

The runner records request counts, HTTP status distributions, p50, p95, maximum latency, board-review completion deltas, and the chosen research contract in `.staging/load-results.json`. CI uploads that file as a 30-day `staging-load-results-*` artifact, including when a threshold fails after the report has been written.

Initial pre-pilot thresholds are deliberately conservative for the expected small pilot scale:

- API liveness p95 <= 1000 ms;
- authenticated workspace-read p95 <= 1500 ms;
- board-review start p95 <= 3000 ms;
- research-acquisition p95 <= 3000 ms;
- zero unexpected HTTP status codes;
- 20 new board reviews complete within 120 seconds.

Observed successful results are copied into `docs/STAGING_QA_LOG.md` so Stage 5 has durable repository evidence rather than only transient workflow logs.

## Real private-staging validation

The private VPS deployment is separately validated through the protected immutable-deployment workflow and manual/browser acceptance recorded in `docs/STAGING_QA_LOG.md`. This proves DNS/TLS/Cloudflare Access, session cookies, real network latency, the deployed database/Temporal stack, and Phase 1-8 product workflows in the actual private staging environment for the recorded deployed SHA.

A future Cloudflare Access service token can make the same browser/load checks fully unattended against the public staging hostnames. Until such a token is stored in the protected environment, CI deliberately does not weaken or bypass Cloudflare Access merely to automate the last external hop.

## Mocking policy

External providers are always tested against explicit interfaces and controlled mocks unless a founder-approved real integration exists. Unit tests must not depend on Docker, public network access, real AI providers, Etsy, payment processors, email, advertising, or customer data. Mock mode must be visible in state/UI and must never be described as live-provider validation.

Integration, E2E, concurrency, Docker staging, and VPS acceptance use real local/private infrastructure while keeping AI/Etsy/payment/advertising network effects disabled unless the founder separately approves a live-provider test scope.

## CI and validation evidence split

- Local developer commands provide evidence for the working copy on that machine and environment.
- GitHub CI provides clean-runner evidence for the checked-out ref/run.
- The disposable staging gate provides local/container production-mode and fail-closed mock-boundary evidence.
- Protected private-staging deployment plus browser/VPS acceptance provides external staging evidence for the recorded deployed SHA.
- Production readiness and production deployment require separate evidence and founder authorization.

See `docs/CI_GOVERNANCE.md`, `docs/TECHNICAL_RELEASE_BASELINE.md`, `docs/APPLICATION_SECURITY_BASELINE.md`, `docs/STAGING_SECURITY_GATE.md`, and `docs/STAGING_QA_LOG.md` for recorded evidence and gates.

## What remains outside current test evidence

Current repository evidence does not establish live AI-provider execution, live Etsy publication, real payment processing, advertising spend, customer-facing external communication, production backup/restore, production monitoring/alerting, or a production deployment. Those require separate founder-approved scopes and evidence.
