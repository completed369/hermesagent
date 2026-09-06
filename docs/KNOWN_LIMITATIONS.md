# Known Limitations

> **Release note (reviewed 2026-08-26):** VentureOS is not production-ready or
> production-deployed. The dated reviewed source baseline for this note is
> `d462733ec55a8bc98092e39a5a071c01b9c76806`; GitHub is authoritative for live
> repository main and checks, and generated protected Mission Control evidence
> is authoritative for live operations. Product PRs #59–#85 are
> merged, including the provider-neutral Agent Control Plane, Runtime Broker,
> Dynamic Agent Factory, verified runtime-interface ADR, tenant-shell switch
> repair, governed AI COO and Voice Gateway foundations, unified event/audit
> spine, approval execution-permit bridge, durable objective/project/task/run
> spine, durable protocol-neutral Agent Bridge admission, durable broker
> decision and capacity/budget reservation evidence, and the non-publishing
> release-candidate evidence workflow and its security hardening. The merged
> scoped bridge secret-lease boundary binds every request to its workspace,
> runtime, connection, authentication generation, and purpose. Provisioning
> derives the initial digest; authentication and frame verification bind to the
> durable digest. Production remains deny-only. Approval
> preparation now resolves exact workspace-scoped
> durable task and run rows instead of accepting caller-asserted work. These are
> repository capabilities, not proof that an external runtime, provider, image,
> or environment is active.
>
> Exact-main GitHub CI passed Prisma generation/validation, the full migration
> chain, seed, formatting, lint, typecheck, unit, integration,
> production build, Chromium E2E, and the disposable staging-security/load gate
> explicitly without deployment. Exact-main CodeQL passed, with zero open
> CodeQL alerts when checked on 2026-08-26. The sanitized five-image release-
> candidate workflow also passed its local build, security, identity, and final
> source-revalidation gates with zero uploaded artifacts and zero deployments.
> No image for current `main` has been published and current `main` has not been
> deployed to private staging.
>
> Codex, Hermes, and Pi remain **NOT_CONFIGURED** for product-status purposes.
> The merged interfaces and routing foundations do not establish connectivity;
> CONNECTED still requires authenticated registration, capability exchange,
> heartbeat, task/status exchange, and an event/result round trip. The Voice
> Gateway is a governed provider-neutral foundation, not an activated speech
> provider or a verified live voice service.
>
> The merged bridge is a service-only authenticated admission boundary proven
> with a deterministic test fixture; it has no transport, controller, network,
> or process-launch path and stops runtime truth at `PARTIAL`. Durable broker
> reservations now bind trusted agent and candidate evidence to the exact
> workspace, task, run, runtime, and connection while serializing short-lived
> capacity, cost, and compute holds. Those holds are routing evidence, not a
> runtime launch, provider charge, or connectivity proof. A Linux-only trusted
> executable/admission-evidence reader is composed behind a live per-admission
> authorization port. The production source and launcher are both deny-only;
> only test-local signed authorization is positive. Windows native identity
> inspection and actual process supervision/transport remain separate later
> changes. Real Codex, Hermes, and Pi adapters follow only after authenticated
> end-to-end evidence; repository installation or local process availability is
> not connection evidence.
>
> A service-only outbound foundation can prepare a short-lived, direction-bound
> `DISPATCH` authorization for an exact durable `PREPARED` dispatch. Its durable
> outbox row is metadata-only and has no `SENT` or delivery state; the signed
> envelope is not transmitted by this repository. Production secret resolution
> remains deny-only, runtime truth remains at most `PARTIAL`, and no real adapter
> becomes configured or connected. The database row is correlation metadata,
> not cryptographic authorization: its trigger cannot verify an HMAC, and any
> future consumer must re-sign or reverify through the trusted service boundary.
> A bounded internal egress-handoff claim can exclusively lease the ephemeral
> re-signed frame to the exact authenticated principal and actor kind for at
> most fifteen seconds; owner authority is not caller-authored. Its attempt and
> optional early release are append-only correlation metadata; natural expiry
> and later generations never rewrite history. Atomic audit applies to the
> authenticated service path only. A trigger-valid direct-writer row is
> unauthenticated correlation metadata without an automatic audit and must be
> re-signed/reverified before any future use. There is still no sender, delivery
> worker, transport, acknowledgement, or runtime-status promotion.
>
> Secret material remains unavailable in production. The scoped bridge lease
> interface is deny-only in the production composition root and has no file,
> environment, network, or provider backend. Its deterministic positive source
> is test-local and does not configure or connect a runtime.
>
> The OS-supervision admission policy is a pure path, digest, identity,
> platform, trusted lexical-worktree, exact-argument-policy, and resource-limit
> validator. It performs no
> executable discovery or filesystem inspection and cannot close path-swap or
> executable-replacement TOCTOU. Its validated output is inert; the production
> launcher still always denies.
>
> Codex is the first selected real-runtime interface, but only as an inert
> Linux app-server manifest policy. The policy admits the exact argument shape
> `app-server --listen stdio://` as a supervisor-manifest candidate; the
> general opened-file identity, digest, owner, worktree, resource, and signed
> authorization bindings remain separate prerequisites for any future launch. It
> rejects alternate listeners, wrappers, environment variables, secret
> handles, and network. It launches nothing, adds no database adapter kind,
> reads no Codex authentication, and grants no provider or runtime status.
> Production authorization and launching remain deny-only and Codex remains
> **NOT_CONFIGURED**.
>
> The Codex protocol state machine can construct and validate one bounded
> initialize/thread/turn/interrupt lifecycle. A separate JSONL transport now
> provides bounded reads and writes over already-open Node streams, including
> framing, timeout, cancellation, malformed-output, and byte-limit enforcement.
> A deterministic test-only composition now exercises both against a separate Node process and the
> authenticated runtime adapter (ADR-0055), including fail-closed wrong-secret and reported-tool
> cases. The same test-only process now proves one correlated `turn/interrupt` acknowledgement and
> interrupted terminal (ADR-0056). After that proof the adapter emits one authenticated cancellation
> evidence frame, and a tenant-bound immutable admission verifies its MAC and prevents completion and
> cancellation from both being retained for the same handoff (ADR-0057). No production source
> supplies a process or streams. Separate evidence-only paths now MAC-verify and immutably retain one
> exact accepted-status/result pair or one exact acknowledged-cancellation terminal without assigning
> the run or promoting connection truth. Synthetic or caller-supplied evidence is not a
> live provider round trip. There is still no production process launch,
> credential source, provider call, artifact admission, recognized usage/cost
> mapping for this path, or
> runtime promotion. Codex remains **NOT_CONFIGURED**.
>
> Authenticated Codex registration now has a dedicated durable evidence path.
> It requires an exact inert candidate, a separately trusted authorization of
> at most five minutes, and a scoped secret lease matching the candidate's
> one-way secret binding. Production authorization and secret resolution both
> deny by default, and the operation neither sends `account/read` nor proves
> provider access. Account details and credentials are not retained. A
> successful authorized write still leaves runtime and connection
> `NOT_CONFIGURED`; capability, heartbeat, task, and connected status are not
> promoted.
>
> Codex capability exchange now has an I/O-free stable `model/list`
> translator. It accepts only a complete non-hidden first page, rejects
> unknown or experimental catalog claims, hashes away model identity and raw
> catalog content, and produces catalog claims with capability, provider, and
> runtime truth all `NOT_CONFIGURED`. An immutable tenant-scoped durable
> acceptance path now binds that normalized candidate to the exact durable
> registration row, capability policy, idempotency key, and a separate
> five-minute authorization. The production authorization source is deny-only,
> and neither runtime nor connection capability/status fields are promoted.
> One Codex-specific immutable heartbeat evidence path now accepts a fresh,
> canonical VentureOS bridge-signed `HEARTBEAT` after the exact durable
> registration and capability rows. It verifies the runtime-to-parent MAC
> through a scoped secret lease and stores only normalized hashes and safe
> references. It is not a native Codex app-server heartbeat, controller, or
> transport; it intentionally does not update connection heartbeat/status
> fields. One separately authorized zero-spend validation `DISPATCH` can now be
> prepared and signed against an exact ready/unassigned `quality.verify` run.
> Its frame is ephemeral and explicitly `NOT_SENT`; it creates no assignment,
> broker reservation, provider call, task/run mutation, or connection claim.
> A separate immutable one-shot egress claim can now expose that exact frame to
> an injected local byte-write port for at most five seconds. The controller
> defaults to denial, burns an attempted claim instead of retrying an ambiguous
> write, and treats local byte acceptance as neither delivery nor
> acknowledgement. The separate already-open-stream JSONL transport is not
> wired to this controller and has no positive production composition. An
> immutable evidence operation now verifies the exact runtime-to-parent MACs
> for a sequence-2 accepted status and sequence-3 terminal validation result,
> binds them to the claimed handoff, and deliberately leaves the ready run
> unassigned and all runtime truth unchanged. The cancellation counterpart
> verifies one sequence-2 `CANCELLED` envelope bound to the exact interrupt
> acknowledgement and interrupted terminal, stores only normalized hashes and
> safe references, and is database-exclusive with completed evidence for that
> handoff. It likewise leaves the ready run unassigned and runtime truth
> unchanged. Both terminal paths now retain only bounded, domain-separated
> progress and token-usage-notification counts/digests (ADR-0058). Raw token
> values are discarded, observations remain unmapped, and recognized cost and
> compute are fixed at zero with no usage or cost-ledger write. A bounded one-shot process-session
> coordinator now authenticates before requesting injected streams and withholds terminal bridge
> output until exact exit evidence and stream destruction (ADR-0059). Its production owner is
> deny-only: there is still no positive Codex process launcher, production OS cleanup/crash recovery,
> real authenticated provider round trip, or connected-state transition; Codex remains
> **NOT_CONFIGURED**.
> Append-only process-session claims and cleanup rows now survive service restarts and are required
> by database triggers before new validation terminal evidence (ADR-0060). They expose unfinished
> claims for a future recovery composition, but no recovery worker consumes them and the cleanup
> hash remains owner-reported integrity evidence rather than independent OS-process proof.
> The coordinator's durable authority port now orders claim before stream open and completion
> before terminal egress (ADR-0061), but its default denies and no production service binds it to
> those durable operations by default. A Level-3 control-plane adapter can now bind the port to the
> exact durable methods (ADR-0062), but no service supplies it alongside a positive owner, secret
> resolver, or transport. A separate bounded Level-3 recovery inventory can list only that
> workspace/principal/actor owner's claims with no cleanup completion, using the database clock to
> distinguish active from expired rows (ADR-0063). Expired unfinished claims can now be serialized by
> one immutable 15-second recovery lease at a time (ADR-0065), but no recovery worker consumes it and
> it supplies no process signal, termination, retry, cleanup proof, or status promotion. Claim insertion now rejects
> owner, actor, state, expiry, and time-window drift from its trusted handoff, and service replay
> rechecks the complete durable binding (ADR-0064). This closes metadata poisoning; it does not make
> the future process owner or cleanup evidence independently trustworthy.
> Completion insertion now locks its claim and database-enforces the complete dispatch binding,
> `NOT_CONFIGURED` truth, and close-time window; idempotent replay rechecks every cleanup field
> (ADR-0066). The cleanup hash is still owner-reported rather than independent OS-process proof.
> An active recovery lease now carries an atomic frozen supervisor/dispatch work item (ADR-0067),
> but it contains no PID or native handle and cannot inspect, signal, terminate, or complete a
> process. Reusable PID lookup is explicitly insufficient recovery authority.
> A shared active-only validator now rejects malformed, stale, extended, secret-bearing, or
> runtime-promoting recovery work items (ADR-0068). This validates metadata only; no retained native
> identity or independent OS-process evidence exists in production.
> A shared exit-evidence contract now requires an independently retained native launch identity and
> revalidates the lease after observation (ADR-0069). Its production source denies, so this is not
> retained identity, process action, cleanup completion, or runtime connectivity in production.
> Durable recovery-completion admission now stores exact retained-identity exit evidence before one
> matching cancellation cleanup under the active lease (ADR-0070). No production evidence source or
> cleanup actor is composed, so abandoned native processes are still not acted on automatically.
> A shared recovery coordinator now orders evidence before durable completion, rejects same-lease
> concurrency, and rechecks expiry immediately before the completion port (ADR-0071). Both production
> ports still deny and no worker invokes the coordinator.
> A Level-3 recovery-completion authority adapter now snapshots one exact lease work item, durable
> dispatch, caller context, and idempotency key before delegating to serializable completion
> (ADR-0072). No positive evidence source or worker is composed, so production recovery remains inert.
> An active recovery lease now returns its validated immutable durable dispatch and work item as one
> serializable bundle; expired replay returns both as null (ADR-0073). This adds no worker, retained
> native identity, cleanup action, or runtime connectivity.

