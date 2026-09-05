# ADR-0093: Authorized retained-descriptor native module loader

Date: 2026-09-05

## Context

ADRs 0090 and 0092 provide source-only Linux N-API listener and client modules behind exact injected
ABIs. Loading either module by an ordinary pathname would add an authority gap and a replacement
race: a path could be swapped after inspection but before Node loads executable native code. The
socket path must also be an explicit authority decision rather than environment-driven discovery.

## Decision

Add an exported but uncomposed Linux-x64 loader boundary that:

1. accepts one exact, frozen request binding module kind, canonical `.node` path, exact `.sock` path,
   Linux x64, and `runtimeConnection: 'NOT_CONFIGURED'`;
2. defaults both its authorization source and native host to explicit denial and consumes one load
   attempt even when that attempt fails;
3. requires an exact authorization lasting at most five minutes, hash-bound to the request and to
   module digest, retained device/inode identity, owner, non-writable readable mode, and an 8 MiB
   size ceiling;
4. binds the socket to its exact existing parent directory, retained device/inode identity, owner,
   and mode `0700`, without selecting or creating either path;
5. opens the directory and module with `O_NOFOLLOW` and close-on-exec, verifies with `fstat(2)`, hashes
   the bytes on the retained module descriptor, and only then calls `dlopen` through
   `/proc/self/fd/<descriptor>` while the descriptor remains open;
6. rechecks retained identity after loading, admits only the exact ADR-0089 or ADR-0091 own-data ABI,
   retains that descriptor for the loaded module's process lifetime, admits at most one exact
   immutable identity for each of the two module kinds, and returns a frozen module/path result that
   still reports `NOT_CONFIGURED`; and
7. uses Linux-x64 evidence to compile both production sources outside the repository, load each
   through the retained-descriptor host, and deny module and socket-directory symlinks.

## Security and runtime-truth boundary

- The authorization source is a trusted port, not an ambient file, environment variable, or path
  discovery mechanism. No positive source is composed in the API or worker.
- No `.node` artifact is committed or admitted to package runtime output. The existing production C
  sources remain outside the package allowlist and Linux tests compile only disposable copies.
- Retaining at most the client and listener descriptors prevents `/proc/self/fd` number reuse from
  aliasing dynamic-loader cache entries; an exact already-loaded identity may be reused, while a
  replacement identity for the same kind is denied until process restart.
- Loading authorized native code is not listener/client service composition. This change supplies no
  socket-directory provisioner, retry loop, process launcher, trust/key provisioning, provider
  access, deployment, publication, spending, or Level-4 authority.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The module-path replacement race and socket-path discovery gap now have a reviewable fail-closed
boundary. A later slice must supply durable, revocable authorization and path provisioning before
either module can be composed into a bounded service; complete authenticated round-trip evidence is
still required before any runtime status promotion.
