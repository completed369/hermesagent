# Sandbox Limitations

This repository's Phase 0/1 source code was written inside Cowork's
sandboxed Linux environment. That environment has two hard limitations that
made real execution impossible for this run:

## 1. No outbound network access to package registries

Verified by direct test during this build:

```
$ curl -sI https://registry.npmjs.org/     → 403 blocked-by-allowlist
$ curl -sI https://pypi.org                → 403 blocked-by-allowlist
$ curl -sI https://github.com              → 403 blocked-by-allowlist
$ curl -sI https://registry.hub.docker.com → 403 blocked-by-allowlist
```

Consequence: `pnpm install` cannot run, so no `node_modules` exist, no
`pnpm-lock.yaml` exists, TypeScript cannot type-check against real library
types, and nothing can be built or bundled.

**Possible fix**: if this Cowork workspace belongs to a Team/Enterprise
organization, an org Owner may be able to widen the network allowlist under
Admin settings → Capabilities. On an individual plan, there is likely no
such control — local execution is the only path.

## 2. No Docker

```
$ docker --version → command not found
```

Docker is not installed in this sandbox image at all — this is not a policy
toggle and (unlike network access) is not expected to be fixable by any
admin setting. Consequence: `docker compose up` cannot run, so PostgreSQL,
Temporal, Temporal UI, and MinIO cannot be started, migrated against, or
health-checked from here, regardless of network access.

## What this means for "Phase 1 complete"

Every Phase 1 acceptance criterion that requires running software (web app
starts, API starts, migration succeeds, seed succeeds, tests pass, build
passes) is **honestly unverified** by this session. The source code is real
and was reviewed as thoroughly as static analysis allows (see the
structural-validation notes in the final phase report), but "the code looks
correct" and "the code runs correctly" are different claims, and this
document exists so that difference is never blurred.

## What WAS possible and was done

- All JSON config files parsed for validity (`package.json`, `tsconfig*.json`)
- `docker-compose.yml` parsed as valid YAML
- Every `.ts`/`.tsx` file checked for balanced braces
- Every `@ventureos/*` cross-package import checked against actually-declared
  package names
- Grepped for TODO/FIXME markers in mandatory Phase 1 code (none found) and
  for hardcoded-secret patterns (none found beyond documented dev-only
  placeholders)
- Every finance/scoring/policy calculation was manually traced by hand
  against its unit test's expected values during writing (see
  `FINANCIAL_MODEL.md` for one worked example)

None of this substitutes for actually running `pnpm install`, a compiler, or
a test runner. See `LOCAL_VERIFICATION_CHECKLIST.md` for exactly what to run
locally and what to report back if something fails.