> The proposed Linux evidence reader opens one exact path with no-follow and
> non-blocking flags, inspects and hashes the same opened regular file, verifies
> a short-lived signed authorization through an injected verifier, and rechecks descriptor/current-path
> identity after hashing. It does not retain a launch handle or close
> replacement TOCTOU after the final check. Production authorization and Windows
> remain fail-closed: the reader and API composition default to an explicit deny
> verifier, while the pinned deterministic key requires a test-only verifier. A
> bounded static verifier can authenticate explicitly supplied Ed25519 trust
> records with exact scope, validity, and revocation constraints. A separate
> source can authenticate exact 15-minute Ed25519 signer-registry snapshots and
> advance a trusted durable compare-and-swap checkpoint, rejecting rollback,
> version skips, broken hash links, equivocation, stale roots, and revocation.
> The supervisor reads that source before preparation and again immediately
> before native handoff (ADR-0052); the API supplies only its deny implementation.
> PostgreSQL snapshot-reader and atomic checkpoint adapters now exist with
> immutable snapshot rows and append-only checkpoint-transition audit evidence
> (ADR-0053), but are not composed. No root provisioning, signer registry,
> snapshot publication procedure, or live revocation publisher is configured
> pending reviewed authority and native
> owner/reparse-point/handle designs.
> Linux CI includes a deterministic, test-only authenticated native dispatch round trip over an
> anonymous parent-owned stdin pipe (ADR-0054). It is not exported or composed and does not prove a
> production interactive stream owner, crash recovery, or real Codex connectivity.

