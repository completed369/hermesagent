# ADR-0076: Bounded Codex recovery worker page

Date: 2026-09-02

## Context

ADR-0075 makes one recovery lease claim and execution atomic, but a future internal worker would
still need broad orchestration code to connect the owner-scoped recovery inventory to that operation.
An unbounded loop, concurrent page execution, caller-selected recovery metadata, or a worker that
claims leases while its evidence source is still deny-only would weaken the recovery boundary.

## Decision

Add one internal Level-3 operation that reads exactly one validated inventory page and processes its
items sequentially. Database-classified active claims are skipped without mutation. For each expired
claim, an injected attempt-identity source must issue an exact claim-bound lease identifier plus
separate lease and completion idempotency keys. Only then may the worker invoke the atomic recovery
operation.

Both the attempt-identity and retained-native-identity evidence sources deny by default. The worker
rejects those defaults before reading inventory or claiming a lease, so an incomplete composition is
inert. Identity candidates reject extra fields, claim drift, unsafe references, and reused identifiers.
The frozen result contains only bounded correlation and replay summaries from that page.

## Security and truth boundary

- The worker requires an already-issued Level-3 control-plane capability and owner-scoped inventory.
- It reads at most the existing 1–100 item bound and has no timer, daemon, retry, or recursive paging.
- Items execute sequentially; the worker introduces no parallel lease or process activity.
- Active claims never reach identity issuance or lease acquisition.
- The caller cannot supply a work item, dispatch, generation, process locator, or native handle.
- The operation adds no process lookup, signal, termination, launch, stream, secret, provider,
  deployment, spend, or runtime-state transition.
- Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Consequences

A future explicitly configured internal scheduler can run one bounded recovery page without broad
database access or caller-assembled executable metadata. A positive OS-specific retained-identity
source, native cleanup action, scheduling trigger, and authenticated real-runtime traffic remain
separate reviewed work.
