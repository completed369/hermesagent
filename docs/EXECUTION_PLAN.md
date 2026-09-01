# Execution Plan — Phase 0 to Phase 8

> **DELIVERY UPDATE — reviewed 2026-08-26.** The Phase 0–8 record below is
> historical implementation evidence, not a production-readiness or deployment
> claim. The dated reviewed source baseline for this update is
> `d462733ec55a8bc98092e39a5a071c01b9c76806`; GitHub is authoritative for live
> repository main and checks, and generated protected Mission Control evidence
> is authoritative for live operations. Product PRs #59–#85 are merged,
> including the Agent Control Plane, Runtime Broker, Dynamic Agent Factory,
> runtime-interface ADR, tenant-shell switch repair, AI COO, Voice Gateway,
> unified event/audit spine, approval execution-permit bridge, durable
> objective/project/task/run spine, durable protocol-neutral Agent Bridge
> admission, durable broker decision and capacity/budget reservation evidence,
> a scoped deny-only bridge secret-lease boundary, a pure inert OS-supervision
> admission policy, and sanitized release-
> candidate evidence workflow/hardening.
> A pure lifecycle/cancellation contract and deterministic test-only process-
> tree harness add bounded Windows/Linux cancellation evidence without adding a
> production launcher, runtime connection, provider, or deployment path.
> Approval preparation now binds to real workspace-scoped
> durable task/run rows. Exact-main CI passed the full
> migration chain, application integration/E2E, and staging-security/load gate
> without deployment. CodeQL passed, with zero open alerts when checked on
> 2026-08-25. The sanitized five-image workflow passed with no artifact upload
> and no deployment. No image for current `main` has been published and current
> `main` has not been deployed to private staging.
>
> These merged foundations are not evidence that Codex, Hermes, Pi, or any
> external runtime is connected. All three remain **NOT_CONFIGURED** until
> authenticated registration, capability exchange, heartbeat, task/status
> exchange, and an event/result round trip are evidenced. The Voice Gateway is
> not an activated speech provider or verified live voice service. Current-main
> backup/restore and rollback rehearsal, live providers, production
> observability, commercial proof, and legal/privacy readiness remain unfinished.
> The merged bridge is a service-only authenticated admission boundary validated
> against a deterministic test fixture; it has no transport, controller,
> network, or process-launch path and stops runtime truth at `PARTIAL`. Durable
> broker reservations now serialize exact, short-lived capacity, cost, and
> compute holds without launching a runtime or creating a provider/finance
> charge. The next

Authenticated `USAGE` evidence is being paired atomically with a durable
workspace/task budget ledger. This recognizes spend only after exact bridge
evidence; broker reservations remain estimates rather than financial charges.

> The next
> runtime dependency now includes a reviewed Linux executable/admission-evidence
> reader and a deny-by-default supervisor composition with a live per-admission
> authorization port. Executable-signature verification is now an explicit
> dependency across authorization, evidence, admission, and launch revalidation;
> production injects only a deny verifier, and the pinned key is test-only.
> A bounded verifier for explicitly supplied, fingerprinted Ed25519 trust records
> is available but unconfigured; no production trust source or live revocation
> feed is wired.
> Production authorization and launching still deny.
> A pure bounded post-authentication runtime-to-parent JSONL driver now verifies
> atomic in-memory batches through scoped secret leases, without owning I/O or
> durable state. Process creation, handshake transport, and supervisor-owned
> handles remain separate later changes before any real Codex, Hermes, or Pi
> adapter is treated as usable.
> A fixed Linux x86-64 helper and test-file-local launcher now supply test-only
> evidence that a composition-owned, one-use request reaches sealed retained-descriptor
> execution. The fixed no-child policy denies process creation and session/group escape,
> then proves TERM-to-KILL cleanup of the one admitted process. This is not general
> process-tree containment. The native path is absent from production packages/images,
> and production authorization and launching still deny.
> A proposed Linux-only deterministic test composes that opaque launch handoff with the bounded
> post-authentication JSONL verifier. The fixed ELF receives a synthetic test secret only through
> an anonymous descriptor, emits exact success or parent-cancellation lifecycle frames, and yields
> evidence only after native cleanup. This remains absent from production packages/images and does
> not configure, connect, or change the durable status of any runtime.
>
> Active delivery order and approval boundaries are tracked in `ROADMAP.md`.
> `ventureos.site` is the public entry point; `staging.ventureos.site`,
> `api-staging.ventureos.site`, and `progress.ventureos.site` are
> protected. A dated operations snapshot verified 2026-08-25 records operations
> PR #24 as deployed to the Access-protected Founder Mission Control. Private
> operations evidence and the live Access boundary are authoritative for newer
> state; this product plan is not an operations pin. GitHub remains the source of
> exact product commit and CI evidence.

This is the single source of truth for "what is actually done" versus "what
is still to build," across the entire master spec (all numbered phases 0–8, section
34). It exists because the master spec explicitly forbids building every
phase at once and requires stopping for a verified report at each phase
boundary (sections 34, 41, 45). Update this file every time a phase's status
changes — do not let it go stale like the original `TODO.md` did.

> **STATUS UPDATE — 2026-07-15.** Phase 2-8 work is now committed and
> protected on branch `recovery/phase2-8-checkpoint-20260715`: checkpoint
> `6c8a699` (recovered Phase 2-8 working tree), `933691e` (Prettier
> formatting), `5594883` (PowerShell validation-script argument-handling fix).
> The working tree is clean. A fresh `.\scripts\run-validation.ps1` run after
> `5594883` passed all six stages (exit 0): format check; lint 17/17 tasks;
> typecheck 36/36 tasks; unit tests 67; integration tests 7 files / 54/54;
> production build 20/20. Docker services verified healthy/running
> (PostgreSQL, MinIO, Temporal, Temporal UI); API `/api/health/ready`
> returned HTTP 200. The earlier `opportunities.service.ts` Prisma typecheck
> errors came from stale historical logs and are not present in the fresh
> typecheck. Non-blocking known warning: turbo reports no output files
> configured for `@ventureos/api#build`. **Unchanged:** VentureOS is a
> verified local development build, NOT production deployed; real AI provider,
> live Etsy publication, real payments, and advertising remain
> disabled/pending; and two known UI tasks are still open — (1) wire real
> Command Centre stats + remove stale phase text/badges, and (2) fix the
> Product Studio nav link that duplicates Board Room.

> **STATUS UPDATE — 2026-07-16.** The two UI tasks noted as still open in the
> 2026-07-15 update are now RESOLVED, and a local-development founder
> credential rotation utility has been added and used — all committed on
> branch `feat/command-centre-product-studio-20260715` and validation-green.
>
> - `2b931a3 fix(auth): inject Reflector in permission guard` — PermissionGuard
>   now injects `Reflector` explicitly (`@Inject(Reflector)`), covered by a
>   guard test; fails closed on a missing permission.
> - `5a01583 feat: wire Command Centre and add Product Studio index` — the
>   Command Centre now uses **real workspace data** instead of fabricated
>   values (via unit-tested helpers in `apps/web/src/lib/dashboard.ts` that
>   fail safe to "—" and never fabricate a count or limit); **Product Studio
>   has its own `/dashboard/products` route** and no longer shares Board
>   Room's nav destination; a **workspace-scoped `GET /api/products`**
>   endpoint was added, requiring authentication plus `product:view`. Product
>   queries are workspace-scoped. Stale phase badges and the false "not yet
>   built" copy were removed.
> - `13c8021 test(e2e): load local environment for Playwright` — Playwright
>   loads the root local `.env` without hardcoding credentials; the existing
>   login/dashboard E2E suite passes **4/4**.
> - `c9d5de4 chore(security): add local founder credential rotation utility` —
>   a **local-development-only** utility (`pnpm db:reset-founder-password`)
>   that updates **only** the founder `passwordHash` and revokes **only** that
>   founder's sessions in a single transaction, reads inputs only from env
>   vars, never prints the email/password, and **rejects `NODE_ENV=production`**.
>   The actual local founder credential was rotated successfully and previous
>   founder sessions were revoked; the replacement password is deliberately
>   not recorded anywhere. **Focused rotation tests: 12 passing.**
>
> Verification 2026-07-16: `pnpm install --frozen-lockfile` passes; all six
> official validation stages pass (`.\scripts\run-validation.ps1`, exit 0);
> the working tree was clean after verification. **Unchanged:** VentureOS
> remains a verified local development build, NOT production deployed; **Phase
> 9 has not started**; real AI provider, live Etsy publication, real payments,
> and advertising spend remain disabled/pending; founder approval remains
> mandatory for sensitive actions; nothing has been pushed, merged, or
> deployed.

**Status legend**

