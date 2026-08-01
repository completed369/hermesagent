# Security

## Implemented in Phase 1

- Password hashing: scrypt with random per-password salt, constant-time
  verification (`packages/auth/src/password.ts`).
- Server-side sessions: an opaque random 32-byte token is returned only at
  creation time. The database stores a deterministic SHA-256 digest in
  `Session.tokenDigest`; incoming tokens are digested before equality lookup.
  Expiry and revocation remain server-enforced.
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
- Append-only audit log with integrity hashing (tamper-evident, not
  tamper-proof — see limitations).
- Integration records start disabled (`Integration.writeEnabled=false`; seed
  creates mock/disconnected records). Current marketplace, payment, advertising,
  and AI safety comes from hardcoded mock-only implementations; the global flags
  and `writeEnabled` are not yet runtime provider-dispatch gates.
- Secrets are referenced, never stored: `SecretReference.reference` holds an
  env var name or external-secret-manager key, never a value.
- `.env.example` contains only placeholders; `.gitignore` excludes `.env`.

## Deferred / not yet implemented

Multi-factor authentication; account recovery; dependency vulnerability
remediation and SAST/secret scanning in CI;
malware scanning for uploaded files (integration point noted in code, no
scanner wired); OpenTelemetry export; a non-mutating/internal Temporal health probe; atomic
single-writer approval decisions; subscription/plan enforcement; and fail-closed
runtime provider kill-switch wiring.

## See also

`THREAT_MODEL.md` for the threat-by-threat status, `PRIVACY_GDPR.md` for
data handling, `KNOWN_LIMITATIONS.md` for the consolidated gap list.
