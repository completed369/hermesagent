# Roadmap

## Delivery roadmap (reviewed 2026-08-26)

The Phase 0–8 checklist below is a historical record of implemented product
scope. It is **not** a production-readiness or deployment claim. The dated
reviewed source baseline for this update is
`d462733ec55a8bc98092e39a5a071c01b9c76806`; it must never be interpreted as a
mutable live-main pin. GitHub is authoritative for repository main and checks,
and generated protected Mission Control evidence is authoritative for the live
operational snapshot. Exact-baseline CI and CodeQL were green. The corresponding
sanitized five-image release-candidate evidence was also green. CI
includes the full migration chain, application integration/E2E, and a disposable
staging-security/load gate that performs no deployment. The release-candidate
workflow uploaded no artifacts and created no deployment. Zero CodeQL alerts
were open when checked on 2026-08-26. No current-main application image has been
published and current `main` has not been deployed to private staging.

### Completed

- The Phase 0–8 mock-provider product baseline and its documented gates.
- The runtime/container security repair merged through PR #49, including five
  final-image vulnerability gates.
- The focused PostCSS/dependency repair, publication trust-boundary hardening,
  security-gate hardening, and deterministic Stage 6 reliability/accessibility
  work merged through PRs #53, #54, #57, and #52.
- The modern private-staging workspace experience merged through PR #50 and the
  secure collaboration, invitation, active-workspace session, role-enforcement,
  and tenant-isolation implementation merged through PR #55. These are merged
  product capabilities, not deployment evidence.
- A public `ventureos.site` entry point plus Access-protected staging, API, and
  progress hostnames at `staging.ventureos.site`,
  `api-staging.ventureos.site`, and `progress.ventureos.site`, managed
  separately from product deployment.
- Fail-closed publication and private-staging workflow templates. Their
  presence remains capability evidence, not deployment evidence.
- Product PRs #59–#65: provider-neutral Agent Control Plane, Runtime Broker,
  Dynamic Agent Factory, verified Codex/Hermes/Pi interface evidence,
  tenant-shell workspace-switch repair, governed AI COO, and governed Voice
  Gateway foundations.
- Product PR #68: a tenant-scoped unified operational event and audit spine.
- Product PR #72: governed approval execution permits that bridge approval
  decisions to bounded execution authority.
- Product PR #76: a verified, service-only durable objective/project/task/
  dependency/run/artifact spine with composite workspace boundaries, atomic
  audit writes, optimistic concurrency, bounded retries, fail-closed evidence
  ports, and Level-4 approval preparation bound to real durable task/run rows.
- Product PR #78: a verified, service-only durable protocol-neutral Agent
  Bridge admission boundary with bounded canonical framing, directional
  authentication, replay protection, exact workspace/principal/session/runtime
  binding, durable dispatch/receipt/usage evidence, fail-closed policy and
  artifact verification ports, and deterministic test-only fixture coverage.
  It adds no transport, controller, network, process launcher, or runtime
  connectivity claim and stops runtime truth at `PARTIAL`.
- A bounded outbound foundation prepares immutable metadata for one
  parent-to-runtime `DISPATCH` authorization and signs an ephemeral canonical
  envelope with the direction-specific leased key. It still adds no transport,
  delivery worker, provider adapter, process path, or `SENT`/connected claim;
  dispatch remains `PREPARED` until separately authenticated runtime evidence
  is admitted.
- A service-only egress-handoff foundation may re-sign that exact prepared
  frame and append one short exclusive claim bound to the authenticated
  principal and actor kind. Expiry is immutable, early release is a separate
  append-only row, and reclaim is a new generation. Only authenticated service
  writes carry atomic audit; trigger-valid direct-writer rows remain
  unauthenticated correlation metadata requiring re-signing/reverification.
  This is still no sender, queue, socket, process, provider, delivery,
  acknowledgement, `SENT`, or connectivity path.
- A bounded single-frame egress controller now exact-binds one claimed
  `DISPATCH` to its canonical JSONL bytes and an injected, abortable local write
  port. The only production-ready transport implementation denies every write;
  there is no API wiring, socket, pipe, queue, process, provider, acknowledgement,
  delivery state, or runtime-status promotion.
- Codex is selected as the first reviewed real-runtime interface behind an inert
  Linux-only app-server policy. It accepts only a supervisor-manifest candidate
  for `codex app-server --listen stdio://` and requires the separate
  opened-file/signed-evidence flow before any future launch; it rejects alternate
  transports, arguments, wrappers, environment, secret handles, and network.
  Production executable authority and launching remain deny-only, no process or
  provider is contacted, and Codex remains `NOT_CONFIGURED`.
- The reviewed Codex interface now has an I/O-free, single-task protocol state
  machine for exact initialization, thread creation, turn creation, optional
  interruption, and terminal correlation. It bounds message size and structure,
  retains no task or result text, rejects out-of-order and unreviewed shapes,
  exposes no transport or provider operation, and leaves runtime truth
  `NOT_CONFIGURED`.
- Codex now has an inert authenticated-registration translation boundary. It
  joins the revalidated command policy, pristine initialized protocol state,
  authenticated VentureOS bridge identity, and a correlated non-refreshing
  account-state declaration, while hashing and discarding account details. It
  grants no durable registration or provider authority and keeps Codex
  `NOT_CONFIGURED`.
- Codex now has a dedicated durable registration-evidence operation. It admits
  only an exact revalidated candidate, a separately trusted five-minute
  authorization, and a scoped secret lease that reproduces the candidate's
  one-way secret binding. The production authorization and secret sources deny
  by default; retained evidence excludes account details and credentials, and
  both runtime and connection remain `NOT_CONFIGURED`.
- Codex now has a dedicated immutable capability-evidence operation. It accepts
  only the normalized complete `model/list` candidate bound to the exact
  tenant-scoped durable registration, capability policy, idempotency key, and
  a separate five-minute authorization. It stores no model identity or raw
  protocol payload, production authorization denies by default, and it leaves
  runtime and connection capability/status truth `NOT_CONFIGURED`.
- Codex now has a dedicated immutable heartbeat-evidence operation. It accepts
  one fresh canonical VentureOS bridge `HEARTBEAT` only after the exact durable
  registration and capability rows, verifies its runtime-to-parent MAC through
  the scoped secret lease, and binds tenant, identity, generation, sequence,
  message, and idempotency evidence. It retains no MAC, nonce, secret, or raw
  frame and deliberately leaves connection heartbeat and status fields
  untouched.
