# ADR-0030: Authenticated post-authentication JSONL session

Status: Proposed (implementation under local review)

## Context

The durable Agent Bridge already defines canonical envelopes, directional authentication,
scoped secret leases, durable admission, and fail-closed production composition. It did not
yet have a single bounded component that could accept already-authenticated runtime-to-parent
JSONL bytes without accidentally turning a parser into a transport, runtime controller, or
durable source of truth.

## Decision

Add an I/O-free `AuthenticatedRuntimeJsonlSession` to `@ventureos/agent-bridge`. A future
trusted transport may hand it byte chunks only after authentication has established the exact
workspace, runtime, connection, session, principal, nonce, secret-reference, generation, and
expiry context. The driver:

- owns sequence state beginning at one, requires exactly one first `CAPABILITIES` frame, and
  accepts work/heartbeat frames only after that capability phase; repeated `CAPABILITIES`,
  `CHALLENGE`, and `AUTHENTICATE` are forbidden;
- bounds every ingest, incomplete line buffer, completed batch, session frame count, and total
  session bytes before copying; its `ingestedBytes` snapshot counter includes buffered,
  unauthenticated partial input and is not an accepted-evidence count;
- supports split and coalesced JSONL lines, but verifies every completed envelope in a batch
  before committing any of them;
- leases secret bytes only for the exact `VERIFY_FRAME` scope, derives the runtime-to-parent
  key in memory, requires local proof that the lease callback completed every verification,
  and zeros both derived directional key arrays on success or failure;
- uses a single observed time for a batch, exact canonical UTC timestamps, the established
  future-skew rule, frame expiry, and session expiry, then rechecks frame and session expiry
  after the lease resolver returns and immediately before committing;
- rejects concurrent ingestion, unsafe/deep/control/sensitive payloads, sequence drift, and all
  later input after any failure with fixed sanitized error codes; and
- returns deeply frozen verified envelopes. It does not persist, dispatch, execute, or infer a
  durable state transition.

The durable ACP service and database remain authoritative for whether a verified message is
allowed to change a task, run, dispatch, receipt, artifact, usage, or audit record. A frozen
envelope is authentication evidence for an in-process caller, not durable execution evidence.

## Security boundaries

The constructor accepts only an exact, bounded, immutable post-authentication context. The
positive secret source remains test-local. Production continues to provide
`DenyBridgeSecretLeaseResolver`; therefore this primitive cannot verify a real runtime in the
current composition.

The component has no stream, socket, filesystem, environment, process, controller, Prisma,
provider, or deployment dependency. JavaScript zeroization is best effort and cannot prove
physical erasure from engine or operating-system copies. Whole-batch atomicity applies to the
driver's in-memory acceptance state only; a future durable consumer must preserve its existing
transactional checks.

## Consequences and next dependency

This closes the pure post-authentication framing prerequisite without creating a runtime
connection. A later separately reviewed change must bind a real supervisor-owned handle to an
authenticated handshake, cancellation, cleanup, and durable ACP message admission. Real
process creation, transport, credentials, provider activation, deployment, and runtime status
changes remain absent. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.
