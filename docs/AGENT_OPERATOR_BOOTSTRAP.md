# Agent Operator Bootstrap

<!-- prettier-ignore-start -->

This is the one-time setup required before agents can stop relying on the founder as a command
relay.

Do not paste secret values into GitHub issues, PRs, chat, documentation, or shell transcripts.

## 1. Public progress Worker deployment

Create a GitHub deployment environment named:

`public-command-center`

Add environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The Cloudflare token for this phase should be scoped to the account that owns
`ventureos-public`. Grant **Account → Workers Scripts Write** only for this first deployment
boundary. Do not grant DNS, Workers Routes, Zero Trust/Access, billing, account-administration,
KV, R2, AI, or unrelated zone/account permissions unless a future reviewed workflow proves they
are required.

The reviewed workflow hardcodes the target Worker name and does not mutate Custom Domains or
Access configuration.

Create a repository or environment variable:

`VENTUREOS_PROGRESS_DEPLOY_ENABLED=false`

Keep it `false` while validating the workflow and credentials. Change it to `true` only after the
first dry review and after confirming that `progress.ventureos.site` remains correctly
protected/routed.

Optional environment protection:

- restrict deployment branches to protected `main`;
- use required reviewers if you still want a human gate for every progress deployment.

The target operating model is that progress-only static deployments can become automatic after
merge, while sensitive environments keep explicit review gates.

## 2. Cloudflare Access for confidential command center

The confidential Founder Command Center must be protected before its private reports/state are
deployed.

Required properties:

- `progress.ventureos.site` is covered by a Cloudflare Access application;
- only authorized founder/board/adviser identities are allowed;
- public `workers.dev` and preview bypasses are disabled or equivalently protected before
  confidential assets are introduced;
- Access/DNS configuration is not managed by the first progress deploy workflow.

This separation prevents a deploy token from also being an identity/DNS administration token.

## 3. Private operations repository

Create a private repository, recommended as:

`completed369/ventureos-ops`

Initial purpose:

- Founder Command Center source;
- confidential reports and reconciled project documents;
- structured daily project/agent state;
- private command-center validation and deployment workflow.

Do not copy secrets into the repository. Private does not mean secrets belong in Git.

Recommended initial branch policy:

- default branch `main`;
- PR-based changes for command-center structure/workflows;
- direct machine-generated daily state updates may be introduced later only with explicit
  reviewed rules;
- no public fork/distribution path for confidential documents.

## 4. Pi engineering identity

Pi should continue using the authenticated GitHub CLI for ordinary engineering work.

Pi does not need the raw Cloudflare token if GitHub Actions performs deployment. Pi needs only
enough GitHub authority to:

- create/push branches;
- create/update PRs;
- observe CI;
- dispatch reviewed workflows where GitHub policy allows it.

This keeps provider credentials out of the local agent context.

## 5. VPS deployment identity — future bootstrap

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

## 6. Founder gates

Even after bootstrap, require explicit founder authorization for:

- production launch;
- paid-provider activation/material spend increase;
- marketplace/publication/ads/payments;
- destructive data or infrastructure changes;
- legal/commercial commitments;
- credential-scope expansion;
- repository visibility changes;
- disabling or weakening security/governance controls.

## 7. Bootstrap verification

Before setting `VENTUREOS_PROGRESS_DEPLOY_ENABLED=true`:

1. The workflow exists on protected `main`.
2. CI is green.
3. The target Worker is still `ventureos-public`.
4. `progress.ventureos.site` routing is correct.
5. Confidential material has not been copied into the public repository.
6. Environment secrets exist and are not printed by workflow logs.
7. A deployment from exact main source can be rolled back using Cloudflare deployment history.
8. Private staging and production workflows are unchanged.

After these checks, routine progress-site deployment can become agent-driven rather than
founder-relayed.

<!-- prettier-ignore-end -->
