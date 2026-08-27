# ADR-0031: Test-only Linux native supervisor evidence

Status: Proposed (source authored; Linux execution pending authoritative Ubuntu CI)

Date: 2026-08-27

## Context

The production supervisor composition owns one-use, expiry-bound plans and launch requests in
private per-instance `WeakMap` state, but the only production launcher still denies. Earlier
process-tree evidence exercised operating-system cancellation through a test fixture without
closing Linux executable path-to-launch identity, working-directory traversal, exec-failure, or
resource-isolation questions.

This ADR does not authorize a production launcher. It defines a Linux x86-64 test boundary that
must execute on the repository's existing Ubuntu CI kernel before its native claims are evidence.
The Windows development host can validate only source, TypeScript, package, and image-exclusion
contracts; it cannot truthfully execute these Linux syscalls.

## Decision

Add a fixed C supervisor core, a fixed ELF fixture, a thin N-API test addon, and one Linux-only
Vitest harness outside package output:

1. The helper opens the exact fixture with `O_NOFOLLOW | O_NONBLOCK`, requires a bounded regular
   ELF owned by the current disposable CI identity with no set-id or write bits, hashes it through
   Linux `AF_ALG`, and records exact descriptor metadata. Both the initial and revalidation opens
   are nonblocking so a FIFO/device substitution denies instead of stalling the boundary.
2. It copies those bounded bytes into a named `memfd`, makes it executable, seals write/grow/
   shrink/further-seal changes, hashes the sealed copy, then rechecks the retained descriptor,
   current path identity, and source digest against the expected and sealed digests.
3. It opens the fixed `work` directory beneath an already opened test root using `openat2` with
   `RESOLVE_BENEATH`, `RESOLVE_NO_SYMLINKS`, `RESOLVE_NO_MAGICLINKS`, and `RESOLVE_NO_XDEV`.
   Root and work-directory ownership/mode are checked against the fixed disposable-CI policy. The
   positive fixture then replaces the pathname and proves the child still enters the retained
   trusted descriptor, not the new untrusted path. This does not claim a signed parent-directory
   identity that the admission evidence does not carry.
4. A child creates a new process group, changes directory through the retained descriptor, applies
   exact core/CPU/address-space/file/process limits, sets `no_new_privs`, and installs a deliberately
   narrow seccomp filter. It denies `socket(2)`, child creation (`clone`, `clone3`, `fork`, and
   `vfork`), and session/process-group escape (`setsid` and `setpgid`) with `EPERM`. This is not a
   syscall allowlist and is not described as a general sandbox.
5. The child calls `execveat(memfd, "", fixedArgv, emptyEnvironment, AT_EMPTY_PATH)`. The fixed argv
   exactly represents the manifest's deterministic-fixture argument policy. A close-on-exec
   status pipe distinguishes successful exec from a pre-exec or exec error.
6. The fixed fixture proves its empty environment, memfd identity, working-directory marker,
   resource limits, `no_new_privs`, socket denial, child-creation denial, and session/group-escape
   denial before it announces readiness. The admitted manifest has `maximumChildProcesses: 0`.
7. The helper monitors the root through `pidfd`, signals the whole process group with `SIGTERM`,
   observes the fixture's fixed TERM-ignore behavior, escalates to `SIGKILL`, reaps the process,
   and requires the process group to disappear before returning evidence. Because child creation
   and group/session escape are denied for this fixed fixture, this is not evidence for general
   process-tree containment of arbitrary executables.

The existing composition plan/request remains an owner-bound, object-identity capability: it is
expiry-bound, validated, and consumed once before composition mints a fresh opaque handoff. A
per-composition consumer closure unwraps that handoff exactly once into a frozen request,
admission/evidence, plan hash, and numeric expiry. The injected, test-file-local
`NativeExecveatRuntimeProcessLauncher` cannot act on a structural or copied request. It derives the
addon invocation's executable path, root, digest, device, inode, owner, group, full safe mode, size,
and expiry from that consumed envelope and its preloaded fixture identity. The addon exports only a
one-shot `bind(consumer)` bootstrap. Composition construction binds a wrapper around its private
consumer and receives the only native launch function; the addon launch accepts one opaque handoff,
calls the bound consumer from native code, and only then parses the returned fixed tuple. It has no
public string launch API, rejects rebinding, and replay reaches the composition consumer's denial.
No environment variable carries launch authority. The N-API addon is loaded before admission and
invokes the compiled-in supervisor core, avoiding a per-launch pathname lookup for supervisor code.
The standalone helper executable is limited to negative operating-system mechanics tests.

## Adversarial evidence

Ubuntu tests must compile the sources/addon with warnings-as-errors and hardening flags, execute the
positive fixture through composition and the preloaded addon, and reject structural/copied/replayed/
expired handoffs, argv drift, symlink executable leaves, digest mismatch, owner-writable or mutated
source metadata, same-byte and FIFO path replacement, direct FIFO input, non-ELF input,
malformed-ELF exec failure, oversized input, expired native handoff, and symlinked working
directories.
The success record is emitted only after pidfd-observed exit and complete process-group cleanup.

Windows-runnable static contracts verify the exact syscalls, seals, metadata/digest rechecks,
empty environment, fixed argv, limits, narrowly stated seccomp rule, and cleanup sequence. They
also require test-source exclusion from the Docker context, package `dist`, and every final image.

## Production boundary and limitations

Production continues to construct only `DenyTrustedSupervisorAuthorizationSource` and
`DenyRuntimeProcessLauncher`. Nothing imports or exports the C helper, fixture, or TypeScript
harness. There is no controller, provider, credential, database, deployment, runtime status, or
real Codex/Hermes/Pi adapter path.

The native helper is Linux x86-64 test evidence, not production supervisor code. Its seccomp rule
is a narrow deny list; it does not provide a syscall allowlist, namespaces, cgroups, a read-only
filesystem, outbound network policy beyond the tested socket call, general process-tree
containment, crash recovery across helper death, Windows Job Objects, production executable
authorization/revocation, or authenticated transport composition.
Codex, Hermes, and Pi remain `NOT_CONFIGURED`.
