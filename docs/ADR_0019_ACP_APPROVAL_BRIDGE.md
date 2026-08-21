# ADR-0019: Governed ACP approval bridge

**Status:** Accepted

## Context

Agent Control Plane tasks need a durable way to prepare a Level-4 decision and
prove that a later execution attempt still refers to the exact work a founder
reviewed. AI COO cards and voice transcripts are untrusted intent surfaces; they
must not become authority. The existing product `ApprovalRequest` is correctly
coupled to venture proposals and cannot represent provider-neutral ACP task/run
work without weakening its invariants.

## Decision

Add three workspace-scoped ACP records: `AcpApprovalRequest`, immutable
`AcpApprovalDecision`, and single-use `AcpExecutionPermit`. A request binds the
workspace, objective, task, run, action code, exact target, artifact version,
evidence digest, and policy version/digest into one SHA-256 binding digest. The
request also records the requester authority level from the trusted principal
capability; Level 0 cannot create a request. The required approver authority is
fixed at Level 4.

Only a current, non-deleted workspace member who is both `isFounder=true` and
has `approval:decide` may approve, reject, or revoke. Approval reuses
`isApprovalValidForExecution` for artifact/evidence freshness and adds exact
target, task/run, and policy binding checks. Issuing and claiming a permit
requires a trusted server-created operational-event capability. That capability
is a composition-root boundary and must never be constructed from an AI COO
card, voice transcript, request body, or runtime payload.

Founder identity is derived from that trusted `CONTROL_PLANE` human capability
and its workspace context, never from a caller-supplied user ID. The decision
transaction runs at serializable isolation and locks the matching user,
membership, role, role-permission, and permission rows so authority remains
current through commit. Approval and permit state transitions also include
database-clock expiry predicates. Idempotent approval and claim replays must
revalidate the complete current binding; a prior success is not authority for
drifted work.

Request, decision, permit, state transition, and audit writes share database
transactions. Database triggers make bindings and decisions immutable, constrain
the state machine, and allow only one permit claim. Deletes remain possible for
governed tenant erasure and retention. Human erasure may clear the relational
approver ID while the non-secret approver reference and decision digest remain.

Claiming a permit only reserves/consumes authorization. It returns
`executed=false`; it does not dispatch a runtime, call a provider, publish,
deploy, or mutate an external target.

## Consequences

- Stale evidence, policy drift, target drift, workspace mismatch, expiry,
  revocation, principal mismatch, replay conflicts, and concurrent claims fail
  closed.
- Approval evidence and observable lifecycle facts are auditable without storing
  rationale, transcript, prompt, credentials, or private chain-of-thought.
- A future execution adapter must claim the permit immediately before its own
  separately governed action and must record the external result independently.
- SHA-256 digests detect accidental or application-layer mutation; they are not
  claimed to be an administrator-resistant or cryptographically anchored log.
