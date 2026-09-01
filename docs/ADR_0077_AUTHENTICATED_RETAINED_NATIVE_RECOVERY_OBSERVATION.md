# ADR-0077: Authenticated retained-native recovery observation

Date: 2026-09-02

## Context

ADR-0076 can drive one bounded recovery page, and ADR-0069 requires exit evidence from an
independently retained native launch identity. No production-safe protocol existed for a recovery
owner to ask an external native supervisor for that observation. A reusable process identifier,
caller assertion, unsigned response, or replayable query would not satisfy the identity boundary.

## Decision

Add a concrete Agent Bridge recovery observation protocol and evidence-source implementation:

- each observation creates a cryptographically fresh request identifier and 256-bit challenge with
  a maximum two-second lifetime bounded by the active recovery lease;
- the domain-separated request hash binds the workspace, runtime, connection, recovery lease and
  generation, claim, handoff, supervisor, launch nonce, session, dispatch, run, executable admission
  hashes, process claim window, and unchanged `NOT_CONFIGURED` runtime truth;
- an injected transport receives one frozen request plus an abort signal and returns at most one
  opaque candidate; the source races it against the request deadline and revalidates the recovery
  lease after the exchange;
- a concrete Ed25519 verifier accepts only an exact response from one explicitly trusted native
  supervisor instance/key, during both the trust and request windows, with a valid signature over
  the complete response payload;
- the response must prove an identity established inside the original claim window and an exit
  inside that window, plus a fresh retained-identity revalidation after the challenge and before the
  signed observation. It carries exactly one bounded exit code or safe signal; and
- only normalized, hash-bound ADR-0069 exit evidence crosses into the existing recovery coordinator.
  The signature, trust identity, transport details, and all native authority remain outside durable
  recovery evidence.

The transport and verifier have explicit deny implementations, and the authenticated evidence
source rejects an incomplete deny composition at construction. No positive transport or trust root
is wired into the API.

## Security and truth boundary

- The protocol exposes no PID, pidfd, process handle, stream, filesystem path, secret, transcript,
  payload, provider response, or signal/termination capability.
- A signature authenticates the configured supervisor response but does not by itself prove native
  retention. A future transport peer must independently retain and re-read the launch identity; its
  native implementation and cleanup action require separate review and Linux evidence.
- Request freshness prevents response replay across calls. Full binding prevents cross-tenant,
  cross-session, cross-launch, cross-dispatch, or cross-lease substitution.
- The positive protocol accepts only the reviewed Linux, non-test launch binding; deterministic test
  fixtures cannot be presented as production retained-identity evidence.
- Trust records must be unrevoked, production-scoped Ed25519 records with bounded validity. Durable
  trust provisioning, rotation, and anti-rollback remain separate work.
- This change performs no process discovery, launch, signal, cleanup, network connection, secret
  resolution, scheduling, provider access, deployment, spend, or runtime-state transition.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The next native-runtime slice can implement one authenticated local transport peer that retains the
launch identity and performs bounded cleanup without changing the recovery worker or accepting a
caller-selected process locator. API composition, durable trust provisioning, scheduling, and an
authenticated real Codex round trip remain unfinished.