- Codex now has a separately authorized validation-dispatch preparation path.
  It signs one zero-cost, resource-bounded `codex.runtime.round-trip.v1`
  challenge tied to an exact ready/unassigned durable validation run and the
  immutable heartbeat precursor. Only digests and safe references persist; the
  frame remains ephemeral and `NOT_SENT`, production authorization and secrets
  remain deny-only, and no task/run/connection truth changes. A one-shot
  controller and bounded JSONL transport over already-open Codex app-server
  streams now exist. A bounded, still-uncomposed protocol coordinator forces
  an ephemeral read-only/no-network turn, rejects tool and approval activity,
  and requires an exact dispatch-bound terminal token. A one-use runtime-side
  adapter now authenticates that exact incoming dispatch, runs the coordinator,
  signs sequence-2 acceptance and sequence-3 result frames through scoped
  directional secret leases, and performs bounded local response writes. An
  immutable admission path now verifies and retains the exact runtime-signed
  sequence-2 accepted status and sequence-3 terminal result against that claimed
  dispatch while leaving runtime, connection, task, and run truth unchanged. An
  acknowledged interrupt plus interrupted terminal now produces one authenticated
  sequence-2 cancellation envelope whose normalized evidence is immutable and
  mutually exclusive with completed evidence for the same handoff (ADR-0057).
  Cancellation still assigns no run and promotes no runtime or connection truth.
  Both terminal outcomes now bind bounded, domain-separated counts and digests
  for admitted progress and `thread/tokenUsage/updated` notifications
  (ADR-0058). Raw token values are discarded, accounting remains unmapped, and
  recognized cost and compute remain exactly zero; no usage or ledger row is
  created.
  The supervisor now applies one explicit executable-authorization verifier to
  its decision, evidence, admission, and launch-time revalidation paths.
  Production and direct evidence-reader defaults deny; the pinned deterministic
  key is available only through an explicitly injected test verifier. A bounded
  unconfigured verifier can validate explicitly supplied, fingerprinted Ed25519
  trust records with exact adapter, argument-policy, worktree, validity, and
  revocation scope. A separate unconfigured source now authenticates bounded
  15-minute signer-registry snapshots and requires a durable monotonic hash-linked
  compare-and-swap checkpoint before exposing that verifier. Durable PostgreSQL
  reader/checkpoint adapters and append-only checkpoint audit evidence now exist
  (ADR-0053), but the API supplies no root records or positive source and remains
  deny-wired. The supervisor re-reads authenticated trust before each
  authorization decision and immediately before native handoff (ADR-0052).
  Production process/stream ownership and an authenticated real-process
  exercise remain later reviewed boundaries.
- Product PR #80: verified durable broker decisions and short-lived capacity,
  cost, and compute reservations bound to exact workspace, task, run, trusted
  agent evidence, runtime, connection, policy, and candidate evidence. Database
  constraints and lifecycle guards serialize holds, expiry, claim, and release;
  this is routing evidence, not execution, connectivity, provider spend, or a
  finance ledger charge.
- Product PR #82: a verified scoped Agent Bridge secret-lease boundary that
  binds every request to the exact workspace, runtime, connection,
  authentication generation, and purpose. Provisioning derives the initial
  digest; authentication and frame verification bind to the durable digest.
  Production remains deny-only and the slice adds no credential backend,
  transport, process launcher, provider, or runtime connectivity.
- Product PR #84: a verified pure OS-supervision admission policy that binds an
  exact normalized manifest to short-lived trusted adapter, executable,
  lexical-worktree, argument-policy, and resource evidence. Its output is inert,
  filesystem and launch-time TOCTOU remain open, and the production launcher
  continues to deny every process request.
- Durable cost governance: immutable one-to-one usage ledger evidence with
  exact workspace/task budget periods is MERGED and VERIFIED. It adds no
  billing provider, runtime connection, controller, deployment, or publication.
- A pure supervision lifecycle and exact-cancellation binding plus a
  deterministic test-only process-tree harness. The fixture is absent from
  package exports and product images and supplies only Windows/Linux test
  evidence; it is not a production launcher, supervisor, or runtime connection.
- Product PRs #66, #67, #69, #70, #71, #73, and #74: a dispatch-only,
  non-publishing release-candidate evidence workflow with runner-local five-
  image builds/scans, sanitized conclusions, exact source/archive/report/SBOM
  identity checks, canonical-main revalidation, and no artifact upload.

### In progress

1. **Documentation reconciliation:** keep public product documentation aligned
   with current repository, CI, security, deployment, and commercial evidence.
   GitHub is authoritative for this documentation PR's mutable head and checks;
   this file does not circularly pin its own commit.
