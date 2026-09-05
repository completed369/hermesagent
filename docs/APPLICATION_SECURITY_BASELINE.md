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

### Phase 14 subscription/provider enforcement amendment

- Branch: `security/phase14-subscription-provider-enforcement`
- Required base: `3ca9cb821b19af32345ffbcbe0fc02829806a712`
- Validation date: 2026-08-02
- Environment: disposable PostgreSQL 16 on a non-default local port, synthetic
  credentials, and explicit mock provider modes. No real provider was contacted.
- Post-remediation evidence: the canonical clean-output suite passed format,
  lint, typecheck, unit, disposable-PostgreSQL integration, and production build;
  root Playwright passed 4/4; and the focused denial/replay/concurrency matrix
  passed ten consecutive times with retries disabled. Independent exact-tree
  review remains a separate release gate.
- Scope: deterministic fail-closed subscription status, trial expiry, active
  plan, feature, quota, provider mode, global switch, audit, queued-work, direct
  runner, and implemented final-dispatch enforcement.

This amendment does not establish production readiness. Live commercial
providers remain absent, marketplace `Integration.writeEnabled` still requires
its own final-boundary enforcement before a real adapter is introduced, and
production MinIO/Temporal connectivity was not exercised.

### PostCSS advisory amendment — 2026-08-20

- A fresh production and complete lockfile audit identified the newly disclosed
  moderate path-disclosure advisory `CVE-2026-69153` /
  `GHSA-fxqj-rqcc-2cmp` in the prior `postcss@8.5.18` override.
- The focused remediation updates only that override to `postcss@8.5.26`, above
  the advisory's fixed floor of `8.5.23`, and regenerates the frozen lockfile.
- After the update, both production and complete dependency audits report no
  known vulnerabilities. Application and CI evidence for the repair belongs to
  its exact pull-request head and does not establish a deployment.

### Decode URI component advisory amendment — 2026-09-01

- A fresh production and complete lockfile audit identified the newly disclosed
  moderate CPU denial-of-service advisory `CVE-2026-45822` /
  `GHSA-vcc3-ghjq-m6fr` in `decode-uri-component@0.2.2` through the production
  `minio@8.0.7` -> `query-string@7.1.3` dependency path.
- The focused remediation uses the existing reviewed pnpm override mechanism to
  select patched `decode-uri-component@0.5.0`; no parent package, provider mode,
  runtime configuration, or application behavior is changed.
- After the update, both production and complete dependency audits report no
  known vulnerabilities. A repository contract binds the override and lockfile
  resolution so a future refresh cannot silently restore the vulnerable child.

### MinIO notification parser advisory amendment — 2026-09-05

- GitHub reported `CVE-2026-71429` / `GHSA-528h-pc64-c93x` against
  `stream-json@1.9.1`, retained only by `minio@8.0.7` for its bucket-notification
  JSON-lines parser. VentureOS does not call that notification API, but the
  vulnerable package still remained in the production dependency graph.
- MinIO's upstream version-only update to `stream-json@3.5.0` fails its own
  CommonJS test path because 3.5.0 is ESM-only and moved the imported module.
  The focused remediation therefore pins the fixed release and applies a
  lockfile-hashed patch that replaces MinIO's single parser use with a
  one-megabyte-bounded Node transform in its source, CommonJS, and ESM builds.
- Repository tests load both shipped module formats, split a multibyte UTF-8
  character across chunks, parse newline-terminated and EOF-terminated records,
  and reject oversized terminated or unterminated records. No MinIO endpoint,
  credentials, provider mode, storage authorization policy, or request behavior
  is changed.

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
- Request bodies are Zod-validated. Prisma parameterized APIs are used. Reviewed
  raw SQL is limited to a constant health `SELECT 1`; parameterized
  authentication-abuse UPSERTs and bounded `FOR UPDATE SKIP LOCKED` cleanup;
  parameterized subscription-row `FOR UPDATE` quota locks; and retained
  parameterized venture-proposal/entity `FOR UPDATE` serialization. No unsafe
  concatenating raw-query API was found in the reviewed paths.
