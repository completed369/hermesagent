# ADR-0038: Codex authenticated registration translation

## Status

Accepted as inert, unauthorized registration-candidate evidence.

## Decision

Join four independently validated facts before a Codex runtime can become a
durable registration candidate:

1. the exact reviewed Codex app-server manifest and policy hashes;
2. a pristine initialized app-server protocol state before thread creation;
3. an authenticated, unexpired VentureOS bridge identity including workspace,
   runtime, connection, session, principal, nonces, secret reference digest,
   and authentication generation; and
4. a correlated `account/read` response observed inside that authenticated
   bridge window with `refreshToken: false`.

Only managed ChatGPT and key-backed OpenAI account declarations are accepted.
Absent accounts, alternate providers, experimental externally managed tokens,
login operations, token refresh, response-ID drift, non-Codex identities,
post-thread protocol states, expired evidence, and forged manifest wrappers are
rejected.

The output contains normalized authentication class, correlation identifiers,
timestamps, and SHA-256 hashes. Email, plan, raw account response, credentials,
tokens, task text, and result text are not retained. The shared sensitive-text
canonicalizer remains authoritative; key-backed evidence is normalized to
`KEY` before hashing rather than weakening that protection.

## Runtime truth and authority

An `account/read` declaration is not a provider round trip and does not prove
that a task can execute. This component does not send the request, start login,
refresh a token, read an authentication store, resolve a secret, provision a
runtime, write the database, launch a process, open a transport, contact a
provider, dispatch a task, or change status.

Every candidate says `registrationAuthorization: NOT_CONFIGURED` and
`runtimeConnection: NOT_CONFIGURED`. Durable provisioning still rejects named
Codex runtimes, the database adapter allowlist remains unchanged, and the
production secret source and process launcher remain deny-only. Codex, Hermes,
and Pi remain `NOT_CONFIGURED`.

## Next safe slice

Add a separately reviewed, control-plane-only durable Codex registration
operation that consumes the exact candidate hash, retains only normalized
evidence, and remains `NOT_CONFIGURED`. It must preserve idempotency, tenant
isolation, secret-reference handling, audit correlation, and the existing
prohibition on capability, heartbeat, dispatch, or connection promotion until
their own evidence is accepted.

## Source

- <https://learn.chatgpt.com/docs/app-server>
