# API Design

REST, NestJS, global prefix `/api`.

The checked-in, generated route inventory is
[`docs/api/API_INVENTORY.json`](api/API_INVENTORY.json). It is derived from
literal NestJS controller decorators and checked by `pnpm docs:api:check` as
part of the root script tests. Run `pnpm docs:api:update` after intentionally
changing a controller route.

Swagger attempts to generate `/api/docs` at application startup. Generation is
best-effort and deliberately cannot take down the API if decorator metadata is
incompatible with the runtime transpiler. Therefore `/api/docs` is not the
release contract and this repository does not claim a complete OpenAPI snapshot.
The generated inventory is a route-drift contract only: it does not describe
request/response schemas, permissions, side effects, or provider availability.

## Representative foundation endpoints

| Method | Path                    | Auth                   | Purpose                                      |
| ------ | ----------------------- | ---------------------- | -------------------------------------------- |
| POST   | /api/auth/login         | none                   | Email/password login, sets session cookie    |
| POST   | /api/auth/logout        | session                | Revokes session, clears cookie               |
| GET    | /api/auth/me            | session                | Current authenticated user + permissions     |
| GET    | /api/workspaces/current | session                | Workspace summary + integration status       |
| GET    | /api/onboarding         | session                | Founder onboarding profile                   |
| PUT    | /api/onboarding         | session                | Save onboarding profile                      |
| GET    | /api/audit-events       | session + `audit:view` | Immutable-content audit trail                |
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
- Sensitive implemented mutations use domain-specific idempotency and durable
  binding where required. An endpoint's presence in the generated inventory
  never establishes that its provider, publication, payment, or runtime side
  effect is enabled.

## Rate limiting

Global default: 120 requests / 60s per client (configurable via
`API_RATE_LIMIT_MAX` / `API_RATE_LIMIT_WINDOW_MS`), enforced by
`@nestjs/throttler` as an `APP_GUARD`.