- React escaping is retained and no `dangerouslySetInnerHTML`, command-execution,
  insecure-deserialization, path-traversal, or user-controlled SSRF sink was
  reproduced.
- Storage providers validate MIME type, size, and workspace-prefixed object keys.
  Upload, signed-download, and existence operations perform centralized
  workspace capability enforcement inside the provider boundary; callers cannot
  inject a permissive authorizer. No multipart HTTP upload endpoint is exposed.
- Real marketplace writes, payments, advertising, and non-mock AI calls are
  absent from implemented runtime paths. Centralized capability policy now
  consumes the authoritative provider modes and global switches at admission,
  queued activity, runner, and implemented final-dispatch boundaries. Future
  live adapters must retain a non-bypassable check at their own boundary.
- Provider-shaped research and mock-marketplace operations perform an immediate
  fail-closed revalidation of current tenant-bound resources and centralized
  policy immediately before each adapter call. Successful idempotency replays are
  also revalidated before they can create a replay-labelled success record.
  Research cost and marketplace daily-rate slots are reserved atomically under
  tenant-owned row locks before dispatch, and research success persistence is one
  transaction. This narrows but does not eliminate TOCTOU: no database transaction
  is held across provider execution, and process configuration or other policy
  state can change after the final read.
- Raw mock adapters are not exported from package roots. Direct consumers use
  the protected runners, and database-backed finance reads as well as mutations
  enforce `FINANCE_ACCESS` at the package boundary. Idempotent publication
  replays do not reserve or consume a new daily-rate slot.
- Product generation validates persisted founder-decision evidence against the
  latest proposal version, snapshot hash, and expiry before mutation and again
  at the final provider boundary. Manual revenue entries accept only listing
  versions owned by the same workspace and venture.
- SCALE approvals canonically bind the current proposal version together with
  the exact experiment definition, variants, metrics, and results. Founder
  decision and SCALE execution both recompute that package, so evidence added
  after request or approval fails closed. Approval state transitions and their
  decision evidence are committed through one conditional transaction.
- Late package-boundary capability denials are mapped centrally to a generic
  HTTP 403 response. Marketplace idempotency serializes local claims and caches
  successes, but provider-level idempotency remains required for the crash
  window between provider acceptance and durable local success persistence.

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

6. **H-06 — Public authentication abuse and enumeration (fixed in Phase 11).**
   PostgreSQL-backed normalized-account/source cooldowns coordinate API
   processes and survive restarts. State keys and event metadata use
   domain-separated keyed digests rather than raw identifiers or IP addresses.
   Existing and missing users execute asynchronous scrypt verification; active
   cooldowns skip KDF work. Forwarding headers are ignored unless an explicit,
   bounded proxy-hop count is configured. Registration is source-limited and
   returns the same time-floored generic `202` response without a session for
   new, existing, and concurrent duplicate-email-race cases. Concurrent
   workspace-slug conflicts retry transactionally with at most three fresh
   randomized suffixes; exhaustion returns only a controlled generic failure.

7. **H-07 — Public Temporal health probe starts workflows (fixed in Phase 12).**
   `GET /api/health/temporal` now performs only the standard gRPC Health `Check`
   under one 3-second absolute connection/RPC deadline. A corrective follow-up
   to the prior local commit removed the API layer's competing timeout: the
   helper now remains the sole connection lifecycle owner and awaits cleanup
   before settling, even when cleanup extends beyond the RPC deadline. Readiness
   includes the same non-mutating Temporal check, returns HTTP 503 on unavailable
   dependencies or cleanup failure, and exposes only generic component status.
   Repeated disposable-infrastructure probes create no additional workflow
   history. Server connectivity does not claim worker/task-queue readiness; see
   `docs/HEALTH_CHECKS.md`.

