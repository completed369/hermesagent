# Local Setup — Windows 11

## Prerequisites

- Windows 11
- PowerShell 7+ (`winget install Microsoft.PowerShell`) — the scripts in
  `scripts/` target PowerShell 7 (`pwsh`), not legacy Windows PowerShell 5.1
- Git for Windows
- Node.js 22 LTS
- Corepack (ships with Node 22; enables pnpm) — `corepack enable`
- Docker Desktop, configured to use the WSL2 backend, **running** before you
  start infrastructure
- At least 16 GB RAM recommended (Temporal + Postgres + MinIO + Node dev
  servers concurrently is not lightweight)
- This repository at `D:\Projects\ventureos` (or wherever you place it — the
  scripts use the repo root, not a hardcoded path)

## First-time setup

```powershell
cd D:\Projects\ventureos
.\scripts\preflight.ps1          # checks everything above, fails fast with clear messages
.\scripts\setup-local.ps1        # copies .env.example -> .env, generates dev secrets, pnpm install
.\scripts\start-infrastructure.ps1   # docker compose up -d (postgres, temporal, temporal-ui, minio)
.\scripts\start-development.ps1  # prisma generate + migrate + seed, then pnpm dev
```

## Everyday use

```powershell
.\scripts\start-infrastructure.ps1   # if not already running
.\scripts\start-development.ps1
# ... work ...
.\scripts\stop-development.ps1       # stops docker compose services; Ctrl+C stops the dev servers
```

## Running the full validation suite

```powershell
.\scripts\run-validation.ps1
```

Runs, in order, and stops at the first real failure: format check → lint →
typecheck → unit tests → integration tests → production build. See
`LOCAL_VERIFICATION_CHECKLIST.md` for what each step proves and what to do
if one fails.

## Local service addresses (defaults from `.env.example`)

| Service | Address |
|---|---|
| Web app | http://localhost:3000 |
| API | http://localhost:3001 |
| API docs (Swagger) | http://localhost:3001/api/docs |
| Temporal UI | http://localhost:8088 |
| MinIO console | http://localhost:9001 |
| PostgreSQL | localhost:5432 |

## Founder dev login

Email/password come from `DEV_FOUNDER_EMAIL` / `DEV_FOUNDER_PASSWORD` in
your local `.env` (defaults: `founder@ventureos.local` /
`change-me-dev-only` — **change the password default before doing anything
beyond local testing**). Created by `pnpm db:seed`.

## Troubleshooting

- **`running scripts is disabled on this system` / `UnauthorizedAccess` /
  `PSSecurityException`** → PowerShell's default execution policy blocks
  unsigned local scripts. Fix once per user account:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```
  Or bypass it for a single run without changing the policy:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\preflight.ps1
  ```

- **`pnpm: command not found`** → run `corepack enable` then re-open your
  terminal.
- **Docker Desktop not running** → `preflight.ps1` will catch this and tell
  you to start it.
- **Port already in use** → another process is using 3000/3001/5432/7233/
  8088/9000/9001; stop it or change the relevant `*_PORT` variable in `.env`.
- **`prisma migrate dev` fails with a connection error** → confirm
  `docker compose ps` shows `postgres` as `healthy`, and that `DATABASE_URL`
  in `.env` matches the `POSTGRES_*` values in the same file.
- Anything else → see `LOCAL_VERIFICATION_CHECKLIST.md`'s "first error to
  report back" section.
