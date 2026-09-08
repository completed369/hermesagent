# ADR-0171: Bounded Workflow Centre telemetry projection

Status: Accepted

## Decision

VentureOS exposes `GET /api/workflow-centre/telemetry` as an authenticated Server-Sent Events
projection of already-persisted operational audit events. The route requires `workflow:view`,
derives its workspace only from the database-backed session, and accepts no workspace selector.

The projection selects only operational sources (`CONTROL_PLANE`, `AI_COO`, and `AGENT_FACTORY`)
and emits an allowlisted envelope: source, event type, subject type/reference, correlation reference,
and event/record timestamps. It never reads or emits event facts, before/after payloads, actors,
policy results, approval references, costs, usage, credentials, artifacts, transcripts, prompts,
private reasoning, or workflow inputs/outputs/errors.

Each authenticated client is limited to five stream initiations per minute by the global throttler.
Each connection replays at most the latest 25 events within ten minutes, fetches no more than 25
rows per poll, emits at most 100 operational events, and closes after 60 seconds. Native
`Last-Event-ID` reconnect cursors are strictly parsed and replay remains clamped to the same
ten-minute window. Rows are ordered by database creation time and audit UUID so equal-timestamp
events are deterministic. The client reconnects to reauthenticate and continue.

The stream emits `transport.keepalive` frames solely to keep intermediaries from buffering or
closing an idle SSE response. Every keepalive states `SSE_TRANSPORT_ONLY` and
`connectivity: NOT_CONFIGURED`. It is not an ACP runtime heartbeat and cannot contribute evidence
for Codex, Hermes, Pi, or any runtime connection status.

## Security properties

- session authentication and `workflow:view` authorization run before stream creation;
- every database query is workspace-scoped and source-allowlisted;
- there is no request body, write path, runtime adapter, execution control, approval capability, or
  provider connection;
- fixed replay, batch, event-count, age, polling, and lifetime bounds limit resource use;
- malformed cursors fail before the Observable opens;
- sensitive event facts are excluded at the Prisma select boundary, not merely removed afterward;
- response buffering is disabled and cache transformation is prohibited.

## Consequences

The Workflow Centre now has a provider-neutral live-update contract based on authenticated durable
truth. Its browser client opens the credentialed stream, ignores individual initial-replay events,
and refreshes the authoritative server snapshot once after the first transport keepalive. Later
operational-event notifications trigger a debounced snapshot refresh; the client never parses event
payload data or turns a notification into an action. The visible connection label refers only to
persisted event notifications and repeats that runtime connectivity is `NOT_CONFIGURED`. This
closes the stored-event SSE projection deferred by ADR-0013, but it does not activate a runtime or
satisfy authenticated runtime round-trip evidence.
