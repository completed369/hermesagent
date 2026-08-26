# VentureOS master completion audit

Date: 2026-08-27

Verified product baseline: `4f5873eaf00b5994d3bb2028de1906bfd6a2b9f6`

This audit applies the master completion directive to the existing product. It is a dependency
map, not a launch or revenue claim. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## A. What exists and is reusable

- A modular TypeScript monolith, PostgreSQL/Prisma persistence, Temporal orchestration, session
  authentication, tenant isolation, RBAC, approvals, audit events, CI, CodeQL, and no-deploy
  staging/security gates.
- Opportunity, evidence, scoring, product, listing, QA, experiment, finance, mock billing, and
  mock marketplace flows. These are useful rehearsal machinery, not live revenue evidence.
- Durable Agent Control Plane objectives, projects, tasks, dependencies, runs, artifacts,
  single-use approval permits, broker reservations, authenticated bridge admission, sequenced
  receipts, replay defenses, cancellation state, and bounded cost governance.
- Scoped secret-lease and OS-supervision policy boundaries. Production secret resolution and
  process launch remain deny-only.
- A bounded, authenticated, read-only Workflow Centre and a tested rollback/restore evidence
  contract.

## B. What is incomplete, simulated, stale, or blocked

- There is no production process supervisor, runtime transport, adapter, authenticated runtime
  registration, capability exchange, heartbeat, task/status/result exchange, or event round trip.
- No runtime has earned `CONNECTED`; presence of a binary, persisted status, test fixture, or
  policy validation is insufficient.
- No provider is active. No product image has been immutably published for this baseline, no
  private product staging deployment is evidenced, and no customer payment or realized profit is
  evidenced.
- Marketplace and billing connectors are mock-only. Commercial pilot status is `NOT STARTED`.
- Several dated planning documents lag merged cost-governance, Workflow Centre, and
  session-authority work. Historical evidence remains historical and must not be relabelled as
  current.
- Operations PR #26 is a separate Founder-controlled deployment-authority change. Its repaired
  exact head requires exact-head approval before merge; it does not block source-only product
  runtime work.

## C. Security, control, and audit gaps

- A trusted executable identity/authorization reader is required before a supervisor can rely on
  filesystem evidence. Linux can use an opened descriptor, `O_NOFOLLOW`, regular-file metadata,
  owner/mode, device/inode identity, canonical real path, and digest. Windows still needs a
  reviewed native handle, owner, reparse-point, and create-process identity design.
- Evidence issuance alone does not close path replacement TOCTOU. A future supervisor must retain
  and revalidate the same native identity through creation, apply non-root isolation, enforce
  limits, and guarantee process-tree cleanup.
- A real adapter must preserve bridge authentication, replay protection, task permits, approval
  policy, bounded payloads, usage/cost recording, cancellation, and sanitized audit evidence.
- Credentials, provider activation, deployment, publication, customer contact, and legal or
  commercial commitments remain separate Founder boundaries.

## D. Revenue-readiness gaps

- There is no real `RevenueRun` or equivalent record joining opportunity, approved action,
  runtime execution, delivery, realized revenue, cost, and profit evidence.
- Expected value and confidence scoring exist in pieces, but there is no live prioritized queue
  whose results update estimates with real outcomes.
- There is no verified first beachhead connector, design partner, payment path, or repeatable
  onboarding path. Mock marketplace and billing results must not be treated as revenue.
- Financial reporting must distinguish holds from charges and forecasts from realized amounts.

## E. Launch-readiness gaps

- Current-main five-image build/security evidence, immutable manifest, SBOM/provenance/signature
  policy, published digests, private staging identity, secrets, backups, monitoring, capacity, and
  rollback rehearsal are not one consolidated current release record.
- Source-only rollback/restore tests do not prove external backups or a live rollback.
- Production and commercial launch still require explicit Founder gates and real acceptance
  evidence.

## F. Dependency map

1. Trusted executable evidence reader.
2. Deny-by-default supervisor composition with native identity retention and isolation contract.
3. Bounded JSONL lifecycle transport using only the deterministic fixture.
4. One reviewed runtime adapter, beginning with authenticated registration and capability
   exchange but retaining `NOT_CONFIGURED` until the complete round trip passes.
5. Registration, heartbeat, single-use task, status, result/event, cancellation, usage/cost, and
   audit evidence for that one runtime.
6. RevenueRun/equivalent plus safe opportunity-to-outcome learning and a single beachhead
   playbook.
7. Current-main release package and private-staging preparation.
8. Founder-approved staging/provider/customer actions, then the first verified financial outcome.

## Ordered backlog

### P0 — unlock one governed runtime

1. Implement the Linux opened-file executable evidence reader with test-only signed authorization;
   keep production authorization and Windows fail-closed.
2. Compose evidence, admission, broker, approval, secret lease, lifecycle, and a launcher that
   still denies every production launch.
3. Add bounded JSONL framing and cancellation around the deterministic process fixture only.
4. Select one runtime adapter and define an exact reviewed executable/argument allowlist.
5. Run authenticated registration → capabilities → heartbeat → one permitted task →
   status/result/event → usage/cost → cancellation/recovery. Promote only that runtime after
   independent evidence review.

### P1 — connect execution to money

1. Add a durable RevenueRun/equivalent correlation model without duplicating existing task/run,
   experiment, finance, or ledger state.
2. Add explicit expected revenue, expected cost, downside, confidence, time-to-cash, and realized
   outcome fields with forecast/actual separation.
3. Build one evidence-backed playbook and asset bundle for a selected beachhead; keep publication
   and customer contact Founder-gated.
4. Surface holds, charges, realized revenue, and profit without foreign-exchange or accounting
   claims not supported by evidence.

### P2 — live command and release truth

1. Replace manual status with authenticated GitHub/ACP/runtime telemetry where safe.
2. Reconcile current-main five-image, SBOM, provenance, signature, manifest, and rollback evidence.
3. Complete private-staging preflight for identity, migrations, secrets, backups, health,
   monitoring, capacity, and rollback.

### P3 — commercial proof

1. Select one beachhead and one connector after Founder approval.
2. Complete a safe rehearsal and pilot readiness review.
3. Execute the first real pilot only across the required customer/provider/deployment boundaries.
4. Record the first verified revenue, cost, and profit outcome; update estimates from evidence.

## Current first slice

The first implementation slice is the Linux trusted executable evidence reader described in
ADR-0027. Only a test-only signer is pinned; production authorization remains unavailable. It
advances P0 while deliberately adding no process, runtime, provider, network, credential,
deployment, publication, or status authority.
