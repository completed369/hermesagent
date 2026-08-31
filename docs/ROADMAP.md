# Roadmap

## Delivery roadmap (reviewed 2026-08-26)

The Phase 0–8 checklist below is a historical record of implemented product
scope. It is **not** a production-readiness or deployment claim. The dated
reviewed source baseline for this update is
`d462733ec55a8bc98092e39a5a071c01b9c76806`; it must never be interpreted as a
mutable live-main pin. GitHub is authoritative for repository main and checks,
and generated protected Mission Control evidence is authoritative for the live
operational snapshot. Exact-baseline CI and CodeQL were green. The corresponding
sanitized five-image release-candidate evidence was also green. CI
includes the full migration chain, application integration/E2E, and a disposable
staging-security/load gate that performs no deployment. The release-candidate
workflow uploaded no artifacts and created no deployment. Zero CodeQL alerts
were open when checked on 2026-08-26. No current-main application image has been
published and current `main` has not been deployed to private staging.

### Completed

- The Phase 0–8 mock-provider product baseline and its documented gates.
- The runtime/container security repair merged through PR #49, including five
  final-image vulnerability gates.
- The focused PostCSS/dependency repair, publication trust-boundary hardening,
  security-gate hardening, and deterministic Stage 6 reliability/accessibility
  work merged through PRs #53, #54, #57, and #52.
- The modern private-staging workspace experience merged through PR #50 and the
  secure collaboration, invitation, active-workspace session, role-enforcement,
  and tenant-isolation implementation merged through PR #55. These are merged
  product capabilities, not deployment evidence.
- A public `ventureos.site` entry point plus Access-protected staging, API, and
  progress hostnames at `staging.ventureos.site`,
  `api-staging.ventureos.site`, and `progress.ventureos.site`, managed
  separately from product deployment.
- Fail-closed publication and private-staging workflow templates. Their
  presence remains capability evidence, not deployment evidence.
- Product PRs #59–#65: provider-neutral Agent Control Plane, Runtime Broker,
  Dynamic Agent Factory, verified Codex/Hermes/Pi interface evidence,
  tenant-shell workspace-switch repair, governed AI COO, and governed Voice
  Gateway foundations.
- Product PR #68: a tenant-scoped unified operational event and audit spine.
- Product PR #72: governed approval execution permits that bridge approval
  decisions to bounded execution authority.
- Product PR #76: a verified, service-only durable objective/project/task/
  dependency/run/artifact spine with composite workspace boundaries, atomic
  audit writes, optimistic concurrency, bounded retries, fail-closed evidence
  ports, and Level-4 approval preparation bound to real durable task/run rows.
- Product PR #78: a verified, service-only durable protocol-neutral Agent
  Bridge admission boundary with bounded canonical framing, directional
  authentication, replay protection, exact workspace/principal/session/runtime
  binding, durable dispatch/receipt/usage evidence, fail-closed policy and
  artifact verification ports, and deterministic test-only fixture coverage.
  It adds no transport, controller, network, process launcher, or runtime
  connectivity claim and stops runtime truth at `PARTIAL`.
- A bounded outbound foundation prepares immutable metadata for one
  parent-to-runtime `DISPATCH` authorization and signs an ephemeral canonical
  envelope with the direction-specific leased key. It still adds no transport,
  delivery worker, provider adapter, process path, or `SENT`/connected claim;
  dispatch remains `PREPARED` until separately authenticated runtime evidence
  is admitted.
- A service-only egress-handoff foundation may re-sign that exact prepared
  frame and append one short exclusive claim bound to the authenticated
  principal and actor kind. Expiry is immutable, early release is a separate
  append-only row, and reclaim is a new generation. Only authenticated service
  writes carry atomic audit; trigger-valid direct-writer rows remain
  unauthenticated correlation metadata requiring re-signing/reverification.
  This is still no sender, queue, socket, process, provider, delivery,
  acknowledgement, `SENT`, or connectivity path.
