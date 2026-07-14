# Roadmap

Phased delivery per master spec section 34. All 8 phases are now built and
locally verified end-to-end (see `docs/EXECUTION_PLAN.md` for the canonical,
itemized verification record). Phase 6 is mock-only per the founder's
explicit 2026-07-14 decision (no real Etsy account connected); Phase 8's
billing/subscriptions are likewise mock-only (no real payment processor
connected, see `docs/DECISIONS.md` ADR-010).

- **Phase 0 — Environment and Repository**: DONE
- **Phase 1 — Foundation**: DONE — auth, workspace, RBAC, audit,
  dashboard shell, seed, health, CI config, local security controls
- **Phase 2 — Opportunity and Evidence**: DONE — Opportunity/Evidence Prisma
  models + migration, seeded pilot opportunity (master spec §25 — Social Media
  Content Planning Kit), Opportunity Feed UI with full evidence trail,
  `scoring-engine` wired to real persisted data, promote/reject/archive API
  with audit logging, unit + integration tests passing, live browser-verified
  promote workflow.
- **Phase 3 — Board and Approval**: DONE — `AgentDefinition`/prompt versions
  seeded for the 8 voting agents + Decision Synthesiser, mock board-agent
  provider producing schema-valid votes, board reviews wired to the
  already-built `calculateBoardVotingResult`, Approval Centre with hash-bound
  enforcement via `isApprovalValidForExecution`, Temporal
  `boardApprovalWorkflow` (board review → approval request →
  founder-decision signal-wait), Board Room + Approval Centre UI, unit +
  integration tests passing, live browser-verified board review + approval
  decision end-to-end.
- **Phase 4 — Product and Listing Studio**: DONE — product/listing Prisma
  models + migration, `@ventureos/product-studio` (mock generation via
  `StorageProvider`, QA checks, Etsy Development Pack, mock listing
  generation, SEO evaluation), fail-closed Gate 3/Gate 4 checks, second
  founder approval gate bound to the latest `ProductPackage` hash, always-
  blocked `PublicationAttempt` (no publication occurs in Phase 4), Temporal
  `productListingWorkflow`, Product Studio + Listing Studio UI, unit +
  integration tests passing, live browser-verified product generation +
  listing + second approval decision end-to-end.
- **Phase 5 — Research Connectors**: DONE — `DataAcquisitionContract`/
  `DataAcquisitionRun` Prisma models + migration, `@ventureos/research-connectors`
  (mock-by-default provider, fail-closed disabled/rate-limit/cost-cap gates,
  real evidence freshness/reliability scoring, prompt-injection sanitiser),
  source health surfaced in the existing Integration Health UI, Research
  Connectors UI, unit + integration tests passing (including a real
  prompt-injection security proof), live browser-verified acquisition run +
  health surfacing end-to-end.
- **Phase 6 — Marketplace Pilot**: DONE — mock-only per explicit founder
  decision (2026-07-14, no real Etsy account connected);
  `MarketplaceAccount`/`IdempotencyKey` Prisma models + migration,
  `@ventureos/marketplace-connectors` (mock Etsy client, idempotent external
  writes, fail-closed gating), second/distinct `PUBLICATION` approval gate
  with hash re-validation, Temporal `marketplacePublicationWorkflow`,
  Marketplace Publication UI, unit + integration tests passing, live
  browser-verified prepare → approval → publish end-to-end (and a real
  workflow-audit-trail gap found via live verification and fixed across
  Phase 3/4/6 alike).
