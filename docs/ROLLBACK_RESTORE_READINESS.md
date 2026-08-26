# Rollback and restore readiness

## Release rollback checklist

Before a founder-authorized deployment, prepare a reviewed record containing:

- current source SHA;
- prior source SHA and the prior API, web, worker, tools, and ingress image
  digests;
- dated prior health evidence for PostgreSQL, Temporal, API, worker, web, and
  both ingress relays;
- current and prior migration heads;
- one migration decision:
  `BACKWARD_COMPATIBLE_CODE_ROLLBACK`, `FORWARD_FIX_ONLY`, or
  `RESTORE_REQUIRED`;
- the evidence hashes and rollback owner.

Only `BACKWARD_COMPATIBLE_CODE_ROLLBACK` permits automatic code rollback. After
restart, re-read the source identity, five digests, and every health target.
Treat a restart command as attempted work, not success. Any mismatch is an
incident and must not be reported as a verified rollback.

## Restore drill evidence template

The source contract records these fields:

| Field                            | Meaning                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| backup reference/checksum/age    | Exact synthetic or approved backup identity and observed age    |
| RPO/RTO                          | Acceptance targets supplied for this drill                      |
| migration decision/evidence hash | Exact compatibility decision associated with the restore        |
| restored migration head          | Migration identity read from the disposable restored target     |
| restored sentinel digest         | Known data digest read from the disposable restored target      |
| health verified                  | Readiness query succeeded after restore                         |
| duration                         | Trusted-clock elapsed time compared with the supplied RTO       |
| cleanup verified                 | Disposable target removal completed before evidence returned    |
| evidence hash                    | Deterministic drift checksum; not a signature/tamper-proof seal |

Template values for a future environment must be decided from business impact,
backup-provider capability, measured restore duration, retention, and cost. Do
not copy the synthetic test values into an operational policy.

## Current evidence

Repository tests exercise source/digest/health drift, migration-decision denial,
backup-age and RPO/RTO rejection, migration/sentinel/health failure, cleanup
failure, and a fresh disposable PostgreSQL database round-trip in Linux CI.

No external environment is backed up or restored by these tests. No image is
published, no staging or production deployment is changed, no provider is
activated, and no credential is introduced. This disposable round-trip does not
prove a real backup or operational restore capability.
