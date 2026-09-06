# ADR-0107: Identity-bound native-module signing listener lifecycle

Date: 2026-09-06

## Context

ADR-0104 and ADR-0105 authenticate and own one accepted native-module signing session, but no
production-shaped boundary created the signing listener or obtained its one-use custody session.
Callers could otherwise acquire custody before proving which owner-only Unix socket would carry the
exchange, or accidentally separate listener cleanup from custody cleanup.

## Decision

Extend the existing one-use Linux listener lifecycle with a signing-specific entry point that:

1. validates the public signer identifier, synchronous custody factory, timeout, and exact
   `NOT_CONFIGURED` listener authorization before creating anything;
2. creates the Unix listener without replacement and authenticates its parent and socket device,
   inode, owner, group, and owner-only modes before requesting custody;
3. gives the factory one frozen, purpose-bound request containing only that attested public socket
   identity, expected worker principal, and signer identifier—never a snapshot payload or secret;
4. admits neither the deny factory nor deny custody session and closes a rejected closable custody
   candidate within the same 100–5,000 ms bound;
5. passes the resulting session only to the authenticated signing handler and accepted-session
   owner, which authenticate `SO_PEERCRED`, bound the protocol, and close custody before response;
6. closes and exact-identity-unlinks the owned listener on every path; and
7. consumes the lifecycle across both recovery and signing entry points, so it cannot retry,
   multiplex, or switch protocols after an attempt.

Custody creation is deliberately synchronous: ownership either transfers to the lifecycle during
the call or it does not. A factory cannot leave an unresolved asynchronous acquisition that later
produces an unowned key handle after cancellation.

## Security and runtime-truth boundary

- This adds a custody **factory port**, not a custody implementation, key, secret resolver, HSM,
  process, service loop, provider, or environment lookup.
- Listener identity is kernel-derived by the separately reviewed native binding. The factory cannot
  choose or discover a path, and custody cannot sign until the accepted-session owner authenticates
  the endpoint and peer and the handler validates the canonical request.
- The lifecycle remains absent from API and worker composition roots. It provisions no public root,
  publishes no snapshot, loads no module, and changes no runtime status.
- No deployment, publication, spend, DNS change, commercial commitment, or Level-4 action is
  introduced. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The signing path now has one ownership chain from no-replacement listener creation through
identity-bound custody creation, authenticated single exchange, custody closure, and exact listener
cleanup. A reviewed custody implementation and key/root provisioning, explicit service composition,
and authenticated publication-to-module-load proof remain required before runtime connectivity can
be claimed.
