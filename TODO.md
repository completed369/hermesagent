# TODO

<!-- CURRENT PRIORITIES — reviewed 2026-08-26:
This is a dated reviewed source baseline, not a mutable current-main pointer.
GitHub checks and protected operational evidence are authoritative for live
state. The historical phase checklists below are retained as implementation
history and must not be read as deployment, publication, runtime-connectivity,
pilot, or customer evidence.

Immediate evidence-backed priorities:
- keep release checks, migrations, E2E, CodeQL, supply-chain gates, and the
  sanitized five-image release-candidate workflow green on the selected SHA;
- complete a production-grade, deny-by-default runtime supervision and
  authenticated transport composition before any runtime process can execute;
- keep Codex, Hermes, and Pi NOT_CONFIGURED until registration, capability
  exchange, heartbeat, task/status, event, and result round trips are verified;
- complete backup/restore and rollback exercises before production readiness;
- keep commercial pilot status NOT STARTED until the Founder authorizes the
  external boundary and real evidence exists.
-->

<!-- STATUS UPDATE — 2026-08-20:
Phase 9 collaborative access is implemented on a draft replacement branch:
hashed provider-free invitations, non-founder roles, explicit per-session
active-workspace context, safe workspace switching, signed-in existing-account
claims, tenant-scoped authorization, and workspace-scoped session revocation.
Merge and deployment remain separately founder-gated; no live provider or paid
service was enabled. Older historical status blocks below are retained as
evidence and are superseded by docs/EXECUTION_PLAN.md. -->

<!-- STATUS UPDATE — 2026-07-16:
The two UI tasks flagged open on 2026-07-15 are now RESOLVED, and a local-dev
founder credential rotation utility was added and used. Branch:
feat/command-centre-product-studio-20260715. Relevant commits:
- 2b931a3 fix(auth): inject Reflector in permission guard (explicit
  @Inject(Reflector), covered by a guard test)
- 5a01583 feat: wire Command Centre and add Product Studio index — Command
  Centre now uses REAL workspace data (no fabricated values); Product Studio
  has its own /dashboard/products route (no longer shares Board Room's nav
  destination); workspace-scoped GET /api/products (auth + product:view) added
- 13c8021 test(e2e): load local environment for Playwright — loads root .env
  without hardcoding credentials; existing E2E suite passes 4/4
- c9d5de4 chore(security): add local founder credential rotation utility —
  LOCAL-DEV-ONLY; updates only the founder passwordHash and revokes only that
  founder's sessions in one transaction; rejects NODE_ENV=production; 12
  focused rotation tests passing. The actual local founder credential was
  rotated successfully and previous founder sessions were revoked (the
  replacement password is not recorded anywhere).
Verification 2026-07-16: `pnpm install --frozen-lockfile` passes; all six
official validation stages pass (`.\scripts\run-validation.ps1`, exit 0);
working tree clean afterward.
STILL PENDING (unchanged): VentureOS is a local dev build, NOT production
deployed; Phase 9 has NOT started; real AI provider, live Etsy publication,
real payments, and advertising remain disabled/pending; founder approval
remains mandatory for sensitive actions; nothing has been pushed, merged, or
deployed. -->

<!-- STATUS UPDATE — 2026-07-15:
Phase 2-8 work is now COMMITTED and protected. Branch:
recovery/phase2-8-checkpoint-20260715. Commits: 6c8a699 (checkpoint recovered
Phase 2-8 working tree), 933691e (Prettier formatting), 5594883 (PowerShell
validation-script argument-handling fix). Working tree is clean. A fresh
`.\scripts\run-validation.ps1` after 5594883 passed all six stages (exit 0:
format; lint 17/17; typecheck 36/36; unit 67 tests; integration 7 files/54
tests; build 20/20). Docker services verified healthy/running (PostgreSQL,
MinIO, Temporal, Temporal UI); API /api/health/ready returned HTTP 200.
STILL PENDING (unchanged): VentureOS is a local dev build, NOT production
deployed; real AI provider, live Etsy publication, real payments, and
advertising remain disabled/pending; and two known UI tasks are still open —
(1) wire real Command Centre stats + remove stale phase text/badges, and
(2) fix the Product Studio nav link that duplicates Board Room. -->

