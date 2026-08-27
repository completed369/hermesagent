# ADR-0029: Deny-by-default trusted supervisor composition

Status: Proposed (implementation under review)

Date: 2026-08-27

## Context

The repository already has a pure supervision-admission policy, an exact lifecycle binding, and a
Linux executable evidence reader. Those pieces did not define who may authorize each admission or
how their outputs must be composed before any future launcher may receive a request. Treating a
structurally valid evidence object or a deterministic hash as authority would allow callers to
reconstruct fictional launch plans.

## Decision

Add a service-only trusted-supervisor composition boundary to `@ventureos/agent-bridge`:

1. validate and normalize the complete launch manifest;
2. ask a trusted authorization source for a fresh decision over the exact workspace, runtime,
   connection, adapter, platform, test-only flag, manifest hash, and normalized manifest;
3. require that trusted decision to mint the supervision ID and launch nonce, bind the exact
   request hash, and consume its decision ID, supervision ID, and nonce once before evidence I/O;
4. validate the short-lived signed Linux authorization and bind every executable, owner, mode,
   worktree, argument-policy, adapter, and test-only field to the manifest;
5. acquire Linux executable evidence for that exact authorization and manifest;
6. revalidate the complete admission and bind the exact authorization identity and hash;
7. create the immutable supervision lifecycle binding; and
8. issue one deeply frozen, in-process launch plan and exact launcher request.

Issued plans and launcher requests are registered in private, per-composition-instance `WeakMap`
state as non-serializable in-process capabilities. A plan prepared by one composition instance
cannot be executed through another instance or its launcher. A request starts pending and is bound
to its exact owner, plan, and the earlier of authorization and evidence expiry. It cannot be
consumed before the full plan is revalidated;
successful plan validation activates only that request, and request validation rechecks current
time and consumes it exactly once. Copies or caller-reconstructed objects are rejected even when
their deterministic hashes are internally consistent. Deterministic hashes are correlation and
integrity evidence; they are not signatures and this design does not claim cryptographic
tamper-proofing. Callers cannot supply supervision or nonce identifiers, and a decision, nonce,
plan, or request cannot be replayed.

Production dependency injection provides only `DenyTrustedSupervisorAuthorizationSource` and
`DenyRuntimeProcessLauncher`. The Linux evidence reader cannot be reached through production
composition because authorization fails first. The positive authorization source and executable
fixtures remain test-local and outside package output and product images.
Exporting the composition primitive and source interface does not provide an authorization source,
signer, registry, or launcher. The composition exposes one execution method: it activates the exact
issued plan, validates and consumes its request, and only then invokes its injected launcher. The
lower-level activation and request-consumption functions are not exported. A future positive
launcher is a composition-root trust decision and requires its own review and production evidence;
accepting the structural request type outside this composition path is forbidden.

## Security and lifecycle limits

This slice does not create a controller, listener, child process, network connection, credential
backend, provider integration, database writer, deployment, publication, or status mutation. It
does not retain the inspected executable descriptor through process creation and therefore does
not close the final filesystem-to-launch TOCTOU window. Process isolation, native Linux process
groups/cgroups, Windows handle and Job Object semantics, resource enforcement, authenticated
JSONL transport, cancellation, and cleanup remain requirements for a separately reviewed native
supervisor.

The issued-plan capability is intentionally process-local and non-durable. Restarting the API or
crossing a serialization boundary requires a new live authorization and evidence read. Windows is
unsupported and fails before the authorization source is consulted.

Revocation is observed only by the single source read for that admission. One-time decision
consumption and short authorization/evidence expiry reduce replay exposure, but do not detect a
revocation after the decision. A future native launcher must revalidate authority and identity
immediately at process creation or provide an atomic retained authority/identity mechanism.

Codex, Hermes, and Pi remain `NOT_CONFIGURED`. This composition is not runtime registration,
connectivity, heartbeat, task exchange, result evidence, or authenticated end-to-end execution.

## Next dependency

The pure post-authentication JSONL session in ADR-0030 is the next bounded prerequisite: it
verifies already-authenticated runtime-to-parent frames without I/O or durable mutation. A later
process-facing slice must preserve the exact issued-plan boundary while implementing a
deny-by-default native supervisor behind an explicit security review. Connecting a real runtime,
using real credentials, activating a provider, deploying, publishing, or changing a runtime to a
connected status remains outside this ADR and requires the corresponding authorization and
end-to-end evidence.
