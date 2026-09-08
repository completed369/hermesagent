# Pet-Sitting Operations Tracker beachhead playbook

Status: **PRE-PUBLICATION / UNVALIDATED**

Evidence checked: **2026-09-08**

Selected beachhead: **solo pet-sitting and dog-walking owner-operators**

This package prepares a reviewable product and validation plan. It does not establish demand,
customer value, payment, delivery, revenue, profitability, or repeatability. No customer was
contacted, no listing was published, no provider was activated, and no payment was accepted while
creating it.

## Beachhead and problem hypothesis

The initial customer hypothesis is an independent operator who needs a small, local-first system to
track service visits, pet/client references, amounts collected, open balances, operating expenses,
and business mileage without adopting a team-oriented platform.

Current evidence supports testing that hypothesis, but does not validate it:

- Pet Sitters International's 2026 member survey reports that 99% of responding member businesses
  were independently owned, 68% expected revenue growth in 2026, and average 2025 gross revenue for
  U.S. member businesses was $112,423. These are member-survey observations, not total-market size or
  buyer-intent evidence.
- The American Pet Products Association reports 95 million U.S. pet-owning households and $158
  billion in total U.S. pet-industry expenditure in 2025. Total pet spending is not pet-sitting
  revenue and cannot be used as a serviceable-market estimate.
- Rover's operator-facing materials treat pet profiles, schedules, custom rates, client updates, and
  payment handling as core workflows. The workbook mirrors the minimal bookkeeping layer around
  those workflows; it does not replace a platform's safety, support, payment, or compliance systems.
- A 2026-09-08 marketplace snapshot found recent Etsy listings advertising comparable pet-sitting
  workbooks at observed one-time prices of $11.99, $17.99, and $19.99. This small convenience sample
  is volatile, seller-authored, and not evidence of sales, quality, conversion, or willingness to
  pay.

## Prepared offer

**Working name:** Pet-Sitting Business Operations Tracker

**Format:** one `.xlsx` file, local-only, six tabs, no macros or external refresh

**Core job:** turn visit, collection, expense, and mileage entries into a bounded weekly operating
view while minimizing stored sensitive data.

The workbook includes:

- a period-controlled dashboard for booked value, collected amount, outstanding balance, operating
  expenses, mileage estimate, net-cash proxy, visit status, and follow-up counts;
- visit, client/pet, expense, and service tables with 100-row working capacity;
- dropdown validation, conditional warnings, and formula-driven balance/follow-up logic;
- conspicuously synthetic `SAMPLE-*` rows that must be deleted before real use;
- in-workbook source notes, limitations, operator-review requirements, and privacy boundaries.

The dashboard's "net cash proxy" is deliberately not labeled profit. It does not account for fees,
tax, accruals, refunds, depreciation, owner labor, foreign exchange, or overlapping costs.

## Pre-publication acceptance evidence

The committed asset is acceptable for a bounded Founder review only when all of these remain true:

1. Its SHA-256 and byte length match `ASSET_MANIFEST.json`.
2. The XLSX opens as an Office Open XML ZIP and contains no macro, external-link, or connection entry.
3. All six sheets render without clipped required content or formula errors.
4. The saved sample dashboard reconciles to $88 booked, $40 collected, $48 outstanding, $38.50
   operating expenses, $12.60 mileage estimate, and a -$11.10 net-cash proxy.
5. A non-persisted scenario changing the partial payment to fully paid updates the collected amount,
   outstanding balance, collection count, follow-up count, and net-cash proxy.
6. A non-persisted mileage-rate scenario updates row and aggregate mileage estimates without changing
   operating expenses.
7. The repository's ordinary unit, formatting, artifact-hygiene, and security checks pass.

## Commercial validation ladder

Every step below is a hypothesis test. Passing an earlier step does not authorize a later step.

