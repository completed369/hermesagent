# ADR-0027: Rollback and restore readiness contracts

## Status

Accepted as a source-only, non-deploying foundation.

## Decision

VentureOS separates code rollback from data restore. An automatic code rollback
is eligible only when an exact prior source SHA, all five prior image digests,
recorded healthy-component evidence, and an explicit
`BACKWARD_COMPATIBLE_CODE_ROLLBACK` migration decision are bound into one
canonical hash. `FORWARD_FIX_ONLY` and `RESTORE_REQUIRED` decisions deny the
automatic code-rollback path.

The production rollback surface is pure validation and evidence completion. It
cannot restart a process or release. It returns `VERIFIED` only when a caller
supplies a post-action observation with the exact prior source, exact digests,
and all required health checks. Command acceptance is not rollback success.
Failure-injection tests deny completion for source, digest, health, or canonical
evidence-hash drift.

The database package likewise exports only pure restore-evidence completion. It
accepts only target names beginning `ventureos_restore_drill_`, exact-binds the
observed backup reference, content checksum and creation time, validates backup
age against both a maximum age and the declared RPO, and verifies migration
head, sentinel digest, health, cleanup, and RTO. A test-only Linux CI harness
uses `pg_dump`/`pg_restore` with the disposable CI PostgreSQL service, restores a
fresh database, verifies real restored rows and migration history, then removes
the target before completing evidence.

## Security and truth boundaries

- Neither production contract discovers backups, reads object storage, invokes
  a provider, creates/destroys a database, deploys a release, or supplies a
  production driver.
- The restore integration fixture proves one real `pg_dump`/`pg_restore`
  round-trip and cleanup against disposable CI PostgreSQL. It is not evidence
  for managed PITR, encrypted retention, off-site copies, object-storage
  restore, Temporal recovery, or a live environment restore.
- Evidence checksums detect accidental/caller-visible drift; they are not a
  signature or a cryptographic tamper-proof log.
- RPO and RTO values in tests/templates are synthetic acceptance inputs, not
  Founder-approved production objectives.
- A real restore, backup-provider activation, credential use, staging or
  production mutation, and acceptance of operational RPO/RTO remain Level-4
  boundaries.

## Consequences

Release automation can later compose these contracts with trusted artifact,
health, migration, and backup readers. Until that separately reviewed work
exists, repository source establishes readiness policy and disposable evidence
only; it does not establish a deployed rollback or backup capability.
