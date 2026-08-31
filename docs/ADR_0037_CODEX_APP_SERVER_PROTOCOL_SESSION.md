# ADR-0037: Codex app-server protocol session

## Status

Accepted as an I/O-free, fail-closed protocol state machine.

## Decision

Model one non-experimental Codex app-server lifecycle without opening a
transport or starting a process. The state machine constructs only:

1. one `initialize` request with fixed VentureOS client metadata;
2. one `initialized` notification after a correlated successful response;
3. one ephemeral, approval-denied, read-only `thread/start` request;
4. one bounded text-only `turn/start` request with an explicit read-only,
   no-network sandbox override; and
5. at most one correlated `turn/interrupt` request.

It accepts the exact correlated minimal and reviewed current stable response shapes and one terminal
`turn/completed` notification. Request IDs, thread IDs, and turn IDs must match
the active state. Pre-handshake, repeated, out-of-order, experimental, unknown,
and uncorrelated messages fail the session closed.

Task text is limited to 16 KiB. Terminal events are limited to 64 KiB, eight
levels, 1,024 values, 256 array entries, and 64 object fields. The session
retains only identifiers, counters, terminal status, and a SHA-256 correlation
hash; it does not retain task text or result items in its snapshot.

## Runtime truth and authority

This component is a pure in-memory encoder/validator. It has no process,
filesystem, environment, database, controller, network, provider,
authentication, approval, secret, or deployment access. It does not consume
the egress outbox and cannot create registration, capability, heartbeat,
dispatch, usage, audit, artifact, or connection records.

The production executable authority and process launcher remain deny-only.
The database adapter allowlist is unchanged. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`.

## Next safe slice

Define the authenticated adapter-registration translation boundary that can
bind a separately authorized Codex process/session identity to the existing
Agent Bridge challenge/response and capability contracts. Keep process launch,
provider access, production credentials, durable connection promotion, and
task dispatch deny-only until their independent gates are complete.

## Source

- <https://learn.chatgpt.com/docs/app-server>
