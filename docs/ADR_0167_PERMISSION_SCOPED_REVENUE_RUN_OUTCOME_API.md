# ADR-0167: Permission-scoped revenue-run outcome API

Date: 2026-09-08

## Context

ADR-0166 added an internal, capability-gated and drift-detecting revenue-run outcome projection.
There was no authenticated API route, so authorized finance readers could not consume that exact
truth-preserving view through the application boundary.

The internal projection contains bigint minor-unit and compute values. Returning those values
directly from Nest would not be JSON-safe, while converting them to JavaScript numbers could lose
precision.

## Decision

Add `GET /api/finance/revenue-runs/:revenueRunId/outcome` behind the existing controller-level
session and permission guards plus the exact `finance:view` permission.

The controller takes the workspace exclusively from the authenticated session. The service calls
the finance engine's existing reader, which performs a fresh `FINANCE_ACCESS` capability decision,
workspace-scoped lookup, evidence re-hashing, and fail-closed drift detection. The API returns an
explicitly shaped response and serializes every bigint minor-unit and compute value as an exact
base-10 string.

Boundary failures map to bounded HTTP categories: invalid identifiers are bad requests, missing
workspace-scoped runs are not found, and evidence drift is a conflict. No source record, hash, or
truth label is rewritten.

## Authority and commercial-truth boundary

- The route is read-only and grants no planning, linking, runtime, publication, spend, payment,
  customer-contact, or commercial authority.
- Recorded revenue remains `UNVERIFIED_SOURCE_RECORDS`.
- Business expenses and recognized runtime charges remain separate with
  `POTENTIAL_EXPENSE_RUNTIME_OVERLAP`.
- Profit remains `NOT_CALCULATED_POTENTIAL_COST_OVERLAP`.
- No provider is activated, no deployment is performed, and no secret is handled.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

Authorized finance readers can consume the evidence view without precision loss or a tenant-scope
input. Explicit cost-deduplication evidence, verified payment/delivery evidence, a repeatable
revenue loop, and commercial activation remain unfinished and Founder-gated where applicable.