**See `docs/EXECUTION_PLAN.md` for the full Phase 0–8 task breakdown and the
canonical up-to-date completion status.** This file only tracks the
immediate next actions.

## Phase 1 — ✅ fully verified, all acceptance criteria met (see docs/EXECUTION_PLAN.md)

- [x] Run `.\scripts\preflight.ps1` and resolve any FAIL items
- [x] `pnpm install` and confirm zero errors
- [x] `docker compose up -d` and confirm all 4 services healthy
- [x] `pnpm db:generate && pnpm db:migrate:dev && pnpm db:seed`
- [x] Founder login verified end-to-end (dashboard renders real seeded data)
- [x] `pnpm run format:check && pnpm run lint && pnpm run typecheck` — clean after fixing 4 real bugs (see docs/KNOWN_LIMITATIONS.md)
- [x] `pnpm test:unit` (all packages) — 12/12 packages, 67 tests, zero failures
- [x] `pnpm --filter @ventureos/api test:integration` — 3/3 passing
- [x] `pnpm build` (all apps) — clean
- [x] `pnpm dev`, then `pnpm --filter @ventureos/web test:e2e` — 4/4 passing
- [x] Manually verified: logout (found + fixed a completely broken button), onboarding save (found + fixed a null-schema bug), audit event visibility (found + fixed missing wiring), security event visibility, health endpoints, MinIO (found + fixed an SSL boolean-coercion bug), a real Temporal workflow execution

## Phase 2 — ✅ fully verified, all acceptance criteria met (see docs/EXECUTION_PLAN.md)

- [x] Opportunity + Evidence Prisma models and migration (`20260713140054_phase2_opportunity_evidence`), applied against real Postgres
- [x] Seed the "Social Media Content Planning Kit" opportunity (master spec section 25) — real seed run: Opportunity Score 71.5, Profit Confidence 61.75, speculative=true
- [x] Opportunity feed UI (list + detail pages) with full evidence trail display
- [x] Wired `@ventureos/scoring-engine` (already built, unit-tested) into the seed pipeline — real `OpportunityScore` rows persisted, not hand-typed numbers
- [x] Profit Confidence Score UI treatment (speculative labelling) — confirmed live in browser
- [x] Opportunities API (list/detail/reject/archive/promote), permission-gated, audit-logged
- [x] `pnpm test:unit` — 14/14 passing in `apps/api` (10 new + 4 pre-existing)
- [x] `pnpm --filter @ventureos/api test:integration` — 7/7 passing (found + fixed a real `audit_events_actorId_fkey` FK-violation bug in the test setup)
- [x] `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm build` — clean
- [x] Manually verified live in-browser: opened Opportunity Feed list and detail pages, clicked "Promote to Venture Proposal," confirmed via direct API calls that a real `VentureProposal` + version and a real audit event were created and the UI reflected the terminal "promoted" state

## Phase 3 — ✅ fully verified, all acceptance criteria met (see docs/EXECUTION_PLAN.md)

- [x] `AgentDefinition`/`AgentPromptVersion` Prisma models + migration (`..._phase3_board_and_approval...`), seeded 8 voting roles + Decision Synthesiser
- [x] Mock board-agent provider (`@ventureos/agent-runtime`) — deterministic per-role lens, schema-validated output, FINANCE veto path implemented
- [x] `VentureProposal`/`BoardReview`/`BoardVote`/`BoardVeto`/`DecisionSummary`/`RevisionRequest`/`ApprovalRequest`/`ApprovalDecision` Prisma models, applied against real Postgres
- [x] Board review orchestration wired to real persisted `calculateBoardVotingResult` — 75% threshold, critical veto blocking
- [x] Decision Synthesiser — non-voting, recommendation strictly mirrors the pre-computed voting result
- [x] Approval Centre module — hash-bound enforcement via `isApprovalValidForExecution`, re-checked server-side on every decision
- [x] Temporal `boardApprovalWorkflow` (`apps/worker`) — board review → approval request → signal-wait for founder decision
- [x] Board Room UI + Approval Centre UI (`apps/web`)
- [x] `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm build` — clean across all 16 packages (found + fixed a real TS2742 declaration-emit bug in `approval-runner.ts`)
- [x] `pnpm test:unit` — 13/13 packages passing, including `@ventureos/agent-runtime` (8/8) and `apps/api` (28/28)
- [x] `pnpm --filter @ventureos/api test:integration` — 12/12 passing, including the new board/approval suite (5/5)
- [x] Manually verified live in-browser: ran a real Board Review from the Board Room UI (8/8 agents APPROVE, weighted score 100/75, Decision Synthesiser recommended APPROVE), decided APPROVE on the resulting Approval Request in the Approval Centre, confirmed the state transition, decision row, and matching `APPROVAL_DECIDED`/`BOARD_REVIEW_STARTED` audit events via the Audit Centre