2. **Agent Control Plane continuation:** the durable task/run, approval-
   preparation, protocol-neutral Agent Bridge admission, and durable broker
   reservation and scoped secret-lease foundations are MERGED and VERIFIED.
   The secret boundary remains deny-only and adds no credential backend or
   connection path. The pure OS-supervision admission policy is also MERGED and
   VERIFIED; its production surface adds no filesystem or process path. A
   deterministic process-tree fixture exercises cancellation only under tests.
   A Linux-only reviewed trusted executable/admission-evidence reader and a
   service-only supervisor composition now bind a live per-admission authority
   decision to an immutable, process-local launch plan. Production authority,
   executable verification, and the sole launcher remain deny-only. The generic
   supervisor is no longer coupled to the pinned test key. An authenticated,
   versioned trust-snapshot source and durable anti-rollback checkpoint port now
   exist. PostgreSQL reader/checkpoint adapters and immutable transition audit
   evidence are implemented, but no root provisioning, signer registry,
   snapshot publication procedure, live revocation source, or positive source
   is configured. The available static
   verifier and snapshot source are unconfigured primitives, not runtime
   authority. A bounded I/O-free post-authentication
   JSONL session now verifies runtime-to-parent batches in memory; it is not a
   transport, durable writer, or connection. Windows native identity inspection and
   actual production process supervision remain required before any process creation or
   runtime adapter. Evaluations, knowledge/playbooks, and adapter hardening
   continue afterward.
   A fixed Linux x86-64 native helper and test-file-local launcher exercise the
   composition-to-native one-use handoff, sealed retained-ELF execution, a fixed
   no-child/session-escape deny policy, and root-process cleanup in tests only.
   This is not general process-tree containment and is not exported, packaged,
   imaged, or wired to production.
   The next test-only slice joins that opaque native handoff to the bounded authenticated JSONL
   verifier for exact capability, heartbeat, success, and cancellation transcripts. Synthetic key
   material uses only an anonymous inherited descriptor and verification occurs after native
   cleanup. This is CI evidence only, not a runtime connection or production transport; production
   authorization, secrets, and launching remain deny-only and all real runtimes remain
   **NOT_CONFIGURED**.
   A Linux-only deterministic fixture additionally accepts one exact parent-authenticated dispatch
   on an anonymous stdin pipe and emits authenticated acceptance/result evidence after cleanup
   (ADR-0054). This remains unexported CI evidence and does not configure a real runtime.
   Codex now also has an I/O-free, exact stable `model/list` capability
   translator and immutable durable acceptance bound to authenticated durable
   registration. It accepts only a complete non-hidden catalog, retains hashes
   and normalized catalog claims rather than model identity, and requires a
   separate deny-by-default authorization. It does not contact a provider or
   promote runtime truth. The successor immutable heartbeat path verifies one
   fresh runtime-to-parent signed observation without updating runtime truth.
   A zero-spend validation dispatch can now be prepared and signed without
   broker routing, assignment, delivery, or truth promotion. A separate
   one-shot claim can bind that exact frame to a five-second bounded local
   controller, but its production transport remains deny-only and local byte
   acceptance is not delivery evidence. A bounded JSONL implementation now
   owns framing, backpressure completion, timeouts, cancellation, and limits
   for already-open Codex app-server streams. A coordinator over that injected
   boundary now enforces ephemeral read-only/no-network execution, bounded
   correlated safe progress, and exact dispatch-bound terminal output. A deterministic test-only
   child process now composes that transport and coordinator with the authenticated runtime adapter
   and proves that wrong-secret and reported-tool paths emit no bridge result (ADR-0055). It also
   proves one exact interrupt acknowledgement and interrupted terminal (ADR-0056). The adapter now
   emits one authenticated cancellation evidence frame after that proof, and the control plane
   retains it immutably under the same tenant, handoff, dispatch, and zero-spend authority while
   preventing a completed/cancelled double outcome (ADR-0057). Authenticated completion and
   cancellation evidence are admitted without assigning the run or promoting runtime truth, but no
   production composition supplies streams. A one-shot process-session coordinator can now obtain
   already-authorized streams through an injected owner, authenticates before opening them, requires
   exact process-exit evidence, destroys both streams, and emits terminal bridge evidence only after
   cleanup (ADR-0059). Its production owner remains deny-only; it contains no launcher or provider
   access. Durable append-only claims now retain the exact owner/supervisor/handoff identity across
   service restarts, and matching cleanup evidence is a database-enforced prerequisite for every
   new validation terminal outcome (ADR-0060). A positive recovery worker and owner are still
   absent. The coordinator now has a deny-by-default durable authority port that orders exact claim
   before stream open and exact cleanup completion before terminal egress (ADR-0061), but no
   production composition binds it by default. A typed Level-3 control-plane adapter now connects
   the port to the existing durable methods while rejecting tenant/identity/binding drift
   (ADR-0062), but no service supplies a positive owner, secret resolver, or transport. An internal
   Level-3 recovery inventory now provides bounded, owner-scoped discovery of claims with no matching
   completion and classifies them from the database clock (ADR-0063). It performs no recovery action;
   a positive owner remains absent. Process-claim inserts now reproduce
   the exact handoff owner, actor, state, expiry, and time window at the database boundary, and replay
   rechecks the complete persisted supervisor/dispatch binding (ADR-0064). Validation
   against a real authenticated Codex process remains approval- and provisioning-gated. Expired
   unfinished claims now support one immutable 15-second, owner-scoped recovery lease generation at
   a time, mutually exclusive with late completion (ADR-0065). The lease has no process, transport,
   secret, provider, cleanup, or runtime-truth authority.
   Completion inserts now lock and reproduce the exact claim binding, `NOT_CONFIGURED` truth, and
   claim-bounded close time; replay compares every persisted cleanup field (ADR-0066). The cleanup
   hash remains owner-reported and no positive recovery owner exists.
   Active lease acquisition now returns an atomic, immutable supervisor/dispatch work item and
   expired replay returns none (ADR-0067). No PID, process handle, action, or status authority is
   added; a future owner must prove retained native identity independently.
   The Agent Bridge now applies an exact active-only validator to that metadata envelope, including
   supervisor binding, claim ordering, fixed lease duration, safe references, and database-clock
   freshness (ADR-0068). It grants no process action or runtime truth.
   A deny-default evidence-source port now defines exact exit evidence from an independently retained
   native launch identity and rechecks lease freshness after observation (ADR-0069). No positive
   source, process action, cleanup completion, or connected-state transition is composed.
   A Level-3 serializable recovery-completion path now persists exact exit evidence and a matching
   cancellation cleanup only while the lease is current (ADR-0070). It does not create protocol
   terminal evidence, perform process action, or promote runtime truth.
   A bounded deny-default coordinator now composes work-item validation, independent exit observation,
   final lease revalidation, and durable completion ordering (ADR-0071). No positive source, authority,
   worker, or native cleanup action is wired.
   A Level-3 factory now snapshots one exact recovery work item, durable dispatch, caller context, and
   idempotency key into the coordinator's completion port (ADR-0072). No evidence source, worker,
   process action, or runtime-status transition is composed.
   Recovery lease acquisition now returns the validated durable dispatch with the active work item in
   one serializable bundle, and expired replay returns neither (ADR-0073). A positive worker,
   retained-identity source, and native cleanup action remain absent.
   One active lease bundle can now be bound to a frozen zero-input, single-attempt coordinator port
   whose evidence source denies by default (ADR-0074). The internal Level-3 recovery operation then
   claims and consumes that exact bundle without accepting caller-selected work or dispatch metadata;
   expired replay returns inert truth (ADR-0075). Inventory scheduling, a positive OS-specific
   retained-identity source, and native cleanup action remain absent.
   A deny-default Level-3 worker can now process one bounded owner-scoped inventory page sequentially,
   skipping active claims and requiring an exact claim-bound attempt identity before each atomic
   recovery (ADR-0076). It is not scheduled or production-wired; positive retained-native evidence
   and native cleanup action remain absent.
   A concrete two-second, challenge-bound recovery observation protocol now binds the complete
   tenant/lease/supervisor/launch/session/dispatch identity to a fresh request and verifies one exact
   Ed25519 response from an explicitly trusted external native supervisor (ADR-0077). It maps only
   normalized exit facts into ADR-0069 evidence, exposes no process locator or action handle, and
   rejects incomplete deny composition. No transport peer, trust provisioning, retained native
   implementation, cleanup action, scheduler, or production wiring is supplied.
   A bounded local peer controller now validates that exact challenge again before calling one
   injected native authority, requires retained pidfd identity revalidation plus process-group-gone
   cleanup evidence, and only then signs the existing normalized response (ADR-0078). It accepts no
   caller-selected process locator and is not API-, worker-, scheduler-, or runtime-wired. The
   positive Linux native authority, IPC, durable trust/key provisioning, and real runtime round trip
   remain absent.
   A Linux-x64-only native integration fixture now retains a pidfd from launch across the later fresh
   challenge, rejects a substituted launch binding, observes exit through that retained identity,
   terminates and reaps the process group, requires kernel-confirmed group absence, and rejects replay
   before the existing peer signs normalized recovery evidence (ADR-0079). This authority is test-only
   and excluded from runtime exports. Production native supervision, authenticated IPC, durable
   trust/key storage and provisioning, worker composition, and a real runtime round trip remain
   absent.
   A production-capable but unconfigured retained-native supervisor trust source now authenticates a
   purpose-bound 15-minute signed key snapshot, supports monotonic explicit revocation and linked key
   rotation, and advances a durable-CAS checkpoint that binds the active key fingerprint and trust-
   record version (ADR-0080). Rollback, skipped versions, equivocation, adjacent key-ID
   substitution, record-version rollback, stale roots, and conflicting races deny. A PostgreSQL
   reader and supervisor-instance-scoped checkpoint store now persist immutable snapshots,
   exact full-field CAS state, and append-only transition audit evidence without positive composition
   (ADR-0081). A bounded evidence-source composition now reads that authenticated trust immediately
   before and after one recovery exchange, requires the complete snapshot identity to remain exact,
   and verifies only with the post-exchange verifier (ADR-0082). A two-sided Linux local IPC contract
   now requires canonical bounded one-request/one-response framing, a pinned owner-only Unix-socket
   device/inode identity before and after each exchange, and exact kernel `SO_PEERCRED` identities for
   both supervisor and worker (ADR-0083). It remains uncomposed: no socket or listener is created and
   no caller-asserted metadata grants authority. No root/snapshot publisher, private-key custodian,
   Linux native IPC adapter, protected socket lifecycle, production native authority, or worker
   wiring is supplied. A Linux-x64-only native fixture now exercises real `AF_UNIX`, `lstat(2)`, and
   bidirectional `SO_PEERCRED` evidence through both contract sides, including path substitution,
   ownership-safe cleanup, peer drift, frame bounds, and replay denial (ADR-0084). The fixture is
   test-only and excluded from runtime exports; it does not create a production listener or service.
   An exported but unconfigured Linux client adapter now owns one exact lstat-connect-peer-
   write/shutdown-read/EOF-lstat-close sequence over an injected native syscall binding, derives
   authority-labelled attestations only from validated raw kernel facts, and closes on every path
   (ADR-0085). No concrete binding, path discovery, listener, retry, or runtime wiring is supplied.
   An exported but unconfigured supervisor session owner now accepts exactly one connection from an
   injected already-authorized listener boundary, authenticates the worker with raw `SO_PEERCRED`,
   revalidates the listener identity before handler effects and response release, bounds both frames,
   and closes on every path (ADR-0086). It cannot create, publish, loop, or compose a real listener.
   An exported but unconfigured listener lifecycle now authorizes one atomic no-replacement creation
   under an exact owner-only parent, proves the created owner-only socket identity, runs exactly one
   authenticated supervisor session whose handler is constructed only after that dynamic identity is
   known, and synchronously closes and removes only that retained identity on every path (ADR-0087).
   Expected worker credentials are pinned before creation. It supplies no native implementation,
   path provisioning, key custody, service loop, or runtime composition.
   A Linux-x64-only native fixture now proves that boundary against real kernel behavior: owner-only
   parent metadata, no-replacement Unix bind, exact `0600` listener identity, backlog `1`, accepted
   `SO_PEERCRED`, bounded frames, synchronous close, exact-identity unlink, and substituted-path
   preservation (ADR-0088). The fixture is test-only, unexported, and excluded from runtime output.
   An exported but uncomposed production-facing adapter now narrows a future Linux native listener
   module to one exact versioned ABI and one frozen no-replacement creation request, wraps listener
   and accepted-session handles in ordered one-shot state machines, enforces the 32 KiB frame limit and
   synchronous identity-owned cleanup, clears its native response copy, and cleans an allocation when
   cancellation wins creation (ADR-0089). It does not load a binary, select or provision a path, supply
   native syscalls, loop, compose a service, or change `NOT_CONFIGURED` runtime truth.
   A source-only Linux N-API listener now implements that exact injected ABI with no-replacement
   owner-only socket creation, retained kernel identity, asynchronous cancellable accept/read/write,
   real `SO_PEERCRED`, bounded cleared frames, and synchronous substitution-safe cleanup (ADR-0090).
   Linux-x64 tests compile the production source with warnings as errors and hardening flags and run
   one authenticated kernel exchange plus cancellation evidence. No loader, compiled repository
   artifact, path provisioner, service loop, worker wiring, or positive runtime composition exists.
   An exported but uncomposed worker-side native adapter now narrows the ADR-0085 client binding to
   one exact versioned ABI, captures module and handle methods against drift, pins initial stat,
   connect, ordered bounded exchange, and final stat to one socket path, clears request/native-
   response/intermediate copies, and closes allocations rejected by cancellation or malformed handle
   shape (ADR-0091). The listener adapter also cleans malformed returned listener allocations. No
   binary loader, native client implementation, path selection, worker composition, or runtime truth
   promotion is supplied.
   A source-only Linux N-API client now implements that exact injected ABI with kernel `lstat(2)` and
   `SO_PEERCRED` evidence, asynchronous cancellable nonblocking connect/write/read, an ordered one-shot
   handle, bounded cleared frames, and close-on-every-path ownership (ADR-0092). Linux-x64 tests compile
   the production source with warnings as errors and hardening flags and prove an authenticated kernel
   exchange, pending-read cancellation, and final-stat socket substitution denial. No loader,
   repository binary, selected path, process launcher, retry loop, worker wiring, or positive runtime
   composition exists; Codex, Hermes, and Pi remain `NOT_CONFIGURED`.
   An exported but uncomposed Linux-x64 loader now requires one exact five-minute module-and-socket
   authorization, retains `O_NOFOLLOW` descriptors, verifies module identity/owner/mode/size/digest
   before loading through `/proc/self/fd`, retains at most one immutable descriptor per module kind,
   binds the existing owner-only socket directory, and admits only the exact listener or client ABI
   (ADR-0093). Linux-x64 tests load both production sources and
   deny module and directory symlinks. The authorization source and host deny by default; no native
   binary is packaged, no path is selected or provisioned, no service is composed, and runtime truth
   remains `NOT_CONFIGURED`.
   A separate exported but uncomposed trust source now authenticates purpose-bound five-minute
   Ed25519 module-authorization snapshots, returns only an exact request-bound grant, and advances a
   supervisor-instance-scoped compare-and-swap checkpoint before exposing authority (ADR-0094).
   Adjacent hash-linked rotation, identical replay, root rotation, explicit empty-snapshot
   revocation, rollback, gaps, equivocation, and authorization-version rollback have fail-closed
   contracts. PostgreSQL snapshot-reader and checkpoint adapters now persist immutable signed
   snapshots, exact grant-bound CAS state, and append-only transition evidence (ADR-0095), but remain
   uncomposed. An identity-preserving Linux-x64 path provisioner now copies one explicitly attested
   retained source into an absent owner-only `0500` module path and creates one absent owner-only
   module through retained parents while reusing one exact identity-bound `0700` socket directory
   (ADR-0096/0116). It denies by default, never replaces
   an existing target, keeps the socket absent, and returns only exact identities for later signing.
   API-side construction functions now join only the exact Level-3 parent/path authorities and one
   shared clock to the real retained-descriptor Linux hosts (ADR-0117). Construction is inert, the
   returned provisioners remain one-attempt, and the functions remain absent from every application
   composition root.
   A separate retained-descriptor Linux-x64 boundary can now create one absent owner-only attempt
   root beneath an exact already-attested parent, with a one-use Level-3 API authority and inert real-
   host construction (ADR-0118). Parent-directory authorization commits to the root provisioning ID,
   request hash, and approval-evidence hash. Fresh attempt IDs provide bounded retry isolation without
   recursive cleanup. A topology-neutral one-attempt controller now sequences runtime-root, parent,
   worker CLIENT, and API LISTENER provisioning through four separately injected ports, derives each
   request only from prior attestation, and returns no partial bundle (ADR-0119). It supplies no
   transport, writable parent/shared mount, service activation, or runtime truth. Two role-local
   retained-descriptor observers plus a bounded reconciler can now prove that API/LISTENER and
   worker/CLIENT see the same exact owner-only runtime parent and their expected immutable source
   artifacts (ADR-0120). The observation ports remain untransported and uncomposed, and the current
   deployment still has no shared runtime mount. A one-use composition boundary now makes all four
   provisioning steps unreachable until that exact two-role topology is fresh and bound to the same
   plan, and requires provisioning to complete before the topology expires (ADR-0121). It remains
   uncomposed and supplies neither the missing mount nor authenticated transports.
   A separate uncomposed publisher now reuses the exact Ed25519 admission boundary and can append
   only an authenticated snapshot proof through a PostgreSQL adapter; database serialization admits
   only bootstrap, exact latest replay, or the adjacent hash-linked successor and denies concurrent
   forks (ADR-0097). An uncomposed one-shot controller now exact-binds tenant/supervisor identity,
   owner-only path attestations, a five-minute Level-3 approval, canonical module-load request hashes,
   and an injected signer before submitting to that independent publisher (ADR-0098). It supports
   signed empty-snapshot revocation, rejects Level 4, and has no private-key custody. No root/key
   provisioning, production signer, approval-source composition, module loading composition, service
   loop, or runtime connection is configured. A separate audited publication boundary now carries an
   unforgeable controller-minted issuance proof through independent signature authentication and
   atomically stores the snapshot with exact Level-3 approval evidence (ADR-0099). PostgreSQL rejects
   stale evidence at its own clock, fixes a supervisor chain to one workspace, binds evidence to the
   signed snapshot, and denies mutation; identical replay rechecks every snapshot and audit field.
   The adapter remains uncomposed. A separate API-side authority adapter can now turn one exact
   trusted `CONTROL_PLANE` Level-3 capability into one domain-separated, one-minute issuance grant
   without touching the Founder-only Level-4 workflow (ADR-0100). It rejects Level 4, runtime
   principals, request drift, and replay, and remains absent from every composition root.
   A separate one-use keyless signer client now binds the exact canonical snapshot payload to one
   signer and one domain-separated request, bounds request/response bytes plus exchange and close
   deadlines, and closes its injected channel before returning (ADR-0101). It contains no key,
   concrete transport, root provisioning, or composition; the independent publisher still verifies
   every signature. A separate uncomposed PostgreSQL registry now persists public-only Ed25519 root
   versions with exact workspace/supervisor scope and immutable Level-3 evidence (ADR-0102). It
   serializes tenant ownership, permits only adjacent monotonic versions and irreversible
   revocation, denies unaudited mutation, and returns at most eight current roots. It provisions no
   private key and is not yet composed with the signer or publisher. A separate uncomposed Linux
   signing transport now carries one bounded keyless request over the existing local IPC client and
   authenticates the exact before/after Unix-socket identity plus `SO_PEERCRED` principal
   (ADR-0103). It discovers no path, owns no key, starts no signer service, and is absent from every
   composition root. A matching uncomposed supervisor-side handler now authenticates the accepted
   listener endpoint and peer, verifies the canonical payload and whole-request hashes, delegates
   only public snapshot bytes to an injected one-use abortable custody session, and closes custody
   before returning an exact 64-byte Ed25519 response (ADR-0104). It supplies no key, native
   service, listener, actual root, or composition. The existing accepted-session owner now admits
   that concrete handler, authenticates and bounds one native request/response, closes custody even
   when pre-handler socket work fails, and denies both concurrent and sequential reuse (ADR-0105).
   The same one-use listener lifecycle now exposes a signing-specific entry point that authenticates
   the no-replacement socket identity before issuing a frozen public-only request to a synchronous
   custody factory, then owns custody, the authenticated session, and exact listener cleanup as one
   consumed attempt (ADR-0107). The factory port has no implementation or key, and the lifecycle
   remains uncomposed; actual custody, service composition, and key/root provisioning remain absent.
   The public-root registry's concurrent first-scope bootstrap now handles either unique-index
   conflict without leaking a database error and admits only exact later-statement replay
   authentication; eight-way integration contention requires one append and seven replays
   (ADR-0106). No actual root is provisioned by this contract.
   A separate one-attempt PostgreSQL issuance composition now binds the exact workspace/supervisor
   public-root read, one-minute Level-3 authority, injected signer, independent signature
   authentication, and audited snapshot/evidence append as one fail-closed chain (ADR-0108). It is
   serialized against public-root rotation/revocation and rechecks the latest signer root at the
   database clock before append. It remains absent from routes and service composition and supplies
   no signer implementation, key/root
   provisioning, listener, module load, or runtime-status promotion.
   A separate one-attempt PostgreSQL trust composition now joins current workspace-scoped roots,
   only the latest snapshot carrying immutable issuance evidence, independent authentication, and
   the durable anti-rollback checkpoint (ADR-0109). Before exposing an exact request-bound grant it
   takes the existing publication and root locks in order and rechecks the same latest audited
   snapshot plus active root at the database clock. It remains absent from routes, workers, the Nest
   graph, and the native loader and supplies no key/root, signer, binary, service owner, or runtime
   truth promotion.
   The audited durable source is now the only positive authorization input accepted by one explicit
   retained-descriptor Linux-x64 loader construction (ADR-0110). Construction performs no trust read,
   path selection, filesystem access, native load, socket operation, or service action and remains
   absent from routes, workers, the Nest graph, and deployment. The composition itself supplies no
   module artifact, key/root, or signer, and runtime truth remains `NOT_CONFIGURED`.
   The reviewed listener and client sources are now compiled as immutable, root-owned, non-writable
   inputs in only the API and worker images respectively, with exact local-only image allowlist and
   security scanning (ADR-0111). No image command references them and no loader, provisioner,
   service, socket, key/root, signer, publication, or deployment is activated.
   Native path requests and attestations now exact-bind workspace and supervisor scope; a one-use
   API-side authority can derive their one-minute digest-only grant from an exact non-runtime
   `CONTROL_PLANE` Level-3 capability, and snapshot issuance rejects cross-scope attestations before
   authority or signing (ADR-0112). The adapter remains uncomposed and does not provision a path.
   A separate one-attempt service owner now requires a fresh exact Level-3 grant binding that path
   evidence to one tenant, supervisor, recovery-or-signing purpose, socket identity, worker
   principal, and 100–5,000 ms deadline before constructing the existing no-replacement listener
   lifecycle (ADR-0113). Its authority denies by default; it adds no retry or daemon loop and remains
   absent from every composition root, so no listener, signer, loader, worker, or runtime is active.
   A one-use API-side adapter can now derive that exact service grant from only a trusted non-runtime
   `CONTROL_PLANE` Level-3 capability, with domain-separated digest-only evidence and no Level-4 or
   AI-COO path (ADR-0114). The adapter remains uncomposed and performs no service or runtime action.
   A retained-descriptor Linux-x64 parent-directory provisioner can now create only the absent fixed
   `native`, `run`, and `run/supervisor` hierarchy beneath one exact owner-only runtime root, with a one-use tenant-bound
   Level-3 control-plane authority (ADR-0115). Its identities and approval provenance are mandatory
   inputs to path provisioning and survive into snapshot issuance. Both pieces remain uncomposed;
   no writable mount, runtime path, module load, socket, service, signer, worker, or runtime is active.
   The path host now reuses that single retained socket-directory identity for both CLIENT and
   LISTENER module attestations instead of attempting an impossible second exclusive directory
   creation (ADR-0116).
   Merged contracts are not runtime-connectivity evidence.
