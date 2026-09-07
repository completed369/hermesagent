# ADR-0137: Inert worker Linux topology carrier root lookup composition

Date: 2026-09-07

## Context

ADR-0131 defines the worker's one-use, mutually authenticated carrier-root source. ADR-0135 adds a
Linux adapter over an explicitly supplied closable native IPC client. The worker application needs
a reviewable construction seam joining these layers without selecting or loading a native client,
discovering a socket, or activating the running worker.

## Decision

Add a worker-local factory that wraps an injected closable IPC client in the ADR-0135 Linux
transport and supplies that transport to the ADR-0131 worker root source using the same exact
carrier binding and clock. Local IPC authorization, the client, binding, and timeout remain explicit
inputs.

Construction validates dependencies but performs no exchange and does not close or otherwise touch
the injected client. The factory is absent from `worker.ts` and all activity/workflow graphs.

## Security and runtime-truth boundary

- No native loader, module path, socket path source, shared mount, route, listener, service lifecycle,
  key, signer, provider, deployment, or publication capability is supplied.
- The explicit deny client remains rejected, and malformed local authorization fails closed before
  client activity.
- No spend, DNS change, commercial commitment, or Level-4 action is introduced.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The worker now has an inert construction boundary from an explicitly injected native client to its
one-use coordinator-root source. Remaining work includes an approved role/OS-principal mapping,
native client loading and ownership, a shared mount and route, listener ownership, keyless carrier
signing, application lifecycle composition, and a verified end-to-end runtime round trip.
