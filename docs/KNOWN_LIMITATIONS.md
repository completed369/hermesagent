# Known Limitations

> **Status note (2026-08-01):** this file began as a Phase 1 sandbox inventory
> and still contains historical phase/sandbox statements. For current executed
> release evidence use `TECHNICAL_RELEASE_BASELINE.md`; for the current security
> findings and gates use `APPLICATION_SECURITY_BASELINE.md`. Historical claims
> below must not override those newer records.

## Sandbox-imposed (not a code problem — see SANDBOX_LIMITATIONS.md)

Nothing in this repository has been installed, compiled, migrated, seeded,
started, or tested. All "implemented" claims in this documentation mean
"real source code exists and was manually/structurally reviewed" — not
"verified working." Local verification is required before any acceptance
criterion can be honestly marked complete; see LOCAL_VERIFICATION_CHECKLIST.md.

## Fixed during local verification

- **`apps/web`'s `@/*` path alias resolved to the monorepo root instead of `apps/web/src`, causing a persistent "Module not found" error that survived cache clears and reinstalls**: `tsconfig.base.json` sets `baseUrl: "."`, and TypeScript resolves an inherited `baseUrl` relative to the file that DEFINES it (the repo root), not the file that extends it - a well-known monorepo tsconfig gotcha. `apps/web/tsconfig.json` didn't override `baseUrl` itself, so `@/*` was silently resolving to `<repo-root>/src/*` (nonexistent) instead of `apps/web/src/*`. Fixed by adding `"baseUrl": "."` explicitly to `apps/web/tsconfig.json`.
- **API crashed with a TypeError inside `@nestjs/swagger`'s parameter explorer** (`Cannot read properties of undefined (reading '0')` in `ParameterMetadataAccessor.explore`), likely caused by `tsx`/esbuild's decorator-metadata emission not exactly matching what Swagger's reflection expects for some custom parameter decorators. Since Swagger docs are non-essential to Phase 1, wrapped doc generation in a try/catch in `main.ts` so a failure logs a warning and the API still starts, instead of crashing the whole process. `/api/docs` may not work until this is investigated further (candidate real fix: run the API via `nest build` + `node dist/main.js` instead of `tsx` for any environment that needs Swagger, since `nest build` uses `tsc`'s own decorator metadata emission).
- **`pnpm run typecheck` failed for `@ventureos/database`** with `Cannot find name 'process'/'console'` and `Cannot find module 'node:crypto'`: `packages/database/src/client.ts` and `src/seed.ts` use Node globals (`process.env`, `console.*`, `node:crypto`) but the package never listed `@types/node` as a direct devDependency — same pnpm strict-isolation class of bug as the earlier `@types/express-serve-static-core` fix. `packages/config/src/env.ts` has the identical latent issue (`process.env` as a default parameter) even though it happened not to surface as an error in this particular typecheck run (likely incidental hoisting) — fixed proactively there too rather than waiting for it to break separately. Added `@types/node` as a direct devDependency to both packages. Found during founder verification on 2026-07-13 while running the Phase 1 verification checklist for the first time.
- **`POST /api/auth/login` returned `500: Cannot read properties of undefined (reading 'login')`** because `this.authService` was `undefined` inside `AuthController` at runtime, despite `AuthModule` correctly providing `AuthService`. Root cause: `AuthController`'s constructor was the only one in the API mixing an undecorated class-typed parameter (`authService: AuthService`) with an explicitly `@Inject(ENV_TOKEN)`-decorated parameter in the same constructor — `tsx`/esbuild's decorator-metadata emission does not reliably populate `design:paramtypes` for that mixed pattern (the same underlying class of bug as the Swagger issue above). Every other controller/service/guard either has all-undecorated parameters or a single `@Inject(...)`-decorated parameter alone, so none of them hit this. Fixed by explicitly adding `@Inject(AuthService)` to the first parameter so DI doesn't depend on mixed reflection. Found during founder verification on 2026-07-13. If any future controller/service needs a constructor mixing a plain class dependency with an explicitly-tokened one, decorate _all_ parameters explicitly to avoid this class of bug recurring under `tsx`.
- **`AuditModule`/`SecurityModule` failed NestJS dependency injection**: both use `SessionAuthGuard`/`PermissionGuard` via `@UseGuards(...)`, which need `ENV_TOKEN` injected, but neither module listed `envProvider` (other modules happened to include it, these two didn't - inconsistent manual wiring). Fixed properly by adding a `@Global()` `ConfigModule` (`apps/api/src/config/config.module.ts`) providing `ENV_TOKEN` application-wide, imported once in `AppModule`, so no future module can hit this by forgetting to list it locally.
- **API crashed at runtime with `ERR_MODULE_NOT_FOUND` for extensionless relative imports inside workspace packages** (e.g. `packages/config/src/index.ts`'s `export * from './env'`), even though TypeScript compilation itself reported 0 errors: `nest start --watch`'s default dev runner resolves workspace-package internals through a path that enforces Node's native ESM extension rules. Switched `apps/api`'s `dev` script from `nest start --watch` to `tsx watch src/main.ts` (the same tool already proven working for `apps/worker`), which resolves extensionless imports transparently. `nest build`/`nest start` (production) are unchanged and untested against this specific issue - flag if the production build hits the same error, since it may need the same treatment or the alternative fix of adding explicit `.js` extensions to all workspace-package relative imports.
- **`req.user`/`req.correlationId` type errors persisted in files other than the ones declaring the augmentation**: the original code scattered two separate `declare module 'express-serve-static-core'` blocks across `session-auth.guard.ts` and `correlation-id.middleware.ts`; NestJS's compiler wasn't merging them consistently for every consuming file. Replaced with the standard, documented pattern: a single ambient `apps/api/src/types/express.d.ts` using `declare global { namespace Express { interface Request {...} } }`, which is reliable regardless of file visit order.
- **API TS errors persisted after adding `express` as a direct dependency**: the actual missing piece was `@types/express-serve-static-core` as its own direct devDependency of `apps/api` — pnpm's strict isolation requires the exact module being augmented (`declare module 'express-serve-static-core'`) to be directly resolvable from the augmenting package, not just transitively present. Added it explicitly.
- **Worker crashed with `Namespace ventureos-dev is not found`, then again with `operatorService.registerNamespace is not a function` after a first attempt at auto-registration used an SDK method that doesn't exist in the installed `@temporalio/client` version**: rather than keep guessing at unverifiable SDK internals, switched Phase 1's default `TEMPORAL_NAMESPACE` to Temporal's built-in `default` namespace, which always exists and needs no registration step. Simpler and more robust than any auto-registration logic for a single-workspace Phase 1 setup.
- **Next.js "Module not found" for `@/lib/server-api` despite the file existing and being identical on disk**: stale `.next` build cache from mid-sync file writes while the dev server was running. Not a code bug; fixed by deleting `apps/web/.next` and restarting.
- **API TS errors persisted after adding `@types/express`**: `express` itself was never a direct dependency of `apps/api` (only pulled in transitively via `@nestjs/platform-express`); pnpm's strict module resolution couldn't resolve `express-serve-static-core` for the `Request`/`Response` type augmentation from application code without it. Added `express` as a direct dependency.
- **Worker crashed with `Namespace ventureos-dev is not found`**: Temporal only ships the built-in `default` namespace; custom namespaces need explicit registration. The worker now checks for its configured namespace on startup and self-registers it if missing (`apps/worker/src/worker.ts` `ensureNamespaceRegistered`), so no manual `tctl`/`temporal` CLI step is required on a fresh environment.
- **Temporal container crash-looped on startup**: `docker-compose.yml` set `DYNAMIC_CONFIG_FILE_PATH: config/dynamicconfig/development-sql.yaml` for the `temporal` service, copied from a common example, but that path doesn't exist inside `temporalio/auto-setup:1.24.2` — confirmed via `docker compose logs temporal` showing `no such file or directory` followed by a connection-refused crash loop. Removed the variable entirely; Temporal starts fine with its built-in default dynamic config for a single-node dev setup. Found during founder verification on 2026-07-13.
- **Root `.env` wasn't reaching `apps/api`, `apps/worker`, or `packages/database`'s Prisma CLI.** Prisma/Nest/tsx only auto-load `.env` from their own package directory, not the monorepo root where `setup-local.ps1` creates it. Fixed by prefixing the relevant `dev`, `start`, `test:integration`, and all Prisma scripts with `dotenv -e ../../.env --` (added `dotenv-cli` as a devDependency to each affected package). Found via real local `prisma migrate dev` failure (`Environment variable not found: DATABASE_URL`) during founder verification on 2026-07-13.
- **First-ever full-repo `pnpm run typecheck` surfaced 4 real type errors** (previously only individual packages had been typechecked incrementally while debugging other issues):
  - `finance-engine`'s `calculateScenarios()` always returns exactly 3 elements (low/base/high, fixed order) but was typed as the open-ended `ScenarioProjection[]`. With `noUncheckedIndexedAccess` on, `const [low, base, high] = calculateScenarios(...)` typed each as possibly `undefined`. Fixed by changing the return type to a proper 3-tuple `[low: ScenarioProjection, base: ScenarioProjection, high: ScenarioProjection]`.
  - `contracts/agent-output.ts` used `VetoType[number]` as a type, but `VetoType` was only ever exported as a value (a zod enum, `export const VetoType = z.enum([...])`), never as a type alias — TS2749. Added `export type VetoType = z.infer<typeof VetoType>` (matching the existing `AgentDecision` const+type shadow pattern) and fixed the `CRITICAL_VETO_ROLES` annotation to just `VetoType`.
  - `policy-engine/board-voting.ts`: the local `weights` variable is `options.weights ?? DEFAULT_AGENT_WEIGHTS`, inferred as a union of `Record<string, number>` and the narrower `Record<BoardAgentRole, number>`. Indexing that union with `output.agentRole` (a plain `string`, since `AgentOutputSchema` validates it as `z.string().min(1)`, not the strict 8-role enum) isn't allowed against the narrower branch — TS7053. Cast to `Record<string, number>` at the lookup site; both branches are structurally plain string-keyed objects at runtime, so behavior is unchanged.
  - `observability/logger.test.ts`: `spy.mock.calls[0]` is typed possibly `undefined` under `noUncheckedIndexedAccess`. The preceding line already asserts `toHaveBeenCalledTimes(1)`, so a non-null assertion (`calls[0]!`) is safe.
  - After these 4 fixes, `pnpm run typecheck` is clean across all 15 packages/apps, and `pnpm test:unit` passes 12/12 packages (67 individual tests, `packages/database` correctly reports "no test files" via `--passWithNoTests` rather than being force-failed for having nothing pure to unit test yet). Found during founder verification on 2026-07-13.
- **`apps/api`'s dev runner crashed with `ERR_MODULE_NOT_FOUND` for `packages/config/src/env.js`, thrown from Node's native ESM resolver, immediately after webpack itself reported a clean compile**: switching to `nest start --watch --webpack` (see ADR-006) fixed the earlier `dist/main` race, but its default config uses `webpack-node-externals`, which externalizes pnpm-symlinked `@ventureos/*` workspace packages along with real `node_modules` deps. Externalized packages are loaded by Node's own runtime resolver instead of being bundled/transpiled — and every workspace package's `main`/`types` still pointed at raw `src/index.ts`, which Node cannot execute. Fixed at the root by giving every consumed package a real `tsc` build (`dist/index.js`, CJS) and pointing `main`/`types` at `dist/`; see ADR-006 for full detail. **Operational note**: `turbo`'s `dev` task now depends on `^build`, so package changes are only picked up on the _next_ `pnpm dev` invocation (turbo's cache invalidates on source changes) — editing a package's `src/*.ts` while `pnpm dev` is already running will not hot-reload until the dev process is restarted, since there is no continuous `tsc --watch` for packages themselves. Found during founder verification on 2026-07-13. A follow-up bug in the same fix (`turbo run dev --parallel` ignores the task graph, so the new `dependsOn: ["^build"]` edge never fired) was caught on the first restart attempt and fixed by dropping `--parallel` from the root `dev` script. **Verified end-to-end 2026-07-13**: a clean restart now builds every package to `dist/` and boots web, api, and worker cleanly (`Nest application successfully started`, worker `RUNNING` and connected to Temporal). See ADR-006.
- **The "Sign out" control in `apps/web`'s dashboard sidebar was completely non-functional**: it rendered as `<form action="/api/logout-redirect"><a href="/login">Sign out</a></form>`. An anchor tag inside a form does not submit it (only `type="submit"` buttons do), and `/api/logout-redirect` was never implemented as a Next.js route handler either way. Clicking it just navigated to `/login` without ever calling `POST /api/auth/logout` — confirmed live: `GET /api/auth/me` still returned 200 with the full user object after "signing out," and navigating straight back to `/dashboard` rendered normally instead of redirecting. Fixed by replacing it with a real client component (`SignOutButton`) that calls the same direct-to-API `apiFetch('/auth/logout')` pattern the login page already uses, then redirects. Confirmed live afterward: `/api/auth/me` returns 401 after clicking Sign out, and the DB session row is revoked. Found during founder verification on 2026-07-13.
- **`AuditService.record()` was fully implemented but never called anywhere in the codebase** — `AuditModule`/`AuditController` correctly exposed `GET /api/audit-events`, but the Audit Centre page showed "No audit events yet." even after real logins and onboarding saves, because nothing ever wrote a row. `EXECUTION_PLAN.md`'s own Phase 1 checklist had already flagged this as unverified. Wired `AuditService` into `OnboardingService.save()` (records a before/after `ONBOARDING_PROFILE_SAVED` event with the acting user's ID). Confirmed live: the Audit Centre now renders a real event with a real timestamp and correlation reference. Other sensitive actions (login, future approvals, etc.) may warrant their own audit events but are out of scope for this fix — scoped deliberately to the action already exercised in Phase 1 verification. Found during founder verification on 2026-07-13.
- **Onboarding save (`PUT /api/onboarding`) worked exactly once, then failed with a 500 on every subsequent save** — `GET /api/onboarding` returns Prisma's real column values, and Prisma represents an unset nullable column (`businessObjectives`, `weeklyTimeHours`, `approvalThresholdEur`, `refundThresholdEur`, `targetProfitEur`, `targetLaunchDate`, `availableBudgetEur`, `riskTolerance` — all declared nullable in `schema.prisma`) as `null`, not `undefined`. `apps/web`'s onboarding page round-trips the GET response straight into the PUT body (`setForm(data)` then `{...form}` on submit), so any field never explicitly filled in comes back as `null`. `onboardingSchema` only had `.optional()` (accepts `undefined`, rejects `null`), so Zod threw `Expected string/number, received null` and the API returned 500 — confirmed live via both a direct API call and clicking Save in the actual browser UI (the UI failure was initially mistaken for an automated-testing click/timing artifact before the real API error was found in the log). Fixed by adding `.nullable()` alongside `.optional()` for every affected field, matching the Prisma column nullability exactly. Confirmed live afterward: edited the budget field in the real UI, clicked Save, and `GET /api/onboarding` reflects the new value. Found during founder verification on 2026-07-13.