3. **Mission Control continuation:** the protected Founder Mission Control is
   deployed from the operations repository and displays verified company state.
   The product repository now includes a bounded authenticated read-only
   Workflow Centre source at `/dashboard/workflows`. It combines safe legacy
   workflow metadata with persisted Agent Control Plane objective, task, run,
   runtime, connection, and pending Level-4 summaries without exposing approval
   authority, private evidence, secrets, transcripts, artifacts, or cost. This
   source capability is not live telemetry or deployment evidence.
   Continue authenticated telemetry, task graph, approvals, security,
   infrastructure, commercial, finance, and board views without exposing
   confidential fields or weakening Cloudflare Access.
4. **Commercial validation:** select and qualify one real beachhead pilot from
   evidence. Synthetic readiness is not a pilot, customer, revenue, conversion,
   or product-market-fit claim.

### Evidence-driven company OS workstreams

Use the state model `PLANNED → READY → IN PROGRESS → REVIEW → GREEN → MERGED →
PUBLISHED → DEPLOYED → VERIFIED`, with `PILOT`, `PRODUCTION`, `BLOCKED`, and
`RETIRED` only where the corresponding evidence exists. Never collapse merged,
published, deployed, verified, pilot, customer, invoice, or cash states.

1. **Agent Control Plane — IN PROGRESS:** the provider-neutral foundation,
   unified event/audit spine, and approval execution permits are MERGED. Continue
   tenant-scoped agents, runtimes, capabilities, authority,
   objectives/tasks/dependencies, runs/checkpoints, events, artifacts,
   approvals, heartbeats, failures/retries/handoffs, locks, schedules,
   notifications/incidents, usage/cost, and versioned models/prompts/tools/
   policies. Runtime identity, replay resistance, scoped credentials, revocation,
   concurrency, nesting, retry, time, tool, and budget limits are release gates.
   The repository now includes a verified, service-only durable objective/
   project/task/dependency/run/artifact spine with exact Level-4 approval
   preparation bound to real durable task/run rows and fail-closed evidence
   ports. This is coordination evidence, not runtime connectivity or execution.
