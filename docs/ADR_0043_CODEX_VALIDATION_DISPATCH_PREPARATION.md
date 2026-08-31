# ADR-0043: Codex validation dispatch preparation

## Status

Accepted.

## Context

The Runtime Broker correctly requires an already `CONNECTED` runtime with registration,
capability, heartbeat, and task/result proofs. Codex remains `NOT_CONFIGURED`, so routing an
ordinary task to it would either fail correctly or require falsifying connection truth. A bounded
bootstrap round trip is needed before Codex can become a broker candidate.

## Decision

Add a separate validation-dispatch preparation boundary. It accepts only a Level 0-3 durable
`runtime.verify` task whose exact policy selects `codex.runtime.round-trip.v1`, whose maximum cost
is zero minor units, whose compute limit is at most 100 units, and whose duration is at most 60
seconds. The run and task must remain ready, prepared, and unassigned.

The candidate binds the exact registration, capability, heartbeat, bridge identity, tenant,
runtime, connection, session, principal, authentication generation, task, run, agent reference,
authority, policy hash, resource limits, message, sequence, and expiry. A separate authorization
of at most five minutes must approve that exact candidate and idempotency key.

The Level-3 durable service revalidates every precursor using the database clock, leases the exact
bridge secret for `SIGN_FRAME`, and signs one parent-to-runtime `DISPATCH`. It returns that frame
ephemerally and stores only immutable correlation and digest evidence. The production
authorization and secret sources remain deny-only.

This boundary does not use the Runtime Broker, create an assignment, reserve production capacity,
send or enqueue the frame, call Codex, contact a provider, update a task or run, or promote runtime,
capability, heartbeat, delivery, or connection truth.

## Consequences

VentureOS now has an honest bootstrap dispatch artifact that can support a future reviewed local
transport/controller path without treating an unverified runtime as eligible for ordinary work.
Authenticated dispatch status/result admission remains required before any connection-state
transition. Codex remains `NOT_CONFIGURED`.
