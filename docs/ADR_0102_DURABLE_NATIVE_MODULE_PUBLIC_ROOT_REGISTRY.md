# ADR-0102: Durable native-module public-root registry

Date: 2026-09-06

## Context

ADR-0101 leaves the keyless signer response subject to independent Ed25519 verification, but the
module-snapshot authenticator could only receive caller-supplied public roots. A production caller
therefore had no durable tenant/supervisor binding, immutable history, rollback protection, or
authorization evidence for those verification roots.

## Decision

Add an exported but uncomposed PostgreSQL public-root registry that:

1. accepts only the existing exact, inert Ed25519 public-root record and `NOT_CONFIGURED` runtime
   truth;
2. requires an unforgeable `CONTROL_PLANE` capability bound to the exact workspace and principal,
   a non-runtime actor, and exactly Level 3 (Level 4 is rejected);
3. atomically appends each root version with a domain-separated request hash and one-minute Level-3
   authorization evidence;
4. globally serializes each supervisor identity, binds it permanently to one workspace, permits only
   version 1 or the adjacent version, and keeps signer/key identity and validity immutable;
5. permits only monotonic minimum-snapshot-version increases and irreversible revocation;
6. returns only the latest non-expired version of at most eight roots for an exact
   workspace/supervisor scope; and
7. denies unaudited inserts at transaction commit and denies every update or delete of root and
   evidence rows.

Identical requests are idempotent: a replay succeeds only when the complete public-root record and
its immutable original Level-3 evidence binding already exist. Conflicting content fails closed.

## Security and runtime-truth boundary

- Only public SPKI bytes and their SHA-256 fingerprint are persisted. The shared agent-bridge
  validator proves canonical base64, fingerprint integrity, Ed25519 key type, exact shape, bounded
  validity, and `testOnly: false` before SQL.
- The registry has no private-key import, generation, signing, secret resolution, filesystem,
  process, network, provider, transport, deployment, or publication capability.
- Database constraints independently enforce fixed purpose/algorithm, bounds, safe references,
  fresh Level-3 evidence, immutable history, tenant ownership, sequential versions, signer identity
  uniqueness, and the eight-active-root ceiling.
- No API route, worker, scheduler, or composition root constructs the registry. No root has been
  provisioned by this change and no runtime status is promoted.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The repository now has a durable reviewed source for public snapshot-verification roots without
collapsing signing custody into the API. A separately reviewed service owner must compose this
registry with the snapshot authenticator and keyless transport before module authorization can be
used. A real authenticated registration-through-result round trip remains required before runtime
connection truth can change.
