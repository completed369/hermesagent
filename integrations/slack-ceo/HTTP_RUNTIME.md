# CEO command service activation

This implementation adds a persistent founder command inbox to the existing API.
It is **not an autonomous business director**: natural-language objectives are
stored but not planned or dispatched, and payment/delivery/finance reporting is
explicitly unreconciled. The governed runtime adapters retain their existing
deny-by-default authorization. A deployed instance and a real founder round trip
remain unverified.

## Transport

The command service uses Slack's signed HTTP Events API at
`/api/ceo/slack/events`, with the existing API lifecycle and PostgreSQL database.
This avoids introducing another daemon or changing the runtime architecture.
The earlier Socket Mode manifest is retained as historical setup work; **it is
not compatible with this HTTP implementation without changing app settings**.
Disable Socket Mode in the same app and configure its Events API Request URL
only after the reviewed production route is deployed. Retain `message.im`,
`im:history`, and `chat:write`; no channel-wide access is required.

Required server-side configuration:

- `CEO_SLACK_ENABLED=true`, `DEPLOYMENT_ENVIRONMENT=production`.
- `CEO_WORKSPACE_ID`, `CEO_FOUNDER_ID`: existing database workspace and founder.
- `SLACK_TEAM_ID`, `SLACK_FOUNDER_USER_ID`, `SLACK_APP_ID`: verified Slack binding.
- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`: secure deployment secret store only.

The API verifies the bot's own `auth.test` identity at startup and rechecks the
database founder role when accepting or processing a command. Requests require
the Slack HMAC over original bytes, a five-minute freshness window, the bound
app/team/user, and an original direct message. Event replay is keyed durably;
payload drift is rejected. Pause/resume/stop is committed in the same transaction
as initial message acceptance, so replay cannot reapply an old control.

No current workflow deploys this as a live production business. Staging rejects
activation and keeps mock-provider restrictions. Do not change Access rules to
make staging accept Slack events. Configure the production callback through a
reviewed ingress/deployment change.

## Commands and reliability

`status`, `report`, `budget`, `agents`, `pause`, `resume`, `stop`, and
`verify health` have deterministic handlers. `verify health` performs a real
database query and retains a result digest; it is not an AI-provider task.
Other text is retained for future planning with an explicit blocked reply.

The inbox uses database leases, `SKIP LOCKED`, bounded attempts, persisted reply
content, and restart recovery. Slack requests time out after ten seconds.
An exhausted delivery is marked FAILED. Audit records distinguish acceptance,
verified response content and confirmed Slack reply. A crash after Slack accepts
a reply but before the database stores its timestamp can yield a duplicate reply;
the stable `client_msg_id` is supplied, but exactly-once Slack delivery is not
asserted. Resolve ambiguous deliveries using Slack history before manual retry.

Raw instructions are private database content, never log output. The API returns
no private inbox or budget data on the public callback. Before broader use,
complete retention/deletion policy, encrypted storage and operator recovery.

## Spending

The added ledger reserves full enforced task ceilings before real broker
reservations and rechecks pause/funding at broker evidence admission. Existing
test-only fixtures remain controlled by the existing test-only gate. Missing
funding denies paid execution. Provider pricing evidence and external invoice
reconciliation still require trusted adapters; the ledger does not create them.

The monthly EUR 150 and related-obligation EUR 25 limits are fixed integer-cent
controls. Open commitments remain held across month boundaries until verified
cancellation or final settlement. A recurring obligation must reserve its full
contractual maximum, including renewal/cancellation exposure; unknown or unbounded
costs must not be submitted for execution. All tasks in one objective share the
single-obligation ceiling. The trusted planner must not create new objectives to
split one purchase.

No migration credits the EUR 100 budget. `funding_cents` means cumulative verified
funding authorized for this business, not a fresh bank-balance snapshot.
`protected_cents` excludes taxes, refunds, liabilities and required reserves.
The funding evidence and expiry must come from a trusted finance reconciliation;
there is deliberately no public funding-update endpoint. Reinvestment requires
verified available profit and a justified need. Historical ACP usage and this
commitment ledger must be linked before presenting consolidated cost totals;
do not add the two ledgers together or label reserved amounts as paid charges.

Reconciliation records actual overruns instead of concealing them, then pauses
and invalidates funding. Cancellation releases funds only with evidence of no
remaining liability. Provider dispatch must perform a fresh control check at its
external-effect boundary. The deny-only provider implementation is unchanged.

## Release acceptance still required

- Protected CI, real PostgreSQL concurrency tests, migration and API build.
- Production credentials, exact deployment provenance and restart test.
- Real founder message → task → result → Slack reply → persistent audit.
- Trusted AI planning/execution, provider invoice reconciliation and delivery.
- Checkout-to-delivery testing and seller configuration before live sales.

Reference: https://docs.slack.dev/authentication/verifying-requests-from-slack/
