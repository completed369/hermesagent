# ADR-0116: Shared retained-native socket-directory provenance

Date: 2026-09-06

## Context

The authenticated module snapshot requires exactly one CLIENT and one LISTENER authorization whose
socket path, socket directory, and directory identity agree. ADR-0096 nevertheless made each module
provisioning attempt create that same socket directory with fail-if-present semantics. The first
attempt could succeed, but the second necessarily failed. This made the otherwise valid two-module
authorization chain impossible to compose.

## Decision

Move ownership of the fixed `run/supervisor` directory into ADR-0115's one-attempt parent-directory
provisioner. It now creates and retains the exact `native`, `run`, and `run/supervisor` hierarchy,
requires owner UID/GID and mode `0700` throughout, rejects every pre-existing component, and returns
the socket directory's positive Linux device/inode identity with the existing tenant, supervisor,
request, and Level-3 approval provenance.

Require every later path request and grant to bind that exact socket-directory identity. The path
host opens it through the retained `run` descriptor with `O_NOFOLLOW`, verifies owner, mode, and
identity before writing, rechecks all retained identities afterward, and creates only its own
fixed-kind module with `O_EXCL`. It never creates, replaces, removes, or otherwise owns the shared
socket directory. Host-returned evidence must repeat the exact requested identity.

Linux-x64 evidence provisions separate CLIENT and LISTENER module paths against the same retained
socket-directory identity. Unit evidence rejects missing, zero, substituted, and host-drifted
directory identities.

## Security and runtime-truth boundary

- This preserves fail-if-present behavior for every created directory and module; it introduces no
  reuse based on path strings alone.
- Cleanup remains limited to objects created and identified by the current attempt. A module failure
  cannot remove the shared directory.
- The provisioners and positive Level-3 authorities remain absent from routes, Nest composition,
  workers, schedulers, CLIs, image commands, and deployment.
- No module is loaded, socket opened, service started, key/root provisioned, signer contacted,
  provider activated, deployment or publication performed, money spent, DNS changed, commercial
  commitment made, or Level-4 boundary crossed.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

The native provisioning chain can now produce the mutually consistent two-module evidence required
by snapshot issuance without weakening directory identity. An actual writable runtime root/shared
mount, positive composition call, signer/root custody, worker wiring, and complete authenticated
round trip remain unfinished.
