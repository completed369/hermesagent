# Test Strategy

## Current-state note

This document began during the original Phase 1 sandbox authoring period, when
source existed but had not yet been installed or executed. That historical state
is preserved in `docs/SANDBOX_LIMITATIONS.md`. It is no longer the current
repository evidence: later baseline documents record local and GitHub validation
runs. This file describes the intended and configured test strategy without
claiming that a command was rerun during this documentation-only reconciliation.

## Test pyramid

Deterministic engines and policy boundaries get the heaviest unit-test
investment because they are the arithmetic and authorization logic the founder
must be able to trust completely. An AI agent's prose can be wrong without
silently changing system state; a wrong break-even calculation, approval gate,
quota check, or tenant filter must not silently pass review.

The repository uses these layers:

1. **Unit tests** — fast Vitest/node tests for contracts, finance/scoring,
   policy, security, auth helpers, provider-boundary policy, billing, research,
   marketplace mock/idempotency logic, storage validation, observability, worker
   activity policy, and build/entrypoint contracts.
2. **Integration tests** — database-backed tests against disposable PostgreSQL,
   primarily through API/service boundaries, covering authentication, abuse
   controls, opportunities, board/approval, product/listing, research,
   marketplace, finance, subscription/provider enforcement, and workspace
   isolation paths.
3. **Application E2E** — Playwright Chromium tests exercise built API/web
   startup, login, dashboard navigation, and browser-visible application flows
   using synthetic credentials and mock/disabled providers.
4. **Build and artifact checks** — Turbo/TypeScript/Next/Nest/worker builds plus
   scripts that assert expected entrypoints/artifacts exist and stale local build
   state has not masked a broken build.
5. **Local/container staging security gate** — `docker-compose.staging.yml` and
   `scripts/staging-security-gate.sh all` provide evidence for a production-mode,
   mock-only, loopback/container staging topology locally. This is not an
   external staging deployment or production-readiness claim.

## Mocking policy

External providers are tested through interfaces and controlled mocks rather
than real network calls. Unit tests must not depend on Docker, public network
access, real AI providers, Etsy, payment processors, email, advertising, or
customer data.

Integration, E2E, and staging-gate tests may require disposable local
infrastructure such as PostgreSQL, Temporal, and containerized services. They
must continue to use synthetic credentials and mock/disabled provider modes
unless the founder separately approves a live-provider test scope.

## CI and local validation split

Local development validation, GitHub CI, and the local/container staging gate are
different evidence types:

- Local developer commands provide evidence for the working copy on a developer
  machine under that environment.
- GitHub CI provides clean-runner evidence for the configured workflow at the
  checked-out ref/run.
- The local/container staging gate provides evidence for the repository's local
  production-mode container topology and fail-closed mock boundary.
- Private-staging deployment templates/workflows are configured capability; they
  do not by themselves prove the current operational state of an externally
  deployed staging environment.
- Production deployment state and production readiness require separate evidence
  and founder approval.

See `docs/CI_GOVERNANCE.md`, `docs/TECHNICAL_RELEASE_BASELINE.md`,
`docs/APPLICATION_SECURITY_BASELINE.md`, and `docs/STAGING_SECURITY_GATE.md` for
recorded evidence and gates.

## What remains outside current test evidence

Current repository evidence does not establish live AI-provider execution, live
Etsy publication, real payment processing, advertising spend, customer-facing
external communication, production MinIO/Temporal operation, production
backup/restore, production monitoring/alerting, or externally verified staging
or production deployment state. Those require separate founder-approved scopes
and evidence.
