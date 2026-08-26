# Security

## Durable ACP task/run boundary

Durable ACP plan creation accepts only a trusted AI COO operational-event
capability. Assignment, start, artifact, failure, and completion mutations accept
only a trusted control-plane capability; runtime principals are denied. Separate
trusted evidence-verifier ports fail closed by default. Workspace identifiers
participate in all task/run graph keys and database relations, while immutable
policy hashes, optimistic versions, transition guards, cycle guards, and
transactional audit writes constrain drift and concurrent replay.

Level-4 prepared runs remain unassigned. The approval bridge locks and verifies
the current durable binding in the same transaction that creates the approval
request. Neither AI COO cards nor voice input provide authority, and this slice
contains no runtime dispatch or external execution path. Hashes are integrity
and drift evidence, not a claim of tamper-proof storage.

## Agent Bridge secret lease boundary

Bridge secret use is scoped to the exact workspace, runtime, connection,
authentication generation, durable digest, and purpose. Each use resolves a
fresh owned copy, validates a 32–4096 byte bound, and zeros owned secret and
derived-key copies in `finally`. JavaScript cannot guarantee physical erasure,
and the source and in-process consumer remain trusted boundaries. Production
is deny-only: there is no credential, file, environment, network, provider, or
process source in this slice. See ADR-0023.

## OS supervision admission policy

The pure ADR-0024 policy validates an exact cross-platform manifest against
short-lived trusted supervisor admission evidence that binds the exact normalized
manifest hash, approved adapter, executable, lexical worktree root, exact dense
argv hash, and argument-policy
reference. It rejects ambiguous paths, known shells/interpreters, sensitive
arguments, shell and network authority, environment values, test-only
provenance drift, lexical worktree escape, executable identity drift, and
unbounded resources. It does
not access a filesystem, resolve a path, launch a process, or close launch-time
TOCTOU. The deterministic positive evidence is test-local and the production
launcher remains deny-only.

ADR-0025 adds a fixed, repository-owned, test-only process-tree fixture that
exercises bounded cancellation semantics on Windows and Linux. Its process API
imports remain under `scripts/`, outside production package exports, build
output, and final images. It accepts no arbitrary executable or argv and does
not establish a production supervisor or a connected runtime.

## Implemented in Phase 1

- Password hashing: scrypt with random per-password salt, constant-time
  verification (`packages/auth/src/password.ts`).
- Server-side sessions: an opaque random 32-byte token is returned only at
  creation time. The database stores a deterministic SHA-256 digest in
  `Session.tokenDigest`; incoming tokens are digested before equality lookup.
  Cookie values must first match the exact 64-character lower-case hexadecimal
  token format; JSON-cookie objects, arrays, malformed text, and oversized input
  are rejected before hashing or database access.
  Expiry and revocation remain server-enforced. Each protected request uses one
  database-clock-bound projection of the exact session-selected workspace
  membership. Deleted users/workspaces, removed memberships, revoked or expired
  sessions, malformed permission keys, and roles exceeding the fixed permission
  bound fail closed. Foreign workspace memberships are not hydrated.
- httpOnly, sameSite=lax session cookie; `secure` flag auto-enabled in
  production (`NODE_ENV=production`).
- Server-side RBAC on every sensitive route (`SessionAuthGuard` +
  `PermissionGuard`), never a frontend-only check.
- Environment validation fails closed on boot (`@ventureos/config`).
- Structured logging with automatic secret redaction
  (`@ventureos/security` `redactSecrets`, key-pattern based).
- Safe error responses: internal detail (stack traces, DB errors) never
  reaches the client; only a generic message + correlation ID does.
- Rate limiting (120 req/60s default, configurable).
- Public-authentication abuse enforcement uses shared PostgreSQL state rather
  than the process-local global limiter: login is bounded by normalized-account
  and source-IP cooldowns, registration by source IP. Stored keys and related
  event metadata are domain-separated keyed digests; raw submitted identifiers
  and source addresses are not persisted in that state. Active cooldowns return
  controlled `429` responses with `Retry-After` and survive API restarts.
