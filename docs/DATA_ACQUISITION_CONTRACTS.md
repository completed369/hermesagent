# Data Acquisition Contracts

**Status: specified, not implemented (Phase 5 — Research Connectors).**

Every data connector must document: source, purpose, access method,
authentication, allowed/prohibited operations, rate limits, expected
schema, freshness, retry policy, failure handling, retention, personal-data
classification, ToS considerations, geographic limitations, monitoring, and
a disable switch (master spec section 16).

Preferred sources, in order: official APIs → public exports →
founder-provided data → permitted browser research → permitted manual
imports. Never: bypass access restrictions, authentication, or CAPTCHAs;
masquerade as a user to access private data; collect unnecessary personal
data; store credentials in source code; ignore marketplace terms.

No connector has been built yet — `AI_PROVIDER=mock` and
`MARKETPLACE_ETSY_MODE=mock` in `.env.example` mean Phase 1/2/3 development
can proceed without any external data acquisition at all.
