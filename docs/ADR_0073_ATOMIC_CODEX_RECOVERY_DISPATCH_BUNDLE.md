# ADR-0073: Atomic Codex recovery dispatch bundle

Date: 2026-09-01

## Context

ADR-0072 binds durable recovery completion to an exact dispatch candidate, but a process restart loses
the caller's in-memory candidate. ADR-0067 recovery lease acquisition returned only the work item. A
future recovery worker would otherwise need to reconstruct or fetch the dispatch outside the lease
transaction, weakening the reviewed binding and leaving no complete restart-safe authority bundle.

## Decision

During the serializable recovery-lease transaction, lock and read the immutable durable validation
dispatch row associated with the claimed process session. Reconstruct the public dispatch candidate
from its digest-only fields and fixed `NOT_CONFIGURED` truth, pass it through the canonical candidate
validator, and compare its workspace, runtime, connection, session, dispatch, run, hash, and expiry
against the durable process claim.

Return the frozen dispatch beside the frozen active work item. An expired lease replay returns both
`workItem: null` and `dispatch: null`; it cannot leak a stale authority pair.

## Security and truth boundary

- The dispatch row is read and share-locked in the same serializable transaction as lease acquisition.
- The bundle contains validated metadata and digests only. It contains no secret, credential,
  authentication tag, payload, prompt, transcript, provider response, stream, or native process handle.
- Recovery remains owner-scoped, Level-3, expired-claim-only, exclusive, bounded to 15 seconds, and
  append-only.
- Returning a dispatch does not send it, assign a task, access a provider, act on a process, admit a
  terminal result, or promote runtime status.
- No worker or positive evidence source is composed. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The completion-authority adapter can now be reconstructed after a service restart from one atomic
lease result without trusting caller-retained dispatch state. A bounded worker lifecycle, positive
OS-specific retained-identity source, native cleanup action, and authenticated real-runtime round trip
remain separate reviewed work.
