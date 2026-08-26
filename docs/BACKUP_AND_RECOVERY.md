# Backup & Recovery

## Current-state note

This document was originally written during Phase 1, before later migrations,
staging-gate topology, and private-staging templates existed. Historical Phase 1
claims such as "no production data worth backing up" are no longer useful as
current-state guidance. Repository evidence still does not establish production
backup automation or a completed production restore drill.

## Evidence boundaries

Keep these states separate:

- **Local development**: developer-operated Docker volumes and manual `pg_dump`
  commands can snapshot local data.
- **Local/container staging gate**: `docker-compose.staging.yml` uses disposable
  volumes and intentionally removes them during cleanup. This is not backup
  evidence.
- **Private-staging templates**: `deploy/private-staging/` contains deployment
  and database-role groundwork, including a backup-role concept, but repository
  configuration alone does not prove that an external staging environment,
  backup target, schedule, encryption policy, or restore drill exists.
- **Production**: production backup/restore automation, retention, monitoring,
  and restore rehearsal are not established by repository evidence alone and
  require separate founder-approved operational work.

## PostgreSQL local development snapshot

Local dev snapshot:

```powershell
docker compose exec postgres pg_dump -U ventureos ventureos > backup.sql
```

Local dev restore into the local database:

```powershell
cmd /c "docker compose exec -T postgres psql -U ventureos ventureos < backup.sql"
```

Data also persists in the named Docker volume `postgres-data` across
`docker compose down`, but not across `docker compose down -v`. Docker volumes
are convenience persistence, not a backup strategy.

## MinIO / object storage local development snapshot

The local development `minio-data` volume persists uploaded files across local
container restarts. For a point-in-time backup, use the MinIO client (`mc mirror`)
or an equivalent object-store backup path to a separate bucket/host. That backup
automation is not configured by the repository's local development Compose file.

## Before destructive or data-transforming migrations

Per master spec rule 22 ("back up before destructive migrations"), any migration
that drops, renames, rewrites, or materially transforms production data requires,
before execution:

1. founder-approved change window and rollback plan;
2. recent encrypted backup;
3. restore rehearsal to a fresh target;
4. migration-status check plan;
5. explicit decision on rollback migration or forward-fix strategy.

Applied Prisma migrations are immutable. Never edit an already-applied migration
in place. Add a new forward migration for new schema changes.

## Restore procedure outline

For a real restore rehearsal or incident response, adapt this outline to the
selected environment:

1. Stop API and worker processes so no new writes occur.
2. Restore the PostgreSQL dump/PITR snapshot into a fresh database target.
3. Restore or mirror object storage to the matching point in time where needed.
4. Point `DATABASE_URL` and storage configuration at the restored targets.
5. Run Prisma generate/status checks; do not run destructive reset commands.
6. Start one API and one worker instance.
7. Verify `/api/health/ready`, worker readiness, Temporal visibility where
   applicable, and representative tenant/application reads.
8. Record the restore evidence, duration, data timestamp, and any data loss
   against the approved RPO/RTO.

`packages/database/src/restore-drill.ts` and
`docs/ROLLBACK_RESTORE_READINESS.md` now define pure, fail-closed restore-drill
evidence completion. Its test-only CI fixture performs a real logical
`pg_dump`/`pg_restore`, verifies content and migration evidence in a fresh
disposable PostgreSQL database, and removes it. This does not prove a provider
backup, managed PITR, encryption, retention, off-site storage, Temporal
recovery, or a real-environment restore.

The same source-only slice records an explicit migration-compatibility decision
before code rollback. A prior release may be reported as restored only after its
exact source SHA, all five image digests, and required health checks are observed;
restart-command acceptance is not success.

## Production-grade backup automation still required

Before production or commercial launch, implement and verify:

- encrypted PostgreSQL backups or managed PITR with retention and access audit;
- off-host/off-account backup copy where feasible;
- object-storage versioning/replication or an independent mirror;
- Temporal persistence backup/restore design appropriate to the selected
  Temporal topology;
- backup-age and backup-failure alerts;
- periodic restore drills;
- founder approval for permanent deletion or destructive production changes.

No paid backup, storage, monitoring, or cloud service should be activated without
founder approval.
