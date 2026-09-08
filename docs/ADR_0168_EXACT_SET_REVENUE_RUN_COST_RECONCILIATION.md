# ADR-0168: Exact-set revenue-run cost reconciliation

Date: 2026-09-08

## Context

ADR-0166 deliberately reported business expenses and recognized ACP runtime charges separately
because the records may overlap. ADR-0167 exposed that conservative view without adding mutation
authority. Summing both sets could double-count costs, while choosing either set or inferring
pairwise relationships would invent accounting facts.

## Decision

Add an immutable aggregate reconciliation record that binds:

- the sorted IDs and evidence hashes of every current linked expense;
- the sorted IDs and evidence hashes of every current recognized runtime usage;
- the authoritative aggregate of each set;
- an operator-asserted overlap amount bounded by both aggregates;
- a bounded basis reference, actor, idempotency key, currency, and canonical reconciliation hash.

The writer requires fresh `FINANCE_ACCESS`, locks the revenue-run parent before reading links,
re-hashes every source fact, and requires both evidence sets to be non-empty. The parent lock
serializes against database-triggered link insertion. One reconciliation is allowed for an exact
evidence-set pair; exact idempotent replay is accepted and all conflicting reuse fails closed.

The read projection derives all links, source facts, and reconciliation evidence inside one
repeatable-read transaction, then re-computes both set hashes and authoritative totals. It uses only
the newest reconciliation when it matches the exact current sets and its canonical hash. A later
evidence link changes a set hash, yielding `STALE_RECONCILIATION_EVIDENCE_SET` and no profit until a
new review.

With current exact-set evidence, deduplicated cost is expense plus recognized runtime charge minus
the asserted overlap. Profit is net recorded revenue minus that cost and is labelled
`CALCULATED_FROM_UNVERIFIED_REVENUE_AND_RECONCILED_COSTS`; it is not verified revenue or profit.

## Database enforcement

The schema and migration enforce non-negative aggregates, an overlap no larger than either
aggregate, tenant/run/currency scope, unique idempotency and evidence sets, and append-only updates
and direct deletes. Workspace cascade erasure remains possible only after the parent revenue run is
removed.

## Authority and commercial-truth boundary

- There is no API or worker mutation composition for reconciliation.
- No expense, usage, ledger, revenue, payment, delivery, task, run, or approval fact is created.
- The basis reference is an assertion pointer, not independently verified accounting evidence.
- No provider activation, publication, customer contact, spend, deployment, DNS, secret handling,
  or Level-4 action is introduced.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

VentureOS can avoid double-counting only when a bounded operator has reconciled the complete exact
cost evidence snapshot. Verified payment and delivery evidence, a real pilot, and a repeatable
risk-adjusted revenue loop remain absent and retain their existing Founder gates.
