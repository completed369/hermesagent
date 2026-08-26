# Getting Started with VentureOS

This document describes the intended customer journey represented by the
reference application. As of the 2026-08-26 dated source review, it is demo and
pilot-preparation material: it is not evidence that public signup, a hosted
customer service, a paid plan, or a production deployment is available. Use a
Founder-authorized protected demonstration environment only. If you are
developing VentureOS, start with `README.md` and `CONTRIBUTING.md` instead.

## 1. Create your workspace

In an authorized demonstration, open the sign-up page and fill in:

- **Workspace name** — your company or agency name. This becomes part of
  your workspace's identity and can be changed later in Settings.
- **Your name and email** — used for your own login.
- **Password** — at least 8 characters.

The reference flow creates a dashboard workspace and a synthetic 14-day
**Trial** subscription record. It does not charge a card: no live payment
processor is connected. Plan labels and mock invoice rows are application
fixtures, not a public pricing offer or proof of a commercial subscription.

## 2. Complete onboarding

The onboarding wizard asks about your business objectives, budget, risk
tolerance, and preferences (categories, regions, languages, marketplaces).
This shapes what opportunities get suggested to you later — it's worth
filling in honestly rather than skipping.

## 3. Review your first opportunity

Every workspace starts with the Opportunity Feed empty except for research
you run yourself (via Research Connectors) or, in this reference build,
one seeded example. Each opportunity shows two scores:

- **Opportunity Score** — how promising the idea looks overall.
- **Profit Confidence Score** — how much you should trust the profit
  estimate. A low Profit Confidence Score next to a high Opportunity Score
  means the idea might be worth pursuing, but the numbers are speculative
  — VentureOS marks these explicitly rather than hiding the uncertainty.

## 4. Promote an opportunity into a venture

Clicking "Promote to Venture Proposal" starts the reference lifecycle: the
configured mock board reviews it (Board Room), you approve or reject the board's
recommendation (Approval Centre), and — once approved — VentureOS
generates the actual product and listing draft (Product Studio / Listing
Studio). Every one of these steps needs your explicit approval before
anything moves forward. Live publication and spending adapters are not enabled;
approval UI alone cannot make them available.

## 5. See all your ventures in one place

The **Ventures** page lists every venture you've started, side by side,
with links into each one's Board Room, Finance Centre, and Product page.
The synthetic plan record sets how many concurrent ventures the reference flow
allows. Changing it in Settings changes local application state only and is not
a purchase or pricing commitment.

## 6. Track the money

The Finance Centre shows your cost/revenue forecast, real expenses and
revenue you record, and (once you're testing pricing or channels) any
experiments you're running. Scaling up ad spend on the back of a positive
experiment result always requires your explicit approval (Gate 6) — the
system will never quietly increase spend on its own.

## 7. Make it yours (Settings)

- **Subscription** — see your current plan, usage against its limits, and
  change or cancel your plan.
- **License keys** — only relevant if you're running your own separate,
  self-hosted install rather than using a shared instance; see
  `docs/DEPLOYMENT.md` if that applies to you.
- **White-label branding** — set your own workspace name, logo, and accent
  color so the dashboard looks like your own product rather than
  "VentureOS."

## Questions or issues

Implemented governed actions write audit evidence to the **Audit Centre**. The
audit system is retention- and erasure-governed; it is not an undeletable
transparency log. For security issues, follow the repository root
[`SECURITY.md`](../SECURITY.md) rather than putting sensitive details in a
public issue.