## Code-level gaps, honestly disclosed

- **CSRF protection is origin-based, not a synchronizer token**: authenticated
  unsafe methods now require an exact `Origin` match in the API's global guard,
  in addition to `sameSite=lax` and the CORS allowlist. Deployments must keep a
  single trusted `API_CORS_ORIGIN`; future multi-origin clients will require a
  reviewed allowlist or a synchronizer-token design.
- **Authentication abuse hardening is implemented but remains deployment-policy
  sensitive**: PostgreSQL-backed account/source cooldowns survive restarts and
  coordinate API instances; blocked requests skip KDF work, missing users run the
  same asynchronous scrypt path, registration responses are generic and
  time-floored, concurrent workspace-slug conflicts use a bounded transactional
  randomized retry, and raw identifiers/IPs are not stored in abuse state.
  Expired abuse rows are removed opportunistically during authentication traffic
  or an explicit cleanup call; no scheduler is included. Deployments behind a
  reverse proxy must set the bounded `API_TRUST_PROXY_HOPS` value to the exact
  trusted hop count; the secure default is `0`, which ignores forwarding headers.
  Rotating the abuse-digest secret invalidates existing pseudonymous buckets and
  therefore requires an explicit operational reset decision.
- **The public Temporal health probe is mutating**: each unauthenticated request
  starts and awaits a real workflow. Replace it with a bounded non-mutating or
  authenticated internal probe before Temporal-backed staging.
