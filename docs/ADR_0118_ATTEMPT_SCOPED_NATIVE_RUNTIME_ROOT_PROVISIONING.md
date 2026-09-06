# ADR-0118: Attempt-scoped native runtime-root provisioning

Date: 2026-09-06

## Context

ADR-0117 joins Level-3 authority to the real retained-descriptor parent/path hosts, but the parent
host requires an already-existing owner-only runtime root. Selecting one stable root for repeated
provisioning is unsafe: if CLIENT succeeds and LISTENER fails, fail-if-present semantics correctly
leave the successful module in place and a naive retry cannot proceed. Granting broad recursive
cleanup would weaken retained-identity ownership and could delete another attempt's state.

The listener and client artifacts also live in separate API and worker images. A single-process
sequencer would therefore assert a runtime topology that does not exist.

## Decision

Add an exported, deny-by-default Linux-x64 boundary that creates exactly one absent owner-only
`0700` attempt root beneath an already-attested owner-only parent. The request binds workspace,
supervisor, a safe basename-only provisioning-attempt ID, exact parent path and retained identity,
effective UID/GID, exact child path, and `runtimeConnection: NOT_CONFIGURED`.

The native host opens the parent with `O_NOFOLLOW`, verifies its retained descriptor, owner, group,
and mode, creates without replacement through `/proc/self/fd`, verifies the new root before and
after reopening, and returns only immutable attestation evidence. Failure cleanup can remove only
the exact retained empty directory created by that call.

An API-side one-use authority derives a one-minute, digest-only grant from an exact trusted
non-runtime `CONTROL_PLANE` Level-3 capability. A construction function joins that authority to the
real host with one shared clock. Parent-directory requests now include the runtime-root provisioning
ID, request hash, and approval-evidence hash, so the downstream Level-3 authorization commits to the
complete root provenance chain.

## Security and runtime-truth boundary

- Existing roots are never reused or replaced; a retry must receive a new authorized attempt ID.
- The boundary has no recursive deletion, discovery, scheduler, retry loop, mount, container, remote
  transport, module load, listener, signer, key, provider, or runtime-status authority.
- The already-attested parent remains an external deployment/topology prerequisite. No writable
  parent or shared mount is configured by this change.
- The construction remains absent from application composition roots. Construction itself performs
  no filesystem operation.
- Level 4, runtime principals, AI-COO authority, cross-workspace use, path drift, symlinks, stale
  grants, cancellation, replay, and malformed/accessor-bearing input deny.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

Fresh attempt roots provide a narrow retry strategy without broad cleanup authority, and later
parent/path grants retain the authorization provenance. A later reviewed distributed controller
must still resolve the shared writable parent/mount, API/worker identity visibility, and transport
that coordinates artifacts across the two images before any service or runtime can be activated.
