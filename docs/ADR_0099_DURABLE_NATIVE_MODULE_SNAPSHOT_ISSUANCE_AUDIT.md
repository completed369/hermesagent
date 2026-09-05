# ADR-0099: Durable native-module snapshot issuance audit

Date: 2026-09-06

## Context

ADR-0098 binds native-module authorization snapshot construction to a short-lived Level-3 approval,
but ADR-0097 persisted only the independently authenticated signed snapshot. The approval identifier,
authority-request binding, authorizer reference, and evidence digest could therefore be lost after
publication. Persisting those fields in a separate best-effort write would also permit a snapshot to
exist without its approval audit record.

## Decision

Add an uncomposed audited publication boundary and PostgreSQL adapter that:

1. has the one-shot controller mint an in-process, unforgeable issuance proof containing the exact
   workspace, supervisor, snapshot, request, approval, and authorization-window bindings;
2. independently authenticates the signed snapshot and requires every snapshot binding and the
   five-minute Level-3 authorization window to match that proof before storage;
3. atomically inserts the immutable signed snapshot and its issuance evidence in one SQL statement,
   so an evidence conflict rolls the entire append back;
4. admits replay only after a fresh read proves every snapshot and issuance-evidence field is
   identical; and
5. constrains the audit row to the signed snapshot through a composite foreign key, fixes each
   supervisor chain to one workspace, rejects stale authorization evidence at the database clock,
   and denies updates and deletes by trigger.

The evidence stores only safe references and SHA-256 digests. It excludes credentials, secrets,
tokens, prompts, transcripts, and private reasoning.

## Security and runtime-truth boundary

- The default audited store denies publication, and only controller-minted plus independently
  authenticated proofs can reach the PostgreSQL adapter.
- Database constraints do not replace signature or approval authentication; they preserve the exact
  result admitted at the application boundary and add freshness, referential, and immutability
  defenses.
- The new adapter is not registered in an API module, worker, route, scheduler, or service loop.
- No signer, private key, trust root, approval source, module loader, socket, process, provider,
  deployment, spend, DNS change, or commercial/legal commitment is activated.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

Approved snapshot issuance can now be made transactionally durable without creating an unaudited
publication gap. Production trust-root/key provisioning, signer custody, approval-source and service
composition, authenticated native runtime wiring, and a verified end-to-end round trip remain
unfinished and require separate review.
