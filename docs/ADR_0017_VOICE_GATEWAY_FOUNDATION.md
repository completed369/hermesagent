# ADR-0017: Provider-neutral governed Voice Gateway foundation

**Status:** Accepted foundation

## Decision

Introduce a deterministic, provider-neutral Voice Gateway policy model inside
`@ventureos/agent-control-plane`. This increment defines microphone-permission and
push-to-talk state transitions, STT/TTS/realtime adapter contracts, evidence-qualified
browser/local fallback metadata, transcript proof and replay controls, bounded redaction and
retention rules, AI COO command routing, authority enforcement, Level-4 confirmation boundaries,
and sanitized stop, replay, and history abstractions.

Voice is an untrusted input surface, not an execution runtime. A session may move from permission
request to ready, recording, transcription, routing, and response states only through explicit
transitions. Permission denial, unavailable capture, illegal transitions, stopped sessions,
unsupported adapters, false browser fallback, or unavailable providers fail closed. The model does
not request browser permissions or capture audio; it records policy state around those future UI
operations.

Only a final transcript envelope bound to the authenticated workspace, principal, session, selected
STT adapter, positive sequence, nonce, timestamp, byte count, and proof may route. A mandatory
trusted verifier checks the envelope. Proofs and session sequences are one-use, transcripts must be
fresh, and oversized audio declarations or UTF-8 transcripts fail before routing. Raw audio is
never accepted or persisted by this model. Raw transcripts remain ephemeral inputs: history stores
only a SHA-256 hash and, when explicitly selected, a dedicated redacted session copy. Secret-like
credentials, authorization values, private-key markers, and email addresses are redacted from both
transcript and response history. Raw or sensitive retention modes are unsupported.

The routing request is a narrow, immutable contract for an injected AI COO port. It carries only
workspace/principal/session correlation, a transcript hash, the redacted transcript, the `VOICE`
source, and an executable-authority ceiling of Level 3. It cannot carry provider options, tools,
commands, URLs, credentials, environment variables, arbitrary runtime input, or hidden reasoning.
The gateway does not invoke a runtime, create a task, dispatch an adapter, or treat a routing
decision as execution evidence.

## Authority and secure confirmation

A deterministic authority evaluator runs before AI COO routing. Denied principals produce a
sanitized denial without invoking the router. A routine decision cannot exceed the principal's
authority. Any Level-4 command must be returned explicitly as `LEVEL_4`, include an exact target,
and produce a `SECURE_CONFIRMATION_REQUIRED` requirement limited to the protected UI plus WebAuthn
or MFA. `voiceConfirmationAccepted` is permanently false in this contract. Spoken acknowledgments,
voice biometrics, replayed speech, or a model response can never approve, assign, execute, deploy,
publish, spend, or weaken policy. The existing AI COO foundation intentionally has no
approval-to-execution transition, and this ADR does not add one.

## Provider and fallback truth

STT, TTS, and realtime ports are interfaces only. Adapter metadata records kind, provider/model,
status, execution availability, network mode, credential mode, fallback flag, capability-evidence
identifier and timestamp, byte/text limits, latency, quality, cost, availability, and data policy.
Browser-local status requires verified browser capability, `LOCAL_BROWSER`, `OFFLINE`, and no
credential. External providers cannot claim browser-local availability and require explicit egress
and scoped credentials. Registration does not call the adapter or prove a live provider.

Replay creates only a plan to synthesize a previously sanitized response. It never reroutes the
transcript or replays an action. History is workspace- and principal-scoped and bounded. Stop is
terminal for the voice session; it does not claim cancellation of an already assigned Agent Control
Plane runtime run, whose separate one-use cancellation permit remains authoritative.

## Security properties tested

- illegal microphone and push-to-talk transitions;
- permission denial and unavailable capture;
- interim/spoofed final transcripts and invalid proof;
- proof, sequence, and cross-session replay;
- stale/future, oversized audio, and oversized transcript input;
- cross-workspace, cross-principal, cross-session, and wrong-adapter linkage;
- unsupported providers and false browser/local fallback;
- hidden fields and private-reasoning payloads;
- authority denial and Level-4 routine-outcome bypass;
- raw-retention attempts and secret/contact-data leakage;
- bounded history, sanitized replay, and terminal stop behavior.

## Explicit non-capabilities

This foundation creates no browser media capture, audio transport, streaming connection, provider
SDK call, paid-provider activation, external network request, provider credential, persistent audio,
database schema, API endpoint, web UI, deployment, publication, DNS change, Cloudflare mutation,
runtime connection, or production action. Codex, Hermes, and Pi remain `NOT_CONFIGURED` until their
separate authenticated registration, capability exchange, heartbeat, task/status exchange, and
result/event round-trip evidence exists. Voice is not live merely because these contracts exist.

## Deferred work

- browser UI permission and button-down/button-up capture with blur/visibility-loss handling;
- ephemeral opaque audio handles and bounded frame/duration/content-type validation;
- real STT/TTS/realtime adapter implementations behind reviewed provider policy;
- durable encrypted session/history storage with deletion and retention jobs;
- authenticated API integration, rate limits, CSRF/origin policy, telemetry, and audit events;
- explicit AI COO intent-to-objective translation and protected Founder decision-card integration;
- streaming, interruption/barge-in, mobile/PWA controls, and evidence-backed briefings;
- golden evaluation suites for ambiguity, injection, authority, redaction, latency, quality, and cost.

Every deferred capability must preserve tenant isolation, provider abstraction, budget limits,
observable evidence, fail-closed authority, and the protected Level-4 approval path.