## Phase 4 — ✅ fully verified, all acceptance criteria met (see docs/EXECUTION_PLAN.md)

- [x] `Product`/`ProductVersion`/`ProductAsset`/`ProductAssetVersion`/`ProductBrief`/`ProductPackage`/`LicenceRecord`/`QualityCheck`/`QualityCheckResult`/`Listing`/`ListingVersion`/`ListingImage`/`ListingFile`/`PriceProposal`/`SEOEvaluation`/`PublicationAttempt` Prisma models + migration, applied against real Postgres
- [x] `@ventureos/product-studio` package: mock product generation (real MinIO-shaped uploads via `StorageProvider`), QA checks (5 check types), Etsy Development Pack policy content, mock listing generation, SEO evaluation
- [x] Fail-closed gates: `ProductGenerationBlockedError` (no Phase 3 approval), `ListingGenerationBlockedError` (product not QA_PASSED) — both real, server-side, covered by integration tests
- [x] Second founder approval gate — `decideApprovalRequest`'s `PRODUCT_LISTING` branch, hash-bound to the latest `ProductPackage`, same re-validation pattern as Phase 3
- [x] Every listing generation records a `PublicationAttempt` with `status: 'BLOCKED_NO_LIVE_INTEGRATION'` — no publication occurs in Phase 4, confirmed as a checkable DB fact
- [x] Temporal `productListingWorkflow` (`apps/worker`) — product generation → QA → (if passed) listing + SEO + second approval request → signal-wait for founder decision
- [x] Product Studio + Listing Studio UI (`apps/web`) — product detail page showing assets/QA/licence/listing/SEO/publication status, Product Studio section embedded in Board Room
- [x] `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm build` — clean across all 17 packages/apps
- [x] `pnpm test:unit` — 14/14 packages passing, including `@ventureos/product-studio` (25/25) and `apps/api` (28/28)
- [x] `pnpm --filter @ventureos/api test:integration` — 17/17 passing, including the new product/listing suite (5/5)
- [x] Manually verified live in-browser: ran real product generation from the Board Room UI (reached QA_PASSED), viewed the product detail page (real generated assets, QA results, licence records, listing draft, SEO score 100/100, blocked publication attempt), approved the resulting PRODUCT_LISTING approval request in the Approval Centre — confirmed state transition and decision row

## Phase 5 — ✅ fully verified, all acceptance criteria met (see docs/EXECUTION_PLAN.md)

- [x] `DataAcquisitionContract`/`DataAcquisitionRun` Prisma models + migration (`20260713215625_phase5_research_connectors`), applied against real Postgres
- [x] `@ventureos/research-connectors` package: mock-by-default provider, fail-closed gates (disabled/rate-limit/cost-cap), evidence freshness/reliability scoring, prompt-injection sanitiser, source-health writer
- [x] Research module wired into `apps/api` (`research:view`/`research:manage` permissions, audit-logged)
- [x] 2 real seeded `DataAcquisitionContract` rows (Etsy public listings permitted browse, founder-provided market notes)
- [x] Research Connectors UI (`apps/web`) — contract list + detail + trigger action + nav entry
- [x] `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm build` — clean across all 18 packages/apps
- [x] `pnpm test:unit` — includes `@ventureos/research-connectors` (13/13)
- [x] `pnpm --filter @ventureos/api test:integration` — 23/23 passing, including the new research-connectors suite (6/6) with a real prompt-injection security proof
- [x] Manually verified live in-browser: ran a real acquisition (SUCCEEDED, real `EvidenceArtifact` with computed scores), confirmed the resulting health row surfaced in the existing Command Centre Integration status table

