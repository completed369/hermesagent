# ADR-0120: Retained shared-runtime topology evidence

Date: 2026-09-06

## Context

ADR-0119 coordinates four provisioning ports but deliberately supplies no transport or deployment
topology. The current API and worker images contain only their role-specific native artifacts and the
private-staging definition gives the two services separate temporary filesystems. Composing the
controller without first proving a common owner-only runtime parent would turn path equality into a
false shared-mount claim.

## Decision

Add two one-use role-local Linux-x64 observers and one bounded reconciler. Each observer receives an
exact request derived from the already-validated ADR-0119 plan. It opens the runtime parent and its
role-specific immutable module with `O_NOFOLLOW` and close-on-exec, retains both descriptors while
checking type, device/inode identity, owner, mode, size and module digest, rechecks the path identities,
records its effective UID/GID as the matching principal, and returns no file contents. The API role
observes only LISTENER evidence and the worker role observes only CLIENT evidence.

The reconciler calls two separately injected ports within one five-second attempt. It validates exact
request hashes, plan binding, role placement, freshness and retained identities, rejects duplicate
observation IDs, and returns a bundle only when both roles observed the same exact runtime-parent
object. Failure, cancellation, timeout, malformed evidence, clock rollback or replay returns no partial
topology result.

## Security and runtime-truth boundary

- Both ports deny by default and their methods are captured at construction against later substitution.
- Observation is read-only. It creates no directory, module, socket, listener, process, service or
  network connection.
- The observers do not authenticate a remote caller or transport. A future adapter must carry each
  request to its real role through a separately reviewed authenticated bounded channel.
- Matching observations prove filesystem visibility for their short validity window only. The existing
  retained-descriptor provisioners must still revalidate every object when acting.
- The reconciler remains absent from API and worker composition roots. No deployment configuration or
  shared volume is changed.
- Level 4, providers, credentials, publication, deployment, spending and status promotion remain outside
  this boundary. Codex, Hermes, Pi and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

VentureOS can now distinguish an actual two-role view of one retained runtime parent from mere matching
path strings. The current deployment still cannot produce that evidence because it has no shared
runtime mount or authenticated observation transport. Those remain prerequisites to provisioning,
activation and any runtime connectivity claim.
