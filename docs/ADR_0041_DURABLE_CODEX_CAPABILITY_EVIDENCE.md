# ADR-0041: Durable Codex capability evidence

## Status

Accepted as immutable, non-connecting evidence.

## Decision

Add one Level-3 control-plane operation that can retain the normalized
ADR-0040 capability candidate only when all of these facts agree:

- the workspace and Codex app-server adapter identity;
- the exact immutable ADR-0039 registration row and its runtime, connection,
  session, principal, bridge identity, account-evidence, and auth generation;
- the runtime's existing capability-policy hash and a separate policy-verifier
  decision over every normalized catalog claim;
- a separately trusted authorization, valid for at most five minutes, bound to
  the exact candidate, registration, policy, and idempotency key; and
- database-clock freshness: the capability observation follows registration
  by no more than five minutes and its authorization is current.

The append-only SQL-managed table has workspace, connection, and registration
foreign keys; unique tenant-scoped candidate, authorization, and idempotency
bindings; normalized sorted capability-code checks; digest checks; and an
update-rejecting trigger. Deletes remain available through tenant-owned
cascades so workspace erasure is not obstructed.

Only hashes, safe references, normalized catalog capability codes, counts, and
timestamps are retained. Model identifiers, display names, descriptions, raw
protocol frames, credentials, prompts, task content, and result content are
not stored. Exact replays return the existing row; drift, cross-tenant input,
authorization reuse, stale evidence, policy mismatch, and concurrent unique
conflicts fail closed.

## Runtime truth and authority

Acceptance requires both runtime and connection to remain `NOT_CONFIGURED` and
requires the connection's executable capability fields to remain empty. The
operation inserts evidence and a sanitized audit event only; it does not update
runtime or connection truth, send `model/list`, start a process, open a
transport, contact a provider, dispatch work, or authorize execution.

The production capability-authorization source remains deny-only. Codex,
Hermes, and Pi remain `NOT_CONFIGURED`.

## Next safe slice

Define and retain one bounded authenticated heartbeat observation tied to this
registration and capability evidence. It must establish freshness evidence
without claiming a task round trip, provider access, or `CONNECTED` status.

## Source

- <https://learn.chatgpt.com/docs/app-server>
