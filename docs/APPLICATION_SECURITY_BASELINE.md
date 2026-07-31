# Application Security Baseline — Phase 10

Date: 2026-08-01

## Provenance and scope

- Parent commit: `2ebdadd692b59ae10509522f48ce5b1018097cf5`
- Branch: `security/phase10-dependency-remediation`
- External technical baseline reference: GitHub Actions run `30538646314`
- Scope: authentication, sessions, request security, authorization, workspace
  isolation, input/query/output boundaries, audit behavior, dependencies,
  repository secrets, test/mock boundaries, and paid/live feature gates.
- Environment: local disposable PostgreSQL 16 using synthetic credentials and
  mock providers only. No production environment or real provider was used.

This record is not a claim that VentureOS is production secure. The Critical
and High dependency gates are closed for the validated lockfile, but the
application and repository-administration blockers below remain open.

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

1. **C-01 — Development-tool dependency advisory (fixed).** The complete audit
   previously reported GHSA-9crc-q9x8-hgqq against direct dev dependency
   `vitest@2.1.9`. Every workspace declaration was upgraded from `^2.1.3` to
   `^3.2.6`, resolving to `vitest@3.2.7` with `vite@6.4.3`. No Vitest
   configuration, mock, coverage, test-discovery, skip, or assertion change was
   required. The full 208-test unit suite and all five build-contract tests pass.

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

5. **H-05 — Production dependency audit (fixed).** The initial production audit
   reported 18 High, 21 Moderate, and 3 Low findings. The compatibility-tested
   remediation upgraded Next.js to 15.5.22, the coordinated NestJS/Express
   family to Nest 11.1.28 and Express 5.2.1, and patched reachable transitive
   packages. The final production and complete audits both exit zero with no
   finding at any severity. Detailed roots and compatibility evidence are below.

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

### Before

- Production: 42 findings — 18 High, 21 Moderate, 3 Low.
- Complete: 59 findings — 1 Critical, 26 High, 26 Moderate, 6 Low.
- Reachable runtime High findings included the public Next.js application. Other
  production paths included Nest platform/Multer, Swagger YAML/Lodash, MinIO XML,
  Temporal brace expansion, PostCSS, and schema URI processing. The Vitest
  Critical finding was development-only and not reachable in deployed runtime.

### Remediation roots

- **Next.js:** `next` 14.2.35 -> 15.5.22 and `eslint-config-next` 14.2.15 ->
  15.5.22 resolved GHSA-9g9p-9gw9-jx7f, GHSA-f82v-jwr5-mffw,
  GHSA-g5qg-72qw-gw5v, GHSA-h25m-26qc-wcjf, GHSA-mwv6-3258-q52c,
  GHSA-p5wg-g6qr-c7cg, GHSA-qpjv-v59x-3qc4, GHSA-vf9p-x7vx-q6p9,
  GHSA-3h52-269p-cp9r, GHSA-gv2c-59w2-j3r8, GHSA-5j59-xgg2-r9c4,
  GHSA-ggv3-7p47-pfv8, GHSA-4342-x723-ch2f, GHSA-j3hg-5p4h-vf9q, and
  GHSA-mq59-m269-xvcx.
- **NestJS/Express:** coordinated upgrades to Nest 11.1.28, Swagger 11.4.6,
  Express 5.2.1, Nest CLI 11.0.24, Nest testing 11.1.28, and Express 5 typings
  resolved the platform/Multer/Lodash/js-yaml parent paths. Multer resolved to
  2.2.0. Addressed advisories include GHSA-44fp-w29j-9vj5,
  GHSA-4pg4-qvpc-4h7c, GHSA-g5wq-j36m-2p46, GHSA-j2f9-p6j9-4r5q,
  GHSA-fjgf-rc76-4x9p, GHSA-xxjr-mmjv-4gpg, and GHSA-86r5-2q66-6m8q.
- **Vitest/Vite:** all 18 workspace Vitest declarations moved from `^2.1.3`
  (resolved 2.1.9) to `^3.2.6` (resolved 3.2.7); Vite resolves to 6.4.3.
  This resolves GHSA-9crc-q9x8-hgqq and the Vite High advisories
  GHSA-g4jq-h2w9-997c, GHSA-93m4-6634-74q7, GHSA-jqfw-vq24-v9c3,
  GHSA-67mh-4wv8-2f99, and GHSA-g9pc-8g42-g6vq.
- **Targeted transitive patches:** `fast-uri` 3.1.3 -> 3.1.5,
  `fast-xml-parser` 5.10.0 -> 5.10.1, and `brace-expansion` 1.1.16/2.1.2/5.0.7
  -> 1.1.18/2.1.4/5.0.9 resolved GHSA-8ghp-88xm-4h5r,
  GHSA-jmr7-xgp7-cmfj, GHSA-v6h2-p8h4-qcjw, GHSA-7h2j-9565-4h9v, and
  GHSA-832h-xg76-4gv6.
