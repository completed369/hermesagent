# ADR-0068: Active-only Codex recovery work-item validation

Date: 2026-09-01

## Context

ADR-0067 defined the atomic recovery work item returned with an active lease. A future injected owner
must not rely on TypeScript shape alone or consume a stale, extended, malformed, secret-bearing, or
runtime-promoting object after it crosses a composition boundary.

## Decision

Add one shared Agent Bridge validator for the exact work-item schema. It revalidates every safe
reference, the dispatch digest, positive generation, complete supervisor binding, canonical
timestamps, original claim ordering, expired-claim precondition, immutable 15-second lease, and
`NOT_CONFIGURED` runtime truth. The supplied observation clock must fall inside the half-open lease
window.

The API applies this shared validator with its transaction's database observation time before it
returns any active work item. Validation failures become a fail-closed control-plane denial.

## Security and truth boundary

- Validation performs no process discovery, launch, signal, termination, retry, cleanup, transport,
  secret resolution, provider call, persistence, status transition, or deployment.
- Exact-key validation rejects additional payload, transcript, prompt, credential, secret, PID, or
  native-handle fields rather than retaining them.
- Validation proves metadata integrity and lease freshness only. It does not prove a live process or
  authorize a future owner to act.
- Runtime truth remains `NOT_CONFIGURED`; Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

A future recovery owner and independent OS-evidence verifier can share one canonical, time-bounded
input contract. Positive recovery action, native retained-identity proof, recovery-specific durable
completion, authenticated real-runtime traffic, and runtime promotion remain separate work.