> The supervisor composition issues a deeply frozen, non-serializable in-process
> plan only after exact authorization, evidence, admission, and lifecycle binding.
> Private per-instance state keeps the request pending and owner-bound until the
> exact plan is fully revalidated, then current-time checks and consumes it once
> before invoking that instance's injected launcher. A foreign composition
> cannot execute or consume the plan. No lower-level activation or request
> validator is exported.
> Its hashes are deterministic correlation/integrity evidence, not signatures or
> tamper-proof authority. It does not retain the inspected descriptor through a
> launch, create a process, or close the final filesystem-to-launch TOCTOU gap.
> The exported composition interface supplies no production signer, positive
> authorization source, or verifier. The same explicit verifier is applied to
> the live decision, filesystem evidence, admission, and launch-time
> revalidation; production injects only the deny implementation. The authenticated snapshot source
> is consumed before authorization and again immediately before native handoff. Post-handoff
> revocation and atomic kernel launch-time revocation checks remain unresolved.
>
> The authenticated JSONL session is likewise an I/O-free post-authentication
> verifier only. It owns bounded parsing, runtime-to-parent sequence and batch
> verification state, including a one-time first `CAPABILITIES` phase, but it
> does not infer `PARTIAL` or `CONNECTED` and has no socket, process handle, controller, durable
> writer, or positive production secret source. Verified frozen envelopes do not
> by themselves authorize an ACP state transition.
>
> A Linux x86-64 native supervisor helper and fixed ELF runtime exist only as
> test sources for Ubuntu CI. They exercise sealed `memfd` plus `execveat`, a
> safe opened working directory, pidfd/process-group cancellation, exact
> rlimits, `no_new_privs`, and a narrow filter that denies `socket(2)`, process
> creation, and session/process-group escape for a fixed no-child fixture. A
> test-file-local launcher receives only the composition-consumed request; helper
> authority is not sourced from ambient environment. They are
> excluded from package output and final images and are not a production
> launcher, general sandbox, or general process-tree containment. Native execution was not run on the Windows
> authoring host; Ubuntu CI is authoritative for those claims.

> The source-only Linux retained-native listener and client now have an uncomposed loader boundary.
> A positive load requires an exact short-lived authorization binding module digest, retained
> device/inode identity, owner, non-writable mode, size, module kind, exact socket path, and an
> existing identity-bound `0700` socket directory. The Linux host verifies `O_NOFOLLOW` descriptors
> before loading through `/proc/self/fd` and retains at most one immutable descriptor for each module
> kind to prevent dynamic-loader aliasing after descriptor-number reuse; both authorization and host
> deny by default. This is not a
> configured service: there is no positive authorization source, packaged native binary, path
> provisioner, loop, API/worker wiring, provider access, or runtime status promotion. Codex, Hermes,
> and Pi remain **NOT_CONFIGURED**.

