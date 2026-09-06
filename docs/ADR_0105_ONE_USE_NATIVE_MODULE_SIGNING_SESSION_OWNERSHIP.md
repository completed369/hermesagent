# ADR-0105: One-use native-module signing session ownership

Date: 2026-09-06

## Context

ADR-0104 adds the authenticated supervisor-side signing protocol handler, but the existing Linux
accepted-session owner admitted only the recovery handler. Passing a signing handler directly to a
native session without lifecycle integration could also leave its custody session open when socket
attestation or request reading failed before protocol handling.

The accepted-session owner additionally prevented concurrent use but did not itself prevent a
second sequential accept. Its current listener-lifecycle caller is one-use, but the exported class
must enforce that invariant independently.

## Decision

Extend the existing bounded Linux accepted-session owner to admit exactly either the authenticated
recovery handler or the authenticated native-module signing handler. For either protocol it still:

1. authenticates the socket identity before and after accept and again before response release;
2. derives the peer principal from `SO_PEERCRED` and reads one EOF-delimited request of at most
   32 KiB;
3. writes one bounded response and shuts down the write side; and
4. clears all request/response copies and closes the accepted socket on every path.

For the signing protocol, the session owner also closes the handler on every exit, including
failures before handler invocation. The signing handler now exposes an idempotent bounded close,
shares one close promise, and aborts an active custody operation. It still closes custody before
returning any successful response.

The accepted-session owner now uses a `READY → IN_FLIGHT → ATTEMPTED` state machine. Every call,
including malformed path or cancelled input, consumes the instance; concurrent calls receive a
distinct denial and sequential replay cannot accept a second connection.

## Security and runtime-truth boundary

- Only the two concrete authenticated handler classes are admitted; arbitrary callback handlers are
  rejected.
- No listener is created, bound, discovered, or unlinked here. No retry or service loop is added.
- No key, custody implementation, native module, socket, root provisioning, route, worker,
  composition root, deployment, spend, DNS, legal commitment, or Level-4 action is introduced.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

An already-authorized native listener can now hand one accepted connection to the signing handler
without leaking custody across pre-protocol failures. Production listener creation still targets
the recovery handler only; a signing-specific listener lifecycle, custody factory, reviewed native
service, actual key/root provisioning, and authenticated end-to-end publication/load proof remain
required before any runtime connection claim.
