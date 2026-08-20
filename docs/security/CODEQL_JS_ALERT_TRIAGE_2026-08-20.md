# CodeQL JavaScript alert triage — 2026-08-20

Scope: open alerts #14–26 on `completed369/hermesagent` main
`56450df103b74add0c5553b8d54e747eb4c1b587`. This record classifies reachability;
it does not dismiss or suppress any alert.

## Production-reachable boundaries

- **#14 (`js/command-line-injection`) — confirmed boundary weakness, not shell
  interpolation.** The secret adapter used `spawn` without a shell, so command
  arguments were not interpreted as shell syntax. However, container command
  overrides could select an arbitrary executable. The immutable API, worker and
  migration images now map only their three reviewed command signatures to
  literal executables and arguments; all overrides fail closed.
- **#17 (`js/request-forgery`) — defense-in-depth for a server-reachable helper.**
  Existing string concatenation prefixed every request with the configured API
  base and `/api`, so route parameters could not replace the origin. The helper
  now additionally requires an HTTP(S), origin-only base URL and a bounded
  root-relative path, then verifies the normalized URL remains on that origin
  and below `/api` before fetching.
- **#16 (`js/request-forgery`) — browser-side, not SSRF.** The same helper pattern
  executes in the user's browser and therefore cannot make a server-side request.
  It now shares the same URL barrier to prevent client-side origin or prefix
  escape and keep client/server behavior identical.

## Engineering, CI and synthetic-test boundaries

- **#15 (`js/command-line-injection`) — local/CI-only executable selection.** The
  Windows build regression script accepted `ComSpec` from its environment. Its
  command string was constant, but the executable was not. It now invokes the
  literal `cmd.exe` with fixed arguments.
- **#18 (`js/request-forgery`) — synthetic local load test.** The test no longer
  accepts a request target from the environment. It talks only to the disposable
  loopback API on port 3001; API-provided identifiers are encoded as single path
  segments.
- **#19–20 (`js/path-injection`) — synthetic local load-test output.** The result
  path is now the fixed repository `.staging/load-results.json`; the unused
  environment override was removed.
- **#21–24 (`js/path-injection`) — synthetic environment generator.** Generated
  credentials default to repository `.staging/phase15.env`. The staging gate may
  pass a custom `--target`, but it must be a direct, regular `.env` file in the
  repository `.staging` directory; traversal, nested paths, symlinks, and other
  CLI shapes fail closed. The gate validates this boundary even when the target
  already exists.
- **#25 (`js/path-injection`) — CI manifest validator.** The validator accepts
  only the repository-root `ventureos-images.json`, requires a regular file and
  caps it at 1 MiB before parsing.
- **#26 (`js/resource-exhaustion`) — synthetic local load-test delay.** The unused
  environment-controlled timer duration was removed; the reviewed 65-second
  rate-limit settling interval is constant.

## Security invariants

No production provider, external publication, deployment, customer data or
production infrastructure is involved in these changes. The staging load target
remains disposable and loopback-only. The image manifest and generated staging
environment remain repository-local. No CodeQL alert is dismissed or marked
false-positive by this work; alert closure depends on a fresh scan of the changed
data flows.