8. **H-08 — Subscription and provider enforcement is implemented for current
   execution paths; live adapters remain a commercial blocker.** Central policy
   now checks status, trial expiry, active plan, feature, quota, required provider
   selection, and global switches at admission and direct worker/runner/provider
   boundaries. Implemented provider selections are required startup configuration.
   Advertising, paid-integration, notification, payment, live marketplace, and
   non-mock AI adapters remain unavailable and fail closed. A future live
   marketplace adapter must additionally enforce `Integration.writeEnabled` at
   its own non-bypassable boundary.

### Medium

1. MFA and account recovery are not implemented. No complete scaffolding exists;
   both remain explicitly deferred rather than partially implemented.
2. Account recovery remains absent. Registration no longer reports duplicate
   identifiers and does not create an authenticated session from the public
   acceptance response.
3. API/web security headers are partial. Frame, MIME-sniffing, and referrer
   controls exist on the web, but no reviewed CSP/HSTS/Permissions-Policy
   baseline exists for a real deployment.
4. Insert-only application audit writing, versioned integrity checksums, and a
   migration-level immutable-content update guard exist. The migration is not a
   signature or undeletable ledger, and production DB-role, retention, and
   access-policy enforcement are not verified.
5. Repository-level GitHub secret scanning and push protection could not be
   confirmed locally. CI has least-privilege permissions and Dependabot, but no
   secret-scan/SAST gate is present in the inspected workflow.
6. Approval decisions use an atomic pending-state compare-and-set, so concurrent
   decisions have exactly one winner. Execution revalidates approval status,
   expiry, artifact binding, and proposal/version hashes before side effects.
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
  `js-yaml` with 5.2.2, `postcss` with 8.5.26, `sharp` with 0.35.0, `vite` with
  6.4.3, `browserslist` with 4.28.7, and `decode-uri-component` with 0.5.0.
  These replace vulnerable code retained by exact/incompatible parent ranges;
  they do not suppress audit output. They resolve
  GHSA-2g4f-4pwh-qvx6, GHSA-q7g4-2pjw-v29r, GHSA-566m-qj78-rww5, and
  GHSA-4h9g-4w22-8q66 in addition to the Vite advisories above, plus
  GHSA-vcc3-ghjq-m6fr on the MinIO query-string path and CVE-2026-73088 /
  CVE-2026-73089 in workspace image dependency trees.

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

### Phase 11 authentication-abuse validation — 2026-08-01

All values below used disposable PostgreSQL and synthetic credentials:

1. Fresh PostgreSQL migration chain — PASS: 11/11 migrations applied and the
   `auth_abuse_states` table was present; the fresh container was removed by
   the command's cleanup trap.
2. Real-PostgreSQL authentication integration — PASS: transactional account
   and source thresholds, concurrent increments, cooldown expiry, selective
   account reset, bounded retention cleanup, controlled `429`/`Retry-After`,
   forwarding-header rejection at proxy trust `0`, and generic registration.
3. Two independent API processes — PASS: four failures against process A were
   followed by a `429` from process B; after both exited, a newly started
   process C returned the same durable account cooldown and `Retry-After`.
4. Interleaved asynchronous scrypt timing probe — PASS: real-hash and dummy-hash
   distributions overlapped (`p10` 35.725/35.569 ms, median 69.980/69.036 ms,
   `p90` 75.557/74.358 ms). Blocked requests are checked before KDF work.
5. Registration HTTP comparison — PASS: new and duplicate identifiers both
   returned `202`, the same body, no session cookie, and measured 311/309 ms
   with the default 300 ms response floor. A concurrent uniqueness race is
   covered by a focused regression test. Invalid admitted JSON is rejected with
   a generic `400`, no cookie, and the same controller-boundary floor; malformed
   transport bodies and pre-route guard/throttle outcomes are outside this
   identifier-dependent timing contract.
6. Fresh final workspace gates — PASS: `format:check`, lint (17/17), typecheck
   (36/36), unit, integration, build (20/20), and Playwright E2E (4/4).
