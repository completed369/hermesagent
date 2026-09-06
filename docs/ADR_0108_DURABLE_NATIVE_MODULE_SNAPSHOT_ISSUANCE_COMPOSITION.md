# ADR-0108: Durable native-module snapshot issuance composition

Date: 2026-09-06

## Context

The repository already had separately reviewed boundaries for Level-3 snapshot approval, keyless
signing, public-root storage, independent signature authentication, and audited snapshot storage.
They were not joined by a production-shaped owner. A caller could exercise each primitive in tests,
but no single bounded path proved that an approved snapshot was signed by a currently registered
public root before the snapshot and its exact approval evidence reached durable storage.

## Decision

Add an uncomposed, one-attempt PostgreSQL issuance composition that:

1. validates and freezes the complete issuance request before selecting authority;
2. rejects cross-workspace context and aborted or reused attempts before selecting authority;
3. derives the exact issuance-authority request and admits only the existing one-use Level-3
   control-plane authority, excluding runtime and Level-4 principals, before reading trust state;
4. reads at most eight current public roots for the exact workspace and supervisor scope;
5. requires exactly one current root for the requested signer identifier;
6. delegates the canonical snapshot to an injected signer;
7. independently authenticates the returned signature against the durable public roots; and
8. atomically appends the authenticated snapshot with its unforgeable controller-minted approval
   evidence through the existing audited PostgreSQL store; and
9. requires the database to re-check and transaction-lock the latest scoped signer root at its own
   clock, preventing root expiry, rotation, or revocation from racing the append.

All dependency failures are mapped to one non-sensitive composition denial. The exported request
validator reuses the controller's exact inert-record validation rather than maintaining a second
parser.

## Security and runtime-truth boundary

- The composition accepts a signer port; it does not implement custody, resolve a secret, provision
  a key/root, create a socket, start a service, or load a native module.
- It is absent from the Nest module, routes, workers, and deployment configuration. Construction is
  therefore an explicit future trust decision, not ambient runtime authority.
- The public root is read before signing, the independent publisher verifies the signature again,
  and PostgreSQL serializes publication against root rotation/revocation before durable append. A
  signer cannot cause an unregistered, stale-root, or invalid signature to be stored.
- It preserves `runtimeConnection: NOT_CONFIGURED` throughout and supplies no runtime-status
  promotion.
- No deployment, publication, spend, DNS change, commercial commitment, or Level-4 action is
  introduced. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The durable root-to-signer-to-audited-publication chain now has a single fail-closed owner and an
adversarial proof. A reviewed custody implementation, actual key/root provisioning, explicit signer
service composition, publication-to-loader composition, and a complete authenticated runtime round
trip remain required before connectivity can be claimed.
