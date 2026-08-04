# Private-staging deployment template

Phase 21A installs this as a reviewed template only. It must not be deployed until the founder separately authorizes publication and deployment and all external prerequisites are verified.

## Required non-secret inputs

- `STAGING_API_ORIGIN`: founder-approved, stable, private HTTPS API origin.
- `STAGING_WEB_ORIGIN`: founder-approved, stable, private HTTPS web origin, distinct from the API origin.
- Five `VENTUREOS_*_DIGEST` values from one validated and attested image manifest.
- `SECRET_ROOT`: an existing host path rendered by the approved secrets vault. Phase 21A does not create it.

The public web origin and API origin are build inputs. The web image is invalid if its compiled `NEXT_PUBLIC_API_BASE_URL` does not exactly match `STAGING_API_ORIGIN`.

## Credential boundaries

`ventureos_bootstrap` is the PostgreSQL initialization administrator and is never an application credential. `ventureos_owner` cannot log in. The migrator is a member of the owner role and its provisioned URL must contain `options=-c%20role%3Dventureos_owner`; the tools entrypoint rejects a URL that does not explicitly assume that role. The application role receives only DML and sequence rights. Temporal owns only its two databases. The backup role receives read-only application-table and sequence access after `20-privileges.sql` is applied.

Secret files are mounted read-only. VentureOS API, worker, and tools images translate supported `*_FILE` values in their fail-closed entrypoint. Direct values and matching file values cannot coexist.

## Ordered future initialization (not authorized in Phase 21A)

1. Validate the five-image manifest, signatures, SBOMs, provenance, origins, external image pins, secrets, free disk, backup target, and restore plan.
2. Initialize PostgreSQL roles and databases once through the official PostgreSQL entrypoint.
3. Run the `initialize` profile once to create/update Temporal schemas and create `ventureos-staging`. Future schema changes use the separate `upgrade` profile, which never reruns `setup-schema`.
4. Run the migration profile with the separate migrator connection.
5. Run the `grant-runtime` profile to apply post-migration application and backup grants.
6. Start the bounded steady-state services without publishing host ports.
7. Verify private Access/Tunnel, TLS, health, metrics, alerts, backup completion, and a restore test before accepting staging.

Temporal `auto-setup` is intentionally absent from this deployment template. It remains only in disposable local/security-gate topologies and is digest-pinned there.

The pinned Temporal server is the sole steady-state service without a read-only root filesystem: its upstream entrypoint renders `/etc/temporal/config/docker.yaml` at startup. It still drops all capabilities, sets `no-new-privileges`, runs as the upstream non-root user, has no host port, and is bounded by CPU, memory, PID, and log limits. A future image upgrade may remove this documented exception if upstream supports a secret-safe writable-config mount.

## Fail-closed blockers

The template cannot render without all five application digests, stable origins, and secret paths. It is not evidence that GHCR, GitHub environments, private Access/Tunnel, TLS, monitoring, alerts, object storage, backup encryption, or restore testing exists. Those remain external publication/deployment gates.
