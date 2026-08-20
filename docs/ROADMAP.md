# Roadmap

## Current delivery roadmap (2026-08-20)

The Phase 0–8 checklist below is a historical record of implemented product
scope. It is **not** a production-readiness or deployment claim. The current
verified product baseline is `main` commit
`815935c3463151bff33f724ff0a457fee162d564`. PRs #53, #54, #57, and #52 are
merged into that exact commit; post-merge CI and CodeQL are green and there are
zero open CodeQL alerts. No application image for this baseline has been
published and no private-staging application deployment has been dispatched.

### Completed

- The Phase 0–8 mock-provider product baseline and its documented gates.
- The runtime/container security repair merged through PR #49, including five
  final-image vulnerability gates.
- The focused PostCSS/dependency repair, publication trust-boundary hardening,
  security-gate hardening, and deterministic Stage 6 reliability/accessibility
  work merged through PRs #53, #54, #57, and #52.
- A public `ventureos.site` entry point plus Access-protected staging and
  progress hostnames at `staging.ventureos.site` and
  `progress.ventureos.site`, managed separately from product deployment.
- Fail-closed publication and private-staging workflow templates. Their
  presence remains capability evidence, not deployment evidence.

### In progress

1. **Private staging experience:** PR #50 at exact head
   `f4a9f1a28fcf1afabc54303ebd76feb7c96e6c76` is a clean, fully green draft
   modernizing the core workspace shell and product surfaces. It is validated
   but unmerged and undeployed.
2. **Secure collaboration:** PR #55 at exact head
   `13e3846d4be091b5f828cda3fcfb5e5b005c4715` is a clean, fully green draft
   stacked on PR #50 at `f4a9f1a28fcf1afabc54303ebd76feb7c96e6c76`.
   Founder authorization, account-bound invitation continuation,
   active-workspace sessions, retained-role semantics, tenant-scoped
   revocation, migration behavior, and a real workspace-switch browser journey
   are covered. CI, CodeQL, the staging-security gate, Prisma/runtime gates, and
   all five final-image scans passed. It remains unmerged and undeployed.
3. **Public journey:** operations-repository PR #21 at
   `f6c0c952b5446eb6e0fb67418b58944ee1abf085` is a validated, unmerged public
   welcome-journey candidate. It must remain honest about pilot status and must
   not expose protected or confidential information.
4. **Founder command center:** operations-repository PR #20 at
   `12eb5cad692bda5a02f8ed9da2a5c4ac0fdc47db` is an unmerged progress-dashboard
   candidate that must be reconciled after the product sequence. The protected
   `progress.ventureos.site` must distinguish current `main`, validated drafts,
   blockers, approvals, deployments, and live evidence without invented
   percentages or milestone claims.

### Release, staging, and pilot sequence

1. Review PR #50 at its exact head and obtain merge approval. After it lands,
   reconcile PR #55 onto the resulting `main`, rerun every required exact-head
   CI/security/migration/runtime/image gate, review its delta, and obtain merge
   approval. Passing checks do not authorize either merge.
2. Reconcile this roadmap and the operations-repository public/progress drafts
   to the resulting exact merged state. Keep `ventureos.site` public and keep
   `staging.ventureos.site` and `progress.ventureos.site` Access-protected.
3. Select one exact merged release-candidate commit, build and scan all five immutable
   application images, and retain digest/SBOM/provenance evidence. Publishing
   those images requires a separate exact-SHA authorization.
4. Deploy only the authorized digests to Access-protected private staging after
   a separate deployment authorization. Validate migrations, health, E2E,
   responsive/accessibility behavior, tenant isolation, audit evidence,
   backup/restore, and rollback using synthetic data and disabled live providers.
5. Run an internal synthetic-data rehearsal. An invited pilot follows only after
   privacy/terms/data-handling, access, support, incident, and rollback ownership
   are approved. Record observed pilot evidence; do not infer pricing, revenue,
   conversion, or product-market fit from mock data or draft code.
6. Consider paid/live-provider or production activation only from measured
   staging/pilot evidence and a separately approved commercial and operational
   plan.

### Founder decisions that require separate approval

- Any spend, paid account, provider contract, pricing, customer promise, or
  other legal/commercial commitment.
- Supplying or rotating production credentials, enabling live AI, marketplace,
  email, payment, advertising, monitoring, or other external providers.
- Collecting or accessing customer/personal data, approving privacy/terms/
  retention/data-processing arrangements, or selecting a real pilot cohort.
- Publishing images for an exact SHA; changing production DNS/infrastructure;
  deploying to private staging or production; and accepting the associated
  backup, rollback, incident, and support ownership.

Ordinary code repair, tests, review, and draft-PR maintenance remain engineering
work within the existing authorization and do not require a new founder decision.

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

## Historical master-spec milestone

The original eight implementation phases were completed as a product-scope
milestone. The prior instruction to stop after Phase 8 was superseded by the
founder's 2026-08-20 autonomous completion directive. Current work follows the
delivery roadmap above and the repository's protected review, security, and
deployment gates.