- **Exact vulnerable-child replacements:** reviewed pnpm overrides replace
  `js-yaml` with 5.2.2, `postcss` with 8.5.18, `sharp` with 0.35.0, and `vite`
  with 6.4.3. These replace vulnerable code retained by exact/incompatible
  parent ranges; they do not suppress audit output. They resolve
  GHSA-2g4f-4pwh-qvx6, GHSA-q7g4-2pjw-v29r, GHSA-566m-qj78-rww5, and
  GHSA-4h9g-4w22-8q66 in addition to the Vite advisories above.

### Compatibility evidence

- Next 15 asynchronous request APIs are handled by awaiting `cookies()` and
  dynamic route `params`; internal dashboard anchors were migrated to
  `next/link`. The generated Next type reference was retained.
- Nest 11 uses the named `{*path}` middleware catch-all and emits no legacy
  route-conversion warning. No controller contract or permission behavior was
  relaxed.
- Vitest required no config, mock, coverage, environment, or discovery change.
- Node 24.18.0 was used; all selected packages support the repository's declared
  Node >=22 floor. Prisma 5.22.0, TypeScript 5.9.3, Playwright 1.61.1, Turbo
  2.10.4, and pnpm 9.12.0 remained compatible.

### After

- `pnpm audit --prod --audit-level=high --json`: exit 0; 0 Critical, 0 High,
  0 Moderate, 0 Low.
- `pnpm audit --audit-level=high --json`: exit 0; 0 Critical, 0 High,
  0 Moderate, 0 Low.
- Residual dependency advisories: none. Reachable residual Critical/High: none.
- No force-upgrade, advisory suppression, ignored finding, or unrelated package
  refresh was used.

## Secret and repository protection review

A value-redacting local scanner enumerated 425 tracked/proposed files and
inspected 403 eligible UTF-8 text files after excluding the lockfile and
generated outputs. It separately inspected added diff lines for private keys and
common provider/token/password patterns. Result: zero review-required findings;
two tracked synthetic fixture/documentation examples classified as placeholders;
zero proposed-diff findings. This is local evidence, not confirmation of GitHub
Advanced Security settings. Required repository administrative protections
remain: secret scanning, push protection, protected main branch, required
passing CI, and least-privilege workflow permissions.

## Validation evidence

Executed with a fresh disposable PostgreSQL 16 database, synthetic credentials,
mock providers, and live/paid flags disabled:

1. `pnpm install --frozen-lockfile` — PASS with pnpm 9.12.0.
2. `pnpm run format:check` — PASS.
3. `pnpm run lint` — PASS, 17/17 tasks.
4. `pnpm run typecheck` — PASS, 36/36 tasks.
5. `pnpm run db:generate` — PASS, Prisma Client 5.22.0.
6. Prisma format check and validate — PASS.
7. `pnpm run db:migrate` — PASS; all ten migrations applied fresh.
8. `pnpm run db:seed` — PASS with explicit synthetic credentials.
9. `node --test scripts/api-build-contract.test.mjs` — PASS, 5/5.
10. `pnpm run test:unit` — PASS, 208/208 application tests plus 5/5 build
    contracts; 18/18 Turbo test tasks.
11. `pnpm run test:integration` — PASS, 58/58; 17/17 Turbo tasks.
12. Clean-state root `pnpm run test:e2e` — PASS: build 20/20, E2E 4/4.
13. Reused-state root `pnpm run test:e2e` — PASS: build 20/20, E2E 4/4.
14. Immediate repeated root `pnpm run test:e2e` — PASS: build 20/20, E2E 4/4.
15. Separate `pnpm run build` — PASS, 20/20.
16. `node scripts/assert-api-entrypoint.mjs` — PASS; non-empty `dist/main.js`
    verified at 2,377 bytes before cleanup.
17. Production and complete audits — PASS with zero findings at every severity.
18. Value-redacting tracked/proposed-file and added-diff secret scan — PASS.
19. `git diff --check` — PASS.
20. Cleanup — PASS; app build outputs and disposable database removed.
21. Final port check — PASS; 3000, 3001, and 5432 closed.

No real AI, marketplace, payment, email, advertising, storage, customer, or
production account was contacted.

## Residual risks and staging blockers

- The dependency Critical/High gates are closed for the validated lockfile, but
  audits must remain required on future lockfile changes.
- MFA and account recovery remain deferred product/security work.
- Login/registration abuse controls and timing equalization remain open.
- The Temporal health route must stop creating workflows before public staging.
- Subscription enforcement and provider kill switches are not wired.
- Approval decisions require an atomic single-writer transition before real
  side effects are enabled.
- GitHub secret scanning/push protection and branch protections require owner
  verification in repository settings.

## Readiness flags

`APPLICATION_SECURITY_BASELINE_READY=True`

`CRITICAL_SECURITY_FINDINGS_OPEN=False`

`HIGH_SECURITY_FINDINGS_OPEN=True`

`STAGING_SECURITY_GATE_READY=False`

`PRODUCTION_DEPLOYMENT_READY=False`

`COMMERCIAL_LAUNCH_READY=False`
