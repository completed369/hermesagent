# Security

## Implemented in Phase 1

- Password hashing: scrypt with random per-password salt, constant-time
  verification (`packages/auth/src/password.ts`).
- Server-side sessions: opaque random token (32 bytes) stored in
  `Session.sessionToken` with a unique DB index. **Known gap**: the token is
  stored as plaintext in the DB rather than hashed-at-rest; acceptable for a
  single-founder dev deployment but flagged in `KNOWN_LIMITATIONS.md` as a
  hardening item (hash the token before storing, compare hashes) before any
  multi-user or production deployment.
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
- File upload validation: MIME allowlist, size limit, path-traversal
  rejection (`packages/integrations/src/storage`).
- Append-only audit log with integrity hashing (tamper-evident, not
  tamper-proof — see limitations).
- Write-enabled integrations start disabled (`Integration.writeEnabled`
  defaults to `false`; seed creates all three Phase 1 integrations as
  `DISCONNECTED`/mock).
- Secrets are referenced, never stored: `SecretReference.reference` holds an
  env var name or external-secret-manager key, never a value.
- `.env.example` contains only placeholders; `.gitignore` excludes `.env`.

## Deferred / not yet implemented

CSRF token enforcement (currently relying on `sameSite=lax` + CORS
allowlist — acceptable for Phase 1's same-origin-in-practice setup but not
a complete CSRF defense); multi-factor authentication; account recovery;
dependency scanning / SAST in CI (workflow file exists but hasn't run);
malware scanning for uploaded files (integration point noted in code, no
scanner wired); OpenTelemetry export.

## See also

`THREAT_MODEL.md` for the threat-by-threat status, `PRIVACY_GDPR.md` for
data handling, `KNOWN_LIMITATIONS.md` for the consolidated gap list.
