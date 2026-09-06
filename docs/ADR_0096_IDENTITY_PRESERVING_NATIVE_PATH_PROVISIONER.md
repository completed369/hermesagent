# ADR-0096: Identity-preserving native path provisioner

Date: 2026-09-05

## Context

ADR-0093 loads retained-native modules only after an exact short-lived authorization binds a module
file and owner-only socket directory to their device/inode identities. ADRs 0094 and 0095 authenticate
and durably checkpoint that authorization, but no reviewed boundary can create the paths whose
identities must be signed. Selecting paths ambiently or overwriting an existing module would reopen
path-substitution and executable-authority gaps.

## Decision

Add an exported but uncomposed Linux-x64 path provisioner that:

1. accepts one exact request naming an already-built source `.node` file, new canonical client or
   listener path, an existing identity-bound socket directory, future `.sock` path, explicit owner UID/GID, and
   `runtimeConnection: 'NOT_CONFIGURED'`;
2. defaults its authority and filesystem host to denial, consumes one attempt, and requires an exact
   request-hash-bound grant lasting at most five minutes;
3. opens the source and both existing parents with `O_NOFOLLOW` and close-on-exec, verifies the
   source digest, size, owner, non-writable mode, and retained identity, and requires both parents to
   be owned by the effective process principal with exact mode `0700`;
4. creates only an absent fixed-kind module basename with `O_EXCL`, writes retained source bytes,
   syncs them, fixes mode to owner-only `0500`, and reuses only the exact retained owner-only socket
   directory created by ADR-0115/0116;
5. requires the future socket path to remain absent, reopens every canonical path to prove it still
   resolves to the retained parent/module/directory identities, and returns only frozen attestation
   fields suitable for a later authorization snapshot; and
6. clears copied module bytes and limits failure cleanup to the exact retained parents. It never
   overwrites a module or removes a pre-existing target.

Linux-x64 evidence compiles a disposable production client module outside package output and proves
successful owner-only provisioning, source-symlink denial, unsafe-parent denial, no-replace behavior,
and two distinct module provisions sharing one retained socket-directory identity.

## Security and runtime-truth boundary

- The provisioner chooses no path and reads no environment variable, credential, network endpoint,
  database, private key, or provider configuration.
- No native binary enters the repository package output or final images.
- The provisioner does not load code, create a Unix socket, start a process or service loop, publish
  or sign an authorization snapshot, or compose with the API or worker.
- No deployment, publication, provider activation, spending, DNS change, commercial commitment, or
  Level-4 action is performed.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The future authorization publisher can bind exact created module and directory identities without
an overwrite or path-discovery race. Positive composition still requires reviewed root/key custody,
snapshot publication, service ownership, authenticated runtime wiring, and a complete round trip.
Provisioning evidence alone is not runtime connectivity.
