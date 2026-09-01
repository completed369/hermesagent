# ADR-0072: Recovery-bound Codex completion authority

Date: 2026-09-01

## Context

ADR-0071 added a bounded coordinator whose completion port denies by default, while ADR-0070 added
the serializable durable recovery-completion operation. A future worker must not be able to connect
those boundaries with a mutable context, a different dispatch, a substituted lease work item, or an
unreviewed runtime-truth transition.

## Decision

Add a Level-3 Agent Control Plane factory that snapshots one validated active recovery work item, its
exact validated dispatch candidate, the workspace/principal context, and one completion idempotency
key. The factory rejects any mismatch across workspace, runtime, connection, session, dispatch, run,
or dispatch hash.

The process lease and validation dispatch have deliberately separate expiry clocks: the process claim
inherits the shorter egress-handoff lease, while the dispatch retains its validation window. The
canonical dispatch hash binds the complete candidate, including its own issued/expiry timestamps;
the work item separately binds the process claim timestamps. Recovery therefore compares the two
authorities by their shared candidate hash and identities, never by equating their expiries.

The returned frozen completion authority accepts only `NOT_CONFIGURED` runtime truth. On every call it
revalidates the active work item and retained-identity exit evidence, compares the work item with the
snapshot canonically, and then delegates the snapshot and evidence to the serializable durable
completion operation.

## Security and truth boundary

- Creating the adapter requires an already-issued Level-3 control-plane capability.
- Caller mutations after creation cannot change context, dispatch, work item, or idempotency identity.
- The adapter cannot obtain exit evidence, discover work, open a stream, inspect or act on a process,
  access a secret or provider, dispatch a task, or promote runtime status.
- Durable completion remains cancellation-only, append-only, owner-scoped, lease-current, and
  database-clock-authoritative.
- Nothing composes this adapter with a positive evidence source or worker. Codex, Hermes, and Pi
  remain `NOT_CONFIGURED`.

## Consequences

A later internal recovery worker can receive an exact control-plane completion port without gaining
database access or broad service authority. A positive OS-specific retained-identity source, native
cleanup action, bounded worker lifecycle, and authenticated real-runtime round trip remain separate
reviewed work.
