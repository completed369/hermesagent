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

The rollback executor is an inert orchestration contract. Its caller supplies a
trusted driver and it returns `VERIFIED` only after the restarted release is
observed with the exact prior source, exact digests, and all required health
checks. Command acceptance is not rollback success. Failure-injection tests deny
success for source, digest, or health drift.

The database package also provides a disposable PostgreSQL restore-drill
orchestrator. It accepts only target names beginning
`ventureos_restore_drill_`, validates backup age against both a maximum age and
the declared RPO, verifies migration head, sentinel digest, health, and RTO, and
always destroys the target before returning evidence. CI uses a synthetic
snapshot and a fresh disposable PostgreSQL database. The evidence schema records
the exact decision and measurements and includes a deterministic checksum.

## Security and truth boundaries

- Neither contract discovers backups, reads object storage, invokes a provider,
  deploys a release, or supplies a production driver.
- The restore integration fixture proves disposable orchestration and database
  cleanup. It is not evidence for `pg_dump`, managed PITR, encrypted retention,
  off-site copies, object-storage restore, Temporal recovery, or a live
  environment restore.
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