- **Commercial/provider gates are incomplete**: subscription/plan helpers and
  declared global publishing/advertising/paid-integration/dev-login flags are
  not feature/provider dispatch gates. Current external-call safety derives
  from hardcoded mock-only implementations.
- **Approval decisions are not concurrency-safe**: the pending-state check and
  decision update are not one atomic single-writer transition. Fix before any
  real publication, spend, or customer side effect is connected.
- **Dependency Critical/High remediation is complete for the validated
  lockfile**: compatibility-tested Next 15, Nest 11/Express 5, and Vitest 3
  upgrades plus targeted vulnerable-child replacements reduced both production
  and complete `pnpm audit` results to zero findings at every severity. This is
  lockfile-specific evidence, not a permanent waiver: frozen install and both
  audits must remain required for future dependency changes. See
  `APPLICATION_SECURITY_BASELINE.md` for advisory roots and validation evidence.
- **Database migrations still require normal production change controls**:
  the eleven-migration chain, including in-place hashing of existing session
  tokens and durable authentication-abuse state, has been exercised on
  disposable PostgreSQL. That does not replace a
  production backup, restore rehearsal, maintenance plan, or rollback review.
- **MinIO and live Temporal connectivity remain unverified here.** Disposable
  PostgreSQL migration, seed, unit/integration, and compatibility probes passed;
  this is not production infrastructure evidence.
