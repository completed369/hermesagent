# ADR-0169: Permission-scoped revenue-run mutation API

Date: 2026-09-08

## Context

ADRs 0165, 0166, and 0168 added an immutable planning spine, append-only outcome links, and exact-set
cost reconciliation inside the finance engine. ADR-0167 exposed only the read projection. A bounded
authenticated operator therefore could not create the planning identity or correlate existing facts
through the application boundary, and exposing reconciliation alone would leave its prerequisites
unreachable.

## Decision

Add `finance:manage` routes for:

- creating an immutable `PLANNED` revenue run;
- linking one existing revenue, expense, or recognized runtime-usage fact; and
- recording exact-set cost reconciliation.

Every route remains behind the controller-level session and permission guards. Workspace and actor
identity come exclusively from the authenticated session. Route and body identifiers must be UUIDs.
All BIGINT amounts use canonical non-negative base-10 strings bounded to signed BIGINT; numeric JSON,
signs, fractions, padding, leading zeroes, and out-of-range values fail before the engine is called.
Forecast hashes, currency, confidence, time-to-cash, basis references, and idempotency keys remain
strictly bounded.

The service delegates to existing finance-engine writers, which perform fresh `FINANCE_ACCESS`
decisions and enforce tenant/semantic scope, current approval evidence where supplied, exact replay,
source locking, source re-hashing, recognized usage-ledger evidence, exact-set reconciliation, and
immutable persistence. Responses are explicitly shaped, serialize BIGINT values without precision
loss, and create attributed audit events.

## Authority and commercial-truth boundary

- Revenue runs remain permanently `PLANNED`; there is no transition or dispatch writer.
- Link routes cannot create or alter an expense, usage, ledger, revenue, payment, delivery, task,
  run, approval, or source fact.
- Reconciliation remains an operator assertion bounded by authoritative cost facts. It does not
  verify revenue, payment, delivery, profitability, repeatability, or customer value.
- A later cost link invalidates an earlier exact-set reconciliation until new reviewed evidence is
  recorded.
- No provider activation, publication, customer contact, spend, deployment, DNS, secret handling,
  or Level-4 action is introduced.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

An authorized bounded operator can now form and maintain the planning-to-recorded-outcome evidence
graph through the normal application boundary without caller-selected tenant/actor identity or
precision loss. Verified payment and delivery evidence, a real pilot, and repeatable risk-adjusted
revenue remain unfinished and retain their existing Founder gates.