## Phase 6 — ✅ fully verified, mock-only per explicit founder decision (see docs/EXECUTION_PLAN.md)

- [x] Founder decision gate (2026-07-14): mock-only — no real Etsy account connected, recorded in `docs/DECISIONS.md` (ADR-007) and `docs/ETSY_API_INTEGRATION.md`
- [x] `MarketplaceAccount`/`IdempotencyKey` Prisma models + extended `PublicationAttempt`/`ApprovalRequest`, migration (`20260714065131_phase6_marketplace_pilot`), applied against real Postgres
- [x] `@ventureos/marketplace-connectors` package: mock Etsy client (draft/upload/publish), `withIdempotency` (conflict/replay/retry-in-place), fail-closed publication runner
- [x] Second, distinct `PUBLICATION` approval gate — hash-bound, re-validated at both decision and publish time
- [x] Temporal `marketplacePublicationWorkflow` (`apps/worker`) — prepare → PUBLICATION approval → signal-wait → publish
- [x] Marketplace Publication UI card (mode badge, start action, attempt history, approval status, real mock listing URL)
- [x] `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm build` — clean across all 19 packages/apps
- [x] `pnpm test:unit` — 16/16 packages passing, including `@ventureos/marketplace-connectors` (3/3)
- [x] `pnpm --filter @ventureos/api test:integration` — 36/36 passing, including the new marketplace suite (13/13: prepare/fail-closed/idempotency/approval/publish/hash-drift/audit)
- [x] Manually verified live in-browser: ran the full prepare → PUBLICATION approval → publish flow via the Temporal workflow, confirmed the real mock listing URL rendered on the product page
- [x] Found + fixed a real bug via live verification: Temporal-workflow-triggered actions (Phase 3/4/6 alike) weren't audit-logged for intermediate steps, only workflow-start + founder-decision — added `apps/worker/src/lib/write-audit-event.ts` and wired it into all three phases' worker activities (see `docs/DECISIONS.md` ADR-008); re-verified live afterward that the full audit chain now appears

## Phase 7 — ✅ fully verified, all acceptance criteria met (see docs/EXECUTION_PLAN.md)

- [x] `FinancialAssumption`/`FinancialForecast`/`FinancialScenario`/`Expense`/`RevenueEntry`/`MarketplaceFee`/`RefundRequest`/`Budget`/`BudgetAllocation`/`CostLedgerEntry` Prisma models + migration, applied against real Postgres
- [x] Model-usage cost tracking (`recordModelUsage`) — zero-cost invocations record usage without charging, non-zero-cost invocations charge a real ledger entry + increment allocation spend
- [x] Budget hard-stop enforcement (`assertWithinBudget`/`chargeToBudget`) — venture-scoped allocations preferred over workspace-wide, fail-closed with no partial side effect when a charge would exceed the limit
- [x] Forecast-vs-actual comparison (`compareForecastToActual`) against real `RevenueEntry` rows
- [x] `Experiment`/`ExperimentVariant`/`ExperimentMetric`/`ExperimentResult`/`ExperimentDecision` Prisma models + full lifecycle runner
- [x] Gate 6 (Scale Decision) approval gate — same `ApprovalRequest`/`decideApprovalRequest` machinery as every prior phase; KILL/ITERATE/HOLD never require approval, only SCALE does
- [x] Finance Centre UI (`apps/web`) — assumptions, forecast + scenarios, forecast-vs-actual, expenses, revenue, experiments
- [x] `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm build` — clean across all packages/apps (found + fixed 16 files of pure Prettier formatting drift)
- [x] `pnpm test:unit` — includes `@ventureos/finance-engine` (24/24: assumptions defaults/validation, error classes)
- [x] `pnpm --filter @ventureos/api test:integration` — 7 files / 54 tests, all passing, including the new finance suite (20/20)
- [x] Found + fixed a real production bug via testing: Gate 6 SCALE approvals computed `packageHash` differently from every other approval kind's re-validation scheme, so they would have permanently failed closed with `PACKAGE_HASH_MISMATCH` regardless of real drift
- [x] Manually verified live in-browser: generated a real forecast, recorded a real expense + revenue entry (forecast-vs-actual updated live), created + started an experiment, recorded a real result, requested + approved the Gate 6 scale-decision approval, recorded the SCALE decision, confirmed the full audit trail in the Audit Centre
- [x] Found + fixed a real bug via live verification: `serverApiFetch` (shared by all 16 dashboard pages) crashed with "Unexpected end of JSON input" on NestJS's genuinely-empty response body for any endpoint returning `null` — see `docs/DECISIONS.md` ADR-009