2. **Runtime Broker and adapters — IN PROGRESS:** the capability- and
   policy-aware Runtime Broker, constrained Agent Bridge durable admission,
   exact durable capacity/cost/compute reservations, and scoped deny-only
   secret leases are MERGED and VERIFIED. The bridge is service-only, stops at
   `PARTIAL`, and has a deny-only launcher plus an unexported deterministic test
   fixture. A Linux-only trusted executable/admission-evidence reader and
   deny-by-default composition issue only process-local plans after a live
   authority read; production authority and launching still deny. Windows
   identity inspection, actual process supervision/transport, and authenticated
   runtime adapters remain to be completed. Codex, Hermes, and Pi remain
   **NOT_CONFIGURED** until each demonstrates authenticated
   registration, capability exchange, heartbeat, task/status exchange, and an
   event/result round trip. Do not infer connectivity from installed software,
   repositories, or prior conversations.
3. **Dynamic Agent Factory and AI COO — IN PROGRESS:** governed foundations for
   both are MERGED. Continue bounded temporary specialists only when
   specialization adds value; use isolated worktrees,
   branches, ownership, locks, acceptance criteria, stop conditions, retention,
   authority, and budgets. AI COO decomposes founder objectives and coordinates
   human and AI assignees but cannot bypass CI, security, policy, or Level-4
   boundaries.