- Login verifies both existing and missing accounts through asynchronous scrypt
  work on libuv's worker pool. Registration returns a generic `202` with no
  session cookie for new, existing, and duplicate-email-race cases and enforces
  a validated 300 ms default response floor at the controller boundary for every
  admitted JSON registration request, including schema rejection. Malformed HTTP
  bodies and global guard/throttle rejections occur before the route and are not
  identifier-dependent. Workspace creation first attempts
  the preferred name-derived slug, then handles a concurrent slug collision with
  at most three fresh randomized-suffix retries. Every attempt atomically creates
  the user, founder profile, workspace, membership, and branding; exhaustion is
  a generic controlled failure that exposes no Prisma constraint detail.
- Proxy forwarding headers are ignored by default. `API_TRUST_PROXY_HOPS` must
  be set to the deployment's exact bounded trusted-hop count before Express uses
  a forwarded client address.
- CSRF protection: the global `CsrfOriginGuard` rejects authenticated unsafe
  methods unless the browser-supplied `Origin` exactly matches
  `API_CORS_ORIGIN`. Safe methods and cookie-less public authentication
  requests are intentionally exempt; this control supplements rather than
  replaces `sameSite=lax`.
- File upload validation: MIME allowlist, size limit, path-traversal
  rejection (`packages/integrations/src/storage`).
- Fixture seeding fails closed without explicit non-placeholder founder
  credentials and is disabled in production.
- The local founder password-reset utility normalizes the configured email before
  lookup, revokes sessions, and clears only that account's login cooldown in the
  same transaction; it never clears shared source-IP state.
- Tenant security-event reads exclude unscoped platform authentication
  telemetry. Experiment results bind workspace, route experiment, variant, and
  metric before insertion.
- Immutable audit-event content with versioned integrity checksums and
  workspace/source replay keys. Governed retention or erasure may delete rows;
  this is not an undeletable or administrator-resistant transparency log.
- Approval decisions use a conditional single-winner state transition; the
  winning request update and immutable decision evidence are committed in one
  transaction. Concurrent or stale decisions fail closed.
- ACP Level-4 approvals bind the exact workspace, objective, task, run, action,
  target, artifact, evidence digest, and policy version/digest. Only a current
  founder with `approval:decide` may decide. Founder identity comes from a
  trusted `CONTROL_PLANE` human capability and workspace context, never a
  caller-provided identifier; the decision transaction locks the matching
  authority records through commit. Requester authority is taken from a trusted
  principal capability (Level 0 cannot request). A trusted control-plane
  capability may issue and a specifically bound execution principal may claim
  one permit; consuming paths lock the request first (then the permit when
  applicable) and check the database clock only after locks are held, preventing
  a lock wait from carrying authority past expiry. A claim consumes
  authorization but performs no external action. Exact binding is revalidated
  even on idempotent approval and claim replays. Revocation, expiry, drift,
  source forgery, cross-workspace access, and replay conflict fail closed. AI COO
  cards and voice transcripts are never authority (ADR-0019).
- Integration records start disabled (`Integration.writeEnabled=false`; seed
  creates mock/disconnected records). Centralized capability policy enforces
  subscription state, trial expiry, active plan, feature entitlement, quotas,
  configured provider mode, and global switches at API admission, queued
  activities, direct runners, and implemented final-dispatch boundaries.
- Storage upload, signed-download, and existence operations require a matching
  workspace-prefixed key and perform centralized capability enforcement inside
  the provider implementation rather than trusting a caller-supplied callback.
  Direct provider calls record the final allow and fail closed if it cannot be
  persisted. Providers invoked inside an already-audited matching dispatch
  revalidate policy without duplicating that allow event; the audited context
  is server-owned and scoped to the matching async dispatch.
