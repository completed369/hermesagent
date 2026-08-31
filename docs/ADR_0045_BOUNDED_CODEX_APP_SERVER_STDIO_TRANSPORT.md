# ADR-0045: Bounded Codex app-server stdio transport

## Status

Accepted as an uncomposed local transport boundary.

## Context

ADR-0044 can lease one exact signed zero-spend validation frame to a local controller, while
ADR-0037 can construct and validate one Codex app-server protocol session. Neither component owns
the byte boundary to an already-open app-server process. Treating an injected test port as a real
stdio transport would overstate the implementation and leave framing, backpressure, cancellation,
and untrusted-output limits undefined.

## Decision

Add a Node stream-backed JSONL transport for an already-open Codex app-server stdin/stdout pair.
It writes one canonical object per line, waits for the writable callback, admits fragmented or
coalesced stdout one line at a time, and rejects malformed UTF-8, non-object JSON, embedded raw
newlines, invalid streams, concurrent operations, and closed streams. Each line is capped at 64
KiB, buffered output at 128 KiB, cumulative reads and writes at 8 MiB each, and every operation at
five seconds. Cancellation, timeout, ambiguity, malformed output, limit exhaustion, or stream
failure destroys both sides and makes the transport terminal. Owned transient buffers are cleared.

The constructor accepts only already-open streams. It does not resolve an executable, start a
process, read environment variables or credentials, inspect Codex authentication, contact a
provider, or supply a positive production composition. Its snapshot always reports
`runtimeConnection: NOT_CONFIGURED`.

## Consequences

This is a real bounded local byte/framing boundary, but it is not a runtime connection. No
production code creates or supplies its streams, and ADR-0044's validation-egress controller is
not yet composed with the Codex protocol session and this transport. Local write completion proves
only acceptance by the already-open writable boundary. It proves no delivery, protocol response,
task execution, provider access, status, result, artifact, usage, audit, or connection truth.

The next reviewed slice must compose the one-shot validation claim, exact protocol state machine,
and this transport behind separately authorized already-open process evidence, then authenticate
and durably admit the correlated dispatch status/result evidence before any runtime-state change.
Codex, Hermes, and Pi remain `NOT_CONFIGURED`.
