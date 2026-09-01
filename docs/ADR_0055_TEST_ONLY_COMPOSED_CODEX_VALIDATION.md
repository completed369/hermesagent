# ADR-0055: Test-only composed Codex validation process

Status: Accepted as deterministic test evidence

## Context

The bounded Codex stdio transport, validation protocol runner, and authenticated runtime adapter
were individually covered but had never executed as one path. That separation concealed a timeout
contract defect: the runtime adapter supplied its full authority remainder as an explicit runner
timeout, while the runner correctly rejects any explicit timeout above its stricter 15-second cap.
No production process or provider was needed to expose or repair that composition boundary.

## Decision

Compose the existing components in a test only against a deterministic Node child process:

- the child receives no inherited environment entries and speaks JSONL only on anonymous standard
  streams;
- it attests the exact ephemeral, read-only, no-network thread and turn restrictions before
  returning a dispatch-bound terminal token;
- the runtime adapter authenticates the parent `DISPATCH` before the first app-server byte is
  written;
- the bounded stdio transport carries the exact initialize, thread, turn, progress, and terminal
  exchange;
- only a successful terminal exchange permits signed `DISPATCH_ACCEPTED` and `RESULT` bridge
  frames; and
- a wrong secret lease contacts no child process, while reported tool activity produces no bridge
  output.

When the caller does not specify a timeout, the runtime adapter now leaves it unspecified for the
runner to apply its own stricter cap. An explicit caller timeout remains bounded by the authenticated
dispatch and bridge authority window.

## Consequences and limits

This proves the complete authenticated adapter/runner/stdio composition against a separate process
and protects the cross-component timeout contract. The process is a deterministic fixture, not the
Codex executable or an authenticated provider session. Its launcher remains in a test file, the
fixture is excluded from package output and images, and production retains deny-only secret, egress,
authorization, and process-launch sources. No credential is read, no network or provider call is
made, no durable state changes, and no runtime truth is promoted. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`.

## Next boundary

A real Codex exercise still requires a reviewed production process/stream owner, live executable
and trust-root provisioning, credential authority, stderr/backpressure and crash recovery policy,
and an explicit approval to contact the provider. Those boundaries are not granted here.
