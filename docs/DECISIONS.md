# Architectural Decision Records

## ADR-001: Authentication library — hand-rolled session auth, not Better

Auth or Auth.js, for Phase 1

**Context**: master spec section 8 asks for "Better Auth or Auth.js,
choosing the option that integrates most reliably with the selected
Next.js and NestJS architecture."

**Decision**: Phase 1 implements authentication directly (scrypt password
hashing, DB-backed session table, httpOnly cookie, server-side guards) in
`@ventureos/auth` + `apps/api`, rather than adopting Better Auth or Auth.js.

**Reasoning**: both libraries are designed around a single Next.js app
handling its own auth routes; VentureOS's architecture deliberately splits
web (Next.js) and API (NestJS) so the API is the sole source of
authorization truth (master spec section 26: "server-side approval
enforcement", "a frontend button must never be the only approval control").
Integrating either library would mean either (a) running auth inside
Next.js and having NestJS trust a token it didn't issue, or (b) fighting
the library's Next.js-centric assumptions to run it inside Nest. A minimal,
fully-understood, framework-agnostic implementation was judged lower-risk
for a security-critical system than adapting a Next.js-shaped library to a
role it wasn't designed for.

**Consequence**: MFA, OAuth providers, and account recovery — which Better
Auth/Auth.js would have provided for free — are now bespoke future work
(tracked in `TODO.md`). This is an accepted tradeoff for Phase 1; revisit
if a library emerges (or matures) with first-class support for a
Next.js-frontend / separate-API-backend split.

**Status**: Not yet run/tested (sandbox has no network/DB — see
`SANDBOX_LIMITATIONS.md`). Revisit this ADR after local verification in
case scrypt performance or session-table design needs adjustment.

## ADR-002: Modular monolith, not microservices

See `ARCHITECTURE.md`. Single founder, single workspace, tight budget —
microservices would add operational cost with no corresponding benefit at
current scale.

## ADR-003: Deterministic engines built as standalone packages ahead of

their consuming features

`finance-engine`, `scoring-engine`, `policy-engine`, and the agent-output/
approval contracts in `@ventureos/contracts` were built in Phase 1 even
though the features that will call them (Opportunity feed, Board Room,
Approval Centre) are Phase 2/3. **Reasoning**: these are the pieces of the
system where correctness matters most (arithmetic, voting math, contract
validation) and where unit tests provide the most value; building and
testing them now, independent of any UI or AI provider, means Phase 2/3 can
consume already-verified logic rather than writing and verifying it under
feature-delivery time pressure. **Risk accepted**: minor chance of rework if
Phase 2/3 domain modeling reveals a need to change these interfaces — judged
low given how closely they were modeled on the master spec's explicit
formulas and schemas.

## ADR-004: Project location changed mid-build

The founder's original instruction placed the project inside
`D:\Documents\hermes ai agent`, which turned out to contain internal Hermes
agent runtime state (auth.json, lock files, databases) — not a project
folder. Per founder direction, the project was relocated to
`D:\Projects\ventureos` conceptually; due to a sandbox folder-picker
limitation the connected folder ended up being
`D:\Documents\claudehermespromt\ventureos` instead. See the founder-facing
summary in the final chat report for the exact path and how to move it.

## ADR-005: `apps/api` reverted from `tsx watch` back to `nest start --watch`; workspace packages now use explicit `.js` extensions on relative imports

**Context**: `apps/api`'s dev script originally used `nest start --watch`,
NestJS's own dev workflow (tsc/webpack-based). It crashed with
`ERR_MODULE_NOT_FOUND` when loading workspace packages
(`packages/*/src/index.ts`, e.g. `export * from './env'`) because those
files used extensionless relative imports — valid under the `Bundler`
`moduleResolution` each package's own tsconfig declares (appropriate for
direct-TS-source consumption by bundlers), but not valid under real Node
module resolution, which `nest start --watch`'s runtime loading path
enforces for workspace-linked source. The dev script was switched to
`tsx watch src/main.ts`, since esbuild resolves extensions itself like a
bundler and the crash disappeared immediately.

