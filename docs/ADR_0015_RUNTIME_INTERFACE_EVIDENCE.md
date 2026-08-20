# ADR-0015: Runtime interface evidence for Codex, Hermes, and Pi

- **Status:** Accepted as interface-selection evidence; connections remain unverified
- **Date:** 2026-08-21
- **Evidence baseline:** `completed369/hermesagent` `main` at
  `9c2bc086b28599adf1ac31dc72826c9c0370a9d4`
- **Refines:** ADR-0013 and ADR-0014 without rewriting their historical evidence

## Decision

VentureOS will place a small authenticated bridge around each runtime's most
structured local interface:

- **Codex:** `codex app-server` over stdio is preferred. `codex exec --json` is
  the bounded non-interactive fallback. The Codex SDK and MCP server remain
  optional surfaces.
- **Hermes:** `hermes acp` over stdio is preferred. Hermes MCP may support
  conversation interoperability, but is not the primary task-control transport.
- **Pi:** `pi --mode rpc` over JSON Lines is preferred, running only inside the
  existing pinned, non-root, disposable engineering container. The SDK is an
  alternative only inside a similarly isolated worker.

The bridge owns VentureOS runtime identity, authentication, replay protection,
capability filtering, task permits, event normalization, cancellation, and
audit persistence. Local stdio does not prove an authenticated VentureOS
connection.

No runtime is connected by this ADR. Codex, Hermes, and Pi remain
`NOT_CONFIGURED` until the acceptance evidence below is retained.

## Evidence labels

- **CONFIRMED:** directly observed in current repository state, installed
  software, installed primary documentation, or current official documentation.
- **INFERENCE:** a recommended design derived from confirmed evidence but not
  yet exercised end to end.
- **NOT EVIDENCED:** not observed, not tested, or deliberately not inspected.

## Current evidence matrix

| Runtime | Current interface evidence                                                                                     | Local evidence                                                                                                                                                                                               | Connection status |
| ------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Codex   | **CONFIRMED:** official app-server, non-interactive JSONL, TypeScript SDK, and MCP server documentation        | **CONFIRMED:** the Codex desktop binary exists. **NOT EVIDENCED:** executable version, authenticated session, heartbeat, or task/result round trip; WindowsApps access blocked local CLI inspection          | `NOT_CONFIGURED`  |
| Hermes  | **CONFIRMED:** ACP stdio, MCP server, one-shot CLI, chat/session CLI, and localhost JSON-RPC/WebSocket backend | **CONFIRMED:** Hermes Agent `0.18.2` (`2026.7.7.2`); `hermes acp --check` passed. Installed source is dirty and diverged, so it is supporting—not release-authoritative—evidence                             | `NOT_CONFIGURED`  |
| Pi      | **CONFIRMED:** RPC JSONL, JSON event stream, and TypeScript SDK in installed package documentation             | **CONFIRMED:** host package `@earendil-works/pi-coding-agent` `0.84.2` exists; the product harness pins `0.84.1`. **NOT EVIDENCED:** successful local CLI invocation or authenticated task/result round trip | `NOT_CONFIGURED`  |

## Codex

### Confirmed surfaces

The official Codex app-server protocol uses a bidirectional JSON-RPC-like
protocol. Stdio JSONL is the stable default transport. A client initializes the
connection, starts or resumes a thread, starts a turn, consumes streamed item
and tool events, and receives turn completion. It also exposes adapter control
operations.

`codex exec --json` emits JSONL lifecycle, item, error, and usage events for a
simpler bounded worker. The TypeScript SDK can start and resume local threads.
`codex mcp-server` exposes Codex and reply tools to an MCP client.

The local Codex desktop binary exists under the installed WindowsApps package.
Windows application permissions prevented direct version/help execution in
this environment. Binary presence is not runtime readiness.

### Minimal adapter and credentials

Use a child-process adapter for app-server stdio. Translate only allowlisted
VentureOS task envelopes into thread/turn operations, normalize streamed events,
and map cancellation explicitly. Do not use the experimental WebSocket
transport as the initial production path.

The child process needs approved Codex authentication, such as an existing
local login or scoped API key supplied through the approved secret-reference
mechanism. Never copy, log, or persist local auth files. The bridge also needs a
separate scoped VentureOS runtime credential; provider authentication is not
VentureOS runtime authentication.

## Hermes

### Confirmed surfaces

The installed Hermes CLI reports:

```text
Hermes Agent v0.18.2 (2026.7.7.2)
Python 3.11.15
OpenAI SDK 2.24.0
```

`hermes acp --check` passed. CLI and installed-source evidence show that ACP
reserves stdout for structured protocol messages and supports session/event and
permission flows. `hermes mcp serve` exposes conversation operations through
MCP. `hermes serve` provides a localhost JSON-RPC/WebSocket backend by default,
with authentication required for non-loopback binding.

One-shot mode is rejected as the primary adapter because its documented
behavior automatically bypasses interactive approvals. It may only be
considered for pre-approved, sandboxed, non-consequential jobs whose VentureOS
permit fully defines the allowed work.

The inspected source checkout was at
`7b5ba2054721dde998ed47fd4a0f031955278e99`, with local modifications and remote
divergence. It is not a clean or current upstream release.

### Minimal adapter and credentials

Launch `hermes acp` as a dedicated child process and terminate it with the run.
The bridge supplies identity and authentication, validates capabilities, maps
permission requests into the approval engine, filters events, and owns
cancellation/timeouts. Do not expose the localhost backend to a network until
its separate authentication and threat model are approved.

Hermes needs an approved model-provider credential or existing provider
session. Those values were not inspected. Use secret references only. ACP stdio
still needs a separate VentureOS bridge credential and one-time task permit.

