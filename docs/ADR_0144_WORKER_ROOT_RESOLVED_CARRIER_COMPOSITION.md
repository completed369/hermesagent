# ADR-0144: Worker root-resolved carrier composition

Date: 2026-09-07

## Context

ADR-0139 can load an authorized native `CLIENT` module into the worker's one-use, independently
authenticated API-coordinator root source. ADR-0127 separately defines a worker endpoint that must
resolve the coordinator root before authenticating an observation request or invoking the observer
and delivery signer. No worker-local boundary requires those exact concrete pieces to be joined.

## Decision

Add an explicit unwired worker-local factory that accepts only the concrete one-use root source from
the Linux composition, an injected topology observer, injected delivery signer, live carrier
binding, and clock. It rejects substituted root-source implementations and delegates the remaining
observer, signer, binding, and clock validation to the root-resolved worker endpoint.

Construction performs no root lookup, IPC exchange, close, observation, signing, or native call.
The existing endpoint remains one-use and resolves the exact `API_COORDINATOR` root before it
authenticates or observes any carrier message.

## Security and runtime-truth boundary

- Only the concrete bounded, mutually authenticated worker root source is accepted.
- Deny-only or malformed observers, signers, bindings, and clocks remain rejected by the existing
  endpoint before any lookup or observation.
- No loader, module path, socket path, OS-principal mapping, observer implementation, signer key or
  transport, shared mount, carrier listener, route, or lifecycle is discovered or selected.
- The factory remains absent from `worker.ts` and production supplies no caller.
- No deployment, publication, provider activation, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The worker's reviewed root-lookup source can now be joined to the reviewed root-resolved observation
endpoint without weakening root provenance. Remaining work must still compose approved
deployment-specific native loading, Linux identity and socket inputs, a concrete bounded observer
and keyless signer, carrier framing/listener lifecycle, and verified authenticated round-trip
evidence before any runtime can be reported connected.
