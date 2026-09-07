# ADR-0143: API carrier-root one-session run composition

Date: 2026-09-07

## Context

ADR-0142 can load an authorized native `LISTENER` module into an inert one-use Level-3 service
owner. ADR-0134 separately composes the API coordinator's least-authority PostgreSQL public-root
source and authenticated protocol handler. No boundary joins those parts for one service attempt.
Leaving the join implicit risks consuming service authority before carrier tenant and supervisor
scope have been checked together.

## Decision

Add an explicit unwired API-local entry point that accepts an already-constructed concrete service
owner, PostgreSQL root-source client, exact service request, live carrier binding, abort signal,
clock, and bounded protocol timeout. It validates the owner and signal, authenticates the live
carrier at the supplied clock, and requires the carrier-root purpose plus exact workspace and
supervisor equality before constructing the handler or invoking the owner.

The entry point then delegates exactly one attempt to the existing service owner. That owner still
independently consumes the Level-3 authority, validates its grant, revalidates live carrier scope,
owns the created socket and accepted session, derives peer identity from kernel evidence, bounds the
deadline, and cleans up only its owned socket.

## Security and runtime-truth boundary

- Wrong owner types, cancellation, expired carrier bindings, wrong purposes, cross-workspace scope,
  and cross-supervisor scope fail before service-owner consumption.
- Handler construction performs no database read; PostgreSQL is queried only after an authenticated
  worker request reaches the owned session.
- The entry point cannot construct or discover a loader, authority, module, path, peer, mount, route,
  or application lifecycle.
- It remains absent from the Nest application graph and production supplies no caller or required
  deployment-specific configuration.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

All reviewed API-side carrier-root pieces can now be joined for one explicitly injected session
without weakening authority or tenant scope. The remaining activation gap is deployment-specific:
approved module and shared-socket paths, Linux principal mapping, bounded application lifecycle
wiring, the worker counterpart, and verified authenticated round-trip evidence are still required
before any runtime can be reported connected.