7. Value-redacting changed-file scan and `git diff --check` — PASS; flagged
   password/secret-like values were synthetic test fixtures only.

The original read-only findings report should have been delivered before edits
began. Implementation started first, so this phase records that sequencing
violation explicitly rather than presenting the work as procedurally perfect.

### Phase 12 Temporal-health validation — 2026-08-01

The Temporal-health implementation passed its scoped source, unit, build,
runtime, audit, and secret-scan gates. This does **not** make the full
application suite green. Two separate reliability blockers remain recorded and
must not be hidden, skipped, or treated as passing:

The prior local Temporal-health commit was not an approved checkpoint because
its API service added a second `Promise.race` around the helper-owned gRPC
deadline and connection cleanup. The corrective follow-up removes that outer
timeout, awaits helper cleanup before every route outcome, and truthfully allows
cleanup to finish after the RPC deadline. The Temporal readiness and staging
flags below apply only after this correction passes scoped validation and
independent review.

1. The complete integration run has produced a Prisma interactive-transaction
   admission timeout in `auth-abuse.integration.test.ts` when five concurrent
   same-row operations compete for the two-second admission window. Ten serial
   focused base-commit runs and six complete base-commit integration runs passed,
   so the exact timeout is resource-dependent rather than deterministic. The
   failing test and authentication service are unchanged by the Temporal diff,
   import no health code, and execute no Temporal-health path.
2. Clean root E2E has produced a five-second login URL timeout while concurrent
   asynchronous scrypt work occupied approximately 4.2 seconds. Fifteen repeated
   base-commit E2E runs did not reproduce that exact URL timeout, but five failed
   on a separate pre-existing strict-locator race in the same unchanged E2E file.
   The Playwright spec, timeout, authentication path, and scrypt implementation
   are unchanged by the Temporal diff; Playwright continues to start the API by
   polling process-only `/api/health/live`.

Both reported global failures are classified as pre-existing,
environmental/resource-dependent reliability risks in unchanged code, not as
failures introduced by the Temporal-health implementation. A separate
authentication/E2E reliability task is required before the full application
suite can be called green. No authentication assertion or Playwright timeout was
weakened or skipped, and no staging or production readiness claim follows from
the scoped Temporal result.

### Phase 13 authentication and E2E reliability — 2026-08-01

The two Phase 12 reliability blockers were reproduced and corrected without a
dependency, policy-threshold, KDF, timeout, retry, or Temporal-health change:

1. Authentication transaction admission — the failure was Prisma `P2028`
   before interactive-transaction callback execution. A controlled pool probe
   admitted five held interactive transactions, showed five PostgreSQL sessions
   idle in transaction, and reproduced `Unable to start a transaction in the
given time` with the next callback never entered. The login-failure path used
   one interactive transaction per attempt, performed cleanup while reserving
   that connection, then locked ACCOUNT followed by IP. PostgreSQL reported zero
   deadlocks, every LOGIN path used the same lock order, and test digests/cleanup
   were isolated. This is an avoidable production transaction-design defect
   under resource contention, not lost updates, reversed lock order, global test
   cleanup, or an unrealistic five-failure scenario.
2. Authentication correction — bounded `FOR UPDATE SKIP LOCKED` cleanup now
   completes outside the counter transaction. ACCOUNT and IP UPSERTs execute in
   one ordered non-interactive Prisma batch transaction, preserving atomicity,
   ACCOUNT-before-IP lock order, exact thresholds, cooldown escalation, restart
   persistence, shared multi-instance state, and selective account clearing.
   No `maxWait` increase or retry was added.
