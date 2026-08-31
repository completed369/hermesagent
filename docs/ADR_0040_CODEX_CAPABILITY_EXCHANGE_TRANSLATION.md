# ADR-0040: Codex capability-exchange translation

## Status

Accepted as inert, unauthorized capability-candidate evidence.

## Decision

Translate one already-observed stable Codex app-server `model/list` exchange
only after revalidating the exact ADR-0038 authenticated registration
candidate. The request must use `includeHidden: false` and a bounded positive
limit. The response must correlate to the request, contain one non-empty page,
and declare `nextCursor: null`; incomplete or hidden catalogs are rejected.

Every model entry is exact-shaped. Model identifiers must be unique and
self-consistent, exactly one model must be the default, and only the reviewed
stable input modalities and reasoning-effort values are accepted. Unknown,
duplicate, malformed, experimental, or internally inconsistent declarations
fail closed. Evidence must be observed no earlier than registration and no
later than five minutes afterward.

The output retains only normalized catalog capability codes, counts,
correlation and registration bindings, timestamps, and SHA-256 hashes. Raw
responses, display names, model identifiers, descriptions, credentials,
prompts, task content, and result content are not retained. Capability codes
are catalog claims, not execution claims.

## Runtime truth and authority

The translator performs no I/O. It does not send `model/list`, start or attach
to a process, open a transport, contact a provider, write the database,
dispatch work, accept heartbeat, or change runtime status. Every candidate
says `capabilityAuthorization: NOT_CONFIGURED`,
`providerAccess: NOT_CONFIGURED`, and `runtimeConnection: NOT_CONFIGURED`.

A separate, short-lived authorization request binds the exact candidate,
registration, capability policy hash, and idempotency key. Its production
source denies by default. This authorization is necessary but not sufficient
for any future durable acceptance and grants no provider or execution
authority. Codex, Hermes, and Pi remain `NOT_CONFIGURED`.

## Next safe slice

Add a tenant-scoped immutable durable acceptance boundary bound to the exact
ADR-0039 registration row and an independently verified capability policy.
It must leave connection status `NOT_CONFIGURED` and must not admit heartbeat,
dispatch, result, artifact, usage, or connected-state evidence.

## Source

- <https://learn.chatgpt.com/docs/app-server>
