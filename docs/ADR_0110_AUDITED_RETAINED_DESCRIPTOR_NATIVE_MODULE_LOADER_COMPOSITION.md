# ADR-0110: Audited retained-descriptor native-module loader composition

Date: 2026-09-06

## Context

ADR-0093 supplied a Linux-x64 retained-descriptor native-module loader with deny-by-default
authorization. ADR-0109 subsequently supplied a workspace-scoped PostgreSQL source that exposes an
exact grant only after audited snapshot authentication, durable anti-rollback checkpointing, and a
database-linearized root/publication currentness check. The two boundaries were deliberately not
joined, leaving the loader without a production-shaped positive authorization source.

## Decision

Add one API-side construction function that:

1. fixes an exact database, workspace, supervisor instance, and shared process clock;
2. constructs the ADR-0109 audited durable trust source for that exact scope; and
3. supplies only that source to the ADR-0093 retained-descriptor Linux-x64 loader factory.

Construction performs no trust read, checkpoint write, filesystem access, native load, socket
operation, or service action. The returned loader retains its existing one-attempt request,
authorization freshness, path/digest/identity, descriptor, ABI, and cancellation checks.

## Security and runtime-truth boundary

- The function accepts no path, module bytes, root, signature, key, credential, secret, environment
  variable, or caller-provided native host.
- The real host remains Linux-x64-only and still discovers nothing. A future caller must supply one
  exact request already covered by the latest audited grant.
- The function remains absent from the Nest module, controllers, routes, workers, service loops,
  images, and deployment configuration. No module is packaged or loaded by this change.
- Root/key provisioning, signer custody, native-module packaging, listener/client service ownership,
  recovery-worker wiring, and authenticated runtime round-trip evidence remain absent.
- `runtimeConnection` remains `NOT_CONFIGURED`; Codex, Hermes, and Pi remain `NOT_CONFIGURED`.
- No deployment, publication, spend, DNS change, commercial commitment, or Level-4 action occurs.

## Consequences

The authorization-to-load boundary now has a single explicit production-shaped join with no
alternate positive authority port. The next safe slices are reviewed source-to-image native-module
packaging and explicit bounded service ownership; neither can promote runtime truth without the full
authenticated registration-through-result round trip.