## Phase 8 — ✅ fully verified, all acceptance criteria met (see docs/EXECUTION_PLAN.md)

- [x] `Plan`/`Subscription`/`SubscriptionInvoice`/`LicenseKey`/`WorkspaceBranding` Prisma models + migration (`20260714132415_phase8_multi_venture_and_saas`), applied against real Postgres
- [x] `@ventureos/billing` package: mock-only subscription/licensing engine (see `docs/DECISIONS.md` ADR-010), fail-closed plan-limit guards mirroring Phase 7's budget-guard pattern
- [x] Tenant isolation audit across every `apps/api/src/modules/*.service.ts` — no real cross-workspace leak found, one defense-in-depth fix made (`marketplace.service.ts`)
- [x] Unified Ventures list UI (`apps/web/src/app/dashboard/ventures`) + live plan-usage badge — no schema rewrite needed, `Opportunity`→`VentureProposal` already supported multiple ventures per workspace since Phase 2
- [x] Billing API module (`apps/api/src/modules/billing`) — plan change/cancel/reactivate, license key issue/revoke, all permission-gated and audit-logged
- [x] White-label settings (`WorkspaceBranding`) actually configurable at runtime (`PATCH /workspaces/branding`), applied live to the dashboard shell
- [x] Customer registration/onboarding flow (`POST /api/auth/register`, `apps/web/src/app/register`) — creates workspace + starts a real 14-day TRIAL subscription in one transaction
- [x] Installable/exportable configuration — license-key issuance for tracking self-hosted installs, `docs/DEPLOYMENT.md` extended, new `docs/CUSTOMER_GETTING_STARTED.md`
- [x] `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run build && pnpm test:unit && pnpm --filter @ventureos/api test:integration` — all clean, after founder-run rounds found and fixed 4 real bugs (a `seed.ts` `TS18048`, three `@ventureos/billing` `TS2742`/`noUncheckedIndexedAccess` errors surfaced once `pnpm install` linked the new package in, a missing `apps/web/.eslintrc.json` that silently never loaded the `@next/next` ESLint plugin, and 7 `react/no-unescaped-entities` violations that fix then surfaced — see `docs/DECISIONS.md` ADR-011)
- [x] `pnpm test:unit` — includes `@ventureos/billing` (7/7: error classes, plan-tier ordering/limits)
- [x] `pnpm --filter @ventureos/api test:integration` — 7 files / 54 tests, all passing, including `auth.integration.test.ts` (previously failing to load due to the unlinked billing package)
- [x] Manually verified live in-browser: registered a brand-new workspace via `/register` (real TRIAL subscription + branding row created), confirmed the Ventures page's live quota display, changed plan TRIAL → STARTER (limits updated correctly to match `DEFAULT_PLANS`), issued + revoked a license key, updated white-label branding and confirmed it applied to the dashboard sidebar on next load

## Known follow-ups from Phase 1

- [ ] Extract `apps/web/src/components` into `@ventureos/ui` once a second consumer exists
- [ ] Multi-factor authentication (deferred per master spec section 8, architecture should anticipate it)
- [ ] Account recovery flow (password reset) — not implemented, dev-login only so far
- [ ] OpenTelemetry exporter wiring (currently `OTEL_ENABLED=false` stub only)
- [x] Obtain complete green clean-runner CI evidence including Prisma migration
      apply, unit tests, real PostgreSQL integration, production build, and
      Chromium E2E (verified by 2026-08-26; GitHub remains authoritative).

See `docs/ROADMAP.md` for the full phase-by-phase plan and `docs/KNOWN_LIMITATIONS.md`
for a complete list of mocked/incomplete functionality.
