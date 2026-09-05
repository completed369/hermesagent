# ADR-0094: Authenticated native-module authorization trust

Date: 2026-09-05

## Context

ADR-0093 requires one exact five-minute authorization before loading either retained-native module,
but deliberately defines only a trusted port and a deny implementation. An unsigned injected object
cannot establish who authorized executable native code, survive authority rotation, or make
revocation resistant to replay across service restarts.

## Decision

Add an exported but uncomposed module-authorization trust source that:

1. accepts one to eight explicit Ed25519 root records fingerprinted and purpose-bound to retained-
   native module-authorization snapshots, with validity, revocation, and minimum-version limits;
2. authenticates an exact, canonical, supervisor-instance-bound snapshot lasting at most five
   minutes and containing zero, one, or two canonically ordered ADR-0093 authorizations;
3. requires every enclosed authorization to remain inside the signed snapshot window and returns
   only the authorization whose request hash, module kind, module path, and socket path match the
   caller's exact request;
4. advances a supervisor-instance-scoped compare-and-swap checkpoint before exposing authority;
   bootstrap has no predecessor, successors advance by exactly one version and hash-link the prior
   snapshot, identical replay is idempotent, and same-version equivocation, rollback, gaps, broken
   links, and authorization-version rollback deny closed;
5. keeps root rotation inside the same checkpoint chain and binds the checkpoint to each active
   authorization ID, version, and canonical hash; and
6. treats a signed empty authorization list as explicit revocation: the durable checkpoint advances
   first and the request then receives `NOT_CONFIGURED`, so replaying an earlier grant remains denied.

## Security and runtime-truth boundary

- The source accepts no private key, credential, environment value, filesystem path discovery,
  network endpoint, database client, process authority, or provider configuration.
- The default source remains deny-only. No API, worker, scheduler, recovery worker, or native peer
  constructs the positive source.
- Root provisioning, snapshot publication, private-key custody, and a durable checkpoint/snapshot
  adapter remain explicit unconfigured composition-root responsibilities.
- This change does not create or select a module/socket path, package a native binary, load a module,
  start a service loop, contact a provider, deploy, publish, spend, or authorize a Level-4 action.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

ADR-0093 can now receive cryptographically authenticated, fresh, rotatable, replay-resistant grants
once separately reviewed durable state and key provisioning exist. The next safe slices are durable
checkpoint/snapshot adapters and an identity-preserving owner-only path provisioner. Neither native
module may be composed into a service until both boundaries are reviewed and complete authenticated
round-trip evidence exists.