- A bounded single-frame egress controller now exact-binds one claimed
  `DISPATCH` to its canonical JSONL bytes and an injected, abortable local write
  port. The only production-ready transport implementation denies every write;
  there is no API wiring, socket, pipe, queue, process, provider, acknowledgement,
  delivery state, or runtime-status promotion.
- Codex is selected as the first reviewed real-runtime interface behind an inert
  Linux-only app-server policy. It accepts only a supervisor-manifest candidate
  for `codex app-server --listen stdio://` and requires the separate
  opened-file/signed-evidence flow before any future launch; it rejects alternate
  transports, arguments, wrappers, environment, secret handles, and network.
  Production executable authority and launching remain deny-only, no process or
  provider is contacted, and Codex remains `NOT_CONFIGURED`.
- The reviewed Codex interface now has an I/O-free, single-task protocol state
  machine for exact initialization, thread creation, turn creation, optional
  interruption, and terminal correlation. It bounds message size and structure,
  retains no task or result text, rejects out-of-order and unreviewed shapes,
  exposes no transport or provider operation, and leaves runtime truth
  `NOT_CONFIGURED`.
- Codex now has an inert authenticated-registration translation boundary. It
  joins the revalidated command policy, pristine initialized protocol state,
  authenticated VentureOS bridge identity, and a correlated non-refreshing
  account-state declaration, while hashing and discarding account details. It
  grants no durable registration or provider authority and keeps Codex
  `NOT_CONFIGURED`.
- Codex now has a dedicated durable registration-evidence operation. It admits
  only an exact revalidated candidate, a separately trusted five-minute
  authorization, and a scoped secret lease that reproduces the candidate's
  one-way secret binding. The production authorization and secret sources deny
  by default; retained evidence excludes account details and credentials, and
  both runtime and connection remain `NOT_CONFIGURED`.
- Codex now has a dedicated immutable capability-evidence operation. It accepts
  only the normalized complete `model/list` candidate bound to the exact
  tenant-scoped durable registration, capability policy, idempotency key, and
  a separate five-minute authorization. It stores no model identity or raw
  protocol payload, production authorization denies by default, and it leaves
  runtime and connection capability/status truth `NOT_CONFIGURED`.
- Codex now has a dedicated immutable heartbeat-evidence operation. It accepts
  one fresh canonical VentureOS bridge `HEARTBEAT` only after the exact durable
  registration and capability rows, verifies its runtime-to-parent MAC through
  the scoped secret lease, and binds tenant, identity, generation, sequence,
  message, and idempotency evidence. It retains no MAC, nonce, secret, or raw
  frame and deliberately leaves connection heartbeat and status fields
  untouched.
- Codex now has a separately authorized validation-dispatch preparation path.
  It signs one zero-cost, resource-bounded `codex.runtime.round-trip.v1`
  challenge tied to an exact ready/unassigned durable validation run and the
  immutable heartbeat precursor. Only digests and safe references persist; the
  frame remains ephemeral and `NOT_SENT`, production authorization and secrets
  remain deny-only, and no task/run/connection truth changes. A bounded local
  controller/transport and authenticated status/result admission are the next
  separately reviewed adapter boundaries.
- Product PR #80: verified durable broker decisions and short-lived capacity,
  cost, and compute reservations bound to exact workspace, task, run, trusted
  agent evidence, runtime, connection, policy, and candidate evidence. Database
  constraints and lifecycle guards serialize holds, expiry, claim, and release;
  this is routing evidence, not execution, connectivity, provider spend, or a
  finance ledger charge.
- Product PR #82: a verified scoped Agent Bridge secret-lease boundary that
  binds every request to the exact workspace, runtime, connection,
  authentication generation, and purpose. Provisioning derives the initial
  digest; authentication and frame verification bind to the durable digest.
  Production remains deny-only and the slice adds no credential backend,
  transport, process launcher, provider, or runtime connectivity.
