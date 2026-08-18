# VentureOS Agent Operator Control Plane

## Purpose

This control plane removes routine founder relay work without giving any agent blanket
administrator access.

GitHub remains the product/release source of truth. Routine engineering, CI observation,
reviewed merges, bounded progress-site deployment, and evidence capture should flow through
GitHub and protected workflows. Sensitive actions stay behind explicit founder gates.

This document contains no secret values.

## Trust zones

### Product repository — public

`completed369/hermesagent`

Allowed content:

- product source and tests;
- reviewed deployment workflow definitions;
- non-confidential release evidence;
- public progress-site assets;
- permission/runbook documentation that contains no credentials or confidential strategy.

Forbidden content:

- investor/board confidential reports;
- private Founder Command Center state;
- customer/private venture data;
- API tokens, SSH private keys, passwords, or raw secret material.

### Private operations repository — required

A separate private repository, recommended as `completed369/ventureos-ops`, will hold:

- Founder Command Center source;
- daily agent/project state;
- confidential roadmap and board/investor material;
- private deployment evidence that should not be public;
- generated private command-center artifact.

The private repository is a bootstrap dependency for the confidential command-center phase. It
must not weaken the product repository's existing branch and release governance.

## Operator identities and permissions

### ChatGPT project lead

Routine authority:

- GitHub issues, branches, files, PR review/merge where tools permit;
- roadmap and execution decisions;
- CI diagnosis.

Excluded:

- secret values;
- Cloudflare dashboard login;
- direct VPS shell;
- production, spend, or legal commitments.

### Pi engineering operator

Routine authority:

- local repo implementation and tests;
- branch/PR work;
- `gh`-based CI and reviewed deploy dispatch.

Excluded:

- personal founder credentials;
- unrestricted cloud/root access;
- self-approved production or paid actions.

### Hermes reserve reviewer/research

Routine authority:

- independent review or research when assigned.

Excluded:

- parallel edits to Pi's active branch unless explicitly coordinated;
- infrastructure credentials by default.

### GitHub Actions

Routine authority:

- exact reviewed workflow actions using environment-scoped credentials.

Excluded:

- credentials outside the referenced environment;
- actions not encoded by the reviewed workflow.

### Cloudflare deploy token

Routine authority:

- deploy/update the approved progress Worker through the reviewed workflow.

Excluded:

- DNS, Access policy, account administration, or unrelated provider changes unless a future
  reviewed workflow explicitly adds them.

### VPS deploy principal

Routine authority:

- future reviewed private-staging deployment only.

Excluded:

- founder administration identity;
- unrestricted interactive root shell;
- unrelated host administration.

### Founder

The founder remains final authority at sensitive gates. Routine command relay should not be
required once bootstrap is complete.

## Founder gates that remain mandatory

The control plane does not authorize agents to independently perform:

- production launch or production rollback with customer impact;
- paid-provider activation or material spend-limit increase;
- marketplace publication, advertising, payments, or financial transfers;
- destructive data/infrastructure operations;
- legal/commercial commitments, contracts, financing, or compliance claims;
- credential-scope expansion;
- repository visibility changes;
- weakening branch, CI, approval, security, or Access controls.

## Routine actions that should not require founder relay

Once the required operator credentials/environments are bootstrapped, agents should drive:

- branch creation and implementation;
- formatting, lint, typecheck, tests, and builds;
- PR creation, review, and merge when policy permits;
- CI observation and bounded repair;
- static progress-site deployment after reviewed changes reach protected `main`;
- generation of deployment evidence/manifests;
- status/roadmap updates in the private command-center repository;
- read-only staging and provider health checks that do not bypass authentication.

## Progress Worker deployment boundary

The initial automated external mutation is intentionally narrow:

- Worker name is fixed to `ventureos-public`.
- Assets come only from `deploy/public-landing/`.
- `scripts/validate-public-landing.mjs` must pass before deployment.
- Source must equal current protected `main`.
- The workflow does not configure DNS, Custom Domains, or Cloudflare Access.
- The workflow does not touch the VPS, private staging, APIs, databases, or application backend.
- Automatic deployment remains disabled until `VENTUREOS_PROGRESS_DEPLOY_ENABLED` is set to
  `true` after credential bootstrap.

The Cloudflare API token should receive only the minimum account permission required to deploy
Workers. Do not grant DNS or Access permissions to this token in the first control-plane phase.

## Credential handling

Credential values must exist only in provider/GitHub secret stores.

Never place them in:

- Git history;
- issues or PR bodies;
- workflow YAML;
- command-center HTML/JSON;
- chat transcripts;
- screenshots;
- deployment artifacts/logs.

Environment-scoped GitHub secrets are preferred because GitHub exposes them only to jobs that
reference the environment. If a protected environment requires review, the job cannot access its
environment secrets until the protection rules pass.

## One-time bootstrap

See `docs/AGENT_OPERATOR_BOOTSTRAP.md`.

After bootstrap, normal progress-site updates should follow:

1. An agent changes reviewed source on a branch.
2. PR CI passes.
3. The PR merges to protected `main`.
4. The bounded progress deployment workflow validates exact main source.
5. When deployment is enabled, GitHub Actions updates only the approved Worker.
6. Deployment evidence is retained in GitHub Actions.
7. The Founder Command Center is updated from the private operations source.

## Private staging and production

Existing `image-publication` and `private-staging` workflows remain authoritative. This
control-plane phase must not bypass or weaken them.

A future VPS operator identity should be separate from the founder administration identity and
constrained to a root-owned reviewed deployment entry point rather than a general-purpose
interactive root credential.

## Audit rule

Every external mutation must be attributable to:

- exact source/ref;
- workflow/run;
- operator/trigger;
- bounded credential scope;
- resulting deployment identifier/evidence;
- rollback/recovery path.

If any of those cannot be established, the automation should stop rather than improvise.