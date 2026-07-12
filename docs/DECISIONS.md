# Architectural Decision Records

## ADR-001: Authentication library — hand-rolled session auth, not Better
Auth or Auth.js, for Phase 1

**Context**: master spec section 8 asks for "Better Auth or Auth.js,
choosing the option that integrates most reliably with the selected
Next.js and NestJS architecture."

**Decision**: Phase 1 implements authentication directly (scrypt password
hashing, DB-backed session table, httpOnly cookie, server-side guards) in
`@ventureos/auth` + `apps/api`, rather than adopting Better Auth or Auth.js.

**Reasoning**: both libraries are designed around a single Next.js app
handling its own auth routes; VentureOS's architecture deliberately splits
web (Next.js) and API (NestJS) so the API is the sole source of
authorization truth (master spec section 26: "server-side approval
enforcement", "a frontend button must never be the only approval control").
Integrating either library would mean either (a) running auth inside
Next.js and having NestJS trust a token it didn't issue, or (b) fighting
the library's Next.js-centric assumptions to run it inside Nest. A minimal,
fully-understood, framework-agnostic implementation was judged lower-risk
for a security-critical system than adapting a Next.js-shaped library to a
role it wasn't designed for.

**Consequence**: MFA, OAuth providers, and account recovery — which Better
Auth/Auth.js would have provided for free — are now bespoke future work
(tracked in `TODO.md`). This is an accepted tradeoff for Phase 1; revisit
if a library emerges (or matures) with first-class support for a
Next.js-frontend / separate-API-backend split.

**Status**: Not yet run/tested (sandbox has no network/DB — see
`SANDBOX_LIMITATIONS.md`). Revisit this ADR after local verification in
case scrypt performance or session-table design needs adjustment.

## ADR-002: Modular monolith, not microservices

See `ARCHITECTURE.md`. Single founder, single workspace, tight budget —
microservices would add operational cost with no corresponding benefit at
current scale.

## ADR-003: Deterministic engines built as standalone packages ahead of
their consuming features

`finance-engine`, `scoring-engine`, `policy-engine`, and the agent-output/
approval contracts in `@ventureos/contracts` were built in Phase 1 even
though the features that will call them (Opportunity feed, Board Room,
Approval Centre) are Phase 2/3. **Reasoning**: these are the pieces of the
system where correctness matters most (arithmetic, voting math, contract
validation) and where unit tests provide the most value; building and
testing them now, independent of any UI or AI provider, means Phase 2/3 can
consume already-verified logic rather than writing and verifying it under
feature-delivery time pressure. **Risk accepted**: minor chance of rework if
Phase 2/3 domain modeling reveals a need to change these interfaces — judged
low given how closely they were modeled on the master spec's explicit
formulas and schemas.

## ADR-004: Project location changed mid-build

The founder's original instruction placed the project inside
`D:\Documents\hermes ai agent`, which turned out to contain internal Hermes
agent runtime state (auth.json, lock files, databases) — not a project
folder. Per founder direction, the project was relocated to
`D:\Projects\ventureos` conceptually; due to a sandbox folder-picker
limitation the connected folder ended up being
`D:\Documents\claudehermespromt\ventureos` instead. See the founder-facing
summary in the final chat report for the exact path and how to move it.