**Problem discovered later the same day**: over a long dev session with
many file-triggered hot-reload restarts, `tsx`/esbuild's decorator-metadata
emission proved unreliable for NestJS's reflection-based dependency
injection. This first appeared to be a `AuthController`-specific bug
(mixing an undecorated constructor parameter with an explicitly
`@Inject()`-decorated one) and was fixed as such. But `HealthController`,
`WorkspacesController`, and `OnboardingController` — none of which have that
mixed-parameter pattern — later hit the exact same symptom
(`this.xService` silently `undefined` at runtime despite correct module
`providers` wiring) after enough additional hot-reload cycles. That proved
the real cause was never any individual controller's shape: `tsx`'s
decorator metadata degrades cumulatively across incremental watch-mode
restarts in a way `tsc`'s own emission does not.

**Decision**: fix the actual root cause instead of continuing to patch
individual controllers as they surface. Added explicit `.js` extensions to
every relative import inside `packages/*/src` (17 files) — the standard
TypeScript-supported pattern (`import from './env.js'` in a file that's
physically `env.ts`) that resolves correctly under real Node module
resolution AND remains valid under `Bundler` resolution, so nothing else
breaks. With that fixed, `apps/api`'s dev script reverts to
`nest start --watch`, which compiles through `tsc` and does not have the
decorator-metadata reliability gap.

**Scope**: `apps/worker` is unaffected and intentionally keeps `tsx watch`
— it has no NestJS/decorators/reflection-based DI at all (Temporal
workflows/activities are plain functions), so the `tsx` reliability gap
never applied there.

**Verification needed**: this fix must be proven to hold up across several
real hot-reload cycles (edit a file, watch it restart, exercise the
previously-broken endpoints again), not just a single fresh boot — a single
successful cold start was already misleadingly observed earlier today
before the corruption reappeared.

**Update — superseded by ADR-006**: plain `nest start --watch` turned out to
have its own deterministic bug (see ADR-006), and the fix for that
(`--webpack`) reopened the workspace-package resolution problem in a new
form. ADR-006 is the actual final state of `apps/api`'s dev runner.

## ADR-006: `apps/api` dev runner finalized as `nest start --watch --webpack`; workspace packages now build to real `dist/` output

**Problem 1 — `dist/main` race**: plain `nest start --watch` (tsc-watch
mode) reproduced, identically on two consecutive clean restarts, `Error:
Cannot find module '...\apps\api\dist\main'`. Root cause: `nest-cli.json`
sets `deleteOutDir: true`, and the CLI launched `node dist/main.js` before
the fresh `tsc` recompile had finished writing output — a deterministic
race, not a flake. **Fix**: switched to `nest start --watch --webpack`,
which bundles in-memory via `ts-loader` and never touches `dist/` as an
intermediate file, removing the race entirely.

