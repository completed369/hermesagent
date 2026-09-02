# ADR-0082: Fresh retained-native trust around the recovery exchange

Date: 2026-09-02

## Context

ADR-0080 authenticates fresh, revocable supervisor trust and ADR-0081 persists its monotonic
checkpoint. The existing recovery evidence source accepts one response verifier at construction
time. Composing a verifier read only before an exchange would leave a time-of-check/time-of-use gap:
the supervisor key could be rotated, revoked, expired, or replaced while the bounded exchange was
in flight.

## Decision

Add an uncomposed evidence-source composition that wraps exactly one existing two-second recovery
exchange:

1. the authenticated trust source is read after the request and abort boundary exist and immediately
   before transport I/O;
2. after a successful transport response, the trust source is read again before the response crosses
   back to the evidence source;
3. the pre- and post-exchange snapshots must match in every authenticated identity, version, hash,
   signer, root record, supervisor key, trust record, issuance, and validity field; and
4. only the response verifier returned by the post-exchange read may authenticate the response.

Both trust reads and the transport remain inside the existing request timeout. Initial trust failure
prevents transport invocation. Post-exchange failure or any snapshot drift discards the response.
Snapshot expiry after the second read is still rejected by the snapshot-bound verifier at the final
observation time.

## Security and runtime-truth boundary

- Explicit deny-only trust or transport dependencies are rejected at construction.
- The composition installs no root, publisher, private key, database adapter, IPC endpoint, process
  authority, worker, scheduler, provider, credential, or ambient configuration.
- No trust change is treated as harmless during an in-flight exchange, including a valid linked
  rotation that retains the same supervisor key.
- The result remains recovery exit evidence with `runtimeConnection: NOT_CONFIGURED`; it does not
  register, connect, promote, dispatch to, deploy, or spend through a real runtime.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The durable trust source can now be composed without a trust-check gap around one bounded recovery
exchange. Production composition still requires authenticated Linux local IPC, explicit root and
snapshot provisioning, private-key custody, and reviewed worker wiring. The next safe slice is the
authenticated local IPC contract between the recovery worker side and retained-native supervisor,
without enabling production process authority or runtime-status promotion.
