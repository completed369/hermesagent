# Application Security Baseline — Phase 10

Date: 2026-07-30

## Provenance and scope

- Parent commit: `fe652af01f14737e37d8acc6a10f6c36a91323f8`
- Branch: `feat/phase10-security-hardening`
- External technical baseline reference: GitHub Actions run `30538646314`
- Scope: authentication, sessions, request security, authorization, workspace
  isolation, input/query/output boundaries, audit behavior, dependencies,
  repository secrets, test/mock boundaries, and paid/live feature gates.
- Environment: local disposable PostgreSQL 16 using synthetic credentials and
  mock providers only. No production environment or real provider was used.

This record is not a claim that VentureOS is production secure. The dependency
and repository-administration gates below remain open.

## Security model observed

- Passwords use salted scrypt and constant-time verification.
- Authentication uses an opaque 32-byte random session token in an httpOnly,
  `sameSite=lax` cookie; `secure` is enabled when `NODE_ENV=production`.
- The database stores only a deterministic SHA-256 token digest and all session
  lookups/revocations digest incoming raw tokens first.
- A global CSRF guard allows safe methods (`GET`, `HEAD`, `OPTIONS`) and
  cookie-less public authentication requests. Every cookie-authenticated unsafe
  method requires an exact `Origin` match with `API_CORS_ORIGIN`.
- Sensitive controllers use server-side session and permission guards. Founder
  decisions are rechecked in deterministic backend services and queries are
  scoped by the server-derived workspace ID.
- Request bodies are Zod-validated. Prisma parameterized APIs are used; the only
  raw query found is a constant `SELECT 1` health probe.
- React escaping is retained and no `dangerouslySetInnerHTML`, command-execution,
  insecure-deserialization, path-traversal, or user-controlled SSRF sink was
  reproduced.
- Storage helpers validate MIME type, size, and object keys; no multipart HTTP
  upload endpoint is currently exposed.
- Real marketplace writes, payments, advertising, and AI calls are absent from
  the implemented runtime paths: those paths invoke hardcoded mocks. The
  declared global feature flags are not yet consumed by runtime code and must
  not be treated as effective kill switches for a future real provider.

## Findings

### Critical

1. **C-01 — Open development-tool dependency advisory (unfixed).** The complete
   `pnpm audit --audit-level=high --json` reports one Critical advisory for
   direct dev dependency `vitest@2.1.9`: arbitrary file read/execution when the
   Vitest UI server is listening. Repository scripts use non-listening
   `vitest run`, so it is not reachable in the deployed application or the
   validated CI/test path. The published fix requires `vitest>=3.2.6`, a major
   upgrade across the workspace. It was not forced into this bounded changeset.
   It does not by itself block a runtime-only staging deployment, but it keeps
   the complete dependency gate and Critical-open flag red.

2. **C-02 — Repository-known founder seed credential (fixed locally).**
   - Before: `pnpm db:seed` silently fell back to the public
     `founder@ventureos.local` / `change-me-dev-only` credential and assigned
     that account every permission.
   - Risk: any reachable environment seeded without explicit overrides exposed
     a known fully privileged login.
   - Fix: fixture seeding now refuses production, missing credentials, and the
     repository placeholder. No database access occurs before credential
     validation.
   - Tests: four red/green unit cases cover missing values, the known
     placeholder, production refusal, and explicit synthetic credentials; the
     fresh disposable database seed also passed with explicit values.

### High

1. **H-01 — Plaintext-at-rest session bearer tokens (fixed locally).**
   - Before: `Session.sessionToken` stored the raw cookie value; login,
     authentication, and logout queried that raw value.
   - Risk: read access to the session table immediately yielded reusable bearer
     tokens until expiry/revocation.
   - Preconditions: database read exposure plus network access to the API.
   - Affected before: `packages/database/prisma/schema.prisma`,
     `apps/api/src/modules/auth/auth.service.ts`, and
     `apps/api/src/common/guards/session-auth.guard.ts`.
   - Fix: raw tokens exist only at creation/cookie delivery; SHA-256 digests are
     persisted and used for lookup/revocation. Logout no longer suppresses a DB
     revocation failure. The tenth migration hashes existing rows in place and
     renames the unique index without invalidating sessions.
   - Tests: auth unit digest/entropy tests; real-PostgreSQL integration proof
     that raw lookup fails and digest lookup authenticates; migration-compat
     proof for a pre-existing raw-token row.

2. **H-02 — Missing server-side CSRF enforcement for authenticated mutations
   (fixed locally).**
   - Before: cookie authentication relied only on `sameSite=lax` and CORS. A
     malicious same-site sibling origin could submit credentialed unsafe
     requests, and CORS alone does not prevent such requests from being sent.
   - Preconditions: an authenticated victim and attacker-controlled same-site
     origin or another condition causing the browser to attach the cookie.
   - Affected before: all cookie-authenticated state-changing API routes;
     bootstrap was `apps/api/src/app.module.ts`.
   - Fix: global exact-origin guard for cookie-authenticated unsafe methods.
     Safe methods and cookie-less login/register calls are intentionally exempt.
   - Tests: five positive/negative unit cases and real HTTP integration proof
     that logout without Origin returns 403 without revocation while the trusted
     origin succeeds and revokes the session.