- **Phase 7 — Finance and Analytics**: DONE — `FinancialAssumption`/
  `FinancialForecast`/`FinancialScenario`/`Expense`/`RevenueEntry`/`Budget`/
  `BudgetAllocation`/`CostLedgerEntry`/`Experiment` (+ variants/metrics/
  results/decisions) Prisma models + migration, real forecast generation
  and forecast-vs-actual comparison on top of the already-unit-tested
  `finance-engine` calculations, budget hard-stop enforcement, model-usage
  cost tracking, the full experiment lifecycle, Gate 6 (Scale Decision)
  approval gating using the same `ApprovalRequest` machinery as every other
  phase, Finance Centre UI, unit + integration tests passing, live
  browser-verified forecast/expense/revenue/experiment/Gate-6-approval flow
  end-to-end (and two real bugs found and fixed along the way: a Gate 6
  `packageHash` mismatch that would have permanently blocked every SCALE
  approval, and a `serverApiFetch` crash on NestJS's empty-body null
  responses — found via live verification of a venture's real zero-state).
- **Phase 8 — Multi-Venture and SaaS**: DONE — full SaaS resale build-out
  per founder instruction; `Plan`/`Subscription`/`SubscriptionInvoice`/
  `LicenseKey`/`WorkspaceBranding` Prisma models + migration,
  `@ventureos/billing` (mock-only, ADR-010) with fail-closed plan-limit
  guards mirroring Phase 7's budget-guard pattern, tenant-isolation audit
  (one defense-in-depth fix, no real leak found), unified Ventures list UI,
  white-label branding actually configurable at runtime and applied to the
  dashboard shell, customer registration/onboarding flow
  (`POST /api/auth/register`), license-key issuance for exportable installs,
  customer-facing getting-started docs, unit + integration tests passing,
  live browser-verified registration → new workspace → plan change →
  license key issue/revoke → branding update end-to-end (four real bugs
  found and fixed via the verification suite along the way — see
  `docs/EXECUTION_PLAN.md` Phase 8 section and `docs/DECISIONS.md`
  ADR-011).

## Phase 2 closeout (completed)

1. ✅ Local verification of Phase 1 before writing new code
2. ✅ `Opportunity`, `OpportunityScore`, `TargetCustomer` Prisma models +
   migration
3. ✅ Seed script addition: the "Social Media Content Planning Kit" opportunity
   (master spec §25)
4. ✅ Opportunity feed page (`apps/web`) + `GET /api/opportunities` endpoint
   wired to the already-built `@ventureos/scoring-engine`
5. ✅ `EvidenceArtifact` model + evidence-attachment UI so opportunity score
   inputs have a real provenance trail

## Phase 3 closeout (completed)

1. ✅ `AgentDefinition`/`AgentPromptVersion` Prisma models + migration, seeded
   8 voting roles + Decision Synthesiser
2. ✅ Mock board-agent provider (`@ventureos/agent-runtime`) — deterministic,
   schema-validated, no live model calls (master spec §42)
3. ✅ `BoardReview`/`BoardVote`/`BoardVeto`/`DecisionSummary`/`RevisionRequest`/
   `ApprovalRequest`/`ApprovalDecision` Prisma models
4. ✅ Board review orchestration wired to the already-built
   `calculateBoardVotingResult` (75% threshold, critical veto blocking)
5. ✅ Approval Centre with hash-bound enforcement
   (`isApprovalValidForExecution`, re-validated server-side on every decision)
6. ✅ Temporal `boardApprovalWorkflow` (`apps/worker`) + Board Room/Approval
   Centre UI (`apps/web`)
7. ✅ Live browser verification: real board review run (8/8 APPROVE), real
   approval decided (APPROVE), audit trail confirmed

## Phase 4 closeout (completed)

1. ✅ `Product`/`ProductVersion`/`ProductAsset`/`ProductAssetVersion`/
   `ProductBrief`/`ProductPackage`/`LicenceRecord`/`QualityCheck`/
   `QualityCheckResult`/`Listing`/`ListingVersion`/`ListingImage`/
   `ListingFile`/`PriceProposal`/`SEOEvaluation`/`PublicationAttempt` Prisma
   models + migration
2. ✅ `@ventureos/product-studio` package — mock product generation (real
   MinIO-shaped uploads via `StorageProvider`), QA checks, Etsy Development
   Pack, mock listing generation, SEO evaluation
3. ✅ Fail-closed Gate 3/Gate 4 checks (`ProductGenerationBlockedError`/
   `ListingGenerationBlockedError`) — real, server-side, integration-tested
4. ✅ Second founder approval gate — `decideApprovalRequest`'s
   `PRODUCT_LISTING` branch, hash-bound to the latest `ProductPackage`
5. ✅ Every listing generation records an always-blocked `PublicationAttempt`
   — no publication occurs in Phase 4, confirmed as a checkable DB fact
6. ✅ Temporal `productListingWorkflow` (`apps/worker`) + Product Studio /
   Listing Studio UI (`apps/web`)
7. ✅ Live browser verification: real product generation run (reached
   QA_PASSED), real listing + SEO evaluation (100/100), real approval
   decided (APPROVE) on the second gate, audit trail confirmed

## Phase 5 closeout (completed)

1. ✅ `DataAcquisitionContract`/`DataAcquisitionRun` Prisma models + migration
   (`20260713215625_phase5_research_connectors`), applied against real Postgres
2. ✅ `@ventureos/research-connectors` package — mock-by-default provider
   (no live network calls anywhere in this phase), fail-closed
   disabled/rate-limit/cost-cap gates, real evidence freshness/reliability
   scoring, prompt-injection sanitiser
3. ✅ Research module wired into `apps/api` (`research:view`/`research:manage`
   permissions, audit-logged), 2 real seeded contracts
4. ✅ Source health surfaced via the existing Integration Health UI slot
   (Command Centre "Integration status" table) — no new UI table needed
5. ✅ Research Connectors UI (`apps/web`) — contract list + detail + trigger
   action + nav entry
6. ✅ Live browser verification: real acquisition run (SUCCEEDED, real
   `EvidenceArtifact` with computed scores), health row confirmed live in
   the Command Centre

## Phase 6 closeout (completed)

1. ✅ Founder decision gate (2026-07-14): mock-only — no real Etsy account
   connected (`docs/DECISIONS.md` ADR-007, `docs/ETSY_API_INTEGRATION.md`)
2. ✅ `MarketplaceAccount`/`IdempotencyKey` Prisma models + extended
   `PublicationAttempt`/`ApprovalRequest`, migration
   (`20260714065131_phase6_marketplace_pilot`), applied against real Postgres
3. ✅ `@ventureos/marketplace-connectors` package — mock Etsy client (zero
   live network calls anywhere in this phase), `withIdempotency` (conflict/
   replay/retry-in-place), fail-closed publication runner
4. ✅ Second, distinct `PUBLICATION` approval gate — hash-bound to the
   listing's marketplace-facing content, re-validated at both decision and
   publish time
5. ✅ Temporal `marketplacePublicationWorkflow` (`apps/worker`) + Marketplace
   Publication UI card (`apps/web`)
6. ✅ Live browser verification: real prepare → PUBLICATION approval →
   publish run via the Temporal workflow, real mock listing URL rendered
   on the product page; found + fixed a real audit-trail gap (Temporal-
   workflow-triggered actions weren't audited for intermediate steps across
   Phase 3/4/6 alike — see `docs/DECISIONS.md` ADR-008) and re-verified live

## Phase 7 closeout (completed)

1. ✅ `FinancialAssumption`/`FinancialForecast`/`FinancialScenario`/`Expense`/
   `RevenueEntry`/`MarketplaceFee`/`RefundRequest`/`Budget`/
   `BudgetAllocation`/`CostLedgerEntry` Prisma models + migration, applied
   against real Postgres
2. ✅ Model-usage cost tracking (`recordModelUsage`) — real from day one so
   enforcement is correct the moment real model providers are enabled
3. ✅ Budget hard-stop enforcement (`assertWithinBudget`/`chargeToBudget`),
   venture-scoped allocations preferred over workspace-wide ones
4. ✅ Forecast-vs-actual comparison (`compareForecastToActual`) against real
   `RevenueEntry` rows
5. ✅ `Experiment`/`ExperimentVariant`/`ExperimentMetric`/`ExperimentResult`/
   `ExperimentDecision` Prisma models + full lifecycle runner
   (`packages/finance-engine/src/experiment-runner.ts`)
6. ✅ Gate 6 (Scale Decision) approval gate — same `ApprovalRequest`/
   `decideApprovalRequest` machinery as every prior phase, KILL/ITERATE/HOLD
   never require approval, only SCALE does
7. ✅ Finance Centre UI (`apps/web`) — assumptions, forecast + scenarios,
   forecast-vs-actual, expenses, revenue, experiments
8. ✅ Live browser verification: real forecast generated, real expense +
   revenue recorded (forecast-vs-actual updated live), real experiment
   created → started → result recorded → Gate 6 approval requested and
   approved → SCALE decision recorded, full audit trail confirmed in the
   Audit Centre; found + fixed a real Gate 6 `packageHash` mismatch bug
   (would have permanently blocked every SCALE approval, see
   `docs/DECISIONS.md` ADR entries) and a real `serverApiFetch` crash on
   NestJS's empty-body null responses (ADR-009), both caught before
   reaching the founder

## Phase 8 closeout (completed)

1. ✅ `Plan`/`Subscription`/`SubscriptionInvoice`/`LicenseKey`/
   `WorkspaceBranding` Prisma models + migration
   (`20260714132415_phase8_multi_venture_and_saas`), applied against real
   Postgres
2. ✅ `@ventureos/billing` package — mock-only subscription/licensing engine
   (ADR-010), fail-closed plan-limit guards (`assertWithinVentureLimit`/
   `assertWithinMemberLimit`/`assertWithinMarketplaceAccountLimit`)
3. ✅ Tenant isolation audit across every `apps/api` service — no real leak
   found, one defense-in-depth improvement made
   (`marketplace.service.ts`)
4. ✅ Unified Ventures list UI + live plan-usage badge
   (`apps/web/src/app/dashboard/ventures`)
5. ✅ White-label branding actually configurable at runtime
   (`PATCH /workspaces/branding`) and applied to the dashboard shell
6. ✅ Customer registration/onboarding flow (`POST /api/auth/register`,
   `apps/web/src/app/register`) — starts a real 14-day TRIAL subscription
7. ✅ Installable/exportable configuration — license-key issuance +
   `docs/DEPLOYMENT.md`/`docs/CUSTOMER_GETTING_STARTED.md`
8. ✅ Live browser verification: real registration → new workspace → plan
   change (TRIAL → STARTER, limits updated correctly) → license key
   issue/revoke → white-label branding update, all confirmed end-to-end; 4
   real bugs found and fixed via the verification suite along the way (see
   `docs/DECISIONS.md` ADR-011)

## Master spec's 8 phases are now all complete

Per master spec section 35's phasing rule, do not begin any further build
work without explicit founder instruction on what comes next.
