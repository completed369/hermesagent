# ADR-0065: Exclusive Codex process-session recovery leases

Date: 2026-09-01

## Context

ADR-0063 added bounded discovery of unfinished process-session claims, and ADR-0064 closed durable
claim replay drift. A recovery composition still could not serialize responsibility for an expired
claim. Two workers could independently observe the same inventory row, or a late owner completion
could race future recovery work.

## Decision

Add an internal Level-3 operation that claims one immutable, 15-second recovery lease for an expired
process-session claim owned by the exact authenticated workspace principal and actor kind. Leases are
append-only generations with globally scoped safe identifiers and idempotency keys. The database
locks the claim row, requires no cleanup completion, rejects an active prior lease, calculates the
next exact generation, fixes the lease timestamp to its millisecond transaction clock, and rejects
completion insertion while a recovery lease remains active.

The service independently serializes the claim, rechecks exact owner and runtime truth, rejects active
or completed claims, provides exact idempotent replay, and records a zero-payload operational event in
the same serializable transaction.

## Security and truth boundary

- A recovery lease grants only short-lived exclusive metadata authority. It cannot open streams,
  launch, signal, terminate, retry, dispatch, call a provider, resolve a secret, or complete cleanup.
- Natural expiry is the only release. A later attempt uses a new monotonic generation; lease rows are
  immutable and cannot be extended in place.
- An active lease temporarily rejects the legacy completion path so late owner evidence cannot race a
  future recovery owner. This change does not add a recovery completion operation.
- No payload, transcript, prompt, credential, provider response, recognized usage, or cost is stored.
- Runtime truth remains `NOT_CONFIGURED`; Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The recovery inventory now has a durable, exclusive handoff primitive suitable for a later injected
OS-specific recovery owner. Positive OS ownership proof, process cleanup action, recovery-bound
completion, a real authenticated runtime round trip, and runtime truth promotion remain separate work.
