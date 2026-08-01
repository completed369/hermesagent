# Health Checks

VentureOS exposes public, non-mutating process and dependency health endpoints.
Health endpoints never start, execute, signal, update, terminate, or otherwise
write workflow state. They also never call AI providers, marketplaces, payment
systems, or email services.

## Liveness

`GET /api/health/live`

- Returns HTTP 200 while the API process can serve requests.
- Checks process-local state only.
- Does not query PostgreSQL or storage.
- Does not instantiate or connect a Temporal client.
- Is the Playwright and process-restart probe.

A liveness failure is suitable for restarting the API process. Dependency
outages must not turn liveness into a restart loop.

## Readiness

`GET /api/health/ready`

- Checks PostgreSQL, object storage, and Temporal concurrently.
- Bounds every dependency check to 3 seconds.
- Returns HTTP 200 only when every required component reports `ok`.
- Returns HTTP 503 with only `ok`/`down` component statuses when any dependency
  is unavailable or times out.
- Redacts exception messages, stack traces, addresses, connection strings,
  namespaces, task queues, and credentials.

Use readiness to add or remove an API instance from service. Do not use it as a
process-restart signal.

## Temporal compatibility probe

`GET /api/health/temporal`

This public compatibility route performs the standard gRPC Health `Check` RPC
through a lazy `@temporalio/client` connection, with one shared 3-second
connect/RPC deadline. The operation is read-only and creates no workflow
execution or history. It returns HTTP 200 with `temporal: ok`, or HTTP 503 with
`temporal: down`.

Repeated calls are safe with respect to workflow state. Regression tests forbid
workflow start, execute, signal, update, and terminate calls from the health
path, and disposable Temporal verification confirms the workflow count does not
change after repeated requests.

## Worker readiness limitation

Temporal server connectivity does not prove that a VentureOS worker is running,
that it loaded the expected workflow/activity bundle, or that it will continue
polling the configured task queue. Task-queue poller observations are transient
and are not represented as worker readiness. VentureOS will not start an
application workflow merely to probe a worker. Worker lifecycle monitoring must
instead use worker process supervision, worker logs/metrics, and Temporal
poller/task-queue observability.

## Exposure and monitoring

All three routes are currently public and protected by the global request-rate
limit. Responses are deliberately generic. External infrastructure should poll
`/api/health/live` for process liveness and `/api/health/ready` for traffic
readiness. `/api/health/temporal` is retained for compatible component-specific
diagnostics; it is not a worker execution test.
