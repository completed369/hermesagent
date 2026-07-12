# Privacy & GDPR

## Phase 1 posture

No real customer personal data is collected anywhere in this build —
enforced by policy (`.env.example` comments, master spec rule "real
customer data during development: prohibited") rather than by a technical
filter, since Phase 1 has no customer-facing data collection surface at
all. The only personal data in Phase 1 is the founder's own account
(email, display name) and session metadata (IP, user agent) — necessary for
authentication and security auditing.

## Data inventory (Phase 1)

| Data | Purpose | Retention |
|---|---|---|
| User.email, displayName | Authentication, display | Until account deletion (soft delete) |
| User.passwordHash | Authentication | Until account deletion |
| Session.ipAddress, userAgent | Security auditing | Until session expiry/revocation |
| SecurityEvent.ipAddress, userAgent, description | Security auditing | Indefinite (append-only) — retention policy TBD Phase 2+ |
| AuditEvent.before/after (JSON) | Governance auditing | Indefinite (append-only) — must never contain secrets (enforced by convention + redaction at the logging layer, not yet at the audit-write layer) |

## Not yet implemented

Personal-data export/correction/deletion endpoints, consent tracking,
processing records, subprocessor register, DPAs, breach-response process,
formal privacy-impact assessment, data-residency decision. All required
before any real customer data is collected (Phase 6 marketplace pilot at
the earliest, and only with explicit founder approval per governance
rules).

## Design-by-default reminder for future phases

When evidence collection (Phase 5) or customer data (Phase 6) is added,
every new personal-data field must be added to the data inventory table
above in the same PR that introduces it — this document must never fall
out of sync with the schema.
