# ADR-0103: Authenticated local native-module signing transport

Date: 2026-09-06

## Context

ADR-0101 defines a bounded keyless snapshot signer but intentionally leaves its transport
unconfigured. The repository already has an independently hardened Linux local IPC client that
owns one `lstat(2)` / `connect(2)` / `SO_PEERCRED` / write-shutdown / bounded-read / `lstat(2)` /
close sequence. A signing adapter is required to bind the keyless protocol to that authenticated
channel without introducing key custody or a second socket implementation.

## Decision

Add an exported but uncomposed Linux signing transport that:

1. accepts one exact constructor-bound local IPC authorization with `NOT_CONFIGURED` runtime truth;
2. sends one keyless signing request of at most 32 KiB to the exact authorized Unix-socket path;
3. requires exact before-and-after device, inode, owner, group, mode, and path evidence plus exact
   `SO_PEERCRED` PID, UID, and GID evidence;
4. returns a defensive copy of only a 2-byte to 1-KiB response for ADR-0101's canonical response
   authentication; and
5. consumes every attempted exchange, redacts unexpected client failures, and requires the outer
   signer to close the adapter before any signature can escape. The local IPC ownership port is now
   explicitly closable so cancellation can actively close a still-pending native connection rather
   than relying on the pending operation to cooperate.

The transport reuses the existing local IPC client port. Production composition must use the
bounded native client and its reviewed native module so endpoint and peer evidence derive from the
kernel rather than caller metadata.

## Security and runtime-truth boundary

- The adapter imports no private key, crypto signer, filesystem, socket, process, environment,
  provider, or secret-resolution capability.
- It cannot discover or select a socket, retry, multiplex, create a listener, start a signer
  service, or promote runtime state.
- Exact inert records reject accessors, symbols, custom prototypes, extra fields, unsafe paths,
  endpoint replacement, peer drift, malformed bytes, cancellation, concurrency, and replay.
- It remains absent from API and worker composition roots. This change provides no native binary,
  signer service, key, socket, public-root provisioning, deployment, publication, spend, DNS,
  legal commitment, or Level-4 action.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

The keyless signer can now use the repository's existing OS-authenticated local channel without
duplicating native transport logic or moving private keys into the control plane. A reviewed signer
service/native module, key custody, root-to-authenticator composition, service ownership, and an
authenticated end-to-end runtime round trip remain required before any connection claim.