- **CI has run, but there is still no complete green clean-runner result
  (corrected 2026-07-20, Phase 9.1).** The historical first main-branch run
  failed at build. The current pull-request run for PR #1 at commit
  `0f536c7c9511945a135a5a030f34e8908a5a9f4b` also remains red (GitHub
  Actions run `29660695312`): dependency installation, Prisma generation,
  format, lint, and typecheck succeeded; Prisma migrate failed because the CI
  database connection did not succeed; unit tests, integration tests, and
  production build were skipped. This records the observed stopping point
  without asserting why the connection failed, a migration defect, or a
  verified fix. Historical green local validation is separate evidence and
  does not make the branch CI-ready. See `docs/CI_GOVERNANCE.md`.
- **Root E2E build orchestration is fixed and regression-protected**: the root
  task now performs the production build before Playwright, the API build asserts
  a non-empty `dist/main.js`, and build-contract tests cover stale incremental
  state. On the remediated dependency graph, clean-state, reused-state, and
  immediate repeated root runs each passed build 20/20 and E2E 4/4. Future build
  script or Turbo graph changes must preserve those regression gates.
- **No malware scanning** on uploaded files (integration point documented,
  not wired).
- **No OpenTelemetry exporter** wired despite `OTEL_*` env vars existing —
  currently a structural placeholder only.

## Scope limitations (by design, not oversight)

Later-phase opportunity, board, approval, product, research, finance,
experiment, billing, and marketplace modules now exist. Real-provider/live
publication and commercial readiness remain intentionally blocked by the
controls and residual risks above; see `ROADMAP.md` and
`APPLICATION_SECURITY_BASELINE.md`.
