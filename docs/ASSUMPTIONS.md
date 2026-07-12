# Assumptions

Recorded per master spec rule 39 ("record reasonable assumptions and
continue") whenever a decision was needed but not explicitly specified.

1. **Package manager versions**: pnpm 9.x, Node 22 LTS, TypeScript 5.6,
   NestJS 10.x, Next.js 14 (App Router), Prisma 5.x, Temporal SDK 1.11.x —
   chosen as current-at-writing stable versions; none have been installed or
   verified to actually resolve/interoperate in this sandbox.
2. **RBAC model**: two seeded roles for Phase 1 (`FOUNDER` with all
   permissions, `VIEWER` read-only) rather than the fuller role set the
   later phases will need — minimal viable RBAC that still enforces
   server-side authorization end to end.
3. **Session token storage**: stored as plaintext with a unique index
   rather than hashed-at-rest, accepted as a documented gap for a
   single-founder dev deployment (see `SECURITY.md`, `KNOWN_LIMITATIONS.md`).
4. **CI provider**: GitHub Actions assumed (`.github/workflows/ci.yml`)
   since the repo structure includes `.github/` per the required monorepo
   layout — not confirmed with the founder, easily swapped.
5. **Docker image versions**: pinned specific tags (postgres:16-alpine,
   temporalio/auto-setup:1.24.2, temporalio/ui:2.31.2,
   minio/minio:RELEASE.2024-10-13T13-34-11Z) for reproducibility; not pulled
   or verified to actually exist/work together in this sandbox (no Docker
   Hub access).
6. **Single workspace slug**: `ventureos-default`, used by both the seed
   script and any future workspace-scoped test fixtures.
7. **Founder default timezone**: Europe/Athens (founder's approximate
   region, inferred from currency default EUR + no timezone specified) —
   trivially changeable, stored per-`FounderProfile`.
8. **Project folder location**: relocated during the build per explicit
   founder instruction after the original folder was found to contain
   unrelated internal Hermes runtime state — see ADR-004.