> A purpose-bound Ed25519 trust source can now authenticate fresh module-authorization snapshots and
> require a durable instance-scoped CAS checkpoint before returning an exact ADR-0093 grant.
> Hash-linked rotation and signed empty-snapshot revocation prevent stale snapshot replay. This is
> still an unconfigured trust primitive: PostgreSQL snapshot-reader and checkpoint adapters now
> preserve immutable grant-bound state and append-only audit evidence across restarts, but no root or
> signing-key provisioner or API/worker composition exists. An uncomposed
> Linux-x64 path provisioner can now copy one explicitly attested source module into an absent
> owner-only `0500` path and create one absent owner-only `0700` socket directory through retained
> parent descriptors. It denies by default, does not package or load a binary, leaves the socket
> absent, and returns only identities for later signing. An uncomposed publisher can now append only
> snapshots admitted by that same Ed25519 verifier, and PostgreSQL serializes each supervisor chain
> to bootstrap, exact latest replay, or one adjacent hash-linked successor. It cannot sign and has
> no root/key custody, route, worker, or service composition. An uncomposed one-shot controller can
> now construct canonical grants from those owner-only attestations only after an exact tenant- and
> supervisor-bound five-minute Level-3 approval, delegate signing through a deny-default port, and
> submit the result to the independent authenticator/publisher. It has no production signer, private
> key, root/key provisioning, approval-source composition, or service owner. An uncomposed audited
> publisher can now atomically persist an independently authenticated snapshot with its exact
> controller-minted Level-3 approval evidence. The database rejects stale evidence, fixes each
> supervisor chain to one workspace, foreign-key binds evidence to the snapshot, and denies
> updates/deletes, while exact replay rechecks every field.
> A separate uncomposed adapter can issue one exact one-minute grant from an exact Level-3 trusted
> control-plane capability; it rejects Level 4 and does not invoke the Founder approval workflow.
> It has no signer, key, publisher, loader, or service composition. These boundaries therefore do
> not prove runtime connectivity.
> A separate uncomposed keyless signer client can now exchange only that controller's canonical,
> hash-bound snapshot-signing request over an injected bounded channel and closes the channel before
> returning. It has no private key, concrete transport, public-root provisioning, or service owner;
> its response remains subject to independent publisher verification and proves no runtime
> connectivity.
> A separate uncomposed PostgreSQL registry now accepts validated public-only Ed25519 roots under an
> exact tenant/supervisor-scoped Level-3 capability and atomically stores immutable provisioning
> evidence. Database guards prevent cross-tenant supervisor races, version gaps, signer/key reuse,
> rollback, revocation reversal, unaudited inserts, mutation, and more than eight current roots.
> No private key, actual root, route, worker, signer transport, or service composition is supplied,
> so this closes durable public-root state only and does not prove runtime connectivity.
> An uncomposed Linux signing transport now adapts the bounded keyless signer to the existing
> one-exchange local IPC client with exact before/after socket identity and `SO_PEERCRED` checks
> (ADR-0103). It still supplies no native module, signer service, key, actual socket, root-to-verifier
> composition, route, worker, or runtime-status promotion and therefore proves no live connection.
> A matching uncomposed supervisor signing handler now authenticates the accepted endpoint and
> `SO_PEERCRED` principal, validates the canonical request and both hashes, and closes an injected
> one-use custody session before returning its bounded signature (ADR-0104). The custody port has no
> implementation, private key, native listener/service, root composition, or lifecycle owner, so
> the test-only round trip is not runtime-connectivity evidence.

> A proposed deterministic Linux test now joins the composition-owned native handoff to the
> I/O-free authenticated JSONL verifier. A synthetic 32-byte fixture secret crosses only an
> anonymous inherited descriptor, the fixed ELF emits bounded success or cancellation frames, and
> the transcript is verified only after pidfd/process-group cleanup evidence. This remains
> test-only: production authorization, secret resolution, and launching still deny, no durable ACP
> status is changed, and Codex, Hermes, and Pi remain **NOT_CONFIGURED**. Native execution was not
> run on the Windows authoring host; Ubuntu CI is authoritative.

The cost-governance foundation pairs authenticated bridge usage with immutable
recognized-spend evidence under exact workspace and task budget periods. It
does not activate billing, reconcile provider invoices, convert currencies,
administer policies through a UI/controller, or treat broker capacity holds as
spend. Production budget policy administration remains a later governed path.

> A deterministic process-tree harness exercises exact-bound cancellation and
> cleanup only in local Windows tests and the existing Linux CI path. Its
> process imports and fixtures are absent from package exports and product
> images. This is not production Job Object, cgroup, namespace, executable-
> identity, crash-cleanup, or runtime-connectivity evidence.
>
> The authenticated product Workflow Centre is a bounded read-only snapshot.
> It derives the workspace from the session, requires `workflow:view`, and
> returns only allowlisted legacy workflow and Agent Control Plane status
> metadata. It intentionally excludes command authority, approval targets,
> evidence and policy hashes, secrets, principal references, artifacts,
> transcripts, and cost. It is not streaming telemetry, a runtime connection,
> the protected Founder Mission Control, publication, or deployment evidence.
>
> A dated, non-authoritative operations snapshot verified on 2026-08-25 records
> operations PR #24 as deployed to the Access-protected Founder Mission Control,
> with its command-center and Site Steward checks green. The private operations
> evidence and live Access boundary remain authoritative; this product document
> must not be used to pin future operations state. `ventureos.site` remains
> public, while `staging.ventureos.site`,
> `api-staging.ventureos.site`, and `progress.ventureos.site` remain protected.
>
> Backup/restore and current-main rollback rehearsal, live-provider validation,
> legal/privacy operations, real billing and email delivery, malware scanning,
> production observability, authenticated runtime connections, and commercial
> proof remain incomplete or unevidenced. Never treat merged source, a workflow
> template, a sanitized scan, or a protected command-center deployment as
> application image publication, current-main staging deployment, production,
> pilot, customer, revenue, or cash evidence. See `ROADMAP.md` for dependency
> order.