- ✅ **DONE** — built, and personally verified working (I ran it, or drove it
  live, or the founder pasted real passing output)
- 🟡 **BUILT, UNVERIFIED** — code exists and looks correct but has not been
  exercised end-to-end
- ⬜ **NOT STARTED**
- 🚫 **BLOCKED** — cannot proceed without founder input (credentials,
  spending, legal, irreversible action)

---

## Phase 0 — Environment and Repository — ✅ DONE

All Phase 0 acceptance criteria (spec section 38) met and verified during
this session:

- ✅ Repository exists at `D:\Documents\claudehermespromt\ventureos`, Git initialised
- ✅ Monorepo installs (`pnpm install` completed successfully, founder-verified)
- ✅ Docker Compose validates and all 4 services (Postgres, Temporal, Temporal UI, MinIO) start and reach healthy/running state (founder-verified, after fixing the `DYNAMIC_CONFIG_FILE_PATH` crash-loop)
- ✅ Health checks pass for infra containers
- ✅ All 30 required documentation files exist with real content (not stubs)
- ✅ `.env.example` exists, no real secrets anywhere in the repo
- ✅ Setup commands documented (`docs/LOCAL_SETUP_WINDOWS.md`)
- ✅ Committed in logical, descriptive commits (see `git log`)

**No open items.**

---

## Phase 1 — Foundation — ✅ DONE

Per spec section 39: _"Do not mark Phase 1 complete when any mandatory
acceptance criterion fails."_ Being honest about where this actually stands:

### Verified working (I confirmed these myself or the founder pasted real passing output)

- ✅ Web app starts (`next dev`, dashboard and login pages compile and render)
- ✅ API starts (`Nest application successfully started`, all routes mapped)
- ✅ Worker starts and connects to Temporal (`Worker state changed ... RUNNING`)
- ✅ Database migration succeeded (`prisma migrate dev`, migration name `init`)
- ✅ Seed command succeeded (founder user/role/workspace/permissions created)
- ✅ Founder can log in — I drove this myself via the browser just now: submitted `founder@ventureos.local` / `change-me-dev-only`, landed on `/dashboard` with real seeded data, zero console errors
- ✅ Unauthenticated access is blocked — confirmed via real 401s on `/api/auth/me` and `/api/workspaces/current` before login, and a 307 redirect to `/login` when visiting `/dashboard` unauthenticated
- ✅ Founder workspace loads (dashboard renders workspace-scoped data)
- ✅ Dashboard loads with real data (Command Centre widgets, integration status table)
- ✅ Role checks enforced server-side (`SessionAuthGuard`/`PermissionGuard`, not frontend-only)
- ✅ Startup steps documented (`docs/LOCAL_SETUP_WINDOWS.md`, `scripts/*.ps1`)
- ✅ No external publication occurs, no paid service required (true by construction — no live adapters exist yet)
- ✅ Changes committed in logical commits throughout

### Newly verified this session

- ✅ **Format check** (`pnpm run format:check`) — clean after `pnpm run format` fixed 65 pre-existing style issues
- ✅ **Lint** (`pnpm run lint`) — clean
- ✅ **Full-repo typecheck** (`pnpm run typecheck`) — clean across all 15 packages/apps after fixing 4 real bugs found by the first-ever full run: a non-tuple return type in `finance-engine`, a value/type confusion in `contracts` (`VetoType`), a union-indexing issue in `policy-engine`'s `board-voting.ts`, and a possibly-undefined mock-call access in an `observability` test. See `docs/KNOWN_LIMITATIONS.md` for details on each.
- ✅ **Unit tests** (`pnpm test:unit`) — 12/12 packages passing, 67 individual tests, zero failures. `packages/database` correctly reports "no test files" (nothing pure to unit test yet — client singleton + a script needing a real DB) rather than being force-failed.
- ✅ **Integration tests** (`pnpm --filter @ventureos/api test:integration`) — 3/3 passing against a real Postgres instance
- ✅ **Production build** (`pnpm build`) — clean: `apps/web`, `apps/worker`, `apps/api` all build successfully

### Dev-runner reliability (its own saga — see ADR-005/ADR-006 for full detail)

