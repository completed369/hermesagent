# PROJECT_CONTEXT.md

## Mission

VentureOS is a production-oriented platform that lets one founder (Yiannis)
research, validate, create, launch and operate digital businesses using a
controlled team of AI agents. It is inspired only by the publicly observable
business concept of AI-managed side businesses (see
`docs/SIDELOOT_COMPARISON.md`) — no proprietary code, branding, or trade
secrets from any other company are used.

VentureOS must be better than that inspiration in: transparency, founder
control, evidence quality, financial modelling, security, approval
governance, auditability, workflow reliability, marketplace compliance,
forecast tracking, multi-business management, and long-term resale
potential.

## Founder & authority

- Founder / final authority: **Yiannis**
- Temporary project name: **VentureOS** (branding, colours, logos, and
  customer-facing terminology are all configurable — see `docs/DECISIONS.md`
  ADR on white-labelling)

## Core principle

The founder always has final authority. AI agents may research, analyse,
draft, calculate, recommend, and prepare actions — never independently
execute anything sensitive (see master spec section 2, reproduced in
`docs/SECURITY.md`).

## Current owner direction — 11 September 2026

VentureOS is a general subscription and usage-credit platform where an AI
Director delegates work to specialist agents. Each workspace pursues useful
products or services and measures actual buyer receipts and costs. No single
marketplace, product category or model provider defines the platform. The owner
communicates with the Director; the backend enforces the standing mandate,
entitlements, budgets and tenant boundaries.

Use existing architecture and domains. The customer experience includes a simple
website and an original event-backed company world showing actual agent work.
Subscriptions, service credits, operating funds and venture earnings are separate
records. A funded balance does not override pause or expand spending authority.

The private operations report and master execution directive dated 10 September
2026 preserve the current owner mandate. Earlier commercial defaults, estimated
budgets and timelines below are historical; they are not current spending or
launch authority. Existing staging mock-only and protected release controls stay
in force. Runtime and commercial claims require current executed evidence.

The current continuation implements durable owner-instruction research intake.
It does not establish a connected research runtime, strategic model planning,
paid execution or revenue. See `docs/DIRECTOR_INSTRUCTION_INTAKE.md`.

## Historical commercial defaults (Phase 1 pilot slice)

Single workspace, single founder, one pilot marketplace (Etsy, mock/draft
mode only), one pilot product category (digital template bundle), mock
research + product-generation connectors, EUR reporting currency, no live
publication, no advertising spend, no real payment processing, no real
customer personal data. Full defaults table: master spec section 5
(preserved verbatim below is out of scope for this file — see the original
build prompt provided by the founder for the complete unabridged text; this
file summarizes the operative defaults actually encoded in `.env.example`
and `packages/finance-engine`).

## Historical budget estimates — superseded

Month 1 ≤ ~€100, month 3 ≤ ~€250/month, steady state ~€300–500/month.
Self-hosted/open-source/usage-based services preferred; no paid service
activates automatically (`FEATURE_PAID_INTEGRATIONS_ENABLED=false` by
default). Cost tracking is architected in `packages/finance-engine` and the
`AI_PER_*_COST_LIMIT_EUR` env vars; UI dashboards for it are Phase 7.

## Historical target timeline

- **Weeks 1–3**: core technical + governance foundation (Phase 0/1 — this
  build).
- **3 months**: first end-to-end commercial pilot, first validated product
  ready for launch.
- **12 months**: repeatable revenue, controlled ad spend.
- **Long term**: package/resell the platform, agent system, workflow
  architecture, prompt framework, methodology, and white-label version.

## Historical master build prompt

The complete, unabridged master build prompt supplied by the founder is the
historical source for the original scope and acceptance criteria. The current
owner direction above supersedes conflicting strategy and delivery assumptions. It is
long (46 sections); rather than duplicate all of it here verbatim (risking
drift between two copies), this repository treats the founder's original
message as canonical and each `docs/*.md` file implements its relevant
section(s), cross-referenced by section number throughout.
