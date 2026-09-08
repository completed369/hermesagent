# ADR-0165: Planning-only revenue-run correlation spine

Date: 2026-09-08

## Context

VentureOS already stores opportunities, proposals, approvals, experiments, ACP tasks/runs, runtime
usage, expenses, and revenue entries. It did not have one durable identity that could correlate those
facts into a prospective opportunity-to-outcome loop. Copying actual amounts into a new aggregate
would create conflicting accounting truth.

The remaining production runtime activation inputs are Founder-gated. A planning-only correlation
spine is independent safe work and advances the revenue-readiness dependency without selecting a
provider, customer, publication target, deployment, or paid action.

## Decision

Add an immutable `RevenueRun` forecast record with explicit expected revenue, expected cost,
downside, confidence, time-to-cash, currency, evidence hash, actor, and idempotency key.
It can reference one exact opportunity and proposal, plus optional current approving evidence,
experiment, ACP task, and matching ACP run.

Add three append-only correlation tables for existing `RevenueEntry`, `Expense`, and `AcpRunUsage`
facts. They store only the link, evidence hash, actor, and timestamp. Revenue, expense, compute, and
cost amounts remain exclusively authoritative in their existing tables.

The finance-engine writer:

- requires a fresh `FINANCE_ACCESS` capability decision before any database read;
- validates bounded integer minor-unit forecasts and exact evidence metadata;
- checks every supplied reference in the workspace and its semantic parent scope;
- accepts optional approval linkage only while an approving decision is current and unrevoked; and
- returns an existing row only for an exact idempotent replay.

Database constraints and triggers independently enforce those tenant and semantic bindings.

## Authority and runtime-truth boundary

- The initial schema permits only `PLANNED`; no transition writer exists.
- Forecast rows and outcome links reject updates. New forecast evidence requires a new planning
  record rather than rewriting history.
- Approval linkage is correlation evidence only. It is not an ACP permit, dispatch grant,
  publication approval, spending authorization, or commercial authority.
- No API route, worker import, scheduler, provider, deployment, publication, customer contact,
  payment action, DNS change, secret, or Level-4 action is added.
- Realized amounts are not inferred. Until authoritative fact links exist, actual outcome remains
  absent rather than zero or successful.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

VentureOS now has a durable, tenant-safe identity for a planned revenue loop without duplicating
existing operational or financial truth. Follow-on work can add capability-gated append-only link
writers and a derived forecast-versus-actual view. Activation, delivery, customer contact, and the
first real financial outcome remain separately gated and unclaimed.