## Pi

### Confirmed surfaces

Installed Pi documentation defines:

- `pi --mode rpc`: JSONL commands, correlated responses, and events over
  stdin/stdout, including prompt, steer/follow-up, abort, state, messages,
  sessions, usage, and cost;
- `pi --mode json`: a JSONL session/event stream;
- the TypeScript SDK: in-process `AgentSession` control.

The host has `@earendil-works/pi-coding-agent` `0.84.2` installed, but Pi is not
on the current process `PATH`, and direct launcher/module probes produced no
help or version output before being stopped. The VentureOS harness intentionally
pins `0.84.1`; the host installation must not replace that reviewed pin without
normal dependency review and evaluation.

Pi documentation states that Pi has no built-in sandbox or approval popup. Its
RPC protocol also includes a direct shell command. VentureOS must never map that
command through telemetry or expose it as a general remote tool.

### Minimal adapter and credentials

Run the pinned package through `tools/pi` in a disposable non-root container,
start RPC mode locally, and map only allowlisted `RuntimeTaskEnvelope` kinds.
Use an isolated session directory or no-session mode. Deny network access by
default and mount only the permitted worktree and secret references. The bridge
owns all policy and approval decisions.

Provide only a scoped provider credential required for the approved task. Do
not mount or inspect the host Pi authentication store. Issue a separate scoped
VentureOS runtime credential and single-use task permit to the bridge.

## Evidence required before `CONNECTED`

For each runtime, retain one correlated acceptance record proving:

1. A unique `runtimeId`, `runtimeConnectionId`, workspace, environment, and
   service principal are registered.
2. Registration is authenticated through a secret reference or workload
   identity; no plaintext secret is persisted in events or artifacts.
3. A nonce/timestamp or equivalent replay defense rejects a replayed
   registration or task request.
4. The adapter exchanges capabilities, which VentureOS filters against the
   connection grants.
5. A sequenced heartbeat is accepted, freshness is measured, and a stale or
   duplicate heartbeat is rejected.
6. VentureOS issues one allowlisted task using a validated, single-use permit
   scoped to the same runtime, workspace, objective, and task.
7. Correlated start/progress/status evidence and a matching result or artifact
   are received.
8. Usage and cost metadata are recorded when available; absence is explicit,
   never synthesized.
9. Cancellation is exercised and produces a terminal auditable state without
   accepting later spoofed progress or completion.
10. The registration-to-result event chain is persisted without prompts,
    credentials, private reasoning, or unrestricted command payloads.

Process startup, a health check, ACP initialization, MCP tool listing, or CLI
help is insufficient. Partial evidence may justify `PARTIAL`, never
`CONNECTED`.

## Runtime-specific round-trip mapping

| Runtime          | Capability exchange                                             | Task/status/result                                                     | Cancellation                                      | Authentication boundary                                          |
| ---------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Codex app-server | initialize and supported method/capability discovery            | thread/turn start, streamed item events, terminal turn event           | correlated app-server interrupt/control operation | approved Codex auth plus VentureOS bridge identity and permit    |
| Hermes ACP       | ACP initialization and advertised capabilities                  | session prompt/task, ACP events, terminal result                       | correlated ACP cancellation                       | approved provider auth plus VentureOS bridge identity and permit |
| Pi RPC           | bridge allowlist validated against supported RPC commands/tools | prompt response, agent/tool/message events, final idle/result evidence | correlated RPC `abort`                            | approved provider auth plus VentureOS bridge identity and permit |

## Rejected initial approaches

- Marking a runtime connected because its executable or repository exists.
- Treating local stdio as authenticated registration.
- Using Codex experimental WebSocket transport as the first adapter.
- Using Hermes one-shot mode as a general autonomous adapter.
- Exposing Hermes localhost service or Pi RPC directly to a network.
- Reusing host Pi `0.84.2` in place of the pinned `0.84.1` harness.
- Forwarding arbitrary commands, raw prompts, environment dumps, auth files, or
  private reasoning through runtime telemetry.

## Next safe implementation slice

1. Implement protocol-neutral child-process lifecycle and bounded JSONL framing
   behind the existing `RuntimeAdapter` contract.
2. Add replay, stale-heartbeat, task-permit, cancellation, payload-bound, and
   cross-workspace rejection tests before any provider-backed run.
3. Implement one adapter at a time, beginning with a deterministic fake-process
   fixture, then an opt-in local smoke test that reads credentials only through
   secret references.
4. Retain the first real registration/capability/heartbeat/task/result evidence
   as a protected artifact and update status only after independent review.

## Sources

### Official Codex documentation

- <https://learn.chatgpt.com/docs/app-server>
- <https://learn.chatgpt.com/docs/non-interactive-mode>
- <https://learn.chatgpt.com/docs/codex-sdk>
- <https://learn.chatgpt.com/docs/mcp-server>

### Repository and installed primary documentation

- `docs/ADR_0013_AGENT_CONTROL_PLANE_FOUNDATION.md`
- `docs/ADR_0014_RUNTIME_BROKER_FOUNDATION.md`
- `docs/ADR_0004_MEMORY_AND_PI_ENGINEERING.md`
- `tools/pi/README.md`
- installed `@earendil-works/pi-coding-agent` `0.84.2` documentation:
  `docs/rpc.md`, `docs/json.md`, `docs/sdk.md`, and `docs/usage.md`
- installed Hermes CLI `0.18.2` and local command help/source at commit
  `7b5ba2054721dde998ed47fd4a0f031955278e99`

No provider credentials, auth-file contents, customer data, or private runtime
transcripts were inspected while collecting this evidence.
