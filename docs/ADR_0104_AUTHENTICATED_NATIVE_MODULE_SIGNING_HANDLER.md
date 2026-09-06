# ADR-0104: Authenticated native-module signing handler

Date: 2026-09-06

## Context

ADR-0103 carries the bounded keyless snapshot-signing protocol over an authenticated local IPC
client, but the retained-supervisor side had no corresponding protocol handler. Adding a concrete
key or signer service at this stage would collapse protocol proof, custody, deployment, and runtime
truth into one unsafe step.

## Decision

Add an exported but uncomposed supervisor-side handler that:

1. authenticates one exact constructor-bound Linux listener identity and `SO_PEERCRED` principal;
2. accepts one canonical request of at most 32 KiB and requires the exact signing domain,
   `NOT_CONFIGURED` runtime truth, signer identity, snapshot payload hash, and whole-request hash;
3. passes only the canonical public snapshot payload bytes to an injected one-use custody session;
4. bounds signing and custody close to 100–5,000 ms, aborts on caller cancellation or timeout, and
   closes custody before a signature can escape;
5. accepts only an exact 64-byte Ed25519 signature and emits the canonical request-bound response
   of at most 1 KiB; and
6. consumes every attempt, denies replay and concurrency, and redacts unexpected custody failures.

The shared local-IPC authorization and inbound-attestation validators are exported and reused by
the existing recovery handler so this new protocol cannot drift to weaker endpoint authentication.

## Security and runtime-truth boundary

- The handler has no private key, concrete custody implementation, key resolver, filesystem,
  listener, socket implementation, process, environment, provider, or secret source.
- The injected custody port requires an abortable `sign` operation and explicit `close`; its deny
  implementation cannot be composed accidentally.
- The snapshot signature is still independently checked against tenant- and supervisor-scoped
  public roots by the audited publisher. A handler response alone grants no module authority.
- The handler remains absent from API and worker composition roots. No native service, key, root,
  socket, deployment, publication, spend, DNS, legal commitment, or Level-4 action is introduced.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The worker-side keyless signer and Linux transport now have a matching authenticated supervisor
protocol boundary, demonstrated with a test-only Ed25519 round trip. Production custody, a reviewed
native listener/service, root-to-publisher composition, lifecycle ownership, and authenticated
post-publication module loading remain required before any runtime connection claim.
