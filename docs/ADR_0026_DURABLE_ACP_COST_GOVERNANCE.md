# ADR 0026: Durable ACP cost-governance ledger

Status: proposed implementation evidence; not deployed

## Decision

Recognized runtime spend is created only from an authenticated `USAGE` bridge
receipt and is paired one-to-one with an immutable, tenant-scoped ledger entry
inside the same serializable database transaction. The ledger binds the exact
receipt, dispatch, session, run, task, runtime, connection, sequence, currency,
usage delta, budget policies, cumulative totals, period, and canonical checksum.

Exactly one canonical workspace policy and one canonical task policy must cover
the database-recorded instant. Missing, overlapping, expired, currency-drifted,
or hash-drifted policies fail closed. Policy rows are immutable versions. The
database locks the correlated policies and rejects alternate-writer attempts to
forge correlations, cumulative spend, or values above either limit. Deferred
constraint triggers reject a usage row without its ledger entry. Ledger evidence
cannot be removed through direct, usage, receipt, dispatch, session, run, task,
or policy deletion while the workspace remains; only whole-workspace erasure
permits its cascade.

For a `USAGE` message, a database trigger overwrites any caller-supplied receipt
time with the database clock. The receipt, usage, and ledger rows must then bind
that exact immutable instant. The database applies the budget period to that
instant and sums ledger deltas across every period and run to enforce the durable
task's lifetime cost and compute ceilings. A retry or replacement run therefore
cannot reset task spend or select a past or future policy period. The canonical
lock order is durable task, workspace policy, then task policy.

The checksum is deterministic integrity evidence, not a signature and not a
claim of cryptographic tamper-proof storage. Tenant deletion cascades the usage,
ledger, and policy evidence; no actor identity or secret is retained here.

## Boundaries

- Broker reservations remain routing/capacity estimates. They are never called
  spend and never create ledger entries.
- There is no controller, UI, provider, process, network, billing, deployment,
  or publication path in this slice.
- The only exposed service operation is a bounded, workspace-scoped read query.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.
- Budget policy administration, external billing reconciliation, FX conversion,
  refunds, invoicing, and provider activation remain later governed work.

## Failure semantics

Any budget, correlation, checksum-input, receipt, audit, or database error rolls
back the receipt, usage, ledger, session sequence, and audit event together.
Concurrent spend is serialized by the durable task and exact policy locks plus
serializable isolation.
The migration fails closed if it encounters pre-existing recognized usage;
such data requires an explicit reviewed policy-and-ledger remediation rather
than an invented historical budget assignment.
