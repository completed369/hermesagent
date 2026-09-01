# ADR-0069: Lease-bound Codex recovery exit evidence

Date: 2026-09-01

## Context

ADR-0068 validates recovery metadata, but metadata cannot prove that the originally launched native
process exited. Looking up a reusable process identifier after a service restart could target an
unrelated process. Caller assertions and owner-reported cleanup hashes are likewise insufficient.

## Decision

Add an Agent Bridge evidence-source port whose contract requires an independently retained native
launch identity. The source returns one exact exit observation bound to the active recovery lease,
claim, supervisor identity, launch nonce, session, dispatch, and dispatch digest. Validation requires
that identity establishment and exit occurred inside the original claim window and that verification
occurred inside the current half-open recovery lease.

The observation is domain-hashed, contains only a bounded exit code or safe signal, is revalidated
after the asynchronous source returns, and remains `NOT_CONFIGURED`. The default source denies.

## Security and truth boundary

- A source implementation must inspect an identity retained from launch. Reusable process identifiers,
  caller-provided locators, and ambient process discovery are not authority.
- The contract contains no process identifier, native handle, stream, secret, payload, transcript,
  provider response, or action capability.
- The evidence hash is deterministic correlation integrity, not a signature or independent proof by
  itself. Trust comes only from the injected source re-reading retained native state.
- This change performs no lookup, signal, termination, cleanup completion, retry, transport, provider
  call, deployment, or runtime-state transition.
- No positive production source is supplied. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

A future OS-specific supervisor can implement the narrow source without exposing native authority to
the recovery worker. Positive retained-identity storage, cleanup action, durable recovery completion,
and authenticated real-runtime traffic remain separate reviewed work.