- ✅ `apps/api`'s dev runner went through several rounds of real, reproduced failures before landing on a stable configuration: a `tsx`/esbuild decorator-metadata reliability gap across hot-reload cycles (fixed via explicit `.js` import extensions + reverting to `nest start --watch`), a deterministic `dist/main` race under plain `tsc`-watch (fixed via `--webpack`), and workspace packages being resolved as raw, uncompiled TypeScript at runtime once webpack's externals kicked in (fixed by giving every workspace package a real `tsc` build to `dist/` and wiring `turbo`'s `dev` task to depend on `^build` — which also required dropping the deprecated `--parallel` flag that was silently bypassing the dependency graph). Verified via a clean full-stack boot: worker connects to Temporal and reaches `RUNNING`, webpack compiles, `Nest application successfully started` with every route mapped.

### Newly verified this session (manual exercise, not just code review)

- ✅ **Founder can log out** — found and fixed a genuinely broken "Sign out" control: it was a `<form action="/api/logout-redirect">` wrapping a plain `<a href="/login">`, which neither submits the form nor calls any real endpoint (and `/api/logout-redirect` was never implemented as a route anyway) — so the session was never revoked. Confirmed live: `GET /api/auth/me` still returned 200 after clicking it. Replaced with a real client component that calls `POST /api/auth/logout` directly; confirmed live that `/api/auth/me` now returns 401 afterward and the DB session row is revoked.
- ✅ **Onboarding saves** — found and fixed a real Zod schema bug: `GET /api/onboarding` returns Prisma's actual `null` values for never-filled-in optional fields, but `onboardingSchema` only accepted `undefined` for those fields, so every save after the very first one (once any field had a stored `null`) failed with a 500 — confirmed live via both a direct API call and clicking Save in the actual browser UI. Fixed by adding `.nullable()` to match the Prisma column nullability exactly. Confirmed live afterward: edited the budget field in the real UI, clicked Save, and `GET /api/onboarding` reflects the new value.
- ✅ **Audit events are recorded** — found and fixed a real gap: `AuditService.record()` was fully implemented (integrity hashing, append-only insert) but nothing in the codebase ever called it — the Audit Centre showed "No audit events yet." even after real logins and saves. Wired it into `OnboardingService.save()` (before/after diff, `ONBOARDING_PROFILE_SAVED`). Confirmed live: the Audit Centre now renders a real event with a real timestamp and correlation reference.
- ✅ **Security events are visible** — confirmed live: the Security Events page renders real `LOGIN_SUCCESS`/`LOGIN_FAILURE` rows with real timestamps, straight from the DB.
- ✅ **Historical Phase 1 health verification (superseded for current behavior)** — at that time `/api/health/temporal` started `helloWorkflow` and returned its result. Phase 12 removed that mutating health behavior: current liveness is process-only, readiness checks PostgreSQL/storage/Temporal, and the compatibility route performs only a bounded gRPC Health `Check`. See `docs/HEALTH_CHECKS.md`.
- ✅ **MinIO integration works in development** — found and fixed a real bug in `@ventureos/config`: `z.coerce.boolean()` is just `Boolean(value)`, and `Boolean("false")` is `true` in JavaScript, so `MINIO_USE_SSL=false` was silently coerced to `true`, and the MinIO client opened a TLS handshake against MinIO's plain HTTP port — exactly the `wrong version number` SSL error `/api/health/ready` surfaced. Fixed with a proper string-parsing boolean helper (also fixed the same latent bug in 5 other boolean env vars). Confirmed live: `/api/health/ready`'s storage check is now `ok`.
- ✅ **Historical Temporal workflow proof** — `helloWorkflow` was executed during the Phase 1 verification above. It remains ordinary explicit development-test functionality, but no current health endpoint starts it or uses workflow execution as a worker-readiness claim.

### End-to-end test — ✅ DONE

- ✅ **Playwright e2e** (`pnpm --filter @ventureos/web test:e2e`) — installed Chromium (`playwright install --with-deps chromium`), ran against the real local stack (Postgres, API, web, seeded founder account). First run: 3/4 passed, 1 failed on a real test bug (`getByText('Command Centre')` matched both the sidebar nav link and the page `<h1>`, tripping Playwright's strict-mode ambiguity check — not an app bug). Fixed by scoping to `getByRole('heading', ...)`. Second run: **4/4 passing**.

**Every Phase 1 acceptance criterion is now genuinely verified**, not just
reviewed as code. Every bug that surfaced along the way was root-caused and
fixed, not worked around: a completely non-functional logout button, missing
audit-event wiring, an onboarding schema rejecting real Prisma nulls, a
`z.coerce.boolean()` bug that silently broke MinIO's SSL config, three
layers of dev-runner instability (tsx/esbuild decorator-metadata
corruption, a `dist/main` race, workspace packages resolved as raw
TypeScript at runtime), and a strict-mode-ambiguous e2e locator. Per spec
section 39, Phase 1 is complete and Phase 2 may now begin.

---

## Phase 2 — Opportunity and Evidence — ✅ DONE

Deliverables per spec section 34 + module 23.4 + data model section 22 +
scoring sections 17/18, built on top of `@ventureos/scoring-engine` (already
built and unit-tested in Phase 1, now wired to real persisted data).

1. ✅ **Data model** — `Opportunity`, `OpportunityScore`, `TargetCustomer`, `ChannelRecommendation`, `DataSource`, `EvidenceArtifact`, `EvidenceClaim`, `VentureProposal`, `VentureProposalVersion` Prisma models added; migration `20260713140054_phase2_opportunity_evidence` generated and applied against the real local Postgres instance (founder-run, confirmed via the migration log).
2. ✅ **Seed data** — the "Social Media Content Planning Kit" opportunity (spec section 25) seeded with realistic mock evidence artefacts, clearly labelled as seed/mock throughout `packages/database/src/seed.ts` (per spec section 15). Founder-run seed confirmed live: `Opportunity Score 71.5, Profit Confidence 61.75, speculative=true`.
3. ✅ **Evidence claim classification** — `EvidenceClaimType` (zod enum, `packages/contracts/src/evidence.ts`) enforces exactly the six types; the seed data includes one real example artifact/claim pair per type, and the UI renders each with a distinct badge — never silently defaulted to "verified."
4. ✅ **API** — `GET /api/opportunities`, `GET /api/opportunities/:id`, `POST /api/opportunities/:id/reject`, `POST /api/opportunities/:id/archive`, `POST /api/opportunities/:id/promote` — all workspace-scoped, gated behind `opportunity:view`/`opportunity:manage` permissions. Promote creates/reuses a `VentureProposal` and appends a new `VentureProposalVersion` snapshot inside a transaction, feeding Phase 3.
5. ✅ **Wired `@ventureos/scoring-engine`** into the seed pipeline — `calculateOpportunityScore`/`calculateProfitConfidenceScore` are called directly (never hand-computed), persisted as `OpportunityScore` rows with `formulaVersion`, factor inputs, and factor contributions.
6. ✅ **Profit Confidence Score** — `isSpeculative` flag persisted and rendered as a visible "Speculative" badge on both the Opportunity Feed list and detail pages, confirmed live in the browser.
7. ✅ **Opportunity Feed UI** (`apps/web/src/app/dashboard/opportunities/`) — list page (title, status, both scores + speculative badge, estimated profit, time to launch, evidence source count) and detail page (target customer, suggested product/marketplace, channels, risks, full evidence trail, actions).
8. ✅ **Evidence display component** — source, retrieval date, reliability/freshness/relevance scores, terms-of-use note, content hash (truncated, monospace) — all visible per artefact on the detail page, confirmed live.
9. ✅ **Unit tests** — `opportunities.service.spec.ts` (10 tests: list/getById/reject/archive/promote, including workspace-isolation and already-promoted guards) — all passing.
10. ✅ **Integration tests** — `opportunities.integration.spec.ts` against a real Postgres instance (4 tests: workspace-scoped listing, cross-workspace 404, real audit-event write on reject, real `VentureProposal`+version creation on promote, idempotent-promotion guard) — all passing, alongside the existing `auth.integration.test.ts` (3 tests). 7/7 total.
11. ✅ **Docs** — `docs/DATA_MODEL.md`, `docs/EVIDENCE_MODEL.md`, `docs/SCORING_MODEL.md` updated from "specified, not implemented" to describe the actual implemented shapes.
12. ✅ **Phase 2 acceptance gate** — Gate 1/Gate 2 style numbers are visibly computed and displayed: Opportunity Score 71.5 (≥70) and Profit Confidence 61.75 (<70) render on both list and detail pages with a "Speculative" badge, exactly matching master spec section 18's requirement that a high-opportunity/low-confidence pairing be clearly labelled — confirmed live in the browser, not just in seed output.

### Verified working (founder-run migration/seed/tests, and I drove the browser live)

- ✅ Migration applied against the real local Postgres (`pnpm db:migrate:dev`)
- ✅ Seed ran successfully and produced the exact designed scores
- ✅ Format/lint/typecheck/build all clean across the full monorepo (15 packages/apps)
- ✅ Unit tests: 14/14 passing in `apps/api` (10 new opportunities tests + 4 pre-existing), full monorepo unit suite 12/12 packages passing
- ✅ Integration tests: 7/7 passing (found and fixed a real bug along the way — the first integration test run used `randomUUID()` as `AuditEvent.actorId`, which is a real foreign key to `User`, and failed 2/4 tests with a foreign-key violation; fixed by creating a real `User` row in the test's `beforeAll`)
- ✅ Live browser verification: logged in as founder, opened the Opportunity Feed list page (correct scores/badges/evidence count), opened the detail page (all 6 evidence claims rendered with correct classification badges, sources, hashes), clicked "Promote to Venture Proposal" — confirmed via direct API calls that the opportunity's status flipped to `PROMOTED`, a real `VentureProposal` (status `DRAFT`) was created, an `OPPORTUNITY_PROMOTED` audit event was written with the correct before/after snapshot and a real actor id, and the UI correctly switched to the terminal "no further actions available" state on both the detail page and the list page's status badge.

**No open items.** Reject/archive are covered by the integration test suite (real DB, real audit events) rather than a second live browser click, since promoting exercises the more complex transactional path (proposal + version creation) and reject/archive share the identical guard/audit pattern.

---

## Phase 3 — Board and Approval — ✅ DONE

Groundwork already existed ahead of schedule: `@ventureos/contracts`
(`AgentOutputSchema`, `ApprovalRequestSchema`/`ApprovalDecisionSchema`,
`isApprovalValidForExecution`) and `@ventureos/policy-engine`
(`calculateBoardVotingResult`, `evaluateCorePolicies`) were built and
unit-tested in Phase 1. Phase 3 wired these to real agent runs and real UI.

1. ✅ **`AgentDefinition`/`AgentPromptVersion` data model** — the 8 voting agents + Decision Synthesiser, each with role, responsibilities, tool allowlist, prohibited actions, input/output schema ref, prompt version, model config, cost/timeout limits (spec section 11). Seeded by `packages/database/src/seed.ts`.
2. ✅ **Mock board-agent provider** — `packages/agent-runtime/src/mock-provider.ts`; deterministic per-role lens over Phase 2 persisted scores, no live model calls (spec section 42), every output validated through `AgentOutputSchema.parse()` before returning (fail-closed).
3. ✅ **`VentureProposal`/`VentureProposalVersion`/`BoardReview`/`BoardVote`/`BoardVeto`/`DecisionSummary`/`RevisionRequest` Prisma models** — migration applied and verified.
4. ✅ **Board review orchestration** — `runBoardReview` in `packages/agent-runtime/src/board-review-runner.ts`; runs all 8 agents, persists `BoardVote`/`BoardVeto` rows, fails closed (`BoardReviewInvalidOutputError`) on any missing/invalid agent output.
5. ✅ **Wired `calculateBoardVotingResult`** to real persisted votes — 75% weighted threshold, default weights table, critical veto blocking, missing-review blocking. Live-verified: 8/8 APPROVE → weighted score 100/75, not blocked.
6. ✅ **Decision Synthesiser** — `packages/agent-runtime/src/decision-synthesiser.ts`; non-voting, recommendation is strictly derived from the pre-computed voting result, never introduces independent decision logic.
7. ✅ **Approval Centre module** — `ApprovalRequest`/`ApprovalDecision` Prisma models (execution/revocation fields collapsed onto `ApprovalRequest` since no execution path exists yet — deferred cleanly to Phase 4); full field set from spec section 14.
8. ✅ **Hash-bound approval enforcement** — `decideApprovalRequest` (`packages/agent-runtime/src/approval-runner.ts`) re-validates `isApprovalValidForExecution` against the proposal's current latest version before honoring any decision, server-side, every time — never a frontend-only check. Covered by an integration test that creates a second proposal version mid-flow and confirms the resulting `EXPIRED` state.
9. ✅ **Temporal `boardApprovalWorkflow`** (`apps/worker/src/workflows/board-approval-workflow.ts`) — runs the board review, creates the approval request, signal-waits up to 7 days for a `founderDecision` signal from the Approval Centre. Live-verified end-to-end via the web UI (see verification note below).
10. ✅ **Board Room UI** and **Approval Centre UI** — `apps/web/src/app/dashboard/board-room`, `apps/web/src/app/dashboard/approvals`.
11. ✅ **Unit tests** — mock-provider and decision-synthesiser pure-function tests (8 tests), covering schema validity across all roles, determinism, FINANCE veto triggering, and recommendation always mirroring the voting result.
12. ✅ **Integration + workflow-adjacent tests** — `apps/api/test/board-and-approval.integration.spec.ts` (5 tests, real Postgres): full board review, packageHash correctness, approve + already-decided rejection, revoke flow, hash-drift invalidation. `apps/api` unit tests cover `BoardService`/`ApprovalsService` including Temporal signal-sending and non-fatal signal failure (28 tests total in `apps/api`).
13. ✅ **Docs** — `docs/AGENT_ROLES.md`, `docs/AGENT_OUTPUT_CONTRACTS.md`, `docs/APPROVAL_MODEL.md`, `docs/WORKFLOWS.md` updated from spec text to actual implementation.

**Verification (2026-07-13):**

- ✅ `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build`: all clean across all 16 packages (a real TS2742 declaration-emit bug in `approval-runner.ts`'s two exported functions was found and fixed — added explicit `Promise<ApprovalRequest>`/`Promise<{approvalRequest, decision}>` return-type annotations, since TypeScript couldn't portably infer a name for the Prisma Client return type across the monorepo's nested `node_modules`).
- ✅ Unit tests: 13/13 packages passing, including `@ventureos/agent-runtime` (8/8) and `apps/api` (28/28).
- ✅ Integration tests: 12/12 passing, including the new `board-and-approval.integration.spec.ts` (5/5).
- ✅ Live browser verification: logged in as founder, opened the seeded Social Media Content Planning Kit opportunity, followed its "View Board Room for this venture proposal" link, clicked "Run Board Review" — the real Temporal workflow executed, all 8 mock board agents voted APPROVE (weighted score 100/75, no vetoes), the Decision Synthesiser correctly recommended APPROVE. Navigated to the resulting Approval Request in the Approval Centre (state PENDING, correct cost/hash/expiry/affected-resources), decided APPROVE with a comment — state transitioned to APPROVED, the decision row persisted with the correct founder identity and comment, and the Audit Centre showed both `BOARD_REVIEW_STARTED` and `APPROVAL_DECIDED` events tied to the correct entities.

**One resolved environment issue, not a code bug:** during verification, `web`/`api` dev servers repeatedly failed with `EADDRINUSE` on ports 3000/3001 — root cause was long-lived orphaned `node.exe` processes from an earlier session still holding those ports (likely the same stray process responsible for the earlier `prisma generate` EPERM warning noted during setup). Resolved by `taskkill /F` on the offending PIDs; not a defect in the Phase 3 code itself.

---

## Phase 4 — Product and Listing Studio — ✅ DONE

1. ✅ **`Product`/`ProductVersion`/`ProductAsset`/`ProductAssetVersion`/`ProductBrief`/`ProductPackage`/`LicenceRecord`/`QualityCheck`/`QualityCheckResult` models** — migration applied and verified against the real local Postgres instance.
2. ✅ **Mock product generation job** — `@ventureos/product-studio`'s `generateProductAssets` (`mock-product-generator.ts`); generates 7 real files across the 6 required asset kinds (PDF guide, CSV planner, editable template, 2 preview images, licence file, readme), clearly labelled MOCK in file content and never copyrighted marketplace content. Fails closed (`ProductGenerationBlockedError`) unless the venture proposal already has a founder-approved Phase 3 `ApprovalRequest`.
3. ✅ **MinIO file storage wiring** — every asset is uploaded through the already-built `StorageProvider` abstraction (`MinioStorageProvider` in dev/prod, `MockStorageProvider` in tests); `contentHash`/`sizeBytes` always come from the real upload result, never hand-typed.
4. ✅ **QA checks** — `qa-checker.ts`'s `evaluateQuality` (pure function, unit-tested) covers COMPLETENESS, FILE_INTEGRITY, NAMING_CONVENTION, DUPLICATE_ASSET, LICENCE_COMPLETENESS; persisted as real `QualityCheck`/`QualityCheckResult` rows.
5. ✅ **Licensing checks** — LICENCE_COMPLETENESS check plus a real `LicenceRecord` row created per licence asset, fails closed if missing.
6. ✅ **`Listing`/`ListingVersion`/`ListingImage`/`ListingFile`/`PriceProposal`/`SEOEvaluation`/`PublicationAttempt` models** — migration applied and verified.
7. ✅ **Etsy Digital Products — Development Pack** — `marketplace-policy-pack.ts`'s `ETSY_DEV_PACK_CONTENT` (v1), seeded as a real `MarketplacePolicyPack`/`MarketplacePolicyPackVersion` row; documented in `docs/MARKETPLACE_POLICY_PACKS.md`.
8. ✅ **Mock Etsy listing generation** — `listing-generator.ts`'s `generateListing`; deterministic title/description/tags/category/price/images/files derived from the approved proposal's data, explicitly draft-only, no live publish path exists.
9. ✅ **SEO evaluation** — `seo-evaluator.ts`'s `evaluateSeoContent` (pure function, unit-tested); scored 100/100 live against the real generated listing during verification.
10. ✅ **Final approval package** — `product-listing-runner.ts`'s `generateListingAndApprovalRequest` bundles the product package + listing into a new hashed `ProductPackage`, creates the second founder `ApprovalRequest` (`kind: 'PRODUCT_LISTING'`), and always records a `PublicationAttempt` with `status: 'BLOCKED_NO_LIVE_INTEGRATION'` — non-publication is a checkable DB fact, not an assumption.
11. ✅ **Product Studio UI** (23.8) and **Listing Studio UI** (23.9) — `apps/web/src/app/dashboard/products/[id]/page.tsx` (assets, QA results, licence records, listing, SEO score, publication-attempt status) plus a Product Studio section embedded in the Board Room detail page (`board-room/[proposalId]/page.tsx`) with the "Start Product Generation" action (`product-studio-actions.tsx`).
12. ✅ **Gate 3 (Product Validation)** and **Gate 4 (Listing Validation)** from spec section 30 enforced as real server-side blocking checks (`ProductGenerationBlockedError`/`ListingGenerationBlockedError`), not just displayed text — covered by integration tests that trigger both failure paths for real.
13. ✅ **Tests** — 25 unit tests (`qa-checker`, `marketplace-policy-pack`, `seo-evaluator`, all pure-function); `apps/api/test/product-and-listing.integration.spec.ts` (5 tests against a real Postgres): Phase 3 gate blocking, real asset generation reaching QA_PASSED, Gate 3 blocking, listing generation + always-blocked `PublicationAttempt`, and PRODUCT_LISTING hash-drift invalidation (mirroring Phase 3's VENTURE_PROPOSAL drift test). A dedicated Temporal `TestWorkflowEnvironment` suite was deliberately not added, following the same precedent Phase 3 set — the workflow is instead proven via live browser verification below.
14. ✅ **Docs** — `docs/MARKETPLACE_POLICY_PACKS.md` describes the real Etsy Development Pack content; `docs/WORKFLOWS.md` describes the real `productListingWorkflow`.

**Verification (2026-07-14):**

- ✅ `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`: all clean across all 17 packages/apps (17/17 build, 29/29 typecheck, 13/13 lint, 14/14 unit-test packages, including the new `@ventureos/product-studio` at 25/25 and `apps/api` at 28/28).
- ✅ Integration tests: 17/17 passing across all 4 suites, including the 5 new `product-and-listing.integration.spec.ts` tests.
- ✅ Live browser verification: logged in as founder, opened the seeded Social Media Content Planning Kit's Board Room (already founder-approved from Phase 3 verification), clicked "Start Product Generation" in the new Product Studio section — the real Temporal `productListingWorkflow` executed, the product reached `QA_PASSED`, and the product detail page correctly rendered all 7 real generated assets with real content hashes, all 3 QA check types PASSED with individual rule results, and the Listing Studio section showing the generated Etsy draft listing (title/tags/category/price/price rationale), an SEO score of 100/100 with all 4 checks PASSED, and the publication attempt clearly marked `BLOCKED_NO_LIVE_INTEGRATION` with its explanatory reason. Navigated to the resulting `PRODUCT_LISTING` approval request in the Approval Centre (state PENDING, correct product/listing IDs and package hash) and approved it — state transitioned to APPROVED with a real decision-history row.
- **One resolved environment issue, not a code bug:** the seed script's founder-user upsert only sets `passwordHash` on first creation (`update: {}`), so changing `DEV_FOUNDER_PASSWORD` in `.env` after the very first `pnpm db:seed` never took effect and login failed with a stale password. Fixed via a one-off local script (`packages/database/reset-founder-password.ts`, not part of the app) that re-hashes and writes the current `.env` password directly — not a defect in the Phase 4 code itself.

---

## Phase 5 — Research Connectors — ✅ DONE

1. ✅ **`DataAcquisitionContract`/`DataAcquisitionRun` models** — full field set per spec section 16 for every connector (source, purpose, access method, auth, allowed/prohibited operations, rate limits, retention, ToS considerations, disable switch), migration `20260713215625_phase5_research_connectors`, applied against real Postgres
2. ✅ **Permitted public-data adapters** — `@ventureos/research-connectors`'s `fetchMockResearchResult` is the only provider (mock-by-default, no live network calls anywhere in this phase, same principle as `AI_PROVIDER=mock`); real adapters are additive later work behind the same fail-closed contract-checking pipeline
3. ✅ **Evidence freshness/reliability scoring** — `computeFreshnessScore`/`computeReliabilityScore` (`packages/research-connectors/src/evidence-scoring.ts`), real deterministic computation feeding the `EvidenceArtifact` fields, replacing the Phase 2 hand-typed stub for every Phase-5-created artifact
4. ✅ **Research cost controls** — `assertWithinResearchCostCaps` (`packages/research-connectors/src/cost-guard.ts`), per-run and per-workspace-per-day caps, checked before every (mock, €0-cost) provider call, integration-tested (`BLOCKED_COST_CAP`)
5. ✅ **Source health monitoring** — `writeResearchConnectorHealth` upserts a real `Integration` row (`research:<slug>`) per contract, surfaced in the existing Command Centre "Integration status" table (Phase 1 UI slot) with zero new UI table needed — confirmed live (see verification below)
6. ✅ **Prompt-injection filtering** — `sanitizeUntrustedContent` (`packages/research-connectors/src/prompt-injection-sanitizer.ts`) runs on every raw acquisition payload before persistence; security-tested both at the unit level and against a real persisted `EvidenceArtifact` row (integration test)
7. ✅ **Docs** — `docs/DATA_ACQUISITION_CONTRACTS.md` filled with the 2 real seeded contracts and the real enforcement pipeline; `docs/THREAT_MODEL.md` updated with actual test evidence for prompt injection and malicious/poisoned research source; `docs/EVIDENCE_MODEL.md` updated to describe the real (Phase 5) vs. seed-time (Phase 2) scoring paths

**Verification (2026-07-14):**

- ✅ `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`: all clean across all 18 packages/apps (18/18 build, 31/31 typecheck, clean lint, including the new `@ventureos/research-connectors` at 13/13 unit tests).
- ✅ Integration tests: 23/23 passing across all 5 suites, including the 6 new `research-connectors.integration.spec.ts` tests (unknown-contract error, `BLOCKED_DISABLED` + Integration health write, `BLOCKED_RATE_LIMIT`, `BLOCKED_COST_CAP`, a real successful run persisting a real `EvidenceArtifact`, and the prompt-injection security proof against the actual persisted row).
- ✅ Live browser verification: opened the seeded "Etsy public listings (permitted browse)" contract in the new Research Connectors UI, confirmed every contract field rendered correctly (allowed/prohibited operations, rate limits, retention, ToS note, disable switch), clicked "Run acquisition now" — a real `DataAcquisitionRun` row appeared (SUCCEEDED, €0, 3 items retrieved, no prompt-injection flag) and a real `EvidenceArtifact` appeared (reliability 60, freshness 100, relevance 70, sanitized excerpt, real content hash). Navigated to the Command Centre and confirmed the `research:etsy-public-listings-permitted-browse` row appeared in the existing "Integration status" table with status CONNECTED, and "Integrations connected" updated to 1/4 — proving deliverable #5 needed no new UI code.
- **One resolved environment issue, not a code bug:** the `apps/web` dev server had been running continuously since before Phase 5's file changes landed; its webpack dev middleware started serving `main-app.js`/`app-pages-internals.js`/`dashboard/layout.js` with HTTP 503 (silently breaking all client-side hydration — the "Run acquisition now" button rendered but no click handler ever attached). Restarting `pnpm --filter @ventureos/web run dev` resolved it immediately; not a defect in the Phase 5 code itself.

---

## Phase 6 — Marketplace Pilot — ✅ DONE (mock-only, per explicit founder decision)

Spec section 34 and section 21 are explicit: **real marketplace integration
only after founder approval**, and only with an approved account and
permitted API access — never claimed as live before that.

1. ✅ **Founder decision (2026-07-14)**: the founder explicitly chose
   **mock-only** for Phase 6 — no real Etsy account is connected, and none
   was requested. Recorded in `docs/ETSY_API_INTEGRATION.md` and
   `docs/DECISIONS.md` (ADR-007). Per the founder's own instruction ("I WILL
   NOT CONNECT MY ETSY ACCOUNT NOW, CONTINUE TO FINISH MY AGENCY"), every
   deliverable below is built against a mock adapter with the exact same
   request/response shapes the real Etsy Open API v3 uses, so switching to a
   real account later is a credential-wiring change, not a rewrite.
2. ✅ **`MarketplaceAccount`/`IdempotencyKey` Prisma models**, extended
   `PublicationAttempt` (errorMessage/completedAt/marketplaceAccountId/
   idempotencyKeyId/externalListingId/externalListingUrl), extended
   `ApprovalRequest` (`kind: 'PUBLICATION'`, `listingVersionId`) — migration
   `20260714065131_phase6_marketplace_pilot`, applied against real Postgres.
3. ✅ **`@ventureos/marketplace-connectors` package** — `fetchMockCreateDraftListing`/`fetchMockUploadListingImage`/`fetchMockUploadListingFile`/`fetchMockPublishListing` (the only provider; zero live network calls anywhere in this phase, same mock-by-default principle as Phase 5), each producing real Etsy-shaped ids/urls (`mock-etsy-listing-<uuid>`, `https://mock.etsy.example/listing/<id>`) never confusable with a real listing.
4. ✅ **Draft listing preparation** (`prepareListingForPublication`) — creates the draft + uploads images/files against the mock adapter, requires an already-approved Phase 4 `PRODUCT_LISTING` approval bound to this exact `ListingVersion`, fails closed (`BLOCKED_NO_APPROVAL`/`BLOCKED_DISABLED`/`BLOCKED_RATE_LIMIT`) with a real persisted `PublicationAttempt` row every time — never a silent no-op.
5. ✅ **Second, distinct `PUBLICATION` approval gate** (`requestPublicationApproval`/`publishListing`) — separate `ApprovalRequest.kind` from Phase 4's `PRODUCT_LISTING`, its own `packageHash` over the listing's marketplace-facing content, re-validated via `isApprovalValidForExecution` both at decision time and again at publish time (content drift after approval marks the request `EXPIRED` and blocks publish — integration-tested).
6. ✅ **Idempotent publication** — `withIdempotency` wraps every external write (draft create, image/file upload, publish); a reused key with a matching payload replays the cached result, a reused key with a different payload throws `IdempotencyKeyConflictError` (never silently treated as a retry), a `FAILED` key retries in place rather than duplicating a row.
7. ✅ **Reconciliation and error recovery** — every failure path (fail-closed block, mock-adapter error) is a real persisted `PublicationAttempt` with a specific status (`BLOCKED_DISABLED`/`BLOCKED_RATE_LIMIT`/`FAILED`) and `errorMessage`/`blockedReason`, never a thrown exception the founder can't see; the idempotency layer's FAILED-key-retried-in-place behaviour is the actual recovery mechanism, integration-tested directly.
8. ✅ **Temporal `marketplacePublicationWorkflow`** (`apps/worker`) — prepare → (if `READY_FOR_PUBLISH`) raise the `PUBLICATION` approval bound to this workflow's id → signal-wait up to 7 days for the founder's decision → publish only if approved. Same signal/condition/retry shape as Phase 3/4's workflows.
9. ✅ **Publication audit trail** — every action (`PUBLICATION_PREPARED`/`PUBLICATION_APPROVAL_REQUESTED`/`PUBLICATION_PUBLISHED`/`PUBLICATION_FAILED`/`PUBLICATION_WORKFLOW_STARTED`) recorded as a real `AuditEvent`. **Live verification found a real gap here** (see below) — fixed, and the fix was applied consistently to Phase 3 and Phase 4's workflow activities too, not just Phase 6.
10. ✅ **UI** — Marketplace Publication card on the product detail page: mode badge (MOCK, never fabricated as REAL), founder-decision explanatory note, "Start publication (mock adapter)" action, full publication-attempt history table, `PUBLICATION` approval status with a link to the Approval Centre, and the real mock listing URL once published.
11. ✅ **Docs** — `docs/ETSY_API_INTEGRATION.md` (new: real Etsy Open API v3 research — OAuth+PKCE, endpoint sequence, rate limits — and the mock-only decision record); `docs/INTEGRATIONS.md` updated (see below) to describe the real mock implementation, explicitly never claiming "verified working with a real account" since that has never happened (spec section 21's explicit rule).

**Tests:**

- ✅ 3 unit tests (`mock-etsy-client.test.ts`, pure functions: draft uniqueness, image/file upload ids, publish URL derivation).
- ✅ 13 integration tests (`apps/api/test/marketplace.integration.spec.ts`, real Postgres): `BLOCKED_NO_APPROVAL` without a decided Phase 4 approval, `READY_FOR_PUBLISH` once approved, idempotent re-prepare (same external id, one `SUCCEEDED` idempotency-key row, two attempt rows), `BLOCKED_DISABLED` fail-closed gating, idempotency-key conflict on a reused key with a different payload, a `FAILED` key retried in place without duplication, the `PUBLICATION` approval raised/idempotent/decided, publish success with the mock listing URL and `executionSuccess: true` on the `ApprovalRequest`, hash-drift re-validation marking the approval `EXPIRED` and blocking publish, and audit-event assertions for prepare/request-approval/publish plus workspace-scoping.

**Verification (2026-07-14):**

- ✅ `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm build`: all clean across all 19 packages/apps (15/15 lint, 33/33 typecheck, 19/19 build).
- ✅ `pnpm test:unit`: 16/16 packages passing, including `@ventureos/marketplace-connectors` (3/3).
- ✅ `pnpm --filter @ventureos/api test:integration`: 36/36 passing across all 6 suites, including the new marketplace suite (13/13).
- ✅ **Live browser verification**: clicked "Start publication (mock adapter)" on the already-approved Social Media Content Planning Kit listing — the real Temporal workflow ran, the mode badge switched to `MOCK`, a real `mock-etsy-listing-<uuid>` external id appeared. Opened the resulting `PUBLICATION` approval request in the Approval Centre (correct package hash, distinct from the earlier `PRODUCT_LISTING` request's hash) and approved it — the signal-wait workflow resumed automatically and published, rendering `Published (mock): https://mock.etsy.example/listing/mock-etsy-listing-...` on the product page.
- **One real bug found and fixed via live verification, not just code review**: the Audit Centre showed only `PUBLICATION_WORKFLOW_STARTED` and `APPROVAL_DECIDED` after the run above — not `PUBLICATION_PREPARED`/`PUBLICATION_APPROVAL_REQUESTED`/`PUBLICATION_PUBLISHED`, even though the publish had clearly succeeded. Root cause: `apps/worker`'s Temporal activities called `@ventureos/marketplace-connectors`'s functions directly, bypassing `MarketplaceService`/`AuditService` (which only exist inside `apps/api`'s NestJS DI container) — my own integration test only exercised the synchronous manual endpoints, which do audit correctly, and never caught this because it never exercised the workflow path. Checking the existing code confirmed Phase 3 and Phase 4 had the exact same gap already (their worker activities never audited board-review-completion, product generation, or listing generation either — only workflow-start and the founder's decision). Fixed for all three phases: added `apps/worker/src/lib/write-audit-event.ts` (mirrors `AuditService.record()`'s exact insert/hash logic without NestJS) and wired it into `board-approval-activities.ts`, `product-listing-activities.ts`, and `marketplace-activities.ts` (`BOARD_REVIEW_COMPLETED`, `PRODUCT_GENERATED`, `LISTING_GENERATED`, `APPROVAL_REQUESTED`, plus the three marketplace actions above). See ADR-008. Re-verified live afterward: the full chain (`PUBLICATION_WORKFLOW_STARTED` → `PUBLICATION_PREPARED` → `PUBLICATION_APPROVAL_REQUESTED` → `APPROVAL_DECIDED` → `PUBLICATION_PUBLISHED`) now appears in the Audit Centre for a fresh run, and the full verification suite (format/lint/typecheck/build/test:unit) was re-confirmed clean afterward.
- **One resolved environment issue, not a code bug:** the web dev server twice needed a restart during this phase's live verification — once because it had crashed into a 500 (stale `.next` fallback chunks), and once because running `pnpm build` (production build) while `pnpm dev` was live corrupted the dev server's `.next` cache (`Cannot find module './547.js'`) — a known Next.js dev/prod-build-sharing-`.next` interaction, not a defect in the Phase 6 code itself.

---

## Phase 7 — Finance and Analytics — ✅ DONE

`@ventureos/finance-engine` core calculations (unit economics, break-even,
scenarios) were already built and unit-tested in Phase 1 — Phase 7 wired
real expense/revenue tracking, budget enforcement, forecast-vs-actual
comparison, controlled experiments, and Gate 6 on top of that math, rather
than rebuilding it.

1. ✅ **`FinancialAssumption`/`FinancialForecast`/`FinancialScenario`/`Expense`/`RevenueEntry`/`MarketplaceFee`/`RefundRequest`/`Budget`/`BudgetAllocation`/`CostLedgerEntry` Prisma models** — migration applied against the real local Postgres instance.
2. ✅ **Model-usage cost tracking** — `ModelUsage` rows recorded via `recordModelUsage` for every model invocation (mock-provider cost = €0 by default, but the recording mechanism is real, so it is correct the moment real providers are enabled); zero-cost invocations record usage without charging any budget, non-zero-cost invocations charge a real `CostLedgerEntry` and increment the resolved allocation's `spentEur` — both paths integration-tested.
3. ✅ **Budget controls** — `assertWithinBudget` (fail-closed pre-check) and `chargeToBudget` (atomic recheck + ledger write + spend increment in one `$transaction`) in `packages/finance-engine/src/budget-guard.ts`; `resolveBudgetAllocation` prefers a venture-scoped ACTIVE budget over the workspace-wide one. Hard-stop enforcement integration-tested: charges within the limit succeed, a charge that would exceed it is blocked with zero partial side effect.
4. ✅ **Forecast-vs-actual comparison** — `compareForecastToActual` (`packages/finance-engine/src/forecast-runner.ts`) diffs the latest forecast's BASE scenario against real `RevenueEntry` rows recorded since that forecast was generated; returns a zeroed comparison before any revenue exists, a real diff (error EUR + error rate) afterward — both integration-tested and live-browser-verified.
5. ✅ **`Experiment`/`ExperimentVariant`/`ExperimentMetric`/`ExperimentResult`/`ExperimentDecision` Prisma models** — controlled experiment tracking (spec section 30 Gate 5/6 metrics), full lifecycle (`createExperiment` → `startExperiment` → `recordExperimentResult` → `recordExperimentDecision`) in `packages/finance-engine/src/experiment-runner.ts`, fail-closed on invalid state transitions.
6. ✅ **Finance Centre UI** (spec 23.10) — `apps/web/src/app/dashboard/finance/page.tsx` (venture list + budgets) and `apps/web/src/app/dashboard/finance/[ventureProposalId]/page.tsx` (assumptions, forecast + scenarios, forecast-vs-actual, expenses, revenue, experiments). The historical Phase 7 Workflow Centre UI was deferred. The current repository now adds a separate authenticated, bounded, read-only Workflow Centre at `/dashboard/workflows` for safe legacy workflow and Agent Control Plane status metadata. It is not live telemetry and exposes no approval or runtime authority.
7. ✅ **Gate 6 (Scale Decision) enforcement** — `requestScaleDecisionApproval`/`recordExperimentDecision` in `packages/finance-engine/src/experiment-runner.ts`, using the same `ApprovalRequest`/`decideApprovalRequest` machinery as every other phase (`kind: 'SCALE_DECISION'`); KILL/ITERATE/HOLD never require approval (they only reduce/hold spend), only SCALE requires an APPROVED request bound to the exact experiment.
8. ✅ **Docs** — `docs/FINANCIAL_MODEL.md` extended with the real ledger/forecast/experiment schema (see below).

**Tests:**

- ✅ 24 unit tests: `packages/finance-engine/src/__tests__/assumptions.test.ts` (defaults, purity, validation fail-closed on bad input) and `errors.test.ts` (all custom error classes are real `Error` subclasses, distinguishable via `instanceof`).
- ✅ 20 integration tests (`apps/api/test/finance.integration.spec.ts`, real Postgres): assumption upsert + supersession (never mutates a prior row in place), forecast generation (auto-seeds defaults, exactly 3 scenarios) + forecast-vs-actual (zeroed before any revenue, real diff after), budget hard-stop enforcement (allows within limit, blocks over limit with no partial side effect, venture-scoped allocation preferred over workspace-wide), model-usage cost tracking (zero-cost records without charging, non-zero-cost charges a real ledger entry), expenses/revenue via `FinanceService` (server-computed `netRevenueEur`, cross-workspace access refused), the full experiment lifecycle (DRAFT → RUNNING, results recorded, cross-workspace variant access refused), Gate 6 (scale-decision approval blocked before RUNNING, SCALE blocked without an approved request, KILL never requires one, SCALE succeeds once approved and re-deciding fails), and the full Phase 7 audit trail (every mutating action produces a distinct, queryable `AuditEvent`, including `approvalReference` on the Gate 6 request/decision events).
- ✅ Two real bugs found and fixed while writing these tests (not pre-existing production code — caught before ever reaching the founder): a test-isolation bug in the model-usage test (an unscoped workspace-wide budget resolved non-deterministically against an earlier test's allocation — fixed by scoping the test's budget to a fresh venture proposal), and a **real, serious production bug**: `requestScaleDecisionApproval` computed its `packageHash` by wrapping the venture proposal's snapshot together with an experiment-results hash, while `decideApprovalRequest`'s default branch (used by every non-`PRODUCT_LISTING`/`PUBLICATION` approval kind) re-computes the hash as the bare snapshot alone — these could never match, so every Gate 6 SCALE approval would have failed closed with `PACKAGE_HASH_MISMATCH` regardless of real drift. Fixed by computing `packageHash` with the exact same bare-snapshot scheme every other approval kind uses.

**Verification (2026-07-14):**

- ✅ `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run test:unit`, `pnpm --filter @ventureos/api test:integration` (7 files / 54 tests) — all clean.
- ✅ `pnpm run format:check` — found 16 files with pure Prettier formatting drift (11 Phase 7 code/test files, 4 pre-existing docs, `pnpm-lock.yaml`); `pnpm run format` fixed all of them, re-confirmed clean.
- ✅ **Live browser verification**: opened the Finance Centre for the Social Media Content Planning Kit venture proposal, generated a forecast (assumptions auto-seeded, break-even + 3 scenarios rendered correctly), recorded a real expense and a real revenue entry (forecast-vs-actual updated live to reflect the new actuals), created an experiment (Control vs. Variant B), started it, recorded a real result, requested the Gate 6 scale-decision approval, decided APPROVE on it in the Approval Centre (no hash mismatch — confirms the bug above stays fixed under a fresh live run), recorded the SCALE decision on the experiment (status transitioned to DECIDED, decision rendered with rationale/approval reference), and confirmed the Audit Centre shows the complete ordered chain: `FINANCIAL_FORECAST_GENERATED` → `EXPENSE_RECORDED` → `REVENUE_RECORDED` → `EXPERIMENT_CREATED` → `EXPERIMENT_STARTED` → `EXPERIMENT_RESULT_RECORDED` → `SCALE_DECISION_APPROVAL_REQUESTED` → `APPROVAL_DECIDED` → `EXPERIMENT_DECIDED`.
- **One real bug found and fixed via live verification, not just code review**: opening the Finance venture page for a venture with no prior `FinancialAssumption`/`FinancialForecast` yet — the real zero-state every fresh venture starts in — crashed with `Error: Unexpected end of JSON input`. Root cause: NestJS special-cases a controller handler returning `null`/`undefined` as "no body to serialize" and sends a genuinely empty response body (not the JSON text `"null"`), but the shared `serverApiFetch` helper (`apps/web/src/lib/server-api.ts`, used by all 16 server-rendered dashboard pages) called `res.json()` unconditionally, which throws on an empty body. Fixed by reading the response as text first and treating an empty string as `null`, matching every caller's already-declared `T | null` return type — no change to any endpoint's actual behavior. See `docs/DECISIONS.md` ADR-009. Re-verified live afterward: the page renders its correct zero-state copy ("No assumptions set yet...", "No forecast generated yet.") instead of crashing.

---

## Phase 8 — Multi-Venture and SaaS — ✅ DONE

Founder chose the **full SaaS resale build-out** scope (not just
multi-venture, not just tenant-isolation hardening): multi-venture support,
tenant-isolation hardening, subscription/licensing architecture, white-label
settings, a new-customer onboarding flow, and installable/exportable
packaging — treating VentureOS as a product to sell to other founders (spec
section 3's long-term objective).

1. ✅ **Multiple ventures per workspace** — no schema rewrite needed: the
   existing `Opportunity` → `VentureProposal` 1:1 relation already supported
   many concurrent ventures per workspace since Phase 2; what was missing
   was a unified list view. `VenturesService.list()` (`apps/api`) aggregates
   every `VentureProposal` + its `Opportunity`/`Product` for the workspace;
   `apps/web/src/app/dashboard/ventures/page.tsx` renders the list plus a
   live plan-usage badge card.
2. ✅ **`Plan`/`Subscription`/`SubscriptionInvoice`/`LicenseKey`/
   `WorkspaceBranding` Prisma models** — migration
   `20260714132415_phase8_multi_venture_and_saas`, applied against the real
   local Postgres instance (founder-run, confirmed via real pasted output).
3. ✅ **Tenant isolation audit** — reviewed every `apps/api/src/modules/*.service.ts`
   for cross-workspace leakage (spec section 27's "cross-workspace data
   exposure" threat) now that a second workspace genuinely exists. No actual
   leak found; one defense-in-depth improvement made in
   `marketplace.service.ts`'s `getScopedListingVersion` (filter `workspaceId`
   directly in the Prisma query instead of fetching by id then
   post-checking).
4. ✅ **`@ventureos/billing` package** — mock subscription/licensing engine:
   `DEFAULT_PLANS` (TRIAL/STARTER/GROWTH/AGENCY tiers with real
   venture/member/marketplace-account limits and price points),
   `resolvePlanLimits`/`assertWithinVentureLimit`/`assertWithinMemberLimit`/
   `assertWithinMarketplaceAccountLimit` (fail-closed quota guards, mirroring
   Phase 7's `assertWithinBudget` pattern), `startTrialSubscription`/
   `changePlan`/`activateSubscription`/`cancelSubscription`, and
   `issueLicenseKey`/`validateLicenseKey`/`revokeLicenseKey` for
   self-hosted/exportable installs. `billingMode` is hardcoded `'MOCK'`
   everywhere and every invoice is `status: 'PAID'` unconditionally — no
   real payment processor is connected (see `docs/DECISIONS.md` ADR-010,
   mirroring ADR-007's precedent for Phase 6).
5. ✅ **Billing API module** (`apps/api/src/modules/billing`) — `GET /billing`
   (plan/status/usage summary), `POST /billing/change-plan`,
   `POST /billing/cancel`, `POST /billing/reactivate`,
   `GET/POST /billing/license-keys`, `DELETE /billing/license-keys/:id`, all
   permission-gated (`billing:view`/`billing:manage`) and audit-logged.
6. ✅ **White-label settings** — `WorkspaceBranding` (brand name, logo URL,
   accent color, terminology overrides) actually configurable at runtime via
   `PATCH /workspaces/branding`, applied live to the dashboard shell
   (`apps/web/src/app/dashboard/layout.tsx` reads it and sets brand
   name/logo/`--vos-accent` CSS variable) — not just structurally possible
   as before.
7. ✅ **Customer signup + onboarding flow** — `POST /api/auth/register`
   (`AuthService.register`): creates User + FounderProfile + Workspace +
   WorkspaceMember + WorkspaceBranding in one transaction, starts a 14-day
   TRIAL subscription, logs the new founder straight in. `apps/web/src/app/register/page.tsx`
   is the public-facing form, linked from the login page.
8. ✅ **Installable/exportable configuration + customer docs** —
   `docs/DEPLOYMENT.md` extended with "Multi-tenant deployment topology" and
   "Exportable/self-hosted installs" sections; new
   `docs/CUSTOMER_GETTING_STARTED.md` (customer-facing walkthrough, distinct
   from the internal `docs/` set). License keys (deliverable #4 above) are
   the record-keeping mechanism for tracking self-hosted installs — a real
   "phone home" validation endpoint is documented as future work, not built
   this phase.
9. ✅ **Settings UI rewrite** — `apps/web/src/app/dashboard/settings/page.tsx`
   replaced its static placeholder with three live sections (Subscription,
   License keys, White-label branding), each backed by real API data and
   client actions (`billing-actions.tsx`, `branding-actions.tsx`).

**Real bugs found and fixed during this phase's own verification suite**
(none reached the founder as a working build — all caught before Phase 8
was marked done):

- A `TS18048` possibly-undefined error in `seed.ts` (`seededPlans['AGENCY']`
  under `noUncheckedIndexedAccess`, even though `DEFAULT_PLANS` always
  includes an AGENCY entry) — fixed with an explicit guard clause.
- Three `TS2742`/`noUncheckedIndexedAccess` errors in the new
  `@ventureos/billing` package, only surfaced once `pnpm install` linked the
  brand-new workspace package in and its `tsc` build step actually ran for
  the first time: `subscription-runner.ts`'s three exported functions
  needed an explicit `SubscriptionWithPlan` return-type annotation (the same
  class of bug ADR from Phase 3's `approval-runner.ts` — TypeScript can't
  portably name an inferred Prisma payload type across the monorepo's nested
  `node_modules`), and two of its own unit test files indexed arrays without
  a non-null assertion.
- `apps/web` had no local ESLint config, so `next lint` silently never
  loaded the `@next/next` plugin (visible only as a warning, never a
  failure, until Phase 8's white-label branding work added an
  `eslint-disable-next-line @next/next/no-img-element` comment, which then
  hard-errored on referencing a rule from an unloaded plugin). Fixed with
  `apps/web/.eslintrc.json` extending `next/core-web-vitals`.
- That same fix then surfaced 7 previously-silent
  `react/no-unescaped-entities` violations (raw apostrophes in JSX text)
  across 6 files that had never been linted against this rule — all
  escaped with `&apos;`. See `docs/DECISIONS.md` ADR-011 for the full
  writeup of both ESLint findings.

**Tests:**

- ✅ 7 new `@ventureos/billing` unit tests (`errors.test.ts`, `plans.test.ts`)
  — error-class instanceof checks, plan-tier ordering/limit assertions.
- ✅ Full integration suite re-confirmed passing after the `pnpm install`
  fix: 7 files / 54 tests, including `auth.integration.test.ts` (previously
  failing to even load due to the unlinked `@ventureos/billing` package).

**Verification (2026-07-14):**

- ✅ `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run build && pnpm test:unit && pnpm --filter @ventureos/api test:integration` — all clean, across several founder-run rounds as each real bug above was found and fixed in turn.
- ✅ **Live browser verification**: registered a brand-new workspace
  ("Acme Test Ventures") via `/register` — landed straight in the dashboard
  with a real TRIAL subscription and `WorkspaceBranding` row. Opened the
  Ventures page: correctly showed "Trial plan, 0/1 ventures used" and "No
  ventures yet." Opened Settings: changed the plan from TRIAL to STARTER
  (limits updated live to 0/3 ventures, 1/2 members, 0/1 marketplace
  accounts, matching `DEFAULT_PLANS`' STARTER tier exactly), issued a
  license key (`VOS-XXXXXXXX-XXXXXXXX-XXXXXXXX` format, ACTIVE, 365-day
  expiry) and revoked it (status flipped to REVOKED, revoke action correctly
  disappeared), and updated white-label branding (brand name changed to
  "Rebrand Test Co") — confirmed it immediately applied to the dashboard
  sidebar on the next page load. No bugs found during this live pass.

---

## Phase 9 — Collaborative Workspace Access — 🟡 DRAFT PR

**Approved scope:** provider-free collaboration for non-founder members,
without deployment or live providers.

- ✅ Hashed, expiring, single-use invite records; the raw token is returned
  only once and is never stored or audited.
- ✅ Deterministic `FOUNDER` / `OPERATOR` / `VIEWER` permission maps.
- ✅ Founder-only member list, invite, role-change, and removal APIs with
  tenant-scoped lookups and mutation audit events.
- ✅ Plan member quota enforced in a workspace-serialized acceptance
  transaction, including concurrent acceptance protection.
- ✅ Public `/join#token=…` fragment-to-body account-creation flow and Settings → Team UI with
  a one-time copy action; no email or other external provider.
- ✅ Existing-account claims remain neutral while signed out: the public form
  consumes the bearer token and reserves one account-bound authenticated
  continuation, so preview and replay match the new-account path. After
  sign-in, the matching account can reopen the link through an account-bound
  preview, atomically complete the claim, retain any existing role with accurate
  UI copy, audit the transition, and switch only the current session.
- ✅ Every session carries an explicit active workspace. The guard resolves
  permissions from that exact membership, the dashboard exposes a safe
  membership-backed workspace selector, and member removal revokes only
  sessions active in the removed tenant.
- ✅ Production build, typecheck, lint, formatting, and immutable migration
  contract pass locally.
- ✅ Database integration coverage includes digest-only storage, expiry,
  replay, tenant isolation, quota, concurrent acceptance, active-workspace
  authorization, signed-in claims, safe switching/removal races, audit events,
  workspace-scoped session revocation, deterministic legacy-session backfill,
  orphan fail-closed behavior, and workspace deletion. Founder-only onboarding
  is enforced by both permission and service boundaries, with collaborator
  GET/PUT denials and permission-aware navigation. CI remains the authoritative
  clean PostgreSQL migration and integration environment.

## Cross-cutting tracker (applies across all phases, not phase-gated)

These spec sections describe standing requirements rather than one-time
phase deliverables. Current status:

| Area                                                             | Spec section | Status                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security controls (secrets, hashing, RBAC, rate limiting, audit) | 26           | ✅ implemented for what exists so far; must be re-applied to every new module in Phases 2-8                                                                                                                                                                                               |
| Threat model                                                     | 27           | 🟡 documented in `docs/THREAT_MODEL.md`; only a handful of threats have actual passing security tests yet (approval bypass, cross-workspace access partially covered by existing guards) — most rows are "documented, not yet tested"                                                     |
| GDPR/privacy                                                     | 28           | 🟡 documented in `docs/PRIVACY_GDPR.md`; synthetic/seed data only so far, consistent with spec — real data-subject-request flows (export/correction/deletion) not yet built since there's no real customer data to act on                                                                 |
| Cost controls                                                    | 41           | 🟡 research cost caps now really enforced (Phase 5, `assertWithinResearchCostCaps`); Phase 6 has no comparable spend risk (mock adapter, €0 cost by construction); AI agent/model cost enforcement still env-var scaffolding only, real enforcement lands in Phase 7 (budget/model-usage) |
| Test strategy                                                    | 31           | 🟡 documented in `docs/TEST_STRATEGY.md`; actual unit/integration/e2e suites exist in code for Phase 1 scope but have never been run in this session (see Phase 1 open items above)                                                                                                       |
| Documentation set                                                | 32           | ✅ all 30 files created; content depth will grow with each phase — treat as living docs, not one-time output                                                                                                                                                                              |

---

## Immediate next steps (in order)

1. Preserve Phases 1–8 as historical product-scope evidence. Phase 6 remains
   mock-only under the founder's 2026-07-14 decision; Phase 8 billing remains
   mock-only under ADR-010. Neither milestone is a release-readiness claim.
2. Preserve the merged workspace/collaboration and Agent Control Plane
   foundations through PR #84. The runtime foundation now includes a reviewed
   Linux executable/admission-evidence reader and deny-by-default supervisor
   composition across the existing service-only bridge boundary. Its production
   authorization source and launcher both deny. The intervening authenticated
   JSONL session is I/O-free and production secret resolution still denies.
   Actual process creation and real adapters follow only after authenticated
   end-to-end evidence; Codex, Hermes, and Pi remain `NOT_CONFIGURED`.
3. Keep running the sanitized five-image workflow against exact current `main`
   as scan evidence only. Image publication requires separate approval for that
   exact SHA; private-staging deployment requires another separate approval.
   Neither has occurred for the current `main` baseline.
4. Exercise Access, migrations, health, E2E, accessibility/responsive behavior,
   tenant isolation, audit evidence, backup/restore, and rollback in private
   staging with synthetic data and live providers disabled.
5. Complete an internal rehearsal before an invited pilot. Pilot access requires
   approved privacy/terms/data-handling, support, incident, and rollback
   ownership. Pricing, revenue, conversion, and product-market-fit claims must
   come from observed evidence, not mock data or forecasts.

Routine implementation, tests, review, and draft-PR updates continue under the
existing engineering authorization. New founder approval is reserved for money
or paid accounts, credentials/live providers, customer or personal data,
legal/commercial commitments, exact-SHA publication, staging/production
deployment, production DNS/infrastructure changes, and pilot/operational risk
ownership.

### Approved release-security repair — 2026-08-19

The founder approved a focused repair for the failed immutable-image
vulnerability gate: replace the five final runtime bases with the pinned
no-OpenSSL composition recorded in ADR-012, upgrade the Prisma dependency set,
apply the targeted `deepmerge-ts` override, and run the complete application
and final-image verification matrix. This authorization covers a repair branch
and draft pull request only. Merge, image publication, and deployment of the
resulting exact SHA require separate explicit approval.

This file will be updated after every phase-affecting change. `docs/ROADMAP.md` and `TODO.md` both now point here as the canonical status source.
