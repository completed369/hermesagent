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
constraint triggers reject a usage row without its ledger entry and reject
removing a ledger entry while its usage remains.

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
Concurrent spend is serialized by exact policy locks and serializable isolation.
The migration fails closed if it encounters pre-existing recognized usage;
such data requires an explicit reviewed policy-and-ledger remediation rather
than an invented historical budget assignment.