- Protected provider dispatch reloads authoritative raw environment values on
  every check. Missing, malformed, unknown, unavailable, mismatched, or disabled
  provider state denies with the generic public message `Operation is not
available`. Mock modes are explicit and never fall through to live behavior.
- Environment booleans are parsed strictly as the strings `true` or `false`;
  JavaScript truthiness coercion is not used. AI, storage, and marketplace
  provider selections are explicit required configuration.
- Research acquisition and each implemented mock marketplace draft, image, file,
  and publication call immediately revalidate current tenant ownership,
  contract/account/approval/prepared-attempt state, subscription/plan/quota,
  provider mode, feature switch, and policy availability before adapter
  dispatch. Policy denials propagate without ordinary failed-publication writes;
  worker policy denials are converted to non-retryable Temporal failures.
- Raw mock provider adapters are internal implementation modules and are not
  exported from package roots. Root-only package `exports` maps also reject
  unsupported compiled deep imports from marketplace, research, and agent
  runtime packages, so package consumers must use the capability-gated runners.
  Database-backed finance reads and mutations enforce `FINANCE_ACCESS` at the
  package boundary.
- Publication replay returns only the original
  tenant/listing/account/idempotency-key-bound success without provider
  dispatch, fresh rate reservation, or approval reuse. Recovery of an
  interrupted local success write conditionally transitions only the exact
  still-`RESERVED` publication row. API and worker callers audit that recovery
  as `PUBLICATION_REPLAYED`, not as another provider publication.
- Final allow events are recorded once at the dispatch boundary. Authorization
  fails closed if that final audit event cannot be persisted. Admission and
  intermediate defense-in-depth allows are silent; denials remain denied even if
  their durable, out-of-transaction audit write fails. Correlation references
  contain resource IDs or safe constants, never credentials, license keys,
  provider payloads, or personal identifiers.
- Venture and first-marketplace-account quotas serialize on the workspace's
  subscription row. Finance budget checks, ledger writes, allocation increments,
  and model-usage charges use one transaction and row locks where required.
- Storage object keys are workspace-namespaced and cross-workspace keys are
  rejected before provider I/O.
- MinIO is the one implemented external storage adapter. Upload requires
  `STORAGE_PROVIDER=minio`, `FEATURE_STORAGE_UPLOADS_ENABLED=true`, an active
  product-entitled subscription, and a fresh policy decision inside the MinIO
  upload method. `STORAGE_PROVIDER=mock` is the no-network validation mode.
- No live marketplace adapter exists. Live marketplace modes fail closed as
  unavailable before dispatch. A future adapter must additionally enforce the
  account/integration `writeEnabled` value at its own non-bypassable boundary.
- These last-moment checks are immediate best-effort TOCTOU mitigation, not a
  transactional lease over mutable database rows and process configuration. No
  database transaction is held across provider-shaped execution.
- Secrets are referenced, never stored: `SecretReference.reference` holds an
  env var name or external-secret-manager key, never a value.
- `.env.example` contains only placeholders; `.gitignore` excludes `.env`.

## Deferred / not yet implemented

Multi-factor authentication; account recovery; malware scanning for uploaded
files (integration point noted in code, no scanner wired); OpenTelemetry export;
worker/task-queue readiness monitoring; production runtime supervision and
authenticated adapters; real commercial billing verification; and live AI,
marketplace, payment, advertising, email, voice, and notification adapters.

CodeQL and source/workflow secret-pattern gates exist, but they do not prove
that every repository-host setting, dependency, artifact, or future provider
payload is safe. Security state must be re-queried for the exact release source.

## See also

The repository root `SECURITY.md` defines private reporting. `THREAT_MODEL.md`
contains threat-by-threat status, `PRIVACY_GDPR.md` covers data handling, and
`KNOWN_LIMITATIONS.md` is the consolidated gap list.
