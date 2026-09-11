# Director instruction intake

Continuation of PR 258, 11 September 2026.

An authenticated owner Slack instruction now creates one durable objective,
project, `business.research` task and prepared run through `AcpTaskRunService`.
The first delegation asks for a sourced opportunity assessment and a bounded
experiment recommendation. It does not choose a permanent market or claim to
have generated a commercial strategy.

The existing inbox retains the owner's text. Task and operational-event
projections contain a reference and digest, not that text. The inbox now also
retains the founder, Slack team, user and app that authenticated the original
message. Before creating a plan, intake checks current founder membership,
compares that complete stored binding, reconstructs the accepted message and
checks its content digest. Accepted content and sender fields are immutable in
PostgreSQL; queue leases, attempts and replies can still change.

A future research adapter must perform the same workspace-scoped resolution
and integrity check again at handoff, bind the result to the actual task/run,
and treat the text as task data rather than authority. This change does not add
that adapter or a dispatch authorization.

Queue claims and cached replies are restricted to the currently configured
complete owner/Slack binding. Reconfiguring an owner or app does not transfer
pending instructions to the new binding. Founder membership is checked again
immediately before a reply is sent.

Migration `20260911100000_ceo_instruction_provenance` keeps older inbox rows
unattributed. It must not backfill them from current configuration, which is not
historical authentication evidence. Such rows remain available for review but
cannot be claimed or turned into research tasks by the new code. If any need
execution, the owner must submit a new authenticated instruction after upgrade.
Apply the additive migration before starting the new API. Older binaries can
still insert unattributed rows, so stop the old Slack consumer during the
upgrade; those rows also require a new instruction. No accepted record is
rewritten, and no provider or paid capability is activated by migration.

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
payload and sender drift, legacy attribution, research authority and current
owner membership. PostgreSQL tests also reject mutations of the accepted
payload/identity while allowing queue recovery and rejecting partial sender
records. The existing
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

## Observed operations — 11 September 2026

PR 258 merged at `e1072e9ced053c93d6f4f96dde7a8c70d0c85655` after its CI and image
security checks passed. The later provenance continuation is a separate change.

[Private staging VPS connectivity run 34573549908](https://github.com/completed369/hermesagent/actions/runs/34573549908)
succeeded on source `585c91f005979c692d16060d05536165a7a110f2`. Its authenticated
SSH job reported healthy staging web, API, worker, Temporal and PostgreSQL
containers. It only queried identity, hostname and container status. It did not
read deployed image revisions or prove that current-main director code is
running. No deployment, provider activation, spending or revenue is evidenced
by that connectivity check.
