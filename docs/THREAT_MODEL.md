# Threat Model

Status legend: **Mitigated** (control exists in code) · **Partially
mitigated** · **Not yet addressed** (planned for a specific phase).

| Threat | Status | Notes |
|---|---|---|
| Prompt injection / indirect prompt injection | Not yet addressed | No agents running yet (Phase 3); principle documented in `EVIDENCE_MODEL.md` |
| Malicious/poisoned research source | Not yet addressed | Phase 5 |
| Secret leakage (logs) | Mitigated | `redactSecrets` on every structured log line |
| Secret leakage (source/docs) | Mitigated | `.env.example` only, `.gitignore` excludes `.env`, grep-checked before commit |
| Excessive agent tool permissions | Not yet addressed | No agent runtime yet; cost/timeout env vars exist as a placeholder |
| Approval bypass | Partially mitigated | `isApprovalValidForExecution` implemented + tested; no real approval flow wired yet (Phase 3) |
| Hash mismatch (approved artefact changed) | Mitigated (mechanism) | Same function; hashing via `hashObject` |
| Duplicate external execution | Not yet addressed | Idempotency keys planned Phase 3+ |
| Cross-workspace data exposure | Mitigated | Every query scoped by `workspaceId` from the server-verified session, not client input |
| Malicious file upload | Mitigated | MIME allowlist, size limit, path-traversal rejection |
| Path traversal | Mitigated | Object-key validation in storage provider |
| SQL injection | Mitigated | Prisma parameterized queries exclusively; one raw query (`SELECT 1` health check) has no interpolated input |
| Cross-site scripting | Partially mitigated | React auto-escapes; no `dangerouslySetInnerHTML` anywhere in Phase 1 code |
| Cross-site request forgery | Partially mitigated | `sameSite=lax` cookie + CORS allowlist; no dedicated CSRF token yet |
| Session theft | Partially mitigated | httpOnly/secure/sameSite cookie; session token not hashed at rest (see SECURITY.md) |
| Brute-force login | Partially mitigated | Global rate limiter; no login-specific lockout yet |
| Dependency compromise | Not yet addressed | No dependency scanning has run (no network access in this sandbox); CI workflow includes a placeholder step |
| Audit-log tampering | Partially mitigated | Integrity hash per event, append-only application code path; DB-level immutability (REVOKE UPDATE/DELETE grants) not yet configured |
| Destructive commands | Mitigated (Phase 1 scope) | No destructive endpoints exist yet; soft-delete columns present on `User`/`Workspace` |
| Unbounded AI cost | Not yet addressed | Env vars for limits exist (`AI_PER_*_COST_LIMIT_EUR`); no agent runtime to enforce them yet |
| Denial of service | Partially mitigated | Rate limiting; no WAF/CDN layer (out of scope for local dev) |
| Container escape | N/A | No containers built/run in this sandbox |
| Insecure backup / retention failure | Not yet addressed | Phase 1 has no backup automation; `docs/BACKUP_AND_RECOVERY.md` documents the intended procedure |

This table will be re-scored at the end of every phase.
