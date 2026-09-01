# ADR-0049: Explicit executable authorization verifier

## Status

Accepted as a deny-by-default supervisor trust boundary.

## Context

The trusted supervisor composition already required a fresh authorization decision and a signed
Linux executable authorization. Its validation path, however, was coupled to the repository's
pinned deterministic test key and required `testOnly: true`. The reviewed Codex app-server policy
requires `testOnly: false`, so no non-test authorization could pass the supervisor even if a future
trusted authority supplied it.

Replacing that pinned verifier with ambient configuration or silently accepting a structurally
valid authorization would collapse the executable trust boundary. The verifier must be explicit,
shared across the decision, evidence, admission, and launch-time revalidation paths, and absent by
default in production.

## Decision

Introduce `LinuxExecutableAuthorizationVerifier` as the sole signature and trust-root verification
port for Linux executable authorizations. The trusted supervisor composition and per-admission
Linux evidence reader default to `DenyLinuxExecutableAuthorizationVerifier`. The API composition
root injects the same deny instance into both components and exposes only that instance through its
dependency-injection token.

The repository's pinned-key implementation is retained as
`TestOnlyLinuxExecutableAuthorizationVerifier`. Tests must inject it explicitly wherever filesystem
evidence is acquired or a positive supervisor plan is expected. The legacy two-argument admission
validator remains deterministic-test-only; the supervisor uses a distinct validation entry point
that requires an explicit verifier. This also prevents an ignored third argument from becoming
caller-selected trust authority.

One adversarial composition test uses an exact test-local verifier to demonstrate that a
production-shaped, `testOnly: false` Codex manifest can traverse the generic supervisor contract
only when authority is explicitly injected. The same input is rejected by the default composition
before evidence access. The test-local verifier is neither exported as production configuration nor
wired into the API.

## Consequences and limits

This change removes the test-key coupling from the generic supervisor contract without adding a
production trust root. It creates no signer registry, key distribution, revocation backend,
executable authorization source, launcher, process, stream, credential, provider access, durable
runtime mutation, deployment, or publication. Production authorization verification and process
launching still deny every request.

The pinned test key remains test-only and cannot validate a non-test authorization. Deterministic
hashes remain correlation evidence rather than authority. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`.

## Next safe slice

Define a separately reviewed, bounded trust-record format and verifier for explicitly supplied
production public keys, with exact signer, adapter, test-only scope, validity, and revocation
evidence. Keep the production composition unconfigured until an authorized trust source exists.
Only then can the supervised process/stream handoff and real-process validation exercise proceed
without weakening the deny-by-default boundary.
