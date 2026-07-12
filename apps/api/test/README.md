# API integration tests

These tests boot the real Nest application and talk to a real PostgreSQL
database (via `DATABASE_URL`). They are NOT run as part of `test:unit` and
require local infrastructure:

```
pnpm db:migrate
pnpm db:seed
pnpm --filter @ventureos/api test:integration
```

Status: written but **not executed in this sandbox** - there is no Docker or
network access here to run Postgres. See docs/SANDBOX_LIMITATIONS.md and
docs/LOCAL_VERIFICATION_CHECKLIST.md.