3. **H-03 — Tenant disclosure of unscoped security events (fixed locally).**
   - Before: a workspace security-event query included every event whose
     `workspaceId` was null. Global login telemetry includes attempted email,
     IP address, and user agent, so any tenant with `audit:view` could retrieve
     cross-tenant authentication metadata.
   - Fix: tenant queries now select only the server-derived workspace ID.
     Unscoped platform telemetry is not exposed through this tenant endpoint.
   - Test: a red/green service regression proves the Prisma query cannot include
     `workspaceId: null`.

4. **H-04 — Cross-experiment metric/result injection (fixed locally).**
   - Before: result recording scoped the variant to a workspace but accepted an
     independently valid metric ID and did not bind either ID to the route
     experiment. This allowed cross-tenant metric corruption if another UUID
     was known, and same-workspace cross-experiment injection.
   - Fix: the caller must pass the route experiment ID; the variant must belong
     to that experiment/workspace and the metric must belong to the same
     experiment before a result is created.
   - Tests: two red/green package regressions cover foreign metrics and a variant
     from a different route experiment. Existing finance integration tests pass.

5. **H-05 — Production dependency audit remains red (unfixed; staging
   blocker).** `pnpm audit --prod --audit-level=high --json` exits 1 with 42
   advisories: 18 High, 21 Moderate, and 3 Low across 365 production dependency
   nodes. High packages are `next` (8), `multer` (4), `postcss` (2),
   `fast-uri` (1), `fast-xml-parser` (1), `js-yaml` (1), and `lodash` (1).
   - Direct runtime exposure: `next@14.2.35` is used by the public web app. The
     audit's complete fix floor is `next>=15.5.21`, a major upgrade requiring a
     dedicated compatibility changeset and lockfile update.
   - Transitive/reachability constraints: no multipart API endpoint was found
     for Multer; PostCSS and Swagger YAML/Lodash paths process repository-owned
     build/startup input; fast-xml-parser is reached through the configured
     storage client and requires a malicious XML response; fast-uri is
     transitive through schema tooling. These constraints reduce several paths
     but do not make the audit gate green.
   - Non-breaking patches exist for several transitive packages, but resolving
     them safely requires owner-package upgrades or reviewed overrides and a
     lockfile change. No force-upgrade or lockfile change was made here.

6. **H-06 — Public authentication lacks distributed/account-specific abuse
   control (unfixed; staging blocker).** Login and registration are protected
   only by the process-local global limiter. Existing-user failures execute
   synchronous scrypt while missing-user failures skip it, enabling timing
   enumeration and distributed password/KDF pressure. A correct fix requires a
   shared limiter keyed by normalized account and trusted client IP, explicit
   proxy policy, dummy-hash verification, and moving KDF work off the event
   loop; a partial in-process decorator was not presented as remediation.

7. **H-07 — Public Temporal health probe starts workflows (unfixed; staging
   blocker when Temporal is connected).** Every unauthenticated
   `GET /api/health/temporal` starts and awaits a uniquely named workflow. The
   global per-IP limiter does not prevent distributed workflow/history/worker
   exhaustion. Replace it with a bounded non-mutating connectivity probe or an
   authenticated internal-only diagnostic before exposing staging.

8. **H-08 — Subscription and global provider flags are not enforcement gates
   (unfixed; commercial blocker).** Plan-limit helpers and subscription
   status/expiry checks have no feature-path callers. Declared live publishing,
   advertising, paid-integration, and development-login flags are not consumed
   by runtime code. Current external-call safety comes from hardcoded mock-only
   implementations, not those flags. Entitlement checks and fail-closed provider
   dispatch must be wired before commercial or real-provider staging.

### Medium

1. MFA and account recovery are not implemented. No complete scaffolding exists;
   both remain explicitly deferred rather than partially implemented.
2. Registration explicitly reports duplicate email; account recovery remains
   absent.
3. API/web security headers are partial. Frame, MIME-sniffing, and referrer
   controls exist on the web, but no reviewed CSP/HSTS/Permissions-Policy
   baseline exists for a real deployment.
4. Append-only application audit writing and integrity hashes exist, but DB-role
   immutability and production retention/access policy are not configured.
5. Repository-level GitHub secret scanning and push protection could not be
   confirmed locally. CI has least-privilege permissions and Dependabot, but no
   secret-scan/SAST gate is present in the inspected workflow.
6. Approval decisions read `PENDING` before their transaction and perform an
   unconditional update. Concurrent decisions can both succeed and create
   contradictory decision rows. Current side effects are mock-only, but this
   becomes High before any real publication/spend action is connected.
7. License keys are stored, returned, and included in audit payloads as bearer
   values rather than hash/fingerprint-only records.

### Low

