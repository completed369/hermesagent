# ADR-0159: Inactive worker topology-carrier runtime composition

Date: 2026-09-08

## Context

ADR-0158 established the authorized one-session worker carrier listener, but no application-layer
boundary joined it to the existing retained-descriptor observer, authenticated carrier-root source,
and keyless signer module loader. The older worker helper returned a generic frame endpoint, which
cannot satisfy ADR-0158's hidden proof that the service receives the exact root-resolved worker for
the live carrier binding.

## Decision

Expose the exact root-resolved worker before frame wrapping in the existing worker carrier helper.
Add a worker application composition that can load one exact native listener module into a one-use
service owner, load one exact signer client into the retained-descriptor worker, validate the
service request and live carrier workspace/supervisor scope, and invoke the captured service-owner
implementation for one bounded exchange.

Every loader, authority, request, authorization, key reference, source, binding, signal, and clock
is explicitly injected. The composition performs no discovery and remains absent from worker
startup.

## Security and runtime-truth boundary

- The listener module must be a strict plain `LISTENER` result whose socket path equals the
  `TOPOLOGY_CARRIER_WORKER_LISTENER` service request.
- The signer module must be a strict `CLIENT` result whose path equals its authenticated local IPC
  authorization. The signing private key remains outside the worker process.
- Service scope is checked against the canonical fresh carrier binding before the signer loader or
  service authority is consumed.
- The exact root-resolved worker retains ADR-0158's hidden carrier-binding proof. The application
  composition requires a hidden canonical-constructor proof for the service owner before loading
  the signer and calls the class-owned service method, denying prototype forgery and instance-method
  substitution.
- The one-use service owner still performs exact Level-3 grant validation, kernel peer admission,
  bounded exchange, session close, and owned-listener cleanup.
- `worker.ts` does not import or run this composition. No production listener, native module,
  identity, path, authority, signer custody, or lifecycle input is selected.
- No provider activation, deployment, publication, spend, DNS change, commercial commitment, or
  Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The inactive worker-side runtime chain now has an application composition from explicitly loaded
native listener and signer modules through one authorized carrier exchange. Remaining work is to
compose issuance and delivery of the exact worker-side service authority and approved production
inputs, then activate only under an authorized runtime launch and collect a complete authenticated
round-trip evidence chain before any `CONNECTED` claim.