3. Authentication proof — the focused real-PostgreSQL suite passed 20/20
   consecutive runs with a constrained two-connection pool (7/7 each;
   3,338–5,068 ms wall time, 4,318 ms average). Five concurrent failures retained
   exact ACCOUNT=5 and IP=5 counts, activated only the account threshold, and
   alternated across service instances. A locked expired row did not block a
   different critical counter update. Five concurrent HTTP failures split across
   two independently running API processes produced exactly four `401` responses
   and one `429`, with durable ACCOUNT=5/IP=5 database state. The forced complete
   integration suite passed 5/5 consecutive runs, 71/71 tests each, with no cache
   (42,606–46,381 ms; 44,864 ms average).
4. E2E root cause — navigation assertions for Audit Centre and Security Events
   used unscoped text shared by each persistent sidebar link and destination
   heading. Depending on render timing, the assertion either passed prematurely
   against the link or saw both elements and failed strict mode. This is a test
   selector/readiness defect; matching accessible nav and heading labels are
   correct UI. Login assertions also started their five-second URL budget before
   the asynchronous scrypt-backed API request completed, conflating KDF and
   client-navigation time. Measured successful login API durations were
   149–198 ms and the concurrent invalid login was 267–276 ms in the final local
   environment; no timeout increase was supported.
5. E2E correction and proof — each login now synchronizes on the specific POST
   response and expected status before asserting redirect/readiness. Destination
   assertions use unique semantic headings; no `.first()`, forced click, sleep,
   retry, disabled assertion, or timeout increase was added. Clean-output root
   E2E passed 5/5 consecutive 4/4 runs (19,734–75,279 ms; 31,454 ms average),
   reused-state root E2E passed 3/3 (15,884–18,324 ms; 17,310 ms average), and
   immediate root E2E passed 3/3 (16,559–20,412 ms; 18,498 ms average). Every
   first attempt passed and Playwright stopped its API/web processes after each
   run.
6. Final validation — frozen install, format, lint (17/17), typecheck (36/36),
   Prisma generate/format/validate, all 11 migrations on fresh PostgreSQL,
   synthetic seed, build-contract tests (5/5), complete unit orchestration,
   complete integration (71/71), clean/reused/immediate root E2E (4/4 each),
   production build (20/20), API entrypoint assertion, and Temporal health
   regression (26/26) passed. Production and complete dependency audits each
   reported zero findings. The value-redacting scan inspected 419 eligible UTF-8
   files plus the proposed diff and reported zero review-required findings.

## Residual risks and staging blockers

- The dependency Critical/High gates are closed for the validated lockfile, but
  audits must remain required on future lockfile changes.
- MFA and account recovery remain deferred product/security work.
- Authentication hardening is implemented; deployment proxy-hop configuration
  and digest-secret rotation remain explicit operational responsibilities.
- Temporal health is non-mutating and readiness-gated. Worker/task-queue
  readiness remains a separately monitored operational limitation.
- Current subscription/provider gates are wired and mock-provider validated;
  live commercial adapters and production provider connectivity remain absent.
- Approval decisions use an atomic single-writer transition; execution-time
  expiry and artifact revalidation remain required before side effects.
- GitHub secret scanning/push protection and branch protections require owner
  verification in repository settings.

## Readiness flags

`AUTHENTICATION_ABUSE_CONTROL_READY=True`

`AUTHENTICATION_TIMING_EQUALIZATION_READY=True`

`AUTHENTICATION_STAGING_GATE_READY=True`

`AUTH_TRANSACTION_RELIABILITY_READY=True`

`LOGIN_E2E_RELIABILITY_READY=True`

`TEMPORAL_PUBLIC_HEALTH_NONMUTATING_READY=True`

`TEMPORAL_READINESS_GATE_READY=True`

`TEMPORAL_STAGING_GATE_READY=True`

`APPLICATION_SECURITY_BASELINE_READY=True`

`CRITICAL_SECURITY_FINDINGS_OPEN=False`

`HIGH_SECURITY_FINDINGS_OPEN=True`

`FULL_APPLICATION_VALIDATION_GREEN=True`

`STAGING_SECURITY_GATE_READY=False`

`PRODUCTION_DEPLOYMENT_READY=False`

`COMMERCIAL_LAUNCH_READY=False`
