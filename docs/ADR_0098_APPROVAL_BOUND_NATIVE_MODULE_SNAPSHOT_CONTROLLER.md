# ADR-0098: Approval-bound native-module snapshot controller

Date: 2026-09-06

## Context

ADR-0096 produces exact owner-only Linux module and socket-directory identities, while ADR-0097
admits and durably publishes only cryptographically valid, sequential authorization snapshots. The
system still lacked a bounded boundary that could turn those path attestations into the exact
request-bound grants in a snapshot without embedding private-key custody or bypassing approval.
The mismatch was also latent that the provisioner emits owner-only `0500` modules while the loader
validator required every read bit (`0444`), so a safely provisioned module could never be admitted.

## Decision

Add an exported but uncomposed one-shot controller that:

1. exact-parses a tenant/workspace- and supervisor-bound issuance request containing zero, one, or
   canonically ordered CLIENT/LISTENER owner-only path attestations;
2. requires one exact hash-bound, five-minute Level-3 approval grant with an approval identifier,
   evidence digest, and safe authorizer reference;
3. constructs module-load request hashes and immutable authorization grants only from the admitted
   `0500` module and `0700` socket-directory identities;
4. delegates canonical-payload signing through an injected signer port, validates the returned
   signer, payload hash, and Ed25519 signature encoding, then submits the snapshot to the independent
   ADR-0097 authenticator/publisher; and
5. preserves empty snapshots as an explicit revocation operation, cancellation checks before every
   consequential boundary, and `NOT_CONFIGURED` runtime truth in both requests and receipts.

Align the loader's mode check with the provisioner: a module must be owner-readable and entirely
non-writable. Group or other readability is not required.

## Security and runtime-truth boundary

- Authority, signer, and publisher dependencies all deny by default.
- The controller does not generate, import, retain, resolve, or expose a private key. A future
  production signer and key-custody design require separate review.
- The publisher independently authenticates the signature and root before storage; a signer response
  is not treated as proof merely because it came from the signer port.
- Shared CLIENT/LISTENER socket identity, bounded windows, exact request hashes, and tenant/supervisor
  identity are checked before signing. Level 4 is rejected.
- No route, worker, scheduler, service loop, or composition root constructs this controller. No module
  is loaded, socket or process is started, provider activated, deployment or publication performed,
  money spent, DNS changed, or commercial/legal commitment made.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The reviewed primitives now form a testable path from owner-only filesystem attestations through
approval-bound canonical signing to authenticated durable publication, including explicit
revocation. Production root and signing-key provisioning, key custody, approval-source composition,
service ownership, native loading, authenticated runtime wiring, and a verified round trip remain
unfinished and must not be inferred from this contract.