- Product PR #84: a verified pure OS-supervision admission policy that binds an
  exact normalized manifest to short-lived trusted adapter, executable,
  lexical-worktree, argument-policy, and resource evidence. Its output is inert,
  filesystem and launch-time TOCTOU remain open, and the production launcher
  continues to deny every process request.
- Durable cost governance: immutable one-to-one usage ledger evidence with
  exact workspace/task budget periods is MERGED and VERIFIED. It adds no
  billing provider, runtime connection, controller, deployment, or publication.
- A pure supervision lifecycle and exact-cancellation binding plus a
  deterministic test-only process-tree harness. The fixture is absent from
  package exports and product images and supplies only Windows/Linux test
  evidence; it is not a production launcher, supervisor, or runtime connection.
- Product PRs #66, #67, #69, #70, #71, #73, and #74: a dispatch-only,
  non-publishing release-candidate evidence workflow with runner-local five-
  image builds/scans, sanitized conclusions, exact source/archive/report/SBOM
  identity checks, canonical-main revalidation, and no artifact upload.

### In progress

1. **Documentation reconciliation:** keep public product documentation aligned
   with current repository, CI, security, deployment, and commercial evidence.
   GitHub is authoritative for this documentation PR's mutable head and checks;
   this file does not circularly pin its own commit.
2. **Agent Control Plane continuation:** the durable task/run, approval-
   preparation, protocol-neutral Agent Bridge admission, and durable broker
   reservation and scoped secret-lease foundations are MERGED and VERIFIED.
   The secret boundary remains deny-only and adds no credential backend or
   connection path. The pure OS-supervision admission policy is also MERGED and
   VERIFIED; its production surface adds no filesystem or process path. A
   deterministic process-tree fixture exercises cancellation only under tests.
   A Linux-only reviewed trusted executable/admission-evidence reader and a
   service-only supervisor composition now bind a live per-admission authority
   decision to an immutable, process-local launch plan. Production authority and
   the sole launcher remain deny-only. A bounded I/O-free post-authentication
   JSONL session now verifies runtime-to-parent batches in memory; it is not a
   transport, durable writer, or connection. Windows native identity inspection and
   actual production process supervision remain required before any process creation or
   runtime adapter. Evaluations, knowledge/playbooks, and adapter hardening
   continue afterward.
   A fixed Linux x86-64 native helper and test-file-local launcher exercise the
   composition-to-native one-use handoff, sealed retained-ELF execution, a fixed
   no-child/session-escape deny policy, and root-process cleanup in tests only.
   This is not general process-tree containment and is not exported, packaged,
   imaged, or wired to production.
   The next test-only slice joins that opaque native handoff to the bounded authenticated JSONL
   verifier for exact capability, heartbeat, success, and cancellation transcripts. Synthetic key
   material uses only an anonymous inherited descriptor and verification occurs after native
   cleanup. This is CI evidence only, not a runtime connection or production transport; production
   authorization, secrets, and launching remain deny-only and all real runtimes remain
   **NOT_CONFIGURED**.
   Codex now also has an I/O-free, exact stable `model/list` capability
   translator and immutable durable acceptance bound to authenticated durable
   registration. It accepts only a complete non-hidden catalog, retains hashes
   and normalized catalog claims rather than model identity, and requires a
   separate deny-by-default authorization. It does not contact a provider or
   promote runtime truth. The successor immutable heartbeat path verifies one
   fresh runtime-to-parent signed observation without updating runtime truth.
   A zero-spend validation dispatch can now be prepared and signed without
   broker routing, assignment, delivery, or truth promotion. A separate
   one-shot claim can bind that exact frame to a five-second bounded local
   controller, but its production transport remains deny-only and local byte
   acceptance is not delivery evidence. A real bounded Codex app-server
   transport and authenticated status/result evidence remain the next safe
   adapter slices.
   Merged contracts are not runtime-connectivity evidence.