> **Status note (2026-08-01):** this file began as a Phase 1 sandbox inventory
> and still contains historical phase/sandbox statements. For current executed
> release evidence use `TECHNICAL_RELEASE_BASELINE.md`; for the current security
> findings and gates use `APPLICATION_SECURITY_BASELINE.md`. Historical claims
> below must not override those newer records.

## Historical sandbox-imposed limitations (obsolete as current-state evidence — see SANDBOX_LIMITATIONS.md)

The original Phase 0/1 source was authored in a sandbox where dependencies,
Docker, migrations, builds, and tests could not be executed. At that time,
"implemented" meant "source exists and was manually/structurally reviewed," not
"verified working."

That statement is preserved as historical context only. It does **not** describe
the later repository state recorded in `TECHNICAL_RELEASE_BASELINE.md`,
`APPLICATION_SECURITY_BASELINE.md`, `STAGING_SECURITY_GATE.md`, and
`CI_GOVERNANCE.md`. Current claims must distinguish:

- repository source/configuration state;
- local development validation evidence;
- GitHub CI evidence;
- local/container staging-gate evidence;
- private-staging deployment capability/templates;
- externally verified staging deployment state;
- production deployment state.

Repository evidence alone does not establish the current operational state of any
externally deployed staging environment, and it does not establish production
deployment or production readiness.

## Fixed during local verification