4. **Mission Control and AI Workforce — IN PROGRESS:** the protected Founder
   Mission Control is deployed from the operations repository. Continue evolving
   it into an evidence-backed view of company health, objectives/tasks/runs,
   real agent telemetry, approvals, incidents, releases, infrastructure,
   security, customers, commercial evidence, finance, costs, board decisions,
   and risks. The bounded product Workflow Centre is the first authenticated
   read-only task/workforce view; streaming telemetry and operator controls remain
   separate future work. Do not fake live events or publish arbitrary percentages.
5. **Voice — IN PROGRESS:** the governed provider-neutral Voice Gateway
   foundation is MERGED. Push-to-talk, activated STT/TTS adapters, end-to-end
   voice interaction, history, and live-evidence briefings are not yet verified.
   Voice never bypasses secure Level-4 confirmation, and no paid provider may be
   activated without founder authorization.
6. **Memory, playbooks, evaluation, and outcome graph — IN PROGRESS:** the
   unified event/audit spine provides an initial observable-fact substrate.
   Continue to preserve
   provenance, freshness, contradictions, decisions, observable actions,
   artifacts, experiments, outcomes, evaluations, agent scorecards, and
   versioned playbooks with tenant/workspace/permission scope, retention,
   export, and deletion controls. Do not store private chain-of-thought or leak
   tenant-private learning.
7. **Commercial proof — PLANNED:** maintain focus on one evidence-selected
   beachhead ICP, synthetic demo readiness, discovery, design partners, pilots,
   measured value, paid conversion, and repeatability. Do not invent customers,
   revenue, pipeline, pricing, partners, costs, or product-market fit.

### Dated website and operations snapshot (verified 2026-08-25)

- `ventureos.site` is the public entry point. Public claims must remain limited
  to implemented or clearly labelled directional capabilities.
- `staging.ventureos.site`, `api-staging.ventureos.site`, and
  `progress.ventureos.site` remain protected surfaces. This access-boundary
  statement is not a current-main product deployment claim.
- Operations PR #24 deployed the protected Founder Mission Control from the
  private operations repository. Its deployment, command-center, and Site
  Steward checks were green at the dated verification point. This is a non-
  authoritative historical snapshot: private operations evidence and the live
  Access boundary are authoritative for newer state.
- The Mission Control deployment did not publish product images or deploy the
  product application, API staging, or current-main private staging. Website
  content and confidential reporting must be synchronized only through their
  authorized workflows and must retain public/private field boundaries.

### Release, staging, and pilot sequence

1. Merge this docs-only reconciliation only after exact-head CI,
   staging-security, CodeQL, and independent truth/diff review pass. Routine safe
   documentation merges are authorized, but this change must not dispatch a
   deployment or publication.
2. Continue Agent Control Plane, Runtime Broker, Dynamic Agent Factory, AI COO,
   Mission Control, Voice, and runtime-adapter work through independently
   reviewed, non-deploying PRs with tenant/authority/budget boundaries intact.
3. Keep the protected Mission Control synchronized through its separate
   operations repository. Any operations merge that updates a website retains
   its deploy-aware Founder boundary; never infer a new deployment from product
   repository changes.
4. Treat the green sanitized release-candidate workflow as current-main scan
   evidence only. Publishing the five images requires separate exact-SHA
   authorization and must produce trusted immutable digest evidence.
5. Deploy only the authorized digests to Access-protected private staging after
   a separate deployment authorization. Validate migrations, health, E2E,
   responsive/accessibility behavior, tenant isolation, audit evidence,
   backup/restore, and rollback using synthetic data and disabled live providers.
   The source-only rollback/restore readiness contract now binds exact prior
   source/digests/health and migration compatibility and exercises a disposable
   PostgreSQL drill. A real backup, restore, or deployment remains separately
   gated and is not evidenced by that fixture.
6. Run a current-main internal synthetic-data rehearsal. An invited pilot follows only after
   privacy/terms/data-handling, access, support, incident, and rollback ownership
   are approved. Record observed pilot evidence; do not infer pricing, revenue,
   conversion, or product-market fit from mock data or draft code.
7. Consider paid/live-provider or production activation only from measured
   staging/pilot evidence and a separately approved commercial and operational
   plan.

### Founder decisions that require separate approval

- Any spend, paid account, provider contract, pricing, customer promise, or
  other legal/commercial commitment.
- Supplying or rotating production credentials, enabling live AI, marketplace,
  email, payment, advertising, monitoring, or other external providers.
- Collecting or accessing customer/personal data, approving privacy/terms/
  retention/data-processing arrangements, or selecting a real pilot cohort.
- Publishing images for an exact SHA; changing production DNS/infrastructure;
  deploying to private staging or production; and accepting the associated
  backup, rollback, incident, and support ownership.

Routine development, documentation, security, UI, collaboration, Agent Control
Plane, runtime-adapter, dashboard, voice, testing, accessibility, and internal
tooling PRs may be independently reviewed, validated, and merged under the
2026-08-20 autonomy amendment when they do not deploy/publish, spend, activate a
paid provider, change DNS/Cloudflare, make a legal commitment, destructively
change production, or cross another Level-4 boundary.

