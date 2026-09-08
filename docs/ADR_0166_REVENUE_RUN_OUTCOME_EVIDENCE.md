# ADR-0166: Revenue-run outcome evidence

Date: 2026-09-08

## Context

ADR-0165 added an immutable planning forecast and schema-level links to canonical revenue, expense,
and ACP usage facts. It deliberately did not add writers or interpret those records as verified
revenue or profit.

The next safe dependency is to make correlation usable without weakening source truth. In
particular, a runtime usage record is not enough by itself to call a cost charged, manual or mock
revenue is not verified payment evidence, and business expenses can overlap runtime costs.

## Decision

Add capability-gated append-only link writers for `RevenueEntry`, `Expense`, and `AcpRunUsage`.
Each writer serializes on the source fact, verifies exact workspace/run/venture/currency scope,
hashes the canonical source fields, and accepts replay only when the run, actor, and evidence hash
are identical.

ACP usage is linkable only when its immutable `AcpCostLedgerEntry` exists and matches the usage ID,
run, currency, compute, and cost. Its evidence hash binds both the usage and recognized ledger
checksum.

Add a read-only outcome projection that re-hashes every linked source and fails closed on drift. It
surfaces:

- immutable forecast values;
- recorded gross/net revenue with `UNVERIFIED_SOURCE_RECORDS` truth;
- recorded business expenses;
- separately recognized ACP runtime charges and compute; and
- an explicit `NOT_CALCULATED_POTENTIAL_COST_OVERLAP` profit state.

Complete database append-only enforcement by rejecting direct deletes while the parent revenue run
still exists. Workspace cascade erasure remains possible after the parent is removed.

## Authority and commercial-truth boundary

- Writers require a fresh `FINANCE_ACCESS` capability decision before reading a fact.
- No writer creates revenue, expense, usage, ledger, approval, task, run, delivery, or payment
  evidence; it can only link an existing exact fact.
- The read model does not call manual/mock records verified, combine possibly overlapping costs, or
  calculate profit.
- No API route or worker composition is added. There is no customer contact, provider activation,
  publication, spend, payment, deployment, DNS change, secret handling, or Level-4 action.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

VentureOS can now form an internally usable, tamper-evident opportunity-to-recorded-outcome view
without fabricating commercial success. A later slice may add a permission-scoped API projection
and explicit cost-deduplication evidence. Verified revenue, profit, and repeatability remain absent
until external payment/delivery evidence crosses the required Founder gates.
