# VentureOS CEO Slack setup

Status: prepared configuration only. No Slack app, running bot, AI connection,
spending authority enforcement, or commercial launch is established by these files.

## Installation

1. Open https://api.slack.com/apps and choose Create New App, then From a manifest.
2. Select the VentureOS workspace and paste `manifest.json` from this folder.
3. Review and install the app in the workspace.
4. Under Basic Information, generate an app-level token with `connections:write`.
5. Store the app token and Bot User OAuth Token in the deployment secret store as
   `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN`. Never commit or paste them in chat.
6. Bind the verified founder Slack user ID and Slack team ID to exactly one
   VentureOS workspace in server-side configuration before accepting commands.

The manifest allows direct messages to this bot and sending responses. It does
not request access to all public/private channels or other users' DMs.
Token rotation is disabled in this bootstrap manifest because no token-refresh
handler exists yet; configure rotation with its handler before any broader rollout.

## Runtime work still required

The existing governed AI COO in
`packages/agent-control-plane/src/ai-coo.ts` should be the integration starting
point. This setup does not introduce a competing agent runtime or bypass its
tenant, policy, approval, or audit boundaries.

Implement a supervised Socket Mode worker with the official Slack SDK.
Authenticate its Slack account at startup, match the configured team and founder,
ignore bot/edited/deleted messages, reject unbound identities, durably deduplicate
event IDs, and persist instructions before acknowledging them. Do not log tokens
or raw private messages. Sanitize outgoing Slack text to prevent unintended mentions.

Connect accepted instructions to durable workspace-scoped tasks. Acknowledgement
must say accepted/queued, not executed. Natural-language messages cannot directly
invoke a shell, change budgets, grant roles, or transfer funds. Use the authenticated
founder mandate through deterministic existing action gates.

Reports must use timestamped task/run evidence and actual financial records.
Missing runtime/provider/ledger evidence must be shown as unknown or unconfigured,
never zero revenue, funded balance, successful deployment, or completed work.

Desired interface (not implemented by this manifest):
- Report: completed work with evidence, active tasks, blockers and next actions.
- Budget: verified cash, committed costs, expenses, revenue and remaining limits.
- Priorities: next tasks and their rationale.
- Pause: persist a pause and stop new dispatch/spend; disclose any in-flight work.
- Normal founder messages: create a durable instruction and report its task ID.

## Founder budget mandate

`founder-budget.json` records the limits explicitly supplied in the conversation:
EUR 100 starting budget, EUR 150 monthly cap, EUR 25 maximum single expense,
100% reinvestment of available profit only when the project needs more.
These supersede older planning estimates for this rollout, but recording them
does not fund the account or enforce a budget. The proposed monthly timezone is
Asia/Nicosia. Actual finance integration must enforce integer-cent ledger
reservations atomically, account for paid and committed costs, and reconcile
provider invoices. Unknown funds or unknown usage must block new paid work.
Recurring contracts must be assessed for their full commitment, not only the
first charge. A signed/authorized workspace policy update must install these
limits without weakening existing guards.

## Activation acceptance

- Founder DM receives one durable task ID and one truthful response.
- Duplicate delivery/restarts cannot duplicate tasks or paid actions.
- Other Slack users/teams cannot command or retrieve company information.
- Pause survives restart and prevents new dispatch and spending.
- EUR 25.01 expense, monthly overflow, cash shortfall and concurrent reservation
  overspend are rejected by backend tests.
- Missing/stale evidence is visible in reports.
- Provider call, bounded usage, result and cleanup are evidenced end to end.
- The deployed service survives restart and has an authenticated health check.

Until these pass, the CEO is not operational. There is no need to purchase another
plugin to import this manifest. A Slack workspace owner must complete app
installation; the connected ChatGPT Slack tools do not expose app creation or
app-level token generation.

References:
- https://docs.slack.dev/reference/app-manifest/
- https://docs.slack.dev/apis/events-api/using-socket-mode/
