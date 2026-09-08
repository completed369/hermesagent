# ADR-0170: Unverified revenue commercial evidence

Date: 2026-09-08

## Context

ADR-0169 made the immutable revenue-run evidence graph available through the authenticated
application boundary. Linked `RevenueEntry` rows are still manual or mock records. A numeric sale
row, or even a caller's statement that payment and delivery happened, cannot establish verified
commercial truth.

VentureOS nevertheless needs to retain the external artifacts that may later be authenticated by a
reviewed marketplace, payment, bank, or fulfilment verifier. Retaining raw order, transaction, or
customer references would unnecessarily put personal or secret-bearing data into the evidence and
audit planes.

## Decision

Add immutable `RevenueRunCommercialEvidence` assertions attached by composite foreign key to one
exact workspace, revenue run, and linked revenue entry. Each assertion records:

- one bounded kind: payment settlement, delivery confirmation, or refund observation;
- one bounded source class;
- separate lowercase SHA-256 hashes for the external reference and retained artifact;
- the observation time, authenticated actor, idempotency key, and canonical evidence hash; and
- the only permitted truth state: `UNVERIFIED_EXTERNAL_ASSERTION`.

Database constraints independently enforce kinds, source classes, hashes, non-future observation
time relative to persistence, bounded identifiers, composite link scope, uniqueness, and append-only
updates/deletes. The writer performs fresh `FINANCE_ACCESS` admission before reading the exact link,
rejects future timestamps, accepts only exact idempotent replay, and never accepts a verification
state from its caller.

Add a `finance:manage` API route that derives workspace and actor exclusively from the session and
accepts no raw external reference. The outcome projection re-hashes every assertion, fails closed on
drift or cross-link evidence, and reports deterministic counts plus an evidence-set hash. Its revenue
truth remains `UNVERIFIED_SOURCE_RECORDS`, even when both payment and delivery assertions exist.

## Authority and commercial-truth boundary

- This change records hashes and assertions; it does not fetch, parse, authenticate, or trust an
  external artifact.
- A marketplace export, payment statement, bank settlement, fulfilment record, or founder
  observation cannot self-promote revenue to verified truth through this path.
- No provider credential, customer identifier, raw transaction reference, payment action, delivery,
  refund, publication, contact, spend, deployment, DNS, or Level-4 authority is introduced.
- A future verified state requires a separately reviewed verifier and trust-root path whose evidence
  is bound to the exact immutable assertion and source fact.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

VentureOS can retain privacy-minimized, tamper-evident payment/delivery/refund assertions without
misstating commercial success. Authenticated external verification, realized verified revenue and
profit, and repeatability remain absent until the relevant Founder-gated provider and pilot evidence
exist.