3. **Mission Control continuation:** the protected Founder Mission Control is
   deployed from the operations repository and displays verified company state.
   The product repository now includes a bounded authenticated read-only
   Workflow Centre source at `/dashboard/workflows`. It combines safe legacy
   workflow metadata with persisted Agent Control Plane objective, task, run,
   runtime, connection, and pending Level-4 summaries without exposing approval
   authority, private evidence, secrets, transcripts, artifacts, or cost. This
   source capability is not live telemetry or deployment evidence.
   Continue authenticated telemetry, task graph, approvals, security,
   infrastructure, commercial, finance, and board views without exposing
   confidential fields or weakening Cloudflare Access.
4. **Commercial validation:** select and qualify one real beachhead pilot from
   evidence. Synthetic readiness is not a pilot, customer, revenue, conversion,
   or product-market-fit claim.

### Evidence-driven company OS workstreams

Use the state model `PLANNED → READY → IN PROGRESS → REVIEW → GREEN → MERGED →
PUBLISHED → DEPLOYED → VERIFIED`, with `PILOT`, `PRODUCTION`, `BLOCKED`, and
`RETIRED` only where the corresponding evidence exists. Never collapse merged,
published, deployed, verified, pilot, customer, invoice, or cash states.

1. **Agent Control Plane — IN PROGRESS:** the provider-neutral foundation,
   unified event/audit spine, and approval execution permits are MERGED. Continue
   tenant-scoped agents, runtimes, capabilities, authority,
   objectives/tasks/dependencies, runs/checkpoints, events, artifacts,
   approvals, heartbeats, failures/retries/handoffs, locks, schedules,
   notifications/incidents, usage/cost, and versioned models/prompts/tools/
   policies. Runtime identity, replay resistance, scoped credentials, revocation,
   concurrency, nesting, retry, time, tool, and budget limits are release gates.
   The repository now includes a verified, service-only durable objective/
   project/task/dependency/run/artifact spine with exact Level-4 approval
   preparation bound to real durable task/run rows and fail-closed evidence
   ports. This is coordination evidence, not runtime connectivity or execution.
2. **Runtime Broker and adapters — IN PROGRESS:** the capability- and
   policy-aware Runtime Broker, constrained Agent Bridge durable admission,
   exact durable capacity/cost/compute reservations, and scoped deny-only
   secret leases are MERGED and VERIFIED. The bridge is service-only, stops at
   `PARTIAL`, and has a deny-only launcher plus an unexported deterministic test
   fixture. A Linux-only trusted executable/admission-evidence reader and
   deny-by-default composition issue only process-local plans after a live
   authority read; production authority and launching still deny. Windows
   identity inspection, actual process supervision/transport, and authenticated
   runtime adapters remain to be completed. Codex, Hermes, and Pi remain
   **NOT_CONFIGURED** until each demonstrates authenticated
   registration, capability exchange, heartbeat, task/status exchange, and an
   event/result round trip. Do not infer connectivity from installed software,
   repositories, or prior conversations.
3. **Dynamic Agent Factory and AI COO — IN PROGRESS:** governed foundations for
   both are MERGED. Continue bounded temporary specialists only when
   specialization adds value; use isolated worktrees,
   branches, ownership, locks, acceptance criteria, stop conditions, retention,
   authority, and budgets. AI COO decomposes founder objectives and coordinates
   human and AI assignees but cannot bypass CI, security, policy, or Level-4
   boundaries.
4. **Mission Control and AI Workforce — IN PROGRESS:** the protected Founder
   Mission Control is deployed from the operations repository. Continue evolving
   it into an evidence-backed view of company health, objectives/tasks/runs,
   real agent telemetry, approvals, incidents, releases, infrastructure,
   security, customers, commercial evidence, finance, costs, board decisions,
   and risks. The bounded product Workflow Centre is the first authenticated
   read-only task/workforce view; streaming telemetry and operator controls remain
   separate future work. Do not fake live events or publish arbitrary percentages.
