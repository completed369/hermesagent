# ADR-0024: OS supervision admission policy foundation

Status: Accepted (implemented and verified)

Date: 2026-08-26

## Context

The authenticated Agent Bridge, durable broker reservations, and scoped secret
leases still have no operating-system process boundary. Adding a child process
before defining an exact, cross-platform admission contract would permit PATH,
shell, executable-replacement, workspace-escape, and resource-limit ambiguity.

## Decision

Add a pure policy validator to `@ventureos/agent-bridge`. It parses exact
schema-versioned launch manifests and separately supplied trusted supervisor
admission evidence. That evidence must be issued from a reviewed executable and
adapter allowlist, not merely from a filesystem metadata reader. The validator
validates and canonically hashes:

- workspace, runtime, connection, adapter, platform, and test-only provenance;
- an absolute lexically canonical executable path, lowercase SHA-256, and stable identity
  reference;
- platform-specific ownership, mode, symlink, and reparse-point evidence;
- exact argv with bounded count, item size, aggregate size, sensitive-switch
  rejection, a trusted exact-argv hash, and a trusted argument-policy reference;
- component-aware lexical containment beneath an independently trusted
  worktree root;
- JSONL stdio intent, shell denial, network denial, and an empty environment
  variable list;
- bounded runtime, CPU, memory, input, output, and zero child processes; and
- short-lived canonical admission evidence sampled against the validator's own
  clock.

Windows paths reject bare/PATH resolution, lowercase drive ambiguity, forward
slashes, UNC and device paths, alternate data streams, traversal, reserved DOS
device names, 8.3 aliases, PATHEXT script types, reparse points, invalid
characters, and trailing-dot/space ambiguity. Linux paths reject relative or
noncanonical paths, traversal, sensitive pseudo-filesystem roots, symlinks,
non-regular files, and group/world-writable executable modes.
Known shells and general-purpose interpreters are denied in this schema version.

The output is an inert, deeply frozen admission record containing only the
normalized manifest/evidence and their hashes. It has no execute, launch,
transport, discovery, or mutation method.

## Trust and TOCTOU boundary

The evidence object is explicitly a trusted future composition-root input. It
binds the exact normalized manifest hash and identity/version, adapter,
executable identity, approved worktree root, exact dense argv hash, and
argument-policy reference. The
pure validator's path canonicality is lexical only: it cannot inspect a
filesystem, recover filesystem-native casing, or prove that a path still names
the same file. It does not close executable replacement or path-resolution TOCTOU.
A later trusted evidence issuer and supervisor must inspect and hash the same
opened executable identity it will launch, retain appropriate handle protections through creation, and then
apply platform cleanup and isolation. A caller-authored evidence object alone
must never authorize execution.

Windows still requires reviewed handle inheritance, Job Object cleanup, and a
race-safe executable-open/create design. Linux still requires reviewed
descriptor/identity verification, non-root execution, process-group or cgroup
cleanup, namespaces/container isolation, and resource enforcement.

## Test fixture and production denial

The only positive evidence producer is a deterministic test fixture below the
package test path and it is absent from package exports. Test-only evidence is
bound to the exact deterministic fake adapter. `DenyRuntimeProcessLauncher`
remains the sole production launcher implementation and always denies.

## Explicit non-capabilities

This foundation has no child process, shell, executable discovery, filesystem
or environment access, network, controller, API service, Prisma state,
credential or provider backend, runtime adapter, deployment, publication, or
status change. Codex, Hermes, and Pi remain `NOT_CONFIGURED`. Valid policy
output is not proof that a binary exists, is safe to launch, has launched, or is
connected.

## Test-only cancellation evidence

A subsequent bounded slice adds a pure lifecycle and exact-cancellation binding
plus a repository-owned deterministic process-tree harness. The process fixture
is outside package source and exports, is not copied into product images, and is
exercised on local Windows and the existing Linux CI path. It may only launch
the fixed Node fixture. This supplies narrow test evidence for tree cleanup and
escalation; it is not a production supervisor or proof of Job Object, cgroup,
namespace, no-breakaway, or launch-time identity enforcement.

## Next dependency

ADR-0027 adds a separately reviewed Linux trusted executable identity and test-authorization
reader that still cannot launch. ADR-0029 composes it behind a live per-admission authorization
port and issues only an in-process exact plan; production authorization and launching still deny,
and Windows remains unsupported. Actual process creation requires atomic identity
verification, isolation, cancellation, cleanup, and resource enforcement plus
the existing bridge, broker, task/run, approval, audit, and secret boundaries.
