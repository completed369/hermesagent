# ADR-0014: Provider-neutral Runtime Broker foundation

**Status:** Accepted foundation

## Decision

Introduce a deterministic, provider-neutral Runtime Broker inside
`@ventureos/agent-control-plane`. The broker is a decision engine only. It does not invoke an
adapter, execute a command, mutate a task, or claim that any runtime is connected.

Eligibility is fail-closed and precedes scoring. A candidate must belong to the authenticated
workspace and provide correlated evidence for authenticated registration, capability exchange,
fresh heartbeat, and task/result round trip. `CONNECTED` asserted without those proofs is rejected.
The candidate must also satisfy exact capability and tool-scope requirements, data-sensitivity and
security policy, minimum reliability, latency and task-cost ceilings, runtime financial/compute
budgets, and concurrency capacity.

Only eligible candidates are scored. The default basis-point weights are quality 25%, reliability
25%, security 20%, latency 10%, cost 10%, and workload 10%. Requests may supply governed integer
weights containing exactly the six governed factors and totaling 10,000. Every component and the
final score are returned as explainable
decision evidence. Equal scores resolve deterministically by runtime ID and then connection ID.
No eligible candidate raises `NoEligibleRuntimeError` with the complete rejection evidence; it
never falls back to an unqualified runtime.

The broker owns its workspace-scoped candidate read model. Only configured control-plane authority
principals may ingest validated evidence; `route` accepts no caller-supplied candidates. Runtime
principals and telemetry endpoints therefore cannot route self-asserted `CONNECTED` flags, proofs,
grants, scores, or budgets. Future persistent implementations must snapshot the evidence/version
used for a decision and revalidate it at task claim time because routing evidence can become stale
after selection.

## Runtime truth boundary

Codex, Hermes, Pi, and all future runtimes remain `NOT_CONFIGURED` until their own authenticated
registration, capability exchange, heartbeat, task/status exchange, and event/result round trip are
verified. A favorable broker score, installed software, repository name, or adapter template is not
connectivity evidence.

## Deferred work

- persistent evidence snapshots and decision events;
- atomic reservation of capacity and budget at dispatch claim;
- learned performance scorecards based on evaluated outcomes;
- policy-version and model-version binding;
- real runtime adapters and authenticated Agent Bridge transport.

These remain separate reviewed increments. No provider is activated and no deployment or
publication behavior is introduced by this ADR.
