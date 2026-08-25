# ADR-0021: Durable protocol-neutral Agent Bridge admission foundation

Status: Proposed (implementation under review)

Date: 2026-08-25

## Context

The Runtime Broker and durable task/run spine provide governed decisions and
work records, but their runtime lifecycle evidence is not yet joined by a
durable authenticated boundary. Starting a real child process at this point
would create a split-brain execution path and could incorrectly imply that
Codex, Hermes, or Pi is connected.

## Decision

Add a bounded, service-only admission foundation:

- `@ventureos/agent-bridge` defines exact canonical JSON Lines envelopes,
  protocol state machines, HKDF-SHA256 directional key derivation, HMAC-SHA256
  message authentication, canonical UTC timestamps with a five-minute maximum
  lifetime, sensitive-text rejection, pre-allocation bounded buffering, usage
  policy, and a production launcher that always denies.
- Secret bytes are supplied only through an injected server-side resolver.
  The database stores a secret reference and digests; it never stores the
  secret, derived keys, raw MACs, protocol payloads, prompts, transcripts, or
  private reasoning.
- Workspace-scoped runtime, connection, session, normalized receipt, dispatch,
  and usage records create a durable replay boundary. Composite foreign keys,
  unique sequence/message/evidence keys, state constraints, immutable receipts,
  correlation triggers, dispatch-row serialization, and monotonic usage checks
  enforce core invariants.
- A trusted CONTROL_PLANE composition-root capability is required for every
  service operation. Runtime payloads cannot mint source, principal, workspace,
  broker, assignment, or artifact authority.
- Capability exchange is checked by a server-owned verifier. Dispatch
  preparation requires re-read trusted broker evidence, a fresh PARTIAL
  session heartbeat, a ready durable run, and authority level 0–3. Level 4 is
  rejected; claimed approval permits are not consumed by this slice.
- Accepted dispatch receipts implement trusted assignment evidence by re-reading
  exact durable rows. Artifact evidence additionally requires an injected
  server-owned verifier to re-read the artifact bytes and verify their content
  hash both at admission and later use; a runtime-authored receipt is never
  sufficient. Receipt, domain mutation, usage, and audit evidence share database
  transactions.
- A deterministic fake runtime exists only below the test fixture path and is
  absent from package exports. Service admission requires both a `TEST_ONLY`
  connection and an injected test-harness gate that fails closed in the
  production composition root. Its evidence is synthetic test evidence, not a
  runtime connection claim.

The connection state deliberately stops at `PARTIAL`. `CONNECTED` is not an
allowed database state in this increment. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`.

## Authentication and replay boundary

The server provisions a scoped runtime principal and secret reference, creates
a short-lived challenge, and binds key derivation to protocol version,
workspace, runtime, connection, session, principal, and both nonces. Parent and
runtime traffic use different derived keys. Every frame binds a positive
monotonic sequence, unique message ID, issue/expiry times, canonical payload
digest, and authenticator. The service locks the session row before sampling
the database clock or advancing the expected sequence. A failed validation or
audit write rolls the whole transaction back.

Checksums and HMAC evidence are not described as administrator-resistant
tamper-proofing. Database administrators and the configured secret store remain
trusted system boundaries.

## Process and operating-system boundary

This increment contains no child-process, shell, network, controller, provider,
or transport implementation. A later separately reviewed launcher must at
minimum use an exact allowlisted executable identity and hash, never invoke a
shell, pass session secrets through a dedicated inherited handle rather than
arguments/environment, limit stdout/stderr and lifetime, isolate the worktree,
deny network by default, and provide deterministic cancellation.

Windows review must cover PATH/PATHEXT ambiguity, `.cmd`/`.bat`, UNC/device
paths, junctions/reparse points, inheritable handles, and Job Object cleanup.
Linux review must cover realpath/symlink resolution, non-root identity,
namespaces/container boundary, process groups, resource limits, and cgroup
cleanup. None of those future requirements is claimed implemented here.

## Explicit non-capabilities

This foundation does not start a process, send a frame, expose an ingestion
endpoint, execute a runtime task, connect a provider, consume a Level-4 permit,
change a real runtime's status, deploy, publish, activate a provider, spend
money, or alter DNS/Cloudflare.

## Consequences and next dependency

The next safe increment can add a reviewed local transport supervisor around
the deterministic fixture, then one opt-in runtime adapter at a time. A real
runtime status may change only after retained authenticated registration,
filtered capability exchange, fresh heartbeat, task/status exchange, and
event/result round-trip evidence passes independent review.
