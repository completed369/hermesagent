# ADR-0051: Authenticated executable-authority trust snapshots

## Status

Accepted as an unconfigured production-capable trust-source primitive.

## Context

ADR-0050 validates explicitly supplied executable-authority trust records, but supplying those
records is itself a trust decision. An unversioned file, environment value, database row, or caller
array could be stale, substituted, or rolled back while still containing individually valid keys.
Supervisor authorization cannot become production-capable until the signer registry has an
authenticated origin, a short freshness window, and rollback protection that survives process
restarts.

## Decision

Add `BoundedLinuxExecutableAuthorityTrustSource`. It accepts only three explicit dependencies:

- one snapshot reader with no built-in filesystem, environment, network, or database backend;
- one trusted durable checkpoint store with signer-scoped atomic compare-and-swap semantics; and
- one to eight explicit Ed25519 root records supplied by the composition root.

Each root is fingerprinted, purpose-bound to
`LINUX_EXECUTABLE_AUTHORITY_TRUST_SNAPSHOT`, limited to five years, explicitly production-only,
and carries a positive minimum snapshot version. Each signed snapshot has an exact plain-data
shape, one to 32 ADR-0050 trust records, a maximum 15-minute interval, and an Ed25519 signature over
its canonical payload.

Before exposing a verifier, the source verifies root validity and revocation, the root version
floor, snapshot freshness and containment within root validity, the canonical signature, and every
embedded trust record. It then advances a durable checkpoint. A later snapshot must increment by
exactly one and name the prior snapshot hash. Replays are accepted only when ID, version, and hash
are identical; rollback, skipped versions, broken links, and same-version equivocation deny. A
compare-and-swap race is accepted only when the winner installed the identical checkpoint.
An empty checkpoint may bootstrap only a snapshot with a null predecessor; later snapshots must
follow the stored chain.

The returned evidence is frozen and contains only safe snapshot/root references, dates, counts,
and a snapshot-expiry-bound authorization verifier that rechecks time before and after signature
verification. Root private keys and executable-authority private keys are never accepted or
retained.

## Runtime truth and production wiring

Construction remains a privileged trust decision: the reader, durable checkpoint store, root
registry, and clock must be supplied explicitly. The repository provides no positive reader or
checkpoint implementation. The API provides only the exported deny source under the trust-source
token and never imports the bounded implementation.

This change reads no ambient configuration, launches no process, opens no stream, resolves no
credential, contacts no provider, mutates no ACP runtime status, deploys nothing, and publishes
nothing. Test keys are generated ephemerally inside the test file. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`.

## Limits and next safe slice

The supervisor still holds one verifier for the lifetime of its composition. A separately reviewed
composition change must read a fresh authenticated snapshot for each authorization decision and
again immediately before native handoff, require the same or a hash-linked newer checkpoint, and
deny when the source is unavailable. A real durable checkpoint backend, reviewed root provisioning,
live revocation publication, scoped secret source, and production process/stream owner remain
unconfigured operational boundaries.
