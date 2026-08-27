# ADR-0032: Test-only authenticated supervised lifecycle transcript

Status: Proposed (source authored; Linux execution pending authoritative Ubuntu CI)

Date: 2026-08-27

## Context

The repository separately proves a composition-owned, one-use native launch handoff and an
I/O-free authenticated runtime-to-parent JSONL verifier. Neither proof demonstrates that the
fixed supervised ELF can receive short-lived key material without argv, environment, or path
authority and emit an authenticated lifecycle transcript that is verified only after process
cleanup. Production authorization, secret resolution, and launching must remain deny-only.

## Decision

Add one Linux x86-64 deterministic-fixture test that joins the existing boundaries without
exporting a positive runtime path:

1. A test-file-local launcher is created only through `TrustedSupervisorComposition`. The launcher
   consumes the composition's opaque, owner-bound handoff before it asks a secret resolver to do
   any work, then mints a separate launcher-private, one-use native token. The preloaded addon can
   consume only that token. Structural, copied, replayed, foreign, or expired handoffs therefore
   reach neither secret resolution nor native process creation.
2. After authority consumption, the launcher obtains a 32-byte synthetic test secret only through
   a scoped lease bound to the
   exact workspace, runtime, connection, digest, generation, and `AUTHENTICATE` purpose. The addon
   accepts the leased `Uint8Array` in memory, copies it once, and writes it to a close-on-exec
   anonymous pipe. It is never an argument, environment variable, filesystem path, log, or
   evidence field. The addon and fixture zero their owned secret/key buffers; JavaScript and C
   physical erasure are not claimed.
3. The fixed retained ELF receives the secret on inherited descriptor 3 with an empty environment,
   derives the existing runtime-to-parent HKDF key, and emits canonical authenticated frames. The
   success transcript is exactly `CAPABILITIES(1) -> HEARTBEAT(2) -> RESULT(3)`. The cancellation
   transcript is exactly `CAPABILITIES(1) -> HEARTBEAT(2) -> CANCELLED(3)` after the supervisor
   requests `SIGTERM`.
4. Native stdout capture is bounded to 8192 bytes and exactly three newline-terminated frames.
   Overflow, timeout, malformed termination, nonzero exit, missing pidfd evidence, or remaining
   process group denies the result and runs bounded cleanup. Native evidence is constructed only
   after the root process is reaped and the process group is absent, and binds the exact captured
   transcript digest.
5. The native evidence calls the final frame expected, not authenticated. Only inside the launch
   call, and only after cleanup evidence returns, does the launcher instantiate
   `AuthenticatedRuntimeJsonlSession`. It leases the same synthetic secret for the distinct
   `VERIFY_FRAME` purpose and authenticates the frozen transcript with one frozen context plus
   exact sequence, expiry, one-time capability phase, payload, and MAC checks. The launcher then
   correlates the three verified envelopes to the native mode and evidence and exposes only a
   sanitized, frozen combined completion record. Tampered, wrongly keyed, context-, nonce-,
   generation-, or expiry-drifted transcripts expose no completion record.

## Threat and boundary evidence

The Ubuntu test compiles the ELF and preloaded N-API addon with warnings as errors and hardening
flags. It covers success, parent cancellation, pre-secret opaque-handoff consumption, exact
inherited-handle manifest authority, bounded transcript capture, cleanup-before-verification,
authenticated ordering, transcript/evidence digest correlation, tamper denial, wrong-key denial,
context/nonce/generation/expiry drift, scoped lease purposes, and absence of completion evidence on
verification failure. Existing native tests retain symlink/FIFO, digest/metadata, expiry, argv
drift, memfd, working-directory, seccomp, pidfd, and cleanup adversarial coverage.

Windows-runnable contracts prove that the lifecycle sources remain under the ignored native test
tree, are absent from package exports and runtime output, and are rejected from final images. The
production Nest composition continues to instantiate `DenyBridgeSecretLeaseResolver`,
`DenyTrustedSupervisorAuthorizationSource`, and `DenyRuntimeProcessLauncher` only.

## Limitations

This is deterministic Linux test evidence, not a transport, production launcher, credential
backend, durable ACP writer, provider adapter, runtime status transition, general sandbox, or
deployment. The transcript is captured after the child has exited; it does not implement
interactive dispatch or a production cancellation channel. It does not set `PARTIAL` or
`CONNECTED`, and verified envelopes do not authorize durable state changes. Codex, Hermes, and Pi
remain **NOT_CONFIGURED**. Linux execution claims remain pending until the authoritative Ubuntu CI
job completes; the Windows authoring host can validate only TypeScript, static, formatting, and
package-exclusion contracts.
