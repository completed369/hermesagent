# ADR-0027: Trusted executable evidence reader

Status: Proposed (implementation under review)

Date: 2026-08-27

## Context

ADR-0024 deliberately accepts trusted admission evidence but does not read a filesystem. The next
runtime dependency is a reviewed evidence issuer that binds an exact executable allowlist to
metadata and bytes observed from the same opened file without adding process authority.

## Decision

Add a Linux-only executable evidence reader to `@ventureos/agent-bridge`. It:

- verifies an exact, versioned, short-lived, signed authorization for one adapter at construction
  and again immediately before any filesystem access;
- validates and canonically hashes the launch manifest before filesystem access;
- opens the exact absolute path read-only with `O_NOFOLLOW`;
- requires the resolved path to remain the exact canonical path;
- requires a non-empty bounded regular file with an executable, non-writable, non-privileged mode;
- binds owner UID/GID, mode, device/inode identity, and SHA-256 to both the authorization and
  manifest;
- hashes through the same opened file descriptor used for identity inspection; and
- emits short-lived admission evidence bound to the exact manifest and argv hashes.

The only pinned signer in this slice is explicitly test-only. It cannot authorize a production
adapter, and its private fixture key is excluded from production output. A real signer and reviewed
authorization registry require a later security review. Authorization identity, version, signer,
and canonical hash are bound into admission evidence, and evidence expiry cannot exceed the
authorization expiry. Package and final-image gates reject test fixtures or private test signing
material from deployable runtime output.

Unknown adapters, unsigned/tampered/expired authorizations, pre-open path replacement, symlinks,
FIFO/device replacement, unsafe modes, oversized files, identity drift, and digest drift fail
closed with fixed errors. The reader rechecks descriptor metadata and current path identity after
hashing to reject changes observed during issuance. Evidence contains no file content, arguments,
credentials, environment values, or private runtime payloads.

## Platform and TOCTOU boundary

Windows is explicitly unsupported by this reader. A later Windows implementation requires native
owner and reparse-point inspection plus retained-handle process creation semantics.

The Linux reader proves what was observed through one opened descriptor and that the current path
still named that identity at its final issuance check. It does not launch that descriptor and
cannot prevent a path or file from changing after the final check or evidence issuance. A future
supervisor must retain or atomically revalidate the same native identity through process creation,
apply non-root isolation and resource limits, and guarantee process-tree cleanup. Short evidence
lifetime is defense in depth, not a TOCTOU solution.

## Explicit non-capabilities

The reader has no child-process, shell, network, controller, database, secret source, production
authorization signer, runtime adapter, provider, deployment, publication, or status mutation.
`DenyRuntimeProcessLauncher` remains the only production launcher. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`.

## Next dependency

Compose this reader with the pure admission and lifecycle policies behind a production launcher
that still denies, then add bounded deterministic-fixture JSONL transport. Actual runtime process
creation requires a separately reviewed native supervisor and complete authenticated round-trip
evidence.
