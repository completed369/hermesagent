# ADR-0028: Workflow Centre read model

Status: Accepted

## Decision

VentureOS exposes one authenticated, read-only `GET /api/workflow-centre`
snapshot and renders it at `/dashboard/workflows`. Both surfaces require the
existing `workflow:view` permission. The API derives the workspace exclusively
from the authenticated session; it accepts no workspace selector from the route,
query, or request body.

The service reads one bounded snapshot under a PostgreSQL `REPEATABLE READ`
transaction. It returns deterministic, explicitly selected metadata from the
legacy workflow tables and the durable Agent Control Plane objective, task,
dependency, run, runtime, connection, and pending Level-4 approval tables. Every
collection has a fixed server-side limit and order, and the response reports
truncation rather than silently implying completeness.

Pending Founder summaries include only durable Level-4 requests whose expiry is
later than the database clock sampled inside that same transaction. Lower-level
requests are rejected by the durable schema and are not elevated by this view.

The DTO is an allowlist. It includes identifiers, display-safe titles, persisted
states, dependency edges, timestamps, and non-authoritative pending-decision
summaries. It excludes workflow inputs and outputs, errors, task criteria,
approval targets, policy and evidence hashes, requester or approver references,
secret references and digests, artifact URIs, transcripts, and cost or budget
amounts. The page offers no approval, assignment, cancellation, retry, or other
execution control.

Codex, Hermes, and Pi are reported as `NOT_CONFIGURED` by a static product-status
boundary. Persisted internal runtime and connection rows are shown separately
with their stored status and are never promoted to direct-runtime connectivity
evidence. A real direct-runtime connection still requires authenticated
registration, capability exchange, heartbeat, task/status exchange, and an
event/result round trip.
Even if a future persisted internal record carries the literal `CONNECTED`
status, the dashboard renders it as unverified rather than as a green direct-
runtime connection.

## Security properties

- session authentication runs before permission evaluation;
- the request cannot override the session workspace;
- every query, including counts used for truncation, is workspace-scoped;
- a repeatable-read transaction prevents collections in one response from
  describing different committed snapshots;
- response construction uses allowlisted scalar fields and JSON-safe numbers;
- titles and identifiers are treated as untrusted text and rely on React's
  escaped rendering;
- Level-4 rows are informational summaries only and carry no execution permit,
  authority, target, evidence, or policy material;
- the controller and page have no write method, command handler, stream, runtime
  adapter, provider, process, or deployment path.

## Limitations

This is a bounded polling snapshot, not live telemetry. Truncated collections
require a later paginated design. Persisted `PARTIAL`, `DEGRADED`, or other
internal runtime states do not prove a direct Codex, Hermes, or Pi connection.
The read model does not verify or execute work and does not replace the protected
Founder Mission Control operational source of truth. Merged repository source is
also not publication or deployment evidence.
