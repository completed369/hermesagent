# ADR-0036: Codex app-server adapter policy

## Status

Accepted as an inert, deny-by-default adapter-selection boundary.

## Decision

Codex is the first reviewed real-runtime interface. Its initial command policy
is Linux-only and accepts exactly one inert supervisor-manifest candidate whose
executable basename is `codex`, with arguments:

```text
app-server --listen stdio://
```

The adapter kind is `CODEX_APP_SERVER_STDIO_V1` and the immutable argument
policy reference is `ventureos.codex-app-server.stdio.v1`. The existing
supervision flow must separately bind the candidate's canonical absolute path,
SHA-256 digest, opened-file identity, owner, mode, worktree, working directory,
resource limits, and exact argument hash to short-lived trusted evidence before
any launch could be considered.

This policy requires JSONL stdio, denies network access, forbids a shell and
ambient environment variables, allows no child processes, and passes no
secret handle to Codex. Alternate WebSocket or Unix-socket listeners,
`--code-mode-host`, `exec --json`, extra flags, wrappers, Windows executables,
and test-only manifests are rejected.

The selected protocol follows the current official OpenAI Codex app-server
documentation: stdio uses newline-delimited JSON, a client must complete one
`initialize` / `initialized` handshake before other methods, and thread/turn
operations and streamed events follow. This decision selects only the local
command boundary; protocol translation and event admission require later,
separately reviewed slices.

## Runtime truth and authorization

The returned value is frozen integrity/correlation evidence, not launch
authority. It exposes no process, transport, provider, registration, task, or
status operation. Production executable authorization and process launching
remain deny-only, provider access is `NOT_CONFIGURED`, and the current database
adapter allowlist is unchanged. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

No Codex process was started, no authentication state or credential was read,
and no provider or network was contacted for this decision.

## Next safe slice

Implement an I/O-free Codex JSON-RPC state machine that accepts only the
non-experimental initialize, thread, turn, interrupt, and bounded event shapes
needed by one VentureOS task. Keep process launch, provider access, durable
status promotion, and production secrets deny-only until the complete
authenticated registration-to-result round trip is independently retained.

## Source

- <https://learn.chatgpt.com/docs/app-server>
