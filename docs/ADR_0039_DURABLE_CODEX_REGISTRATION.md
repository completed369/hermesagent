# ADR-0039: Durable Codex registration evidence

## Status

Accepted as a control-plane-only, deny-by-default registration boundary.

## Decision

Permit the reviewed `CODEX_APP_SERVER_STDIO_V1` adapter kind only through a
dedicated durable registration operation. The operation requires:

1. level-3 trusted control-plane authority for the exact workspace;
2. a revalidated ADR-0038 candidate whose initial authentication generation is
   one;
3. a separate trusted authorization decision, bound to the exact workspace,
   runtime, connection, principal, candidate hash, and idempotency key, with a
   database-clock-checked lifetime of at most five minutes; and
4. a scoped `PROVISION` secret lease whose reference and derived digest
   reproduce the candidate's one-way secret-binding hash.

The write is serializable and tenant-scoped. Candidate, idempotency, runtime,
connection, authorization, principal, secret, policy, environment, and replay
drift are rejected. The immutable evidence table stores only normalized
references, timestamps, authentication class, and SHA-256 hashes. It has no
email, plan, credential, token, raw account response, prompt, transcript, task,
result, or artifact field.

## Runtime truth and production authority

Successful registration creates the runtime and connection with status
`NOT_CONFIGURED`; it does not establish capability exchange, heartbeat, task
round trip, provider access, or connectivity. The production composition uses
`DenyCodexRegistrationAuthorizationSource` and the existing deny-only secret
resolver, so the operation cannot succeed there until both sources receive
their own reviewed configuration.

This change adds no controller, API route, process launch, transport, network,
provider request, login, refresh, deployment, spend, or Level-4 action. Codex,
Hermes, and Pi remain `NOT_CONFIGURED`.

## Next safe slice

Define the authenticated Codex capability-exchange translation and durable
acceptance boundary. It must be exact-bound to this registration evidence and
the authenticated bridge identity and must not accept heartbeat, dispatch, or
connected status until their separate evidence exists.

## Source

- <https://learn.chatgpt.com/docs/app-server>