Phased delivery per master spec section 34. All 8 phases are now built and
locally verified end-to-end (see `docs/EXECUTION_PLAN.md` for the canonical,
itemized verification record). Phase 6 is mock-only per the founder's
explicit 2026-07-14 decision (no real Etsy account connected); Phase 8's
billing/subscriptions are likewise mock-only (no real payment processor
connected, see `docs/DECISIONS.md` ADR-010).

- **Phase 0 — Environment and Repository**: DONE
- **Phase 1 — Foundation**: DONE — auth, workspace, RBAC, audit,
  dashboard shell, seed, health, CI config, local security controls
- **Phase 2 — Opportunity and Evidence**: DONE — Opportunity/Evidence Prisma
  models + migration, seeded pilot opportunity (master spec §25 — Social Media
  Content Planning Kit), Opportunity Feed UI with full evidence trail,
  `scoring-engine` wired to real persisted data, promote/reject/archive API
  with audit logging, unit + integration tests passing, live browser-verified
  promote workflow.
- **Phase 3 — Board and Approval**: DONE — `AgentDefinition`/prompt versions
  seeded for the 8 voting agents + Decision Synthesiser, mock board-agent
  provider producing schema-valid votes, board reviews wired to the
  already-built `calculateBoardVotingResult`, Approval Centre with hash-bound
  enforcement via `isApprovalValidForExecution`, Temporal
  `boardApprovalWorkflow` (board review → approval request →
  founder-decision signal-wait), Board Room + Approval Centre UI, unit +
  integration tests passing, live browser-verified board review + approval
  decision end-to-end.
- **Phase 4 — Product and Listing Studio**: DONE — product/listing Prisma
  models + migration, `@ventureos/product-studio` (mock generation via
  `StorageProvider`, QA checks, Etsy Development Pack, mock listing
  generation, SEO evaluation), fail-closed Gate 3/Gate 4 checks, second
  founder approval gate bound to the latest `ProductPackage` hash, always-
  blocked `PublicationAttempt` (no publication occurs in Phase 4), Temporal
  `productListingWorkflow`, Product Studio + Listing Studio UI, unit +
  integration tests passing, live browser-verified product generation +
  listing + second approval decision end-to-end.
- **Phase 5 — Research Connectors**: DONE — `DataAcquisitionContract`/
  `DataAcquisitionRun` Prisma models + migration, `@ventureos/research-connectors`
  (mock-by-default provider, fail-closed disabled/rate-limit/cost-cap gates,
  real evidence freshness/reliability scoring, prompt-injection sanitiser),
  source health surfaced in the existing Integration Health UI, Research
  Connectors UI, unit + integration tests passing (including a real
  prompt-injection security proof), live browser-verified acquisition run +
  health surfacing end-to-end.
- **Phase 6 — Marketplace Pilot**: DONE — mock-only per explicit founder
  decision (2026-07-14, no real Etsy account connected);
  `MarketplaceAccount`/`IdempotencyKey` Prisma models + migration,
  `@ventureos/marketplace-connectors` (mock Etsy client, idempotent external
  writes, fail-closed gating), second/distinct `PUBLICATION` approval gate
  with hash re-validation, Temporal `marketplacePublicationWorkflow`,
  Marketplace Publication UI, unit + integration tests passing, live
  browser-verified prepare → approval → publish end-to-end (and a real
  workflow-audit-trail gap found via live verification and fixed across
  Phase 3/4/6 alike).