- **`apps/web`'s `@/*` path alias resolved to the monorepo root instead of `apps/web/src`, causing a persistent "Module not found" error that survived cache clears and reinstalls**: `tsconfig.base.json` sets `baseUrl: "."`, and TypeScript resolves an inherited `baseUrl` relative to the file that DEFINES it (the repo root), not the file that extends it - a well-known monorepo tsconfig gotcha. `apps/web/tsconfig.json` didn't override `baseUrl` itself, so `@/*` was silently resolving to `<repo-root>/src/*` (nonexistent) instead of `apps/web/src/*`. Fixed by adding `"baseUrl": "."` explicitly to `apps/web/tsconfig.json`.
- **API crashed with a TypeError inside `@nestjs/swagger`'s parameter explorer** (`Cannot read properties of undefined (reading '0')` in `ParameterMetadataAccessor.explore`), likely caused by `tsx`/esbuild's decorator-metadata emission not exactly matching what Swagger's reflection expects for some custom parameter decorators. Since Swagger docs are non-essential to Phase 1, wrapped doc generation in a try/catch in `main.ts` so a failure logs a warning and the API still starts, instead of crashing the whole process. `/api/docs` may not work until this is investigated further (candidate real fix: run the API via `nest build` + `node dist/main.js` instead of `tsx` for any environment that needs Swagger, since `nest build` uses `tsc`'s own decorator metadata emission).
- **`pnpm run typecheck` failed for `@ventureos/database`** with `Cannot find name 'process'/'console'` and `Cannot find module 'node:crypto'`: `packages/database/src/client.ts` and `src/seed.ts` use Node globals (`process.env`, `console.*`, `node:crypto`) but the package never listed `@types/node` as a direct devDependency — same pnpm strict-isolation class of bug as the earlier `@types/express-serve-static-core` fix. `packages/config/src/env.ts` has the identical latent issue (`process.env` as a default parameter) even though it happened not to surface as an error in this particular typecheck run (likely incidental hoisting) — fixed proactively there too rather than waiting for it to break separately. Added `@types/node` as a direct devDependency to both packages. Found during founder verification on 2026-07-13 while running the Phase 1 verification checklist for the first time.
- **`POST /api/auth/login` returned `500: Cannot read properties of undefined (reading 'login')`** because `this.authService` was `undefined` inside `AuthController` at runtime, despite `AuthModule` correctly providing `AuthService`. Root cause: `AuthController`'s constructor was the only one in the API mixing an undecorated class-typed parameter (`authService: AuthService`) with an explicitly `@Inject(ENV_TOKEN)`-decorated parameter in the same constructor — `tsx`/esbuild's decorator-metadata emission does not reliably populate `design:paramtypes` for that mixed pattern (the same underlying class of bug as the Swagger issue above). Every other controller/service/guard either has all-undecorated parameters or a single `@Inject(...)`-decorated parameter alone, so none of them hit this. Fixed by explicitly adding `@Inject(AuthService)` to the first parameter so DI doesn't depend on mixed reflection. Found during founder verification on 2026-07-13. If any future controller/service needs a constructor mixing a plain class dependency with an explicitly-tokened one, decorate _all_ parameters explicitly to avoid this class of bug recurring under `tsx`.
- **`AuditModule`/`SecurityModule` failed NestJS dependency injection**: both use `SessionAuthGuard`/`PermissionGuard` via `@UseGuards(...)`, which need `ENV_TOKEN` injected, but neither module listed `envProvider` (other modules happened to include it, these two didn't - inconsistent manual wiring). Fixed properly by adding a `@Global()` `ConfigModule` (`apps/api/src/config/config.module.ts`) providing `ENV_TOKEN` application-wide, imported once in `AppModule`, so no future module can hit this by forgetting to list it locally.
- **API crashed at runtime with `ERR_MODULE_NOT_FOUND` for extensionless relative imports inside workspace packages** (e.g. `packages/config/src/index.ts`'s `export * from './env'`), even though TypeScript compilation itself reported 0 errors: `nest start --watch`'s default dev runner resolves workspace-package internals through a path that enforces Node's native ESM extension rules. Switched `apps/api`'s `dev` script from `nest start --watch` to `tsx watch src/main.ts` (the same tool already proven working for `apps/worker`), which resolves extensionless imports transparently. `nest build`/`nest start` (production) are unchanged and untested against this specific issue - flag if the production build hits the same error, since it may need the same treatment or the alternative fix of adding explicit `.js` extensions to all workspace-package relative imports.
- **`req.user`/`req.correlationId` type errors persisted in files other than the ones declaring the augmentation**: the original code scattered two separate `declare module 'express-serve-static-core'` blocks across `session-auth.guard.ts` and `correlation-id.middleware.ts`; NestJS's compiler wasn't merging them consistently for every consuming file. Replaced with the standard, documented pattern: a single ambient `apps/api/src/types/express.d.ts` using `declare global { namespace Express { interface Request {...} } }`, which is reliable regardless of file visit order.
- **API TS errors persisted after adding `express` as a direct dependency**: the actual missing piece was `@types/express-serve-static-core` as its own direct devDependency of `apps/api` — pnpm's strict isolation requires the exact module being augmented (`declare module 'express-serve-static-core'`) to be directly resolvable from the augmenting package, not just transitively present. Added it explicitly.
- **Worker crashed with `Namespace ventureos-dev is not found`, then again with `operatorService.registerNamespace is not a function` after a first attempt at auto-registration used an SDK method that doesn't exist in the installed `@temporalio/client` version**: rather than keep guessing at unverifiable SDK internals, switched Phase 1's default `TEMPORAL_NAMESPACE` to Temporal's built-in `default` namespace, which always exists and needs no registration step. Simpler and more robust than any auto-registration logic for a single-workspace Phase 1 setup.
- **Next.js "Module not found" for `@/lib/server-api` despite the file existing and being identical on disk**: stale `.next` build cache from mid-sync file writes while the dev server was running. Not a code bug; fixed by deleting `apps/web/.next` and restarting.
- **API TS errors persisted after adding `@types/express`**: `express` itself was never a direct dependency of `apps/api` (only pulled in transitively via `@nestjs/platform-express`); pnpm's strict module resolution couldn't resolve `express-serve-static-core` for the `Request`/`Response` type augmentation from application code without it. Added `express` as a direct dependency.
- **Worker crashed with `Namespace ventureos-dev is not found`**: Temporal only ships the built-in `default` namespace; custom namespaces need explicit registration. The worker now checks for its configured namespace on startup and self-registers it if missing (`apps/worker/src/worker.ts` `ensureNamespaceRegistered`), so no manual `tctl`/`temporal` CLI step is required on a fresh environment.
- **Temporal container crash-looped on startup**: `docker-compose.yml` set `DYNAMIC_CONFIG_FILE_PATH: config/dynamicconfig/development-sql.yaml` for the `temporal` service, copied from a common example, but that path doesn't exist inside `temporalio/auto-setup:1.24.2` — confirmed via `docker compose logs temporal` showing `no such file or directory` followed by a connection-refused crash loop. Removed the variable entirely; Temporal starts fine with its built-in default dynamic config for a single-node dev setup. Found during founder verification on 2026-07-13.
- **Root `.env` wasn't reaching `apps/api`, `apps/worker`, or `packages/database`'s Prisma CLI.** Prisma/Nest/tsx only auto-load `.env` from their own package directory, not the monorepo root where `setup-local.ps1` creates it. Fixed by prefixing the relevant `dev`, `start`, `test:integration`, and all Prisma scripts with `dotenv -e ../../.env --` (added `dotenv-cli` as a devDependency to each affected package). Found via real local `prisma migrate dev` failure (`Environment variable not found: DATABASE_URL`) during founder verification on 2026-07-13.
- **First-ever full-repo `pnpm run typecheck` surfaced 4 real type errors** (previously only individual packages had been typechecked incrementally while debugging other issues):
  - `finance-engine`'s `calculateScenarios()` always returns exactly 3 elements (low/base/high, fixed order) but was typed as the open-ended `ScenarioProjection[]`. With `noUncheckedIndexedAccess` on, `const [low, base, high] = calculateScenarios(...)` typed each as possibly `undefined`. Fixed by changing the return type to a proper 3-tuple `[low: ScenarioProjection, base: ScenarioProjection, high: ScenarioProjection]`.
  - `contracts/agent-output.ts` used `VetoType[number]` as a type, but `VetoType` was only ever exported as a value (a zod enum, `export const VetoType = z.enum([...])`), never as a type alias — TS2749. Added `export type VetoType = z.infer<typeof VetoType>` (matching the existing `AgentDecision` const+type shadow pattern) and fixed the `CRITICAL_VETO_ROLES` annotation to just `VetoType`.
  - `policy-engine/board-voting.ts`: the local `weights` variable is `options.weights ?? DEFAULT_AGENT_WEIGHTS`, inferred as a union of `Record<string, number>` and the narrower `Record<BoardAgentRole, number>`. Indexing that union with `output.agentRole` (a plain `string`, since `AgentOutputSchema` validates it as `z.string().min(1)`, not the strict 8-role enum) isn't allowed against the narrower branch — TS7053. Cast to `Record<string, number>` at the lookup site; both branches are structurally plain string-keyed objects at runtime, so behavior is unchanged.
  - `observability/logger.test.ts`: `spy.mock.calls[0]` is typed possibly `undefined` under `noUncheckedIndexedAccess`. The preceding line already asserts `toHaveBeenCalledTimes(1)`, so a non-null assertion (`calls[0]!`) is safe.
  - After these 4 fixes, `pnpm run typecheck` is clean across all 15 packages/apps, and `pnpm test:unit` passes 12/12 packages (67 individual tests, `packages/database` correctly reports "no test files" via `--passWithNoTests` rather than being force-failed for having nothing pure to unit test yet). Found during founder verification on 2026-07-13.
- **`apps/api`'s dev runner crashed with `ERR_MODULE_NOT_FOUND` for `packages/config/src/env.js`, thrown from Node's native ESM resolver, immediately after webpack itself reported a clean compile**: switching to `nest start --watch --webpack` (see ADR-006) fixed the earlier `dist/main` race, but its default config uses `webpack-node-externals`, which externalizes pnpm-symlinked `@ventureos/*` workspace packages along with real `node_modules` deps. Externalized packages are loaded by Node's own runtime resolver instead of being bundled/transpiled — and every workspace package's `main`/`types` still pointed at raw `src/index.ts`, which Node cannot execute. Fixed at the root by giving every consumed package a real `tsc` build (`dist/index.js`, CJS) and pointing `main`/`types` at `dist/`; see ADR-006 for full detail. **Operational note**: `turbo`'s `dev` task now depends on `^build`, so package changes are only picked up on the _next_ `pnpm dev` invocation (turbo's cache invalidates on source changes) — editing a package's `src/*.ts` while `pnpm dev` is already running will not hot-reload until the dev process is restarted, since there is no continuous `tsc --watch` for packages themselves. Found during founder verification on 2026-07-13. A follow-up bug in the same fix (`turbo run dev --parallel` ignores the task graph, so the new `dependsOn: ["^build"]` edge never fired) was caught on the first restart attempt and fixed by dropping `--parallel` from the root `dev` script. **Verified end-to-end 2026-07-13**: a clean restart now builds every package to `dist/` and boots web, api, and worker cleanly (`Nest application successfully started`, worker `RUNNING` and connected to Temporal). See ADR-006.
- **The "Sign out" control in `apps/web`'s dashboard sidebar was completely non-functional**: it rendered as `<form action="/api/logout-redirect"><a href="/login">Sign out</a></form>`. An anchor tag inside a form does not submit it (only `type="submit"` buttons do), and `/api/logout-redirect` was never implemented as a Next.js route handler either way. Clicking it just navigated to `/login` without ever calling `POST /api/auth/logout` — confirmed live: `GET /api/auth/me` still returned 200 with the full user object after "signing out," and navigating straight back to `/dashboard` rendered normally instead of redirecting. Fixed by replacing it with a real client component (`SignOutButton`) that calls the same direct-to-API `apiFetch('/auth/logout')` pattern the login page already uses, then redirects. Confirmed live afterward: `/api/auth/me` returns 401 after clicking Sign out, and the DB session row is revoked. Found during founder verification on 2026-07-13.
- **`AuditService.record()` was fully implemented but never called anywhere in the codebase** — `AuditModule`/`AuditController` correctly exposed `GET /api/audit-events`, but the Audit Centre page showed "No audit events yet." even after real logins and onboarding saves, because nothing ever wrote a row. `EXECUTION_PLAN.md`'s own Phase 1 checklist had already flagged this as unverified. Wired `AuditService` into `OnboardingService.save()` (records a before/after `ONBOARDING_PROFILE_SAVED` event with the acting user's ID). Confirmed live: the Audit Centre now renders a real event with a real timestamp and correlation reference. Other sensitive actions (login, future approvals, etc.) may warrant their own audit events but are out of scope for this fix — scoped deliberately to the action already exercised in Phase 1 verification. Found during founder verification on 2026-07-13.
- **Onboarding save (`PUT /api/onboarding`) worked exactly once, then failed with a 500 on every subsequent save** — `GET /api/onboarding` returns Prisma's real column values, and Prisma represents an unset nullable column (`businessObjectives`, `weeklyTimeHours`, `approvalThresholdEur`, `refundThresholdEur`, `targetProfitEur`, `targetLaunchDate`, `availableBudgetEur`, `riskTolerance` — all declared nullable in `schema.prisma`) as `null`, not `undefined`. `apps/web`'s onboarding page round-trips the GET response straight into the PUT body (`setForm(data)` then `{...form}` on submit), so any field never explicitly filled in comes back as `null`. `onboardingSchema` only had `.optional()` (accepts `undefined`, rejects `null`), so Zod threw `Expected string/number, received null` and the API returned 500 — confirmed live via both a direct API call and clicking Save in the actual browser UI (the UI failure was initially mistaken for an automated-testing click/timing artifact before the real API error was found in the log). Fixed by adding `.nullable()` alongside `.optional()` for every affected field, matching the Prisma column nullability exactly. Confirmed live afterward: edited the budget field in the real UI, clicked Save, and `GET /api/onboarding` reflects the new value. Found during founder verification on 2026-07-13.

