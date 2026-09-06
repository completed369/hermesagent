# ADR-0113: Bounded retained-native supervisor service ownership

Date: 2026-09-06

## Context

ADR-0087 and ADR-0107 own one recovery or signing listener attempt, but a future composition caller
could invoke those lifecycles without an independently authorized service scope or leave the
session deadline implicit. ADR-0112 now provides tenant-bound path-provision evidence, but merely
possessing its identifiers must not authorize a listener service.

## Decision

Add an exported but uncomposed one-session service owner that:

1. accepts an exact request binding workspace, supervisor instance, recovery-or-signing purpose,
   path-provision request and approval evidence digests, retained socket-directory path, identity
   and ownership, its exact child socket path, expected worker PID/UID/GID, and `NOT_CONFIGURED`
   runtime truth;
2. requires a separate injected authority to return the identical request under a domain-separated
   request hash, exact Level-3 approval evidence, and a window of at most one minute;
3. derives the listener's parent device and inode only from the retained Linux identity reference
   and constructs the existing owner-only, no-replacement listener lifecycle with the exact
   approved worker principal;
4. permits exactly one recovery or signing attempt, rejects protocol switching, concurrent use,
   replay, malformed dependencies, clock reversal, expiry, and request or grant drift;
5. bounds the attempt to 100–5,000 ms and never beyond authorization expiry, propagates external
   cancellation, and relies on the existing lifecycle to complete accepted-session and exact-path
   cleanup before returning; and
6. exposes no success result or runtime-state transition.

## Security and runtime-truth boundary

- The default authority denies. This change supplies no positive service authority, path or module
  provisioner call, module loader call, native-module import, key, root, signer custody, worker,
  route, scheduler, retry, daemon loop, process launcher, or service composition.
- Path-provision identifiers and approval digests are binding inputs, not reusable service
  authority. A separate fresh Level-3 grant is mandatory for the exact tenant, supervisor,
  protocol, endpoint, principal, and deadline.
- The owner selects no path, identity, tenant, supervisor, worker, protocol, signer, or secret.
  Existing kernel-attested listener, peer-credential, bounded-frame, custody-close, and
  substitution-safe unlink checks remain authoritative.
- No deployment, publication, spend, DNS change, commercial commitment, or Level-4 action occurs.
  Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The repository now has a fail-closed ownership boundary between tenant-bound path evidence and one
bounded listener attempt without activating it. Positive service authority/composition, parent
runtime directories, loader/provisioner invocation, real signer/root custody, worker wiring, and a
complete authenticated registration-through-result round trip remain required before runtime
connectivity can be claimed.