1. CSRF is intentionally single-origin. A future multi-origin client requires a
   reviewed allowlist or synchronizer-token design rather than weakening the
   exact-origin comparison.
2. Expired/revoked session rows are rejected correctly but no retention cleanup
   job was found.

### Informational / not reproduced

- CORS is credentialed and configured from one origin; no broad hardcoded
  wildcard was found.
- Controller RBAC, founder decision checks, Prisma query parameterization, body
  validation, output escaping, storage-key validation, and safe client error
  filtering showed no additional reproducible Critical/High bypass after the
  workspace/result fixes above.
- No raw session token logging was found.
- No real secret was detected by the tracked-file/proposed-diff scan.

## Dependency audit outcome

- Complete command: `pnpm audit --audit-level=high --json`
  - Exit 1; 59 total advisories: 1 Critical, 26 High, 26 Moderate, 6 Low.
  - Direct Critical: Vitest development tooling; fixed only by a major upgrade.
- Production command: `pnpm audit --prod --audit-level=high --json`
  - Exit 1; 42 total advisories: 18 High, 21 Moderate, 3 Low.
  - Direct High runtime package: Next.js; complete published remediation requires
    a major upgrade from 14.2.35 to at least 15.5.21.
- The lockfile was not changed. No `--force` upgrade was run.

## Secret and repository protection review

A value-redacting local scanner enumerated 413 tracked and nine untracked
proposed files, then inspected 404 eligible UTF-8 text files after excluding the
lockfile and generated outputs. It separately inspected added diff lines for
private keys and common provider/token/password patterns. Result: zero
review-required findings; one tracked synthetic fixture was classified as a
placeholder/reference; zero proposed-diff findings. This is local evidence, not
confirmation of GitHub Advanced Security settings. Required repository
administrative protections remain: secret scanning, push protection, protected
main branch, required passing CI, and least-privilege workflow permissions.

## Validation evidence

Executed with `TURBO_FORCE=true` where Turbo supports cache bypass and with
synthetic local credentials:

1. `pnpm install --frozen-lockfile --prefer-offline` — PASS; lockfile unchanged.
2. `pnpm db:generate` — PASS.
3. `pnpm --filter @ventureos/database exec dotenv -e ../../.env -- prisma format --check --schema prisma/schema.prisma` — PASS.
4. `pnpm --filter @ventureos/database exec dotenv -e ../../.env -- prisma validate --schema prisma/schema.prisma` — PASS.
5. Disposable `postgres:16-alpine` on loopback with tmpfs storage — PASS.
6. `pnpm db:migrate` — PASS; all ten migrations applied fresh.
7. `pnpm db:seed` — PASS with synthetic founder credentials and mock-only flags.
8. Existing-row migration compatibility probe — PASS; raw token became the
   expected 64-character digest and remained lookup-compatible.
9. `pnpm --filter @ventureos/auth test:unit` — PASS; 8 tests.
10. `pnpm --filter @ventureos/database test:unit` — PASS; 16 tests.
11. `pnpm --filter @ventureos/finance-engine test:unit` — PASS; 20 tests.
12. `pnpm --filter @ventureos/api test:unit` — PASS; 37 tests.
13. `pnpm --filter @ventureos/api test:integration` — PASS; 58 tests.
14. `TURBO_FORCE=true; pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/run-validation.ps1` — PASS: format, lint, typecheck, 203 unit tests in 41 files, 58 integration tests, and production build.
15. Direct Playwright run after a clean sequential API build — PASS; 4 tests.
    The root Turbo E2E task remains orchestration-defective: its concurrent build
    can report API success while deleting/omitting `dist/main.js`. The direct run
    verified the real API entrypoint and exercised both servers.
16. `pnpm audit --prod --audit-level=high --json` — FAIL (open dependency gate).
17. `pnpm audit --audit-level=high --json` — FAIL (open dependency gate).
18. Value-redacting tracked-file and proposed-diff secret scan — PASS.
19. `git diff --check` — PASS before final cleanup/review.

No real AI, marketplace, payment, email, advertising, storage, customer, or
production account was contacted.

## Residual risks and staging blockers

- Production and complete dependency audits remain red.
- The direct Next.js High advisories require compatibility-tested remediation.
- The direct Vitest Critical development-tool advisory requires a coordinated
  workspace test-runner upgrade.
- MFA and account recovery remain deferred product/security work.
- Login/registration abuse controls and timing equalization remain open.
- The Temporal health route must stop creating workflows before public staging.
- Subscription enforcement and provider kill switches are not wired.
- Approval decisions require an atomic single-writer transition before real
  side effects are enabled.
- GitHub secret scanning/push protection and branch protections require owner
  verification in repository settings.

## Readiness flags

`APPLICATION_SECURITY_BASELINE_READY=False`

`CRITICAL_SECURITY_FINDINGS_OPEN=True`

`HIGH_SECURITY_FINDINGS_OPEN=True`

`STAGING_SECURITY_GATE_READY=False`

`PRODUCTION_DEPLOYMENT_READY=False`

`COMMERCIAL_LAUNCH_READY=False`
