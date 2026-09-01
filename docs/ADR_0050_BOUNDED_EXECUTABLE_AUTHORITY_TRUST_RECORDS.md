# ADR-0050: Bounded executable authority trust records

## Status

Accepted as an unconfigured production-capable verification primitive.

## Context

ADR-0049 makes Linux executable authorization verification an explicit supervisor dependency and
keeps production wired to denial. The next prerequisite is a verifier that can authenticate a
`testOnly: false` authorization without embedding a production key, reading ambient configuration,
or treating a signer identifier as authority by itself.

The trust input must be bounded, immutable, exact-scope, independently fingerprinted, and capable
of expressing expiry and revocation. Supplying that input is itself a privileged composition-root
decision and remains outside this slice.

## Decision

Add `BoundedLinuxExecutableAuthorizationVerifier`. Its constructor accepts one to 32 explicit
trust records and rejects non-plain or property-extended records, duplicate record IDs, duplicate
signer IDs, and public-key aliases. Each exact record contains:

- one Ed25519 SPKI public key plus its SHA-256 fingerprint;
- one signer, adapter kind, argument policy, and authorized worktree root;
- a positive record version, a validity interval of at most 366 days, and optional revocation time;
- an explicit `testOnly: false` scope.

Verification reparses the complete authorization, requires a positive authorization version, binds
the exact signer and all record scopes, bounds authorization lifetime to five minutes, requires the
authorization interval to fit within the trust interval, enforces immediate and scheduled
revocation, and verifies the canonical payload signature with the record's Ed25519 key. Returned
authorization evidence is frozen.

## Runtime truth and production wiring

The API composition root does not construct or inject this verifier. It continues to inject
`DenyLinuxExecutableAuthorizationVerifier` into both supervisor and evidence-reader paths. The new
class has no filesystem, environment, network, database, key-discovery, signer, authorization-source,
launcher, process, stream, provider, credential, deployment, publication, or status-mutation
authority.

A test-generated key proves only the cryptographic and scope contract. It is not a production key,
credential, configured runtime, or real-process round trip. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`.

## Limits and next safe slice

Trust records are an injected immutable snapshot. This implementation does not authenticate the
snapshot's origin, refresh it, distribute keys, or observe a revocation published after verifier
construction. A separately reviewed trust-record source must provide authenticated, versioned,
fresh evidence and keep the production composition deny-only when no record is available. The live
authorization decision and launch boundary must then recheck that fresh trust evidence immediately
before any supervised process/stream handoff.