5. **Voice — IN PROGRESS:** the governed provider-neutral Voice Gateway
   foundation is MERGED. Push-to-talk, activated STT/TTS adapters, end-to-end
   voice interaction, history, and live-evidence briefings are not yet verified.
   Voice never bypasses secure Level-4 confirmation, and no paid provider may be
   activated without founder authorization.
6. **Memory, playbooks, evaluation, and outcome graph — IN PROGRESS:** the
   unified event/audit spine provides an initial observable-fact substrate.
   Continue to preserve
   provenance, freshness, contradictions, decisions, observable actions,
   artifacts, experiments, outcomes, evaluations, agent scorecards, and
   versioned playbooks with tenant/workspace/permission scope, retention,
   export, and deletion controls. Do not store private chain-of-thought or leak
   tenant-private learning.
7. **Commercial proof — PLANNED:** maintain focus on one evidence-selected
   beachhead ICP, synthetic demo readiness, discovery, design partners, pilots,
   measured value, paid conversion, and repeatability. Do not invent customers,
   revenue, pipeline, pricing, partners, costs, or product-market fit.

### Dated website and operations snapshot (verified 2026-08-25)

- `ventureos.site` is the public entry point. Public claims must remain limited
  to implemented or clearly labelled directional capabilities.
- `staging.ventureos.site`, `api-staging.ventureos.site`, and
  `progress.ventureos.site` remain protected surfaces. This access-boundary
  statement is not a current-main product deployment claim.
- Operations PR #24 deployed the protected Founder Mission Control from the
  private operations repository. Its deployment, command-center, and Site
  Steward checks were green at the dated verification point. This is a non-
  authoritative historical snapshot: private operations evidence and the live
  Access boundary are authoritative for newer state.
- The Mission Control deployment did not publish product images or deploy the
  product application, API staging, or current-main private staging. Website
  content and confidential reporting must be synchronized only through their
  authorized workflows and must retain public/private field boundaries.

### Release, staging, and pilot sequence

1. Merge this docs-only reconciliation only after exact-head CI,
   staging-security, CodeQL, and independent truth/diff review pass. Routine safe
   documentation merges are authorized, but this change must not dispatch a
   deployment or publication.
2. Continue Agent Control Plane, Runtime Broker, Dynamic Agent Factory, AI COO,
   Mission Control, Voice, and runtime-adapter work through independently
   reviewed, non-deploying PRs with tenant/authority/budget boundaries intact.
3. Keep the protected Mission Control synchronized through its separate
   operations repository. Any operations merge that updates a website retains
   its deploy-aware Founder boundary; never infer a new deployment from product
   repository changes.
4. Treat the green sanitized release-candidate workflow as current-main scan
   evidence only. Publishing the five images requires separate exact-SHA
   authorization and must produce trusted immutable digest evidence.
5. Deploy only the authorized digests to Access-protected private staging after
   a separate deployment authorization. Validate migrations, health, E2E,
   responsive/accessibility behavior, tenant isolation, audit evidence,
   backup/restore, and rollback using synthetic data and disabled live providers.
   The source-only rollback/restore readiness contract now binds exact prior
   source/digests/health and migration compatibility and exercises a disposable
   PostgreSQL drill. A real backup, restore, or deployment remains separately
   gated and is not evidenced by that fixture.
6. Run a current-main internal synthetic-data rehearsal. An invited pilot follows only after
   privacy/terms/data-handling, access, support, incident, and rollback ownership
   are approved. Record observed pilot evidence; do not infer pricing, revenue,
   conversion, or product-market fit from mock data or draft code.
7. Consider paid/live-provider or production activation only from measured
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

Routine development, documentation, security, UI, collaboration, Agent Control
Plane, runtime-adapter, dashboard, voice, testing, accessibility, and internal
tooling PRs may be independently reviewed, validated, and merged under the
2026-08-20 autonomy amendment when they do not deploy/publish, spend, activate a
paid provider, change DNS/Cloudflare, make a legal commitment, destructively
change production, or cross another Level-4 boundary.

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