**Problem 2 — workspace packages resolved as raw TypeScript at runtime**:
after switching to `--webpack`, webpack itself compiled successfully
("webpack 5.97.1 compiled successfully"), but the process still crashed
immediately after with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'...\packages\config\src\env.js'` — thrown from Node's **native**
`internal/modules/esm/resolve`, not from webpack or `ts-loader`. Root
cause: Nest's default webpack config uses `webpack-node-externals` to
avoid bundling `node_modules`, and pnpm-linked `@ventureos/*` workspace
packages live in `node_modules` too (via symlinks), so they got
externalized right along with real npm dependencies. Externalized deps are
`require()`/`import`-ed by Node's own runtime loader instead of being
bundled and transpiled by webpack. Every `@ventureos/*` package's
`package.json` still pointed `main`/`types` at raw `src/index.ts` (no
package had ever been built), so Node's native loader tried to load
TypeScript source directly and failed — it has no `.ts` support and no
knowledge of the `./env.js`-pointing-at-`env.ts` convention (that
convention is a bundler/tsc-resolver courtesy, not something Node's native
ESM resolver does).

**Decision**: rather than special-casing `webpack-node-externals` to
allowlist `@ventureos/*` (fragile — would also require excluding those
packages from `ts-loader`'s own `node_modules` exclusion, and would only
fix `apps/api`, leaving the same "raw TS source reachable through
node_modules" hazard for any future consumer), every consumed workspace
package (`auth`, `config`, `contracts`, `database`, `finance-engine`,
`integrations`, `observability`, `policy-engine`, `scoring-engine`,
`security`, `testing`, `workflows`) now gets a real build step:

- `package.json`: `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`,
  new `"build": "tsc -p tsconfig.json"` script.
- `tsconfig.json`: `module` and `moduleResolution` overridden to
  `CommonJS`/`Node` (matching `apps/api`'s own override — the shared
  `tsconfig.base.json` uses `ESNext`/`Bundler`, fine for editor tooling
  against source, not for a package with no `"type": "module"` that's
  loaded by Node's real runtime resolver).
- `turbo.json`: the `dev` task now has `"dependsOn": ["^build"]` (the same
  dependency-graph edge the `build` task already used), so every package a
  dev server depends on gets compiled to `dist/` before the persistent app
  processes start.

This makes `apps/api` (webpack + externals), `apps/worker` (`tsx`), and
`apps/web` (Next.js) all consume the same real compiled JS from
node_modules-linked packages, instead of each tool reaching raw TypeScript
source through its own resolution quirks. It removes this entire class of
resolver mismatch rather than patching it per-consumer.

**Follow-up bug caught on first real restart**: the `^build` dependency
added to the `dev` task never actually ran — the root `dev` script was
`turbo run dev --parallel`, and turbo's `--parallel` flag explicitly runs
tasks ignoring the dependency graph (it's also flagged deprecated in
turbo's own CLI output). So packages were never built and `apps/api`/
`apps/worker` still crashed with `Cannot find module
'...\node_modules\@ventureos\config\dist\index.js'` — the `main` field now
correctly pointed at `dist/`, but nothing had ever produced that file.
Fixed by dropping `--parallel` from the root `dev` script (`turbo run dev`).
turbo's default scheduler still runs independent tasks (like the three
apps' `dev` tasks) concurrently once their graph dependencies are
satisfied, so this doesn't reintroduce serial app startup — it just also
respects `dependsOn: ["^build"]` correctly.

**Verified 2026-07-13**: a full clean restart now shows all consumed
packages building to `dist/` first (cache miss, `tsc -p tsconfig.json` for
each), then all three apps starting cleanly: worker connects to Temporal
and reaches `RUNNING` state, the webpack build compiles successfully, and
Nest logs `Nest application successfully started` with every controller's
routes mapped (`/api/health/*`, `/api/auth/*`, `/api/workspaces/*`,
`/api/onboarding`, `/api/audit-events`, `/api/security-events`). This is
the first clean boot of all three apps together since the dev-runner work
began. Hot-reload durability across many incremental restarts (the
original tsx/esbuild failure mode) hasn't been separately stress-tested,
but `nest start --watch --webpack` uses `ts-loader`'s real `tsc` semantics
rather than esbuild — the same class of pipeline as the plain-`tsc`-watch
mode that never showed metadata corruption.

## ADR-007: Phase 6 marketplace pilot runs mock-only — no real Etsy account

connected

**Decision recorded 2026-07-14, founder-confirmed.** Before any Phase 6
work began, the founder was asked whether to connect a real Etsy seller
account for this pilot or proceed entirely against a mock adapter. The
founder's explicit instruction was: **"I WILL NOT CONNECT MY ETSY ACCOUNT
NOW, CONTINUE TO FINISH MY AGENCY"** — i.e., build the full pilot pipeline,
but do not obtain or use real Etsy OAuth credentials, and do not make any
live call to Etsy's API.

This is a real, load-bearing decision, not a placeholder default: master
spec section 21 requires that any claim of "verified working with a real
account" be literally true before it's written down anywhere, and this
project's docs (`docs/EXECUTION_PLAN.md`, `docs/ROADMAP.md`, `TODO.md`,
`docs/INTEGRATIONS.md`) consistently say "mock-only" rather than implying
real-account verification. Consequences:

- `@ventureos/marketplace-connectors` only implements
  `fetchMockCreateDraftListing`/`fetchMockUploadListingImage`/
  `fetchMockUploadListingFile`/`fetchMockPublishListing`
  (`mock-etsy-client.ts`). No real Etsy API client exists yet.
- `MarketplaceAccount.mode` is `'MOCK'` for every account row; the schema
  supports a future `'REAL'` mode but nothing in this codebase sets it.
- If a real account is connected later, real OAuth credentials must never
  be pasted into chat or committed to source. They go into the project's
  local `.env` file and are referenced only by environment-variable name
  through the existing `SecretReference` pointer pattern (the same pattern
  already used for other secrets in this project).
- Switching to a real account means adding a real Etsy API client behind
  the same interface the mock client implements — not rewriting the
  publication pipeline, approval gate, idempotency layer, or audit trail,
  all of which are already real and adapter-agnostic.

See `docs/ETSY_API_INTEGRATION.md` for the real Etsy Open API v3 research
(OAuth 2.0 + PKCE, endpoint sequence, rate limits) that the mock client's
shapes are deliberately modeled on, so that swapping in a real client later
is a narrow, well-scoped change.

## ADR-008: Temporal worker activities get their own audit-write path,

duplicating `AuditService.record()` without NestJS DI

**Decision recorded 2026-07-14, found via live browser verification.**
Live end-to-end verification of the Phase 6 prepare → approval → publish
flow (run through the real UI via Claude in Chrome, not just integration
tests) included, as a bonus check, opening the Audit Centre to confirm the
expected audit trail. It did not appear: only `PUBLICATION_WORKFLOW_STARTED`
(written synchronously by `apps/api` when the workflow is started) and
`APPROVAL_DECIDED` (written synchronously by `ApprovalsService.decide()`)
were present. `PUBLICATION_PREPARED`, `PUBLICATION_APPROVAL_REQUESTED`, and
`PUBLICATION_PUBLISHED` were all missing, despite the publish having
genuinely succeeded (a real mock listing URL rendered on the product page).

**Root cause**: `apps/worker` (the Temporal worker process) has no NestJS
dependency-injection container. Its activities call
`@ventureos/marketplace-connectors` package functions
(`prepareListingForPublication`, `requestPublicationApproval`,
`publishListing`) directly, entirely bypassing `apps/api`'s
`MarketplaceService`/`AuditService` (both NestJS-only). This meant every
phase's primary UI path — clicking "Start ..." to kick off a Temporal
workflow — only ever audited the workflow-start call and the founder's
eventual decision, never the workflow's own intermediate steps. A code
review confirmed the identical gap in Phase 3
(`board-approval-activities.ts`: board review completion, approval-request
creation) and Phase 4 (`product-listing-activities.ts`: product
generation, listing generation) — in fact those two phases had it worse,
since neither has a synchronous manual endpoint at all, only the
Temporal-workflow path.

**Options considered**, presented to the founder: (1) fix Phase 6 only,
since that's the phase being verified this round; (2) fix all three
affected phases (3, 4, and 6) for full consistency; (3) document as a known
limitation and defer. The founder's explicit decision: **"Fix all three
phases now."**

**Fix**: a new standalone `writeAuditEvent()` function
(`apps/worker/src/lib/write-audit-event.ts`) duplicates
`AuditService.record()`'s exact logic — build the record via
`buildAuditEventRecord` from `@ventureos/observability`, insert via
`prisma.auditEvent.create` from `@ventureos/database` — without requiring a
NestJS DI container, since none exists in `apps/worker`. It is called
directly from within each affected Temporal activity, immediately after
that activity's underlying package-function call succeeds:

- `marketplace-activities.ts`: `PUBLICATION_PREPARED`,
  `PUBLICATION_APPROVAL_REQUESTED`, and `PUBLICATION_PUBLISHED` (or
  `PUBLICATION_FAILED`, based on the real result status)
- `product-listing-activities.ts`: `PRODUCT_GENERATED`, `LISTING_GENERATED`,
  and `APPROVAL_REQUESTED` (`ApprovalRequest`, kind `PRODUCT_LISTING`)
- `board-approval-activities.ts`: `BOARD_REVIEW_COMPLETED` and
  `APPROVAL_REQUESTED` (`ApprovalRequest`, kind `VENTURE_PROPOSAL`)

Each workflow (`marketplace-publication-workflow.ts`,
`product-listing-workflow.ts`, `board-approval-workflow.ts`) was updated to
pass `actorId` and `workflowId: workflowInfo().workflowId` down into the
activities so the resulting audit rows carry the same correlation
information the synchronous API-side audit events already do.

**Trade-off accepted**: this duplicates `AuditService.record()`'s logic in
two places rather than sharing one implementation, because sharing would
require either giving `apps/worker` a NestJS DI container (out of scope,
architectural change) or moving `AuditService` out of NestJS entirely (would
touch every other consumer). The duplication is small (one function) and
the two copies were verified to build the identical `AuditEvent` row shape.
If `AuditService.record()`'s logic changes in the future, both copies must
be updated together — this is a known maintenance cost, not an oversight.

**Verified 2026-07-14**: re-ran the full live browser verification after
the fix. The Audit Centre now shows the complete chain in order —
`PUBLICATION_WORKFLOW_STARTED` → `PUBLICATION_PREPARED` →
`PUBLICATION_APPROVAL_REQUESTED` → `APPROVAL_DECIDED` →
`PUBLICATION_PUBLISHED` — and the full verification suite
(format/lint/typecheck/build/test:unit, 16/16 packages) stayed clean after
the change.

## ADR-009: Two real Phase 7 bugs found via testing and live verification —

Gate 6 `packageHash` mismatch, and `serverApiFetch` crashing on NestJS's
empty-body null responses

**Bug 1 — Gate 6 SCALE approvals would have permanently failed closed.**
Found while writing `finance.integration.spec.ts` (task #84), before
reaching the founder. `requestScaleDecisionApproval`
(`packages/finance-engine/src/experiment-runner.ts`) computed
`packageHash = hashObject({ proposalSnapshot: latestVersion.snapshot,
resultsHash })` — wrapping the venture proposal's snapshot together with a
separate experiment-results hash inside an object. But
`decideApprovalRequest`'s default branch
(`packages/agent-runtime/src/approval-runner.ts`), used to re-validate
every `ApprovalRequest.kind` other than `PRODUCT_LISTING`/`PUBLICATION`,
re-computes `currentHash = hashObject(latestVersion.snapshot)` — the bare
snapshot alone, no wrapping. These two hash computations could never
produce equal values, so every Gate 6 `SCALE_DECISION` approval would have
been rejected with `PACKAGE_HASH_MISMATCH` and marked `EXPIRED`,
regardless of whether any real drift occurred. **Fix**: removed the
now-unused `computeExperimentSnapshotHash` helper; changed `packageHash` to
`hashObject(latestVersion.snapshot)`, the exact scheme `createApprovalRequest`
already uses for `VENTURE_PROPOSAL` requests. Updated the function's JSDoc
to explicitly document why `packageHash` must exactly match this scheme,
for future maintainers extending `ApprovalRequest.kind`. Verified via the
integration test suite (54/54 passing) and again via live browser
verification of a fresh Gate 6 approval (see `docs/EXECUTION_PLAN.md`
Phase 7 section) — no hash mismatch under a real end-to-end run.

**Bug 2 — `serverApiFetch` crashed on a venture's real zero-state.** Found
via live browser verification (task #86), the first time the Finance
Centre venture detail page was opened for a venture with no
`FinancialAssumption`/`FinancialForecast` generated yet — exactly the real
state every fresh venture starts in, which no integration test had
exercised through the HTTP layer (integration tests call
`FinanceService`/the runner functions directly and assert on the returned
`null`, never round-tripping it through an actual HTTP response). The page
crashed with `Error: Unexpected end of JSON input`. **Root cause**: NestJS
special-cases a controller handler returning `null` or `undefined` as "no
body to serialize" and sends a genuinely empty HTTP response body — not
the JSON text `"null"` that `JSON.stringify(null)` would produce. The
shared `serverApiFetch` helper (`apps/web/src/lib/server-api.ts`, used by
all 16 server-rendered dashboard pages, several of which have GET-by-
something endpoints that can legitimately return `null`) called
`res.json()` unconditionally, which throws a `SyntaxError` on an empty
body. **Fix**: read the response as text first; treat an empty string as
`null`, matching the `T | null` return type every caller already declares
and handles. No change to any endpoint's actual behavior — the API always
worked this way, the client simply never defended against the empty-body
case until a genuine one was exercised live. Verified live afterward: the
page renders its correct zero-state copy ("No assumptions set yet...", "No
forecast generated yet.") instead of crashing, and the rest of the Phase 7
flow (forecast generation, expense/revenue recording, experiment
lifecycle, Gate 6 approval, audit trail) was confirmed end-to-end in the
same session.

**Pattern across both**: neither bug was visible from reading the code in
isolation — both required actually exercising the real request/response
path (an integration test hitting a real approval-decision re-validation
for Bug 1; a live browser hitting a real empty-database venture for Bug 2) to surface. This is the same lesson ADR-008 drew from Phase 6's
audit-trail gap: code review and unit tests on individual functions are
necessary but not sufficient — the master spec's requirement for live
browser verification at every phase boundary (section 34/41/45) exists
specifically to catch this class of integration-boundary bug before the
founder ever sees it.

## ADR-010: Phase 8 billing/subscriptions run mock-only — no real payment

processor connected

**Decision recorded 2026-07-14, founder-confirmed via "full SaaS resale
build-out" instruction.** Phase 8 builds a complete subscription/plan/
license model (`Plan`, `Subscription`, `SubscriptionInvoice`, `LicenseKey`)
so that VentureOS can be sold as a product to other founders, per master
spec section 3's long-term objective. Per the prohibited-actions rule that
governs this entire project (never execute a real financial transaction on
the founder's behalf), no real payment processor (Stripe, Paddle, etc.) is
integrated in this phase — `Subscription.billingMode` is hardcoded to
`'MOCK'` everywhere it's set, and every `SubscriptionInvoice` row is
created with `status: 'PAID'` unconditionally, never as the result of an
actual charge.

This follows the exact same pattern Phase 5 (research connectors) and
Phase 6 (marketplace pilot) established: build the real
lifecycle/enforcement logic (plan-limit guards, subscription state machine,
license issuance/validation) against a mock provider first, so that
swapping in a real payment processor later is an additive change behind
`@ventureos/billing`'s existing interface — not a rewrite of the
plan-limit enforcement, the registration flow, or the Settings UI.

**Consequences**:

- `changePlan`/`activateSubscription`/`cancelSubscription` all operate
  purely on the `Subscription`/`Plan` rows in this workspace's own
  database — no webhook, no external API call, no real money movement.
- A workspace's plan limits (`maxVentures`/`maxWorkspaceMembers`/
  `maxMarketplaceAccounts`) are enforced immediately and for real via
  `@ventureos/billing`'s guard functions, since that enforcement has
  nothing to do with whether billing itself is mock or real.
- Before a real payment processor is ever connected, `docs/DECISIONS.md`
  and `docs/EXECUTION_PLAN.md` must be updated to say so explicitly — the
  same "never claim real-account verification before it's literally true"
  rule ADR-007 established for Phase 6's marketplace pilot applies
  identically here.

## ADR-011: Four real Phase 8 bugs found via the verification suite —

`seed.ts` possibly-undefined, `@ventureos/billing` declaration-emit +
indexed-access errors, and a missing `apps/web` ESLint config that hid a
`react/no-unescaped-entities` violation backlog

**Context**: Phase 8 added a brand-new workspace package
(`@ventureos/billing`) and touched `packages/database/src/seed.ts` for the
first time in several phases. Running the founder's real
`pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run
build && pnpm test:unit && pnpm --filter @ventureos/api test:integration`
suite surfaced four distinct real bugs across several rounds, each fixed
before Phase 8 was marked done.

**Bug 1 — `seed.ts` `TS18048`.** `seededPlans['AGENCY']` is typed
`{id: string} | undefined` under `noUncheckedIndexedAccess`, even though
`DEFAULT_PLANS` always includes an `AGENCY` entry — TypeScript can't know
that from a plain array literal indexed by string key. **Fix**: an explicit
`if (!agencyPlan) { throw new Error(...) }` guard immediately after the
lookup, which also turns a silent wrong-assumption into a loud, actionable
failure if `DEFAULT_PLANS` is ever restructured without an `AGENCY` tier.

**Bug 2 — `@ventureos/billing`'s `tsc` build only ran for the first time
after `pnpm install`.** `packages/billing` was a brand-new workspace
package; until the founder ran `pnpm install`, `pnpm-lock.yaml` didn't know
about it (turbo's own warning: `Workspace 'packages/billing' not found in
lockfile`), so its `build`/`typecheck`/`test:unit` tasks were silently
skipped by every prior verification round, and `apps/api`'s
`auth.integration.test.ts` failed to even load
(`Failed to load url @ventureos/billing ... Does the file exist?`). Once
`pnpm install` linked it in, three real errors surfaced that had been
masked the entire time:

- `subscription-runner.ts`'s `startTrialSubscription`/`changePlan`/
  `activateSubscription` each hit `TS2742` ("inferred type ... cannot be
  named without a reference to .../@prisma/client/runtime/library.js") —
  the exact same class of bug ADR already documented for Phase 3's
  `approval-runner.ts` (`docs/EXECUTION_PLAN.md` Phase 3 verification
  notes): TypeScript's declaration-emit can't portably name an inferred
  Prisma payload type across the monorepo's nested `node_modules`. **Fix**:
  a named `SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{include:
  {plan: true}}>` type alias, used as each function's explicit return type.
- Two of the package's own unit test files indexed arrays without
  accounting for `noUncheckedIndexedAccess`: `errors.test.ts` read
  `errors[0].message` after building a literal array (`TS2532`), and
  `plans.test.ts` looped `DEFAULT_PLANS[i-1]`/`DEFAULT_PLANS[i]` without a
  non-null assertion (`TS18048`, 8 occurrences). **Fix**: captured the
  first error in a named const instead of indexing back into the array, and
  added `!` non-null assertions in the loop — matching the `.find(...)!`
  style the same file already used elsewhere.

**Bug 3 — `apps/web` had no local ESLint config, so `next lint` never
loaded the `@next/next` plugin.** This was silently true since Phase 1 (visible
only as a non-fatal warning — "The Next.js plugin was not detected in your
ESLint configuration" — never a failure, because nothing had ever used a
`@next/next`-namespaced rule). Phase 8's white-label branding work added
`// eslint-disable-next-line @next/next/no-img-element` above the branding
logo `<img>` tag in `dashboard/layout.tsx`; ESLint hard-errors when a
disable comment references a rule from a plugin that isn't loaded
("Definition for rule ... was not found"), which broke both `lint` and
`build` (`next build` re-lints during production build). **Fix**: added
`apps/web/.eslintrc.json` extending `next/core-web-vitals` (+`prettier`),
without a `root: true` override so it still merges with the monorepo root
config's `@typescript-eslint` rules.

**Bug 4 — that fix immediately surfaced a backlog of 7 real
`react/no-unescaped-entities` violations.** Once `next/core-web-vitals`
actually loaded, its `react/no-unescaped-entities` rule flagged raw
apostrophes in JSX text across 6 files
(`dashboard/finance/page.tsx`, `dashboard/page.tsx`,
`dashboard/research/[id]/page.tsx`, `dashboard/settings/page.tsx`,
`components/finance-actions.tsx`, `components/research-connector-actions.tsx`)
that had been written across Phases 1, 5, 7, and 8 and never actually
linted against this rule before. **Fix**: escaped each with `&apos;`
(e.g. `finance-engine&apos;s`, `What&apos;s real vs. planned`) — a
cosmetic-only change, no behavior difference.

**Pattern across all four**: three of the four bugs (2, 3, 4) were only
reachable because a *tooling gap* (an unlinked workspace package, a missing
ESLint config) had been silently suppressing an entire category of checks
for one or more prior phases — the underlying code defects themselves had
existed unnoticed the whole time. This is a different failure mode from
ADR-008/ADR-009's integration-boundary bugs, but the same underlying lesson:
a "clean" verification run only proves what it actually executed, not what
it silently skipped — worth periodically confirming that every workspace
package's tasks are genuinely running (e.g. checking turbo's task count
against the expected package count), not just that the tasks that did run
passed.
