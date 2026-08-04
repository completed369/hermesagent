# API Design

REST, NestJS, global prefix `/api`. OpenAPI docs served at `/api/docs` via
`@nestjs/swagger` (generated from decorators, not hand-maintained).

## Phase 1 endpoints

| Method | Path                    | Auth                   | Purpose                                      |
| ------ | ----------------------- | ---------------------- | -------------------------------------------- |
| POST   | /api/auth/login         | none                   | Email/password login, sets session cookie    |
| POST   | /api/auth/logout        | session                | Revokes session, clears cookie               |
| GET    | /api/auth/me            | session                | Current authenticated user + permissions     |
| GET    | /api/workspaces/current | session                | Workspace summary + integration status       |
| GET    | /api/onboarding         | session                | Founder onboarding profile                   |
| PUT    | /api/onboarding         | session                | Save onboarding profile                      |
| GET    | /api/audit-events       | session + `audit:view` | Append-only audit trail                      |
| GET    | /api/security-events    | session + `audit:view` | Security event log                           |
| GET    | /api/health/live        | none                   | Process-local liveness; no dependency access |
| GET    | /api/health/ready       | none                   | Bounded DB, storage, and Temporal readiness  |
| GET    | /api/health/temporal    | none                   | Non-mutating Temporal gRPC health check      |

Health response, timeout, redaction, and worker-readiness contracts are defined
in `docs/HEALTH_CHECKS.md`.

## Conventions

- All request bodies validated with Zod before touching the database (fail
  closed on invalid input — see `onboarding.dto.ts` for the pattern).
- All responses are JSON; errors always `{ statusCode, message, correlationId, timestamp }`
  via `SafeExceptionFilter` — internal error detail is logged, never returned.
- Every response includes an `x-correlation-id` header (set by
  `CorrelationIdMiddleware`, echoing the caller's own ID if provided).
- Idempotency keys for sensitive mutating operations are planned for Phase 3
  (approvals, product generation) — not needed yet since Phase 1 has no
  financially-sensitive mutations.

## Rate limiting

Global default: 120 requests / 60s per client (configurable via
`API_RATE_LIMIT_MAX` / `API_RATE_LIMIT_WINDOW_MS`), enforced by
`@nestjs/throttler` as an `APP_GUARD`.