## Code-level gaps, honestly disclosed

- **CSRF protection is origin-based, not a synchronizer token**: authenticated
  unsafe methods now require an exact `Origin` match in the API's global guard,
  in addition to `sameSite=lax` and the CORS allowlist. Deployments must keep a
  single trusted `API_CORS_ORIGIN`; future multi-origin clients will require a
  reviewed allowlist or a synchronizer-token design.
- **Authentication abuse hardening is implemented but remains deployment-policy
  sensitive**: PostgreSQL-backed account/source cooldowns survive restarts and
  coordinate API instances; blocked requests skip KDF work, missing users run the
  same asynchronous scrypt path, registration responses are generic and
  time-floored, concurrent workspace-slug conflicts use a bounded transactional
  randomized retry, and raw identifiers/IPs are not stored in abuse state.
  Expired abuse rows are removed opportunistically during authentication traffic
  or an explicit cleanup call; no scheduler is included. Deployments behind a
  reverse proxy must set the bounded `API_TRUST_PROXY_HOPS` value to the exact
  trusted hop count; the secure default is `0`, which ignores forwarding headers.
  Rotating the abuse-digest secret invalidates existing pseudonymous buckets and
  therefore requires an explicit operational reset decision.
- **Public Temporal health mutation is resolved in Phase 12, with a corrective
  timeout-lifecycle follow-up after the prior local commit**: the route performs
  only the standard gRPC Health `Check` under one absolute connection/RPC
  deadline. The helper owns the connection and awaits cleanup before settling;
  cleanup may finish after the RPC deadline rather than being abandoned by an
  outer timeout. The route returns generic status, creates no workflow execution
  or history, and does not claim worker/task-queue readiness. See
  `HEALTH_CHECKS.md`.
