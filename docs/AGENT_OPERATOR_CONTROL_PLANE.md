# VentureOS Agent Operator Control Plane

<!-- prettier-ignore-start -->

## Purpose

This control plane removes routine founder relay work without giving any agent blanket
administrator access.

GitHub remains the product/release source of truth. Routine engineering, CI observation,
reviewed merges, bounded deployment, and evidence capture should flow through GitHub and
protected workflows. Sensitive actions stay behind explicit founder gates.

This document contains no secret values.

## Trust zones

### Product repository — public and secretless

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
- Cloudflare deployment credentials;
- API tokens, SSH private keys, passwords, or raw secret material.

The public repository contains a reviewed `progress-worker-deploy` workflow as a fallback and
reference implementation, but `VENTUREOS_PROGRESS_DEPLOY_ENABLED` remains `false` and the
`public-command-center` environment remains secretless once the private operations repository
becomes deployment owner.

### Private operations repository — confidential command-center owner

`completed369/ventureos-ops`

This private repository will hold:

- Founder Command Center source;
- daily agent/project state;
- confidential roadmap and board/investor material;
- private deployment evidence;
- generated private command-center artifact;
- the reviewed command-center deployment workflow;
- the scoped Cloudflare Worker deployment secrets required by that private workflow.

Private repository status does not permit committing raw secrets. Cloudflare credentials stay in
GitHub Actions Secrets and are never stored in Git files.

The private repository is the real owner of confidential command-center deployment. The public
product repository remains the authoritative product/release source.

## Operator identities and permissions

### ChatGPT project lead

Routine authority:

- GitHub issues, branches, files, PR review/merge where tools permit;
- roadmap and execution decisions;
- CI diagnosis;
- command-center state/design management once the private repo is connected.

Excluded:

- raw secret values;
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
- raw Cloudflare deployment credentials;
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

- exact reviewed workflow actions using scoped repository/environment credentials.

Excluded:

- credentials outside the referenced trust zone;
- actions not encoded by the reviewed workflow.

### Cloudflare Worker deploy token

Storage:

- private `completed369/ventureos-ops` Actions Secrets only.

Routine authority:

- deploy/update the approved `ventureos-public` Worker through the reviewed private command-center
  workflow.

Initial permission:

- Account → Workers Scripts Write only.

Excluded:

- DNS;
- Workers Routes;
- Zero Trust/Access;
- account administration;
- billing;
- unrelated Cloudflare products or resources.

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

Once the required operator credentials and private repository are bootstrapped, agents should
drive:

- branch creation and implementation;
- formatting, lint, typecheck, tests, and builds;
- PR creation, review, and merge when policy permits;
- CI observation and bounded repair;
- Founder Command Center source/state updates in the private ops repository;
- static command-center deployment after reviewed changes reach the private repo's protected main;
- generation of deployment evidence/manifests;
- read-only staging and provider health checks that do not bypass authentication.

## Command-center deployment boundary

The active confidential deployment path belongs in `completed369/ventureos-ops` and must:

- target only the existing `ventureos-public` Worker;
- validate the generated static artifact before mutation;
- use only the private repo's Cloudflare Actions Secrets;
- leave DNS, Custom Domains, and Cloudflare Access unchanged;
- leave the VPS, private staging, APIs, databases, and application backend unchanged;
- preserve an evidence record and rollback path.

The public product repo's existing progress deployment workflow remains disabled and secretless as
a reviewed fallback/reference path.

## Cloudflare Access boundary

Cloudflare Access is deliberately separate from Worker deployment credentials.

Before confidential command-center material is published:

- `progress.ventureos.site` must be Access-protected;
- only authorized identities may pass the policy;
- public `workers.dev` and preview bypasses must be disabled or equivalently protected.

Any future Access automation must use a separate narrowly scoped credential and separate reviewed
workflow. Worker deployment credentials must not be widened merely for convenience.

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

## One-time bootstrap

See `docs/AGENT_OPERATOR_BOOTSTRAP.md`.

After bootstrap, the operating loop should become:

1. ChatGPT identifies and records the next task.
2. Pi or ChatGPT implements through a branch/PR as appropriate.
3. Required CI passes.
4. ChatGPT reviews/merges when policy permits.
5. Private ops state is updated.
6. A reviewed private ops workflow deploys the command center using its scoped Worker credential.
7. The founder is contacted only for a genuine founder gate.

## Private staging and production

Existing `image-publication` and `private-staging` workflows remain authoritative. This
control-plane work must not bypass or weaken them.

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

<!-- prettier-ignore-end -->
