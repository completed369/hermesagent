# ADR-0079: Linux retained-pidfd recovery authority evidence

Date: 2026-09-02

## Context

ADR-0078 defines the bounded authenticated recovery peer and its native-authority port, but its tests
previously used an in-memory observation. The next boundary needs executable evidence that a Linux
authority can own a pidfd from launch, retain it across the later fresh recovery challenge, re-read
that same kernel identity, observe exit, and complete process-group cleanup without accepting or
returning a process locator.

## Decision

Add a Linux-x64-only native test fixture and adversarial integration test:

- the native fixture creates the process group, opens and retains the leader pidfd at launch, and
  stores the supervision and launch binding in native state;
- its later observation entry point accepts only the challenge/request binding, never a PID, pidfd,
  path, handle, or signal target;
- it rejects a substituted binding without consuming the retained launch, polls the retained pidfd
  after the fresh challenge, corroborates the leader's exit time through an inherited private pipe,
  reaps the leader, terminates and reaps the retained process group, and requires `ESRCH` before
  returning;
- the fixture is one-shot, closes the pidfd and private pipe before returning, and rejects replay;
- a test-only TypeScript authority maps only timestamps and normalized exit/cleanup facts into the
  ADR-0078 contract; and
- the existing peer validates that observation and signs the existing ADR-0077 response. The test
  verifies the signature and unchanged `NOT_CONFIGURED` truth.

The fixture and authority live only in test files, are excluded from package output, and are asserted
absent from the runtime export surface.

## Security and truth boundary

- This is executable Linux CI evidence, not a production native supervisor, IPC service, or reusable
  production authority.
- No caller-selected native locator crosses the authority port. Native PID and pidfd values remain
  inside the fixture that created them.
- The fixture performs no network access, secret resolution, provider access, deployment,
  publication, spend, or runtime-state transition.
- Signing identity provisioning, rotation, revocation, anti-rollback, secure custody, authenticated
  local IPC, worker scheduling, and API composition remain unfinished.
- A signed recovery response is still only recovery evidence. Codex, Hermes, and Pi remain
  `NOT_CONFIGURED`.

## Consequences

The retained-identity premise now has a real Linux kernel exercise rather than only a mock authority.
The next safe slice can define authenticated local IPC and durable trust/key lifecycle boundaries, or
compose the existing recovery worker only after those identities are provisioned without weakening
the deny-default runtime truth.
