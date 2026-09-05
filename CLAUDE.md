# VentureOS — Claude Code operating contract

@AGENTS.md
@PROJECT_CONTEXT.md
@docs/ROADMAP.md

This file is the repository-level operating contract for Claude Code. The imported files above remain authoritative and all deterministic security/policy controls in code outrank prompt instructions.

## Mission

Continue VentureOS from its real current Git/GitHub state to a production-ready, evidence-backed company operating system while preserving founder authority, tenant isolation, auditability, security, reversibility, and truthful state reporting.

## Source-of-truth order

When sources disagree, use this order:

1. Executed tests, protected GitHub CI, exact Git/GitHub state, and current source code.
2. Current `AGENTS.md`, `docs/ROADMAP.md`, relevant current ADRs, and current open PRs.
3. `PROJECT_CONTEXT.md` for founder mission and core product principles.
4. Older phase-labelled status/master documents only as historical context unless reconfirmed against current Git/GitHub evidence.
5. Prior conversations, summaries, or remembered state are never runtime/deployment evidence.

Important: `PROJECT_CONTEXT.md` records that the founder's original complete 46-section master build prompt is authoritative for full scope but is not duplicated verbatim in this repository. Do not invent missing founder requirements. When a material requirement is absent or conflicts with current repository evidence, surface the conflict explicitly rather than guessing.

## Session start — mandatory

Before modifying code:

1. Fetch `origin` and inspect the exact current `origin/main` SHA.
2. Inspect all current open PRs and do not duplicate or collide with active work.
3. Read the current roadmap section relevant to the work and the newest relevant ADRs.
4. Inspect CI/status evidence for the exact branch/PR head when available.
5. Confirm the working tree is clean or explain any pre-existing changes before touching them.
6. Never use a stale July phase/status document to override newer Git/GitHub evidence.

## Cost and scope discipline

VentureOS must not burn tokens through unbounded autonomous loops.

- One normal coding session should deliver **one narrowly bounded PR**.
- Select the single highest-priority safe remaining blocker that can be completed and independently verified without crossing a Founder/Level-4 boundary.
- Do not begin a second PR automatically after the first is green or merge-ready.
- Do not repeatedly reread the whole repository when targeted files, Git history, or search can answer the question.
- Do not launch parallel/sub-agents unless they provide clear value for an independent review or genuinely separable analysis.
- Prefer targeted tests during iteration; run the full required gate once the slice is ready.
- Never expand the definition of done merely to keep working. Record remaining work and stop.

## PR workflow

For routine safe engineering work:

1. Start from current `origin/main` unless repairing an existing open PR.
2. Create one purpose-specific branch.
3. Make the smallest complete change that satisfies the acceptance criteria.
4. Add/update regression tests and relevant ADR/roadmap truth where required.
5. Run applicable local checks.
6. Open or update exactly one PR.
7. Observe exact-head CI and fix only failures attributable to the PR.
8. Perform a final truth/security/diff review.
9. Stop when the PR is green and merge-ready, or merged when repository policy and explicit authority permit it.
10. Report: exact main SHA, PR number/head SHA, checks, what changed, what remains, and the next recommended bounded slice. Do not silently start it.

## Founder / Level-4 boundaries

Never execute or authorize these merely because they are technically possible:

- real spend or paid-provider activation;
- publication, customer communication, marketplace publishing, advertising, pricing commitments, or legal acceptance;
- production credentials or secret rotation;
- DNS/Cloudflare/external infrastructure changes;
- destructive production/staging data changes;
- production or private-staging deployment/publishing unless separately and explicitly authorized for the exact action/SHA;
- any bypass of approval, budget, entitlement, tenant, audit, security, or provider-policy controls.

Prepare plans/evidence for these actions, but leave execution gated to the founder unless explicit current authorization exists.

## Runtime truth

Do not claim an AI/runtime adapter is configured, connected, deployed, or verified from code presence, package installation, repositories, tests, or conversation history alone. Positive runtime claims require the exact authenticated evidence defined by the current roadmap/ADRs.

As of the current roadmap lineage, Codex, Hermes, and Pi remain `NOT_CONFIGURED` until each has authenticated registration, capability exchange, heartbeat, task/status exchange, and an event/result round trip. Preserve this fail-closed truth unless new executed evidence proves otherwise.

## Current continuation guard

At the time this Claude integration file was introduced, product `main` had just merged PR #164 and PR #165 (`feat(agent-bridge): add Linux native listener module`) was the active continuation. Treat those numbers and SHAs as historical bootstrap hints only: always query GitHub again at session start, because they may already have changed.

Do not recreate PR #165's work on another branch. If it remains open, inspect it first and either finish/review that exact PR or choose a non-colliding task only when explicitly justified.

## Definition of truthful progress

Use the evidence state model from the roadmap. Do not collapse `MERGED`, `PUBLISHED`, `DEPLOYED`, `VERIFIED`, `PILOT`, `CUSTOMER`, `REVENUE`, or `PRODUCTION` into one another.

Synthetic/mock readiness is not a real customer, real provider, production deployment, revenue, conversion, or product-market-fit claim.

## Handoff format at end of every session

Keep the final handoff concise and machine-resumable:

- exact `origin/main` SHA;
- branch and PR number/head SHA;
- CI/check results and links/IDs when available;
- files/behavior changed;
- safety boundaries preserved;
- unresolved blockers;
- exactly one recommended next bounded slice;
- any founder decision required before proceeding.