| Step | Test                          | Minimum evidence                                                                              | Authority                   |
| ---- | ----------------------------- | --------------------------------------------------------------------------------------------- | --------------------------- |
| 0    | Internal product review       | Workbook and claims pass the acceptance evidence above                                        | Safe in repository          |
| 1    | Listing-copy and image review | Founder approves exact copy, visuals, price hypothesis, terms, and channel                    | **FOUNDER-GATED**           |
| 2    | Bounded publication           | Exact approved artifact/hash appears on one approved channel                                  | **FOUNDER-GATED**           |
| 3    | Demand observation            | Impressions, visits, and attributed purchase intent are captured without invented attribution | **FOUNDER-GATED**           |
| 4    | Payment and delivery          | Provider-verified payment plus immutable delivery evidence tied to the exact asset hash       | **FOUNDER-GATED / LEVEL 4** |
| 5    | Refund/support window         | Refunds, disputes, support effort, and costs are reconciled before margin claims              | **FOUNDER-GATED / LEVEL 4** |
| 6    | Repeat run                    | A second approved cohort reproduces positive risk-adjusted contribution after known costs     | **FOUNDER-GATED / LEVEL 4** |

The initial price hypothesis for review is **$15–$19 one-time**, bracketed by the observed snapshot.
It is not approved pricing. A simple planning scenario of ten sales at $15 produces $150 gross before
fees, taxes, refunds, discounts, support, or production cost; it is neither a forecast nor revenue.

## Draft positioning (not approved for publication)

> A calm, local Excel tracker for solo pet sitters and dog walkers. Log visits, collected and open
> balances, operating expenses, and business miles in one place, with a compact monthly dashboard.
> Synthetic examples, dropdowns, and a five-step guide make setup visible. No subscription, macros,
> payment connection, or cloud account. This is an organizational tool—not accounting, tax, legal,
> veterinary, safety, or emergency advice.

Claims intentionally excluded: "profit," "tax ready," "IRS ready," guaranteed savings, guaranteed
time reduction, customer count, reviews, sales, outcomes, platform replacement, or professional
compliance.

## Data and safety boundaries

- Store only the minimum operational data needed. Do not place door or alarm codes, full addresses,
  bank/payment credentials, detailed health records, or emergency secrets in the workbook.
- Confirm service instructions, safety plans, completed work, receipts, and settled payments in the
  relevant authoritative systems before acting or making claims.
- Sanitize any exported copy and disclose its period and assumptions.
- Do not treat sample figures or formulas as evidence of a real customer or transaction.
- Publication, customer contact, payment, provider activation, spend, terms, refunds, and commercial
  commitments remain outside this package and require explicit Founder authority.

## Evidence sources

- Pet Sitters International, “Industry Statistics and Facts,” checked 2026-09-08:
  https://www.petsit.com/industry-stats-and-facts
- American Pet Products Association, “2026 State of the Industry,” checked 2026-09-08:
  https://americanpetproducts.org/2026-state-of-the-industry
- Rover Help Center, “Why should I run my pet care business on Rover?”, checked 2026-09-08:
  https://support.rover.com/hc/en-us/articles/206351003-Why-should-I-run-my-pet-care-business-on-Rover
- Etsy listing snapshots, checked 2026-09-08 (seller-authored observations only):
  - https://www.etsy.com/listing/4544896007/pet-sitting-client-tracker-spreadsheet
  - https://www.etsy.com/listing/4514361148/pet-sitting-business-tracker-google
  - https://www.etsy.com/listing/4529359949/pet-sitting-business-spreadsheet-dog

## Authority state

- `PUBLICATION`: **FOUNDER-GATED**
- `CUSTOMER_CONTACT`: **FOUNDER-GATED**
- `PAYMENT_OR_PROVIDER_ACTIVATION`: **FOUNDER-GATED / LEVEL 4**
- `COMMERCIAL_COMMITMENT`: **FOUNDER-GATED / LEVEL 4**
- `REVENUE`: **UNVERIFIED / NONE RECORDED BY THIS PACKAGE**
- `DELIVERY`: **UNVERIFIED / NONE RECORDED BY THIS PACKAGE**
- `CODEX`, `HERMES`, `PI`, `runtimeConnection`: **NOT_CONFIGURED**