- **Phase 7 — Finance and Analytics**: DONE — `FinancialAssumption`/
  `FinancialForecast`/`FinancialScenario`/`Expense`/`RevenueEntry`/`Budget`/
  `BudgetAllocation`/`CostLedgerEntry`/`Experiment` (+ variants/metrics/
  results/decisions) Prisma models + migration, real forecast generation
  and forecast-vs-actual comparison on top of the already-unit-tested
  `finance-engine` calculations, budget hard-stop enforcement, model-usage
  cost tracking, the full experiment lifecycle, Gate 6 (Scale Decision)
  approval gating using the same `ApprovalRequest` machinery as every other
  phase, Finance Centre UI, unit + integration tests passing, live
  browser-verified forecast/expense/revenue/experiment/Gate-6-approval flow
  end-to-end (and two real bugs found and fixed along the way: a Gate 6
  `packageHash` mismatch that would have permanently blocked every SCALE
  approval, and a `serverApiFetch` crash on NestJS's empty-body null
  responses — found via live verification of a venture's real zero-state).
- **Phase 8 — Multi-Venture and SaaS**: DONE — full SaaS resale build-out
  per founder instruction; `Plan`/`Subscription`/`SubscriptionInvoice`/
  `LicenseKey`/`WorkspaceBranding` Prisma models + migration,
  `@ventureos/billing` (mock-only, ADR-010) with fail-closed plan-limit
  guards mirroring Phase 7's budget-guard pattern, tenant-isolation audit
  (one defense-in-depth fix, no real leak found), unified Ventures list UI,
  white-label branding actually configurable at runtime and applied to the
  dashboard shell, customer registration/onboarding flow
  (`POST /api/auth/register`), license-key issuance for exportable installs,
  customer-facing getting-started docs, unit + integration tests passing,
  live browser-verified registration → new workspace → plan change →
  license key issue/revoke → branding update end-to-end (four real bugs
  found and fixed via the verification suite along the way — see
  `docs/EXECUTION_PLAN.md` Phase 8 section and `docs/DECISIONS.md`
  ADR-011).

## Phase 2 closeout (completed)

1. ✅ Local verification of Phase 1 before writing new code
2. ✅ `Opportunity`, `OpportunityScore`, `TargetCustomer` Prisma models +
   migration
3. ✅ Seed script addition: the "Social Media Content Planning Kit" opportunity
   (master spec §25)
4. ✅ Opportunity feed page (`apps/web`) + `GET /api/opportunities` endpoint
   wired to the already-built `@ventureos/scoring-engine`
5. ✅ `EvidenceArtifact` model + evidence-attachment UI so opportunity score
   inputs have a real provenance trail

## Phase 3 closeout (completed)

1. ✅ `AgentDefinition`/`AgentPromptVersion` Prisma models + migration, seeded
   8 voting roles + Decision Synthesiser
2. ✅ Mock board-agent provider (`@ventureos/agent-runtime`) — deterministic,
   schema-validated, no live model calls (master spec §42)
3. ✅ `BoardReview`/`BoardVote`/`BoardVeto`/`DecisionSummary`/`RevisionRequest`/
   `ApprovalRequest`/`ApprovalDecision` Prisma models
4. ✅ Board review orchestration wired to the already-built
   `calculateBoardVotingResult` (75% threshold, critical veto blocking)
5. ✅ Approval Centre with hash-bound enforcement
   (`isApprovalValidForExecution`, re-validated server-side on every decision)
6. ✅ Temporal `boardApprovalWorkflow` (`apps/worker`) + Board Room/Approval
   Centre UI (`apps/web`)
7. ✅ Live browser verification: real board review run (8/8 APPROVE), real
   approval decided (APPROVE), audit trail confirmed

## Phase 4 closeout (completed)

1. ✅ `Product`/`ProductVersion`/`ProductAsset`/`ProductAssetVersion`/
   `ProductBrief`/`ProductPackage`/`LicenceRecord`/`QualityCheck`/
   `QualityCheckResult`/`Listing`/`ListingVersion`/`ListingImage`/
   `ListingFile`/`PriceProposal`/`SEOEvaluation`/`PublicationAttempt` Prisma
   models + migration
2. ✅ `@ventureos/product-studio` package — mock product generation (real
   MinIO-shaped uploads via `StorageProvider`), QA checks, Etsy Development
   Pack, mock listing generation, SEO evaluation
3. ✅ Fail-closed Gate 3/Gate 4 checks (`ProductGenerationBlockedError`/
   `ListingGenerationBlockedError`) — real, server-side, integration-tested
4. ✅ Second founder approval gate — `decideApprovalRequest`'s
   `PRODUCT_LISTING` branch, hash-bound to the latest `ProductPackage`
5. ✅ Every listing generation records an always-blocked `PublicationAttempt`
   — no publication occurs in Phase 4, confirmed as a checkable DB fact
6. ✅ Temporal `productListingWorkflow` (`apps/worker`) + Product Studio /
   Listing Studio UI (`apps/web`)
7. ✅ Live browser verification: real product generation run (reached
   QA_PASSED), real listing + SEO evaluation (100/100), real approval
   decided (APPROVE) on the second gate, audit trail confirmed

## Phase 5 closeout (completed)

1. ✅ `DataAcquisitionContract`/`DataAcquisitionRun` Prisma models + migration
   (`20260713215625_phase5_research_connectors`), applied against real Postgres
2. ✅ `@ventureos/research-connectors` package — mock-by-default provider
   (no live network calls anywhere in this phase), fail-closed
   disabled/rate-limit/cost-cap gates, real evidence freshness/reliability
   scoring, prompt-injection sanitiser
3. ✅ Research module wired into `apps/api` (`research:view`/`research:manage`
   permissions, audit-logged), 2 real seeded contracts
4. ✅ Source health surfaced via the existing Integration Health UI slot
   (Command Centre "Integration status" table) — no new UI table needed
5. ✅ Research Connectors UI (`apps/web`) — contract list + detail + trigger
   action + nav entry
6. ✅ Live browser verification: real acquisition run (SUCCEEDED, real
   `EvidenceArtifact` with computed scores), health row confirmed live in
   the Command Centre

## Phase 6 closeout (completed)

1. ✅ Founder decision gate (2026-07-14): mock-only — no real Etsy account
   connected (`docs/DECISIONS.md` ADR-007, `docs/ETSY_API_INTEGRATION.md`)
2. ✅ `MarketplaceAccount`/`IdempotencyKey` Prisma models + extended
   `PublicationAttempt`/`ApprovalRequest`, migration
   (`20260714065131_phase6_marketplace_pilot`), applied against real Postgres
3. ✅ `@ventureos/marketplace-connectors` package — mock Etsy client (zero
   live network calls anywhere in this phase), `withIdempotency` (conflict/
   replay/retry-in-place), fail-closed publication runner
4. ✅ Second, distinct `PUBLICATION` approval gate — hash-bound to the
   listing's marketplace-facing content, re-validated at both decision and
   publish time
5. ✅ Temporal `marketplacePublicationWorkflow` (`apps/worker`) + Marketplace
   Publication UI card (`apps/web`)
6. ✅ Live browser verification: real prepare → PUBLICATION approval →
   publish run via the Temporal workflow, real mock listing URL rendered
   on the product page; found + fixed a real audit-trail gap (Temporal-
   workflow-triggered actions weren't audited for intermediate steps across
   Phase 3/4/6 alike — see `docs/DECISIONS.md` ADR-008) and re-verified live

## Phase 7 closeout (completed)

1. ✅ `FinancialAssumption`/`FinancialForecast`/`FinancialScenario`/`Expense`/
   `RevenueEntry`/`MarketplaceFee`/`RefundRequest`/`Budget`/
   `BudgetAllocation`/`CostLedgerEntry` Prisma models + migration, applied
   against real Postgres
2. ✅ Model-usage cost tracking (`recordModelUsage`) — real from day one so
   enforcement is correct the moment real model providers are enabled
3. ✅ Budget hard-stop enforcement (`assertWithinBudget`/`chargeToBudget`),
   venture-scoped allocations preferred over workspace-wide ones
4. ✅ Forecast-vs-actual comparison (`compareForecastToActual`) against real
   `RevenueEntry` rows
5. ✅ `Experiment`/`ExperimentVariant`/`ExperimentMetric`/`ExperimentResult`/
   `ExperimentDecision` Prisma models + full lifecycle runner
   (`packages/finance-engine/src/experiment-runner.ts`)
6. ✅ Gate 6 (Scale Decision) approval gate — same `ApprovalRequest`/
   `decideApprovalRequest` machinery as every prior phase, KILL/ITERATE/HOLD
   never require approval, only SCALE does
7. ✅ Finance Centre UI (`apps/web`) — assumptions, forecast + scenarios,
   forecast-vs-actual, expenses, revenue, experiments
8. ✅ Live browser verification: real forecast generated, real expense +
   revenue recorded (forecast-vs-actual updated live), real experiment
   created → started → result recorded → Gate 6 approval requested and
   approved → SCALE decision recorded, full audit trail confirmed in the
   Audit Centre; found + fixed a real Gate 6 `packageHash` mismatch bug
   (would have permanently blocked every SCALE approval, see
   `docs/DECISIONS.md` ADR entries) and a real `serverApiFetch` crash on
   NestJS's empty-body null responses (ADR-009), both caught before
   reaching the founder

## Phase 8 closeout (completed)

1. ✅ `Plan`/`Subscription`/`SubscriptionInvoice`/`LicenseKey`/
   `WorkspaceBranding` Prisma models + migration
   (`20260714132415_phase8_multi_venture_and_saas`), applied against real
   Postgres
2. ✅ `@ventureos/billing` package — mock-only subscription/licensing engine
   (ADR-010), fail-closed plan-limit guards (`assertWithinVentureLimit`/
   `assertWithinMemberLimit`/`assertWithinMarketplaceAccountLimit`)
3. ✅ Tenant isolation audit across every `apps/api` service — no real leak
   found, one defense-in-depth improvement made
   (`marketplace.service.ts`)
4. ✅ Unified Ventures list UI + live plan-usage badge
   (`apps/web/src/app/dashboard/ventures`)
5. ✅ White-label branding actually configurable at runtime
   (`PATCH /workspaces/branding`) and applied to the dashboard shell
6. ✅ Customer registration/onboarding flow (`POST /api/auth/register`,
   `apps/web/src/app/register`) — starts a real 14-day TRIAL subscription
7. ✅ Installable/exportable configuration — license-key issuance +
   `docs/DEPLOYMENT.md`/`docs/CUSTOMER_GETTING_STARTED.md`
8. ✅ Live browser verification: real registration → new workspace → plan
   change (TRIAL → STARTER, limits updated correctly) → license key
   issue/revoke → white-label branding update, all confirmed end-to-end; 4
   real bugs found and fixed via the verification suite along the way (see
   `docs/DECISIONS.md` ADR-011)

## Historical master-spec milestone

The original eight implementation phases were completed as a product-scope
milestone. The prior instruction to stop after Phase 8 was superseded by the
founder's 2026-08-20 autonomous completion directive. Current work follows the
delivery roadmap above and the repository's protected review, security, and
deployment gates.
