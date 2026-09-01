# ADR-0058: Authenticated Codex usage-observation evidence

Status: Accepted as evidence-only infrastructure

## Context

The bounded Codex validation protocol already admits a small allowlist of progress notifications,
including `thread/tokenUsage/updated`, but discarded every admitted notification after validation.
Completion and cancellation evidence therefore could not prove whether a bounded validation stream
reported token activity. The app-server protocol does not provide a repository-reviewed, stable
mapping from that notification to billable cost or a VentureOS compute unit, so interpreting its raw
values would create false accounting authority.

## Decision

For each admitted progress notification, the validation runner retains only a SHA-256 event digest.
It creates separate domain-separated aggregate digests for the ordered progress stream and the
ordered subset of `thread/tokenUsage/updated` events. The existing 128-event, 64-KiB-per-event,
depth, node, and array bounds apply before hashing. Raw notification content and numeric token values
are not retained.

Completed and interrupted terminal evidence binds the two aggregate digests, the two event counts,
and an accounting state. Zero token-usage notifications produce `NOT_OBSERVED`; one or more produce
`OBSERVED_UNMAPPED`. Both states require recognized cost and compute units to be exactly zero. The
authenticated result or cancellation envelope, normalized candidate hash, and immutable tenant-bound
database row all bind those facts.

Pre-existing terminal rows are preserved as `LEGACY_NOT_CAPTURED` with explicit zero counts and
sentinel digests. New writes cannot use that state. Completion and cancellation remain mutually
exclusive and immutable.

## Consequences and limits

VentureOS can now prove that an authenticated validation stream did or did not contain admitted token
usage notifications without storing provider data. This is observation evidence only: it creates no
`acp_run_usages` row, no cost-ledger entry, no budget charge, no task assignment, and no runtime or
provider truth. `OBSERVED_UNMAPPED` must never be presented as measured spend, billable tokens, or
recognized compute.

No production process or stream owner is added. No provider is contacted, no paid capability is
activated, and Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Next boundary

A future provider-specific accounting mapper requires a separately reviewed, versioned protocol
contract and authenticated real-runtime evidence. It must define monotonicity, retries, currency,
pricing version, rounding, and reconciliation before any observation can become recognized usage or
cost.
