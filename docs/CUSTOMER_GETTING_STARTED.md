# Getting Started with VentureOS

This guide is written for a new customer using VentureOS, not for a
developer working on VentureOS itself. If you're looking for the internal
build documentation, see the rest of the `docs/` folder and `README.md`.

## 1. Create your workspace

Go to the sign-up page and fill in:

- **Workspace name** — your company or agency name. This becomes part of
  your workspace's identity and can be changed later in Settings.
- **Your name and email** — used for your own login.
- **Password** — at least 8 characters.

You'll land straight in your dashboard on a 14-day free trial (the
**Trial** plan): full feature access, one venture. No credit card is
required to start, and nothing is ever charged automatically — VentureOS's
billing is currently a real subscription record with no live payment
processor behind it yet, so upgrading or changing plans in Settings never
results in an actual charge.

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

Clicking "Promote to Venture Proposal" starts the venture lifecycle: your
AI board reviews it (Board Room), you approve or reject the board's
recommendation (Approval Centre), and — once approved — VentureOS
generates the actual product and listing draft (Product Studio / Listing
Studio). Every one of these steps needs your explicit approval before
anything moves forward; nothing publishes or spends money without you
deciding to let it.

## 5. See all your ventures in one place

The **Ventures** page lists every venture you've started, side by side,
with links into each one's Board Room, Finance Centre, and Product page.
Your plan sets how many concurrent ventures you can run at once — check
your usage against your limit right there, and upgrade from Settings if
you need more room.

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

Everything VentureOS does on your behalf is recorded in the **Audit
Centre** — if you're ever unsure why something happened, that's the first
place to look. It shows every action, who (or what) took it, and when.
