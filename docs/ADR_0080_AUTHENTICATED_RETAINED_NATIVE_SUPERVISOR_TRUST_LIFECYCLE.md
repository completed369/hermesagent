# ADR-0080: Authenticated retained-native supervisor trust lifecycle

Date: 2026-09-02

## Context

ADR-0077 verifies a response with one explicitly injected supervisor key. ADR-0078 and ADR-0079
prove the controller and retained-pidfd authority boundary, but a constructor-held key cannot prove
fresh trust, rotation, revocation, or rollback resistance across service restarts. Local IPC must not
be positively composed until the caller can authenticate which supervisor identity is currently
trusted.

## Decision

Add an unconfigured production-capable retained-native supervisor trust source patterned after the
existing executable-authority trust lifecycle:

- one to eight explicit Ed25519 root records are fingerprinted, purpose-bound to
  `RETAINED_NATIVE_SUPERVISOR_TRUST_SNAPSHOT`, version-floored, validity-bounded, and revocable;
- a signed snapshot is bound to one expected supervisor instance, lives for at most 15 minutes, and
  contains exactly one active recovery-observation trust record or an explicit null revocation;
- the source verifies the exact snapshot shape, root scope and freshness, canonical signature, and
  active trust record before exposing a snapshot-expiry-bound response verifier;
- a trusted checkpoint port requires durable supervisor-instance-scoped compare-and-swap semantics.
  The root signer is carried inside that single chain so root rotation cannot create a parallel
  rollback chain. Bootstrap
  requires a null predecessor; later snapshots advance by exactly one version and hash-link the
  previous snapshot;
- identical replay is accepted without rewriting state, while rollback, skipped versions, broken
  links, same-version equivocation, malformed durable state, and conflicting CAS races deny; and
- the checkpoint also binds the active supervisor key ID and fingerprint plus trust-record ID and
  version. An immediately linked signed update cannot silently substitute key material under the
  same key ID or roll an existing trust-record version backward.

A signed snapshot with a null active record first advances the durable checkpoint and then returns
`NOT_CONFIGURED`. This makes revocation monotonic: replaying the earlier active key remains denied.

## Security and runtime-truth boundary

- The source accepts no private key, credential, filesystem path, environment value, network
  endpoint, database client, provider, or ambient configuration.
- Root provisioning, snapshot publication, private signing-key custody, and durable checkpoint
  storage are explicit composition-root responsibilities and remain unconfigured.
- The API, worker, scheduler, recovery worker, and native peer do not construct the positive source.
- The source performs no process action, IPC, provider access, deployment, publication, spend,
  runtime-state mutation, or connection promotion.
- A verified supervisor key authorizes only validation of the bounded ADR-0077 recovery response.
  Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

Retained-native recovery now has a fresh cryptographic trust and key-rotation contract rather than a
long-lived injected public key. The next safe slices are durable PostgreSQL checkpoint/snapshot
adapters with append-only audit evidence, then a composition that reads trust immediately before and
after the bounded exchange. Authenticated Linux local IPC remains necessary before production worker
composition or any real runtime round-trip claim.
