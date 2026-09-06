# ADR-0115: Tenant-bound native parent-directory provisioning

Date: 2026-09-06

## Context

ADR-0096 can create an exact native module and socket directory only beneath two already-existing
owner-only parents. Those parents had no reviewed creation boundary or identity provenance. Merely
authorizing their path strings would allow same-owner directory substitution before path
provisioning and would leave a critical runtime prerequisite ambient.

## Decision

Add an exported but uncomposed Linux-x64 parent-directory provisioner that:

1. accepts one exact tenant and supervisor request binding a retained owner-only runtime root, its
   Linux device/inode identity, owner, fixed absent children named `native` and `run`, and the fixed
   absent `run/supervisor` socket directory;
2. defaults authority and host access to denial, consumes one attempt, and accepts only an exact
   request-hash-bound Level-3 grant lasting at most five minutes;
3. opens the root with `O_NOFOLLOW` and close-on-exec, verifies its retained identity, effective
   process ownership, and exact `0700` mode, and creates no recursive or caller-selected hierarchy;
4. creates the three-directory hierarchy with exact `0700` mode, retains descriptors, rechecks
   canonical path identity, never replaces an existing path, and limits failure cleanup to its own
   retained empty child; and
5. returns frozen tenant-, supervisor-, request-, approval-, owner-, and identity-bound evidence.

Add a one-use API authority adapter that accepts only an exact trusted non-runtime `CONTROL_PLANE`
Level-3 capability. It rejects Level 4, AI-COO authority, cross-workspace scope, request drift,
malformed input, invalid clocks, and replay, and emits only domain-separated digest evidence.

Strengthen ADR-0096 so its request, grant, result, and downstream snapshot issuance carry the parent
provisioning identifier, request and approval hashes, both exact parent identities, and the socket
directory identity. The retained path host now rejects any identity drift before creating a module.
ADR-0116 records the follow-up correction that makes this shared directory mandatory for both module
kinds.

## Security and runtime-truth boundary

- The root, paths, owner, tenant, and supervisor are fixed caller inputs independently validated by
  the boundary; the authority selects none of them.
- Construction performs no filesystem action. The provisioner and positive adapter are absent from
  routes, workers, schedulers, CLIs, image commands, service composition, and deployment.
- No module is loaded, socket opened, service started, signer or key contacted, runtime registered,
  provider activated, deployment or publication performed, money spent, DNS changed, commercial
  commitment made, or Level-4 boundary crossed.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

Native path creation no longer depends on ambient unproven parent directories, and later snapshot
issuance is transitively bound to the exact approved parent identities. An actual runtime root or
writable shared mount, positive composition call, signer/root custody, worker wiring, and complete
authenticated round trip remain unfinished and cannot be inferred from this evidence.
