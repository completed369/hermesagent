# Director research provider implementation

Status: HTTP transport and receipt validation implemented; not connected to the director's durable execution loop. No live request or spend has been made by this implementation's tests.

## What this change adds

The package-private Anthropic adapter sends one bounded Messages request with the basic server-side web-search tool. It accepts a configured model and a short research instruction, requests at most three searches and 4,096 output tokens, and bounds the response body to 512 KiB and the request to 90 seconds. The adapter does not select a permanent niche or marketplace. Its versioned research prompt asks for buyer problems, feasible offers, supporting sources, and a bounded experiment with success and stop conditions.

The request digest binds the workspace, run, compute ceiling and exact provider body. Immediately before HTTP dispatch a required callback receives that frozen binding. The callback must durably claim the attempt once and enforce current owner authority, pause state, task assignment, provider quote and reserved funds. There is no default callback and no API composition in this change. Existing capability policy still denies Anthropic dispatch; staging stays mock-only. Both AI_MODEL_EXECUTION and RESEARCH_RUN audited dispatch contexts are required by the adapter.

This is one replaceable provider implementation. It does not make Anthropic a product-wide dependency or enable arbitrary provider URLs. Package exports prevent consumers from importing this raw transport through the public runtime API.

## Receipt behavior

| Receipt               | Meaning                                                                                                                   | Required downstream action                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| AWAITING_VERIFICATION | A completed provider turn contains a report with at least two distinct native citations bound to returned search results. | Persist privately, independently verify claims and sources, then decide whether the task succeeded.      |
| REJECTED              | A response was received but its content, limits, usage or completion state failed validation.                             | Preserve available usage and reconcile liability; do not report a completed task or automatically retry. |
| OUTCOME_UNKNOWN       | HTTP, transport or response-size failure prevents a reliable outcome.                                                     | Retain the reservation and reconcile with provider evidence; never assume zero cost.                     |

Receipts carry request/response digests, requested/reported model, provider message ID when valid, observation time, token/cache/search usage, and normalized cited text. Unexpected usage fields or charge modes require review. Known usage survives invalid content and observed limit overruns. Provider error bodies, transport exception text, search queries and opaque encrypted search state are not included in receipts. This is not a monetary ledger: no provider tariff, exchange rate, invoice, settlement or revenue is inferred here.

A source URL appearing in the provider response is not proof of factual accuracy, ownership, freshness or safety to fetch. URL checks reject obvious non-public forms, but do not resolve DNS or establish SSRF safety. A later verifier must independently validate evidence with restricted network access, DNS and redirect checks. Display citations with their original links and render report text as untrusted content.

There are no automatic retries, pause-turn continuations, redirects, client tools, code execution, publication or customer messages. A new attempt requires new durable dispatch authority and funding treatment.

## Remaining work before activation

1. Compose a tenant-scoped execution service with the existing director instruction/project/task/run records. Transactionally claim one attempt and reserve the full reviewed provider quote; prevent duplicate sends across workers and recovery. Recheck pause, owner, assignment and entitlement immediately before dispatch.
2. Approve a specific model/version and tariff snapshot. The output/search limits constrain requests, but returned search text and server-side token consumption can exceed the observed compute ceiling. This adapter detects that overrun afterward; it does not guarantee a prepaid hard input-token cap. Resolve worst-case reservation, provider-level spending limits and any residual liability before enabling paid execution.
3. Persist receipts and actual usage idempotently, including provider-success/database-failure and timeout recovery. Reconcile every uncertain attempt before releasing funds. Record costs using exact monetary arithmetic and reviewed pricing dimensions.
4. Minimize and classify instructions before sending them to an external provider. The prompt's privacy instruction is advisory and cannot safely replace deterministic exclusion of secrets and confidential passages from provider input.
5. Verify source claims independently. Transition the task only after verification, record actual artifacts and costs, and return a truthful result to the owner through the existing authenticated director channel. Never label research, simulated balances or subscriptions as realized customer profit.
6. Connect persisted execution events to the company-world display: queued, researching, verifying, awaiting owner decision, completed or failed. Animation must reflect these events; it must not invent work or earnings.
7. Run end-to-end acceptance in the permitted environment before any live capability-policy change. Keep private staging mock-only and review activation separately from this transport implementation.

## Validation and reference

Synthetic HTTP fixtures exercise successful cited reports, both capability gates, production-only dispatch, claim failure, workspace/run/limit digest binding, incomplete turns, forged and missing citations, unsupported tools, HTTP-200 search errors, transport/HTTP/oversized outcomes, unfamiliar charge modes, missing usage and usage overruns. Public API tests reject raw transport exports and deep imports. These tests perform no network calls.

The implementation follows the [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create) and [web-search tool response format](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), reviewed on 2026-09-11. Recheck compatibility when selecting a live model or changing the pinned tool version.
