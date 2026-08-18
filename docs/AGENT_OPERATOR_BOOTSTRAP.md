# Agent Operator Bootstrap

<!-- prettier-ignore-start -->

This is the one-time setup required before agents can stop relying on the founder as a command
relay.

Do not paste secret values into GitHub issues, PRs, chat, documentation, or shell transcripts.

## 1. Public product repository remains secretless

The public product repository is:

`completed369/hermesagent`

Create or retain a GitHub deployment environment named:

`public-command-center`

This environment is a **secretless fallback boundary**. Do not place Cloudflare deployment
credentials in the public repository or this environment.

Keep the repository variable:

`VENTUREOS_PROGRESS_DEPLOY_ENABLED=false`

The public repository's progress Worker workflow remains disabled as a reviewed fallback and
validation reference. It must not become the owner of confidential command-center deployment.

## 2. Private operations repository owns command-center deployment

Create the private repository:

`completed369/ventureos-ops`

It is the trust boundary for:

- Founder Command Center source;
- confidential reports and reconciled project documents;
- structured daily project/agent state;
- command-center validation and deployment workflow;
- Cloudflare Worker deployment credentials used only by the private command-center workflow.

Do not copy secrets into Git files. Private repository status does not make committed secrets safe.

The bootstrap script creates this repository if it does not already exist and fails closed if a
repository with that name exists but is public. Its default branch must be `main`.

## 3. Cloudflare Worker credential boundary

Create a Cloudflare API token scoped to the account that owns `ventureos-public`.

For this first deployment boundary grant only:

**Account → Workers Scripts Write**

Do not grant:

- DNS;
- Workers Routes;
- Zero Trust/Access;
- billing;
- account administration;
- KV;
- R2;
- AI;
- unrelated zone or account permissions.

Store the values only as GitHub Actions repository secrets in the private operations repository:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The bootstrap script can prompt for these values locally. The API token prompt is hidden and the
value is passed directly to `gh secret set` over redirected stdin without being printed or placed on
the command line.

Pi, ChatGPT, and Hermes do not need the raw Cloudflare token. GitHub Actions should perform the
bounded external deployment.

## 4. Cloudflare Access is a separate identity boundary

The confidential Founder Command Center must be protected before private reports or state are
deployed.

Required properties:

- `progress.ventureos.site` is covered by a Cloudflare Access application;
- only authorized founder/board/adviser identities are allowed;
- public `workers.dev` and preview bypasses are disabled or equivalently protected before
  confidential assets are introduced;
- the Worker deployment token does not receive Zero Trust/Access permissions.

This separation prevents a deployment credential from also becoming an identity-administration
credential.

A future Access automation workflow, if needed, must use a separate narrowly scoped credential
and separate review.

## 5. Pi engineering identity

Pi should continue using the authenticated GitHub CLI for ordinary engineering work.

Pi needs enough GitHub authority to:

- create/push branches;
- create/update PRs;
- observe CI;
- dispatch reviewed workflows where GitHub policy allows it.

Pi does not need personal founder credentials, Cloudflare API-token values, or unrestricted VPS
root access.

## 6. VPS deployment identity — future bootstrap

Do not reuse the founder administration key as the long-term automation credential.

Create a separate deployment principal only when the reviewed VPS operator design is ready.
Prefer:

- key-only authentication;
- no password login;
- no unrestricted root shell;
- a root-owned reviewed deployment wrapper/allowlist;
- explicit source/digest input validation;
- auditable logs;
- a separate break-glass founder administration path.

Existing private-staging deployment workflows remain authoritative until a reviewed replacement is
merged.

## 7. Founder gates

Even after bootstrap, require explicit founder authorization for:

- production launch;
- paid-provider activation or material spend increase;
- marketplace publication, advertising, payments, or financial transfers;
- destructive data or infrastructure changes;
- legal/commercial commitments;
- credential-scope expansion;
- repository visibility changes;
- disabling or weakening security/governance controls.

## 8. Bootstrap verification

The one-time bootstrap is complete only when:

1. `completed369/ventureos-ops` exists and is private.
2. Its default branch is `main`.
3. The public repository variable `VENTUREOS_PROGRESS_DEPLOY_ENABLED` is `false`.
4. The public `public-command-center` environment contains no Cloudflare secrets.
5. When configured, the private ops repository contains only the expected Cloudflare Actions
   secret names; values are never printed.
6. `progress.ventureos.site` routing remains unchanged by bootstrap.
7. No DNS, Access, VPS, private-staging, production, provider, or spending mutation occurred.

After this bootstrap, ChatGPT can attempt to access the private repository through the connected
GitHub integration. If the GitHub App installation does not yet include the new repository, only a
one-time repository-access grant is required; the founder should not need to resume routine command
relay.

<!-- prettier-ignore-end -->
