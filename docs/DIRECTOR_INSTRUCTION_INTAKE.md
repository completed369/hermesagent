# Director instruction intake

Continuation of PR 258, 11 September 2026.

An authenticated owner Slack instruction now creates one durable objective,
project, `business.research` task and prepared run through `AcpTaskRunService`.
The first delegation asks for a sourced opportunity assessment and a bounded
experiment recommendation. It does not choose a permanent market or claim to
have generated a commercial strategy.

The existing inbox retains the owner's text. Task and operational-event
projections contain a reference and digest, not that text. A future research
adapter must resolve the reference within the authenticated workspace, check
the digest, and treat the text as task data rather than authority.

Workspace and Slack event identity produce deterministic plan identifiers.
Replaying after a crash recovers the same plan through existing transactional
idempotency; changing the payload under the same identity conflicts. Owner
membership is checked again before intake. The research task requires Level 1,
the `business.research` capability and `research.readonly` tool. It grants no
publication, contact, purchase or account-changing permission. The task ceiling
is not a funding reservation. There is one attempt and no child-agent allowance.

The Slack reply distinguishes durable task creation from execution. Existing
pause, funding, entitlement, assignment, verification and runtime gates remain
in force. Research is not allowed to use the health-check bootstrap exception.
No model provider, research template, positive runtime launcher or payment route
is configured by this change. These are concrete remaining dependencies, not
evidence of an operating company.

## Validation

Focused tests cover plan validation, identity recovery, tenant separation,
payload drift, research authority and current owner membership. The existing
PostgreSQL task/run integration suite now verifies that a research instruction
creates one task/run, survives service reconstruction and rejects replay drift
and cross-workspace access. Run these alongside required protected CI.

## Next operational acceptance

Confirm the current host and deployed revision through authenticated operator
access. Provision the reviewed research template and one permitted metered
provider/tool adapter. Connect actual reservation, dispatch, output verification
and settlement, then prove owner instruction to verified result and reply.
Production activation remains subject to the existing release gates; staging
continues to use mock integrations. A queued task is not a runtime connection,
completed research, revenue or background operation.