- **Authentication transaction and login/dashboard E2E reliability blockers are
  resolved in Phase 13**: authentication failure counters use an ordered,
  non-interactive ACCOUNT/IP batch transaction after independent bounded cleanup,
  removing the resource-sensitive two-second interactive-admission dependency
  without changing thresholds or adding retries. Playwright login assertions
  synchronize on the login response before redirect readiness, and duplicate
  nav/page labels are selected by unique semantic heading role. Focused auth,
  forced complete integration, clean-output E2E, reused-state E2E, and immediate
  E2E repeat gates all passed without retry recovery. See
  `APPLICATION_SECURITY_BASELINE.md` for measured evidence.
- **Subscription/provider enforcement is implemented for current execution
  paths, but live commercial adapters remain absent**: centralized policy now
  enforces subscription status, trial expiry, active plans, feature entitlements,
  venture/marketplace quotas, provider modes, and global switches at admission
  and again in queued activities, direct runners, or final provider boundaries.
  Marketplace, advertising, paid-integration, email/notification, payment, and
  non-mock AI implementations still do not exist. `Integration.writeEnabled`
  must become an additional final-boundary gate before a live marketplace
  adapter is introduced; current live modes fail closed as unavailable.
- **Final-dispatch revalidation is immediate best-effort, not a transactional
  lease**: research acquisition and every implemented mock marketplace
  draft/image/file/publication operation reload tenant-bound local state and
  centralized subscription/provider policy at the last safe point before the
  adapter. Cached idempotency success is revalidated before a new success record
  is accepted. The implementation intentionally does not hold a database
  transaction across provider-shaped execution, so a database or process-config
  change can still occur after the final check. Real providers require a reviewed
  provider-specific lease/idempotency/compensation design where stronger
  atomicity is needed.
- **Raw mock adapters are package-internal**: package roots expose protected
  runners rather than provider-shaped adapter functions. Database-backed finance
  reads and mutations enforce `FINANCE_ACCESS` directly. This protects supported
  package entry points; it is not a claim that arbitrary source-file imports are
  a security boundary outside the package export contract.
- **Approval decisions use a single-winner transition**: the persisted decision
  is committed with an atomic pending-state compare-and-set. Expiry is enforced
  at decision and execution boundaries; untouched pending rows are not
  proactively relabelled by a scheduler.
- **Dependency Critical/High remediation is complete for the validated
  lockfile**: compatibility-tested Next 15, Nest 11/Express 5, and Vitest 3
  upgrades plus targeted vulnerable-child replacements reduced both production
  and complete `pnpm audit` results to zero findings at every severity. This is
  lockfile-specific evidence, not a permanent waiver: frozen install and both
  audits must remain required for future dependency changes. See
  `APPLICATION_SECURITY_BASELINE.md` for advisory roots and validation evidence.
- **Database migrations still require normal production change controls**:
  the eleven-migration chain, including in-place hashing of existing session
  tokens and durable authentication-abuse state, has been exercised on
  disposable PostgreSQL. That does not replace a
  production backup, restore rehearsal, maintenance plan, or rollback review.
- **Production MinIO and live Temporal connectivity remain unverified here.**
  MinIO upload authorization and zero-network denial are unit-tested, and
  disposable PostgreSQL validation plus mock-provider E2E passed. This is not
  production infrastructure evidence and no real provider was contacted.
- **Historical Phase 9.1 CI evidence is preserved but superseded for current
  status.** The first main-branch run failed at build, and the Phase 9.1 PR #1
  run at commit `0f536c7c9511945a135a5a030f34e8908a5a9f4b` remained red at
  Prisma migrate (GitHub Actions run `29660695312`) with later stages skipped.
  This records the observed stopping point for that historical run only. Current
  CI configuration and any current GitHub Actions status must be checked through
  `.github/workflows/ci.yml`, `docs/CI_GOVERNANCE.md`, and run-specific GitHub
  evidence; historical local validation, historical red CI, local/container
  staging-gate evidence, and external deployment state are separate claims.
- **Root E2E build orchestration is fixed and regression-protected**: the root
  task now performs the production build before Playwright, the API build asserts
  a non-empty `dist/main.js`, and build-contract tests cover stale incremental
  state. On the remediated dependency graph, clean-state, reused-state, and
  immediate repeated root runs each passed build 20/20 and E2E 4/4. Future build
  script or Turbo graph changes must preserve those regression gates.
- **No malware scanning** on uploaded files (integration point documented,
  not wired).
- **No OpenTelemetry exporter** wired despite `OTEL_*` env vars existing —
  currently a structural placeholder only.

## Scope limitations (by design, not oversight)

Later-phase opportunity, board, approval, product, research, finance,
experiment, billing, and marketplace modules now exist. Real-provider/live
publication and commercial readiness remain intentionally blocked by the
controls and residual risks above; see `ROADMAP.md` and
`APPLICATION_SECURITY_BASELINE.md`.

## Bounded egress controller has no configured transport

The Agent Bridge can validate one durable egress claim against one canonical
signed `DISPATCH` line and bound an injected local write. The default transport
denies every write, and no API composition, socket, pipe, queue, process,
provider adapter, acknowledgement, or delivery/status authority exists. Local
write completion must not be presented as runtime receipt or connectivity.

The injected Codex protocol coordinator can require an ephemeral
read-only/no-network turn and an exact dispatch-bound terminal token while
rejecting observed tool or approval activity. A deny-by-default runtime adapter
can authenticate the incoming dispatch and sign/write the correlated acceptance
and result through injected secret and local-transport ports. Neither component
receives production streams, launcher authority, credentials, provider access,
or a durable writer, and production secret and response transports remain
deny-only. Because no real authenticated process round trip exists, this must
not be presented as configured Codex or runtime connectivity.
