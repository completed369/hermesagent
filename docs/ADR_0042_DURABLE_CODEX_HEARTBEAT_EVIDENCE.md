# ADR-0042: Durable Codex heartbeat evidence

## Status

Accepted.

## Context

Codex registration and capability evidence are durable, but neither establishes a live runtime.
The reviewed Codex app-server protocol does not document a native heartbeat method. Inventing one
would create an unverified provider claim. Reusing the generic bridge session would also overstate
truth because that path promotes a connection to `PARTIAL` after its own capability frame.

## Decision

Add a Codex-specific, VentureOS bridge-signed heartbeat evidence boundary after the exact durable
registration and capability rows. It accepts one canonical runtime-to-parent `HEARTBEAT` frame at
sequence 1, with only `HEALTHY` or `DEGRADED`, during the original authenticated bridge window.

The pure translator binds the frame to the exact workspace, runtime, connection, session,
principal, authentication generation, registration candidate, capability candidate, capability
digest, bridge identity, and one-way secret binding. It hashes the unsigned envelope and never
retains the MAC, nonces, secret bytes, raw frame, account data, model identity, or provider payload.

The durable Level-3 admission operation:

- uses the database clock and rejects future, expired, or older-than-60-second evidence;
- requires the exact immutable registration and capability precursors;
- requires all runtime and connection truth fields to remain `NOT_CONFIGURED` and empty;
- leases the exact scoped secret for `VERIFY_FRAME` and verifies the runtime-to-parent MAC;
- stores one immutable tenant-scoped evidence row with unique message, sequence, and idempotency
  bindings; and
- records a safe audit event without updating heartbeat or status fields on the connection.

Production secret resolution remains deny-only. This change adds no controller, transport,
process, provider call, dispatch, task result, deployment, or connected-state transition.

## Consequences

VentureOS can durably prove that an already authenticated bridge identity emitted one fresh,
bounded heartbeat after its exact capability evidence. It still cannot claim that Codex is
configured or connected. A bounded authenticated task dispatch and status/result round trip is the
next separately reviewed dependency.
