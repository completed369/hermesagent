# Backup & Recovery

**Status: documented procedure, not automated (Phase 1 has no production
data worth backing up yet — this is prepared ahead of need).**

## PostgreSQL

Local dev: `docker compose exec postgres pg_dump -U ventureos ventureos > backup.sql`
to snapshot; restore with `docker compose exec -T postgres psql -U ventureos ventureos < backup.sql`.
Data also persists in the named Docker volume `postgres-data` across
`docker compose down` (but not `docker compose down -v`).

## MinIO

Named volume `minio-data` persists uploaded files across restarts. For a
point-in-time backup, `mc mirror` (MinIO client) to a second bucket/host —
not configured yet.

## Before any destructive migration

Per master spec rule 22 ("back up before destructive migrations"): always
`pg_dump` before running a migration that drops or renames a column/table.
No destructive migrations exist yet (Phase 1 is the very first migration).

## Restore procedure (once real data exists)

1. Stop the API and worker processes.
2. Restore the Postgres dump into a fresh database.
3. Point `DATABASE_URL` at the restored database.
4. Run `pnpm db:generate` (Prisma client must match schema).
5. Restart API and worker.
6. Verify `/api/health/ready` reports `database: ok`.

## Production-grade backup automation

Deferred until there is production data (Phase 6+): scheduled `pg_dump` to
object storage, retention policy, restore-drill runbook, and — per master
spec — permanent deletion always requires a separate founder approval on
top of any automated retention/cleanup job.
