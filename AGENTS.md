# AGENTS.md

This file governs how any AI coding agent (including future Claude/Cowork
sessions) must work on this repository. It is the operational counterpart to
the master build prompt (preserved in full at the bottom of this file's
companion, `PROJECT_CONTEXT.md`).

## Non-negotiable rules

1. The founder (Yiannis) has final authority. Nothing here overrides that.
2. Agents (both the coding agent building this repo, and the in-product AI
   board agents this repo will eventually run) never get to: spend money,
   publish externally, send customer-facing messages, enter agreements,
   access financial accounts, delete production data permanently, expand
   their own permissions, disable security/audit controls, or bypass founder
   approval. See master spec section 2 and `docs/SECURITY.md`.
3. Every sensitive backend restriction must be enforced in deterministic
   backend code (guards, policy evaluations, DB constraints) — never by a
   prompt instruction alone, and never by a frontend-only check.
4. Do not fabricate: package installs, build results, migration results,
   test results, or "live" integration status. If something hasn't been run,
   say so explicitly (see `docs/SANDBOX_LIMITATIONS.md` for why Phase 0/1
   were built without any of this being run).
5. Mocks, stubs, and incomplete modules must be clearly labelled as such in
   code comments, READMEs, and UI (see the `Phase 2+` badges in the
   dashboard nav).
6. Phased delivery: build one phase at a time, stop at phase boundaries, and
   produce the required end-of-phase report (master spec section 42). Do not
   start Phase 2 work while "in" a Phase 0/1 run.
7. Use documented defaults for ordinary technical decisions (see
   `docs/DECISIONS.md`); only interrupt the founder for spending, external
   publication/communication, legal acceptance, credentials, destructive
   production changes, or irreversible/material architecture conflicts.

## Board agent contract (Phase 3+, not yet running)

When the eight voting board agents and the Decision Synthesiser are
implemented, every agent must: have a unique role, explicit tool allowlist,
explicit prohibited actions, structured I/O validated against
`@ventureos/contracts` (`AgentOutputSchema`), a prompt version, model
config, cost/timeout limits, and an audit trail. Invalid structured output
must fail closed (retry per policy, never silently treated as approval).
See `docs/AGENT_ROLES.md` and `docs/AGENT_OUTPUT_CONTRACTS.md`.

## Where things live

- Deterministic engines (finance, scoring, policy/voting) → `packages/`
- Server-side authorization → `packages/auth` + `apps/api/src/common/guards`
- Append-only audit → `apps/api/src/modules/audit` (the ONLY writer)
- Environment/config → `packages/config` (Zod schema, fails closed)

## For the next agent picking this up

Read, in order: `PROJECT_CONTEXT.md` → `docs/SANDBOX_LIMITATIONS.md` →
`docs/KNOWN_LIMITATIONS.md` → `TODO.md`. Then run the local verification
checklist before writing new code, so you know what's actually working.
