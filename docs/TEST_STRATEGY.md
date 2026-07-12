# Test Strategy

## What exists (written, not yet executed — see SANDBOX_LIMITATIONS.md)

**Unit tests** (Vitest), one file per module, colocated in `__tests__/`:
env validation (`@ventureos/config`), agent output contract + approval
validity (`@ventureos/contracts`), finance calculations
(`@ventureos/finance-engine`), opportunity/profit-confidence scoring
(`@ventureos/scoring-engine`), board voting + core policies
(`@ventureos/policy-engine`), hashing + secret redaction
(`@ventureos/security`), structured logging + audit record building
(`@ventureos/observability`), password hashing + RBAC
(`@ventureos/auth`), storage validation (`@ventureos/integrations`),
PermissionGuard (`apps/api`), a Temporal activity (`apps/worker`).

**Integration tests** (Vitest + Supertest, `apps/api/test/`): full auth flow
against a real Nest app + real Postgres — rejects unauthenticated access,
rejects wrong password, logs in and reads `/auth/me`.

**End-to-end test** (Playwright, `apps/web/e2e/`): unauthenticated redirect
to `/login`, successful login → Command Centre, wrong-password error
display, navigation to Audit/Security pages.

## Test pyramid intent

Deterministic engines (finance/scoring/policy) get the heaviest unit-test
investment because they are the arithmetic/logic the founder must be able
to trust completely — an AI agent's prose can be wrong without breaking the
business; a wrong break-even calculation cannot silently pass review.

## Mocking policy

External providers are always tested against an interface + mock (e.g.
`MockStorageProvider`), never a real network call, so unit tests never
depend on Docker/network. Integration and e2e tests are explicitly the
layer that requires real infrastructure and are documented as such rather
than faked.

## What's NOT covered yet

Security tests (approval bypass, cross-workspace access, prompt injection,
malicious evidence, rate-limit behavior) listed in master spec section 31
require features (approvals, agents, evidence) that don't exist until
Phase 3/5. Workflow tests beyond the one Temporal connectivity check need
the real Opportunity-to-Product workflow (Phase 3+).
