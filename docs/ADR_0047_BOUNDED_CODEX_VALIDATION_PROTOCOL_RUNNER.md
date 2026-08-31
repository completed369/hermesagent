# ADR-0047: Bounded Codex validation protocol runner

## Status

Accepted as an uncomposed, deny-by-default protocol coordinator.

## Context

The Codex adapter already had separately reviewed dispatch preparation, one-shot egress authority,
an exact app-server state machine, bounded JSONL over already-open streams, and immutable admission
of signed status/result evidence. Those pieces did not yet enforce that a validation turn was
ephemeral and read-only, nor did terminal completion prove that Codex returned a value bound to the
exact dispatch. A generic completed turn could therefore be mislabeled as successful validation by
a future adapter composition.

The stable app-server protocol also streams progress before `turn/completed` and can issue
server-to-client approval requests. A validation coordinator must not treat either arbitrary
activity or an approval request as validation success.

## Decision

Add a bounded coordinator over an injected, already-open app-server transport. It validates the
exact zero-cost dispatch candidate, completes the initialize/thread/turn sequence, and forces both
the thread and turn to deny write and network authority:

- the thread is ephemeral, uses `read-only`, sets approval policy to `never`, and cannot persist a
  conversation;
- the turn repeats a read-only/no-network sandbox override and asks for no tools or side effects;
- the expected response is `ventureos-validation:<dispatchId>`, binding the terminal result to the
  exact authenticated dispatch rather than to a reusable constant;
- only correlated turn, safe text/reasoning item, and token-usage progress notifications are
  admitted; command, file, MCP, web, image, approval, unknown, or cross-thread/turn activity fails
  closed;
- the run is limited to 15 seconds, 128 progress messages, eight object levels, 1,024 values, 256
  array entries, 64 object fields, and the existing 64 KiB transport line bound; and
- terminal evidence is returned only for one completed turn containing exactly one agent message
  whose text exactly matches the dispatch-bound token.

The protocol session accepts both the previously reviewed minimal fixtures and the current stable
app-server additive response fields. Current responses are checked for the exact reviewed field
sets, an ephemeral empty thread, `never` approval policy, and a read-only/no-network sandbox.

## Runtime truth and authority

The coordinator cannot create streams, inspect or launch an executable, resolve credentials,
authenticate a Codex account, contact a provider, sign VentureOS bridge frames, write durable
evidence, or change task, run, connection, runtime, usage, artifact, or audit truth. The production
launcher, provider access, and stream composition remain deny-only. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`.

## Next safe slice

Bind this coordinator to the exact one-use supervisor/process authority and runtime-side bridge
signer, then pass its dispatch-bound terminal evidence into the existing immutable status/result
admission path. That composition must retain executable/schema identity, cleanup, cancellation,
secret, tenant, budget, and audit invariants and must not promote connected state until an exact
authenticated real-process round trip is independently verified.

## Sources

- <https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- <https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/typescript/v2>
