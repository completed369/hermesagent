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
- Uses a 3-second operation timeout for PostgreSQL and object storage, and one
  3-second absolute connection/RPC deadline for Temporal. Temporal connection
  cleanup is awaited and may finish after its RPC deadline.
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
through a lazy `@temporalio/client` connection, with one 3-second absolute
connection/RPC deadline. The health RPC establishes connectivity as needed;
creating the lazy connection object does not itself issue a workflow or
application-level RPC. The helper owns the connection and awaits `close()` in
`finally` before it settles. Cleanup may therefore complete after the RPC
deadline when necessary. There is no outer timeout that returns while an owned
connection continues cleanup in the background. The operation is read-only and
creates no workflow execution or history. It returns HTTP 200 with
`temporal: ok`, or HTTP 503 with `temporal: down`, including when the RPC,
deadline, or cleanup fails.

Repeated calls are safe with respect to workflow state. Regression tests forbid
workflow start, execute, signal, update, terminate, and cancel calls from the
health path, and disposable Temporal verification confirms the workflow count
does not change after repeated requests. Public responses never include
Temporal addresses, namespaces, task queues, exception messages, or stack
traces.

## Worker liveness and readiness

The worker exposes private, container-network-only endpoints on its configured
`WORKER_HEALTH_PORT`: `/health/live` reports that the health server process is
serving, while `/health/ready` becomes `ok` only after the Temporal connection,
Worker construction, and task-queue run-loop entry. Shutdown immediately marks
the worker unready. Neither endpoint starts or mutates a workflow. These signals
do not replace Temporal task-queue poller, queue-latency, and task-failure
monitoring in a real staging environment.

## Exposure and monitoring

All three routes are currently public and protected by the global request-rate
limit. Responses are deliberately generic. External infrastructure should poll
`/api/health/live` for process liveness and `/api/health/ready` for traffic
readiness. `/api/health/temporal` is retained for compatible component-specific
diagnostics; it is not a worker execution test.
