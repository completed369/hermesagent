import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const packageFiles = [
  'packages/agent-bridge/src/authenticated-jsonl-session.ts',
  'packages/agent-bridge/src/auth.ts',
  'packages/agent-bridge/src/codec.ts',
  'packages/agent-bridge/src/codex-app-server-policy.ts',
  'packages/agent-bridge/src/codex-app-server-session.ts',
  'packages/agent-bridge/src/codex-authenticated-registration.ts',
  'packages/agent-bridge/src/evidence.ts',
  'packages/agent-bridge/src/index.ts',
  'packages/agent-bridge/src/policy.ts',
  'packages/agent-bridge/src/protocol.ts',
  'packages/agent-bridge/src/secret-lease.ts',
  'packages/agent-bridge/src/supervision-authorization.ts',
  'packages/agent-bridge/src/supervision-evidence-reader.ts',
  'packages/agent-bridge/src/supervision-lifecycle.ts',
  'packages/agent-bridge/src/supervision-policy.ts',
  'packages/agent-bridge/src/supervisor-composition.ts',
];
const serviceFiles = [
  ...packageFiles,
  'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
  'apps/api/src/modules/agent-control-plane/acp-broker-reservation.service.ts',
  'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
];

test('Agent Bridge foundation contains no transport, network, or process execution path', () => {
  const source = serviceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(
    source,
    /from\s+['"]node:(?:child_process|cluster|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(source, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.doesNotMatch(source, /@Controller\s*\(/u);
});

test('Codex app-server policy is exact, inert, and cannot promote runtime truth', () => {
  const policy = readFileSync('packages/agent-bridge/src/codex-app-server-policy.ts', 'utf8');
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const runtimeMigration = readFileSync(
    'packages/database/prisma/migrations/20260825190000_durable_agent_bridge_foundation/migration.sql',
    'utf8',
  );
  assert.doesNotMatch(
    policy,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(policy, /\bprocess\.(?:env|cwd|platform)\b|@Controller\s*\(|Prisma/u);
  assert.doesNotMatch(policy, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.match(policy, /'app-server',[\s\S]*'--listen',[\s\S]*'stdio:\/\/'/u);
  assert.match(policy, /launchAuthorization: 'NOT_CONFIGURED'/u);
  assert.match(policy, /providerAccess: 'NOT_CONFIGURED'/u);
  assert.match(policy, /manifest\.network/u);
  assert.match(index, /codex-app-server-policy/u);
  assert.match(module, /new DenyTrustedSupervisorAuthorizationSource\(\)/u);
  assert.match(module, /new DenyRuntimeProcessLauncher\(\)/u);
  assert.doesNotMatch(runtimeMigration, /CODEX_APP_SERVER_STDIO_V1/u);
});

test('Codex app-server session is bounded, I/O-free, and cannot promote runtime truth', () => {
  const session = readFileSync('packages/agent-bridge/src/codex-app-server-session.ts', 'utf8');
  assert.doesNotMatch(
    session,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(session, /\bprocess\.(?:env|cwd|platform)\b|@Controller\s*\(|Prisma/u);
  assert.doesNotMatch(session, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.match(session, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(session, /method: 'initialize'/u);
  assert.match(session, /method: 'initialized'/u);
  assert.match(session, /method: 'thread\/start'/u);
  assert.match(session, /method: 'turn\/start'/u);
  assert.match(session, /method: 'turn\/interrupt'/u);
  assert.doesNotMatch(session, /experimentalApi:\s*true/u);
});

test('Codex registration translation hashes account evidence and grants no authority', () => {
  const registration = readFileSync(
    'packages/agent-bridge/src/codex-authenticated-registration.ts',
    'utf8',
  );
  assert.doesNotMatch(
    registration,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(registration, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.doesNotMatch(registration, /account\/login|accessToken|apiKey:\s*|Prisma|@Controller/u);
  assert.match(registration, /method !== 'account\/read'/u);
  assert.match(registration, /params\.refreshToken !== false/u);
  assert.match(registration, /registrationAuthorization: 'NOT_CONFIGURED'/u);
  assert.match(registration, /runtimeConnection: 'NOT_CONFIGURED'/u);
});

test('durable Codex registration is explicit, normalized, and production-denied', () => {
  const registration = readFileSync(
    'packages/agent-bridge/src/codex-authenticated-registration.ts',
    'utf8',
  );
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260831142000_durable_codex_registration/migration.sql',
    'utf8',
  );
  assert.match(registration, /class DenyCodexRegistrationAuthorizationSource/u);
  assert.match(module, /new DenyCodexRegistrationAuthorizationSource\(\)/u);
  assert.match(service, /status: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(service, /account\/login|accessToken|apiKey:\s*/u);
  assert.match(migration, /CODEX_APP_SERVER_STDIO_V1/u);
  assert.match(migration, /acp_runtime_registration_evidence/u);
  assert.doesNotMatch(migration, /email|planType|rawPayload|credential|accessToken|apiKey/u);
});

test('production secret resolution is deny-only and has no ambient credential source', () => {
  const source = serviceFiles
    .filter((file) => !file.endsWith('supervision-evidence-reader.ts'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  assert.doesNotMatch(source, /from\s+['"]node:(?:fs|os)['"]/u);
  assert.doesNotMatch(source, /\bprocess\.env\b|\bdotenv\b/u);
  assert.doesNotMatch(index, /deterministic.*secret|fake.*secret/iu);
  assert.doesNotMatch(source, /\bBRIDGE_SECRET_RESOLVER\b/u);
  assert.match(module, /new DenyBridgeSecretLeaseResolver\(\)/u);
  assert.match(module, /provide:\s*BRIDGE_SECRET_LEASE_RESOLVER/u);
});

test('authenticated JSONL session is post-auth, bounded, atomic, and I/O-free', () => {
  const session = readFileSync('packages/agent-bridge/src/authenticated-jsonl-session.ts', 'utf8');
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  assert.doesNotMatch(
    session,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(session, /\bprocess\.(?:env|cwd|platform)\b|@Controller\s*\(|Prisma/u);
  assert.doesNotMatch(session, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.match(session, /purpose:\s*'VERIFY_FRAME'/u);
  assert.match(session, /deriveBridgeKeys/u);
  assert.match(session, /verifyBridgeEnvelope\(envelope, keys\.runtimeToParent/u);
  assert.match(session, /keys\.parentToRuntime\.fill\(0\)/u);
  assert.match(session, /keys\.runtimeToParent\.fill\(0\)/u);
  assert.match(session, /let verificationCompleted = false/u);
  assert.match(session, /verificationCompleted = true/u);
  assert.match(session, /if \(!verificationCompleted\)/u);
  assert.match(session, /finally\s*\{/u);
  assert.match(session, /#nextSequence = 1/u);
  assert.match(session, /#capabilitiesAccepted = false/u);
  assert.match(session, /envelope\.type !== 'CAPABILITIES'/u);
  assert.match(session, /else if \(envelope\.type === 'CAPABILITIES'\)/u);
  assert.match(session, /#ingesting = false/u);
  assert.match(session, /this\.#state = 'FAILED'/u);
  assert.match(session, /if \(this\.#state !== 'ACTIVE'\)/u);
  assert.match(session, /MAX_AUTHENTICATED_BATCH_FRAMES/u);
  assert.match(session, /MAX_AUTHENTICATED_SESSION_FRAMES/u);
  assert.match(session, /MAX_AUTHENTICATED_SESSION_BYTES/u);
  assert.match(session, /const commitObservedAt = Date\.now\(\)/u);
  assert.match(session, /commitObservedAt >= Date\.parse\(this\.#context\.expiresAt\)/u);
  assert.match(session, /readonly ingestedBytes: number/u);
  assert.doesNotMatch(session, /acceptedBytes/u);
  assert.doesNotMatch(session, /POST_AUTH_TYPES[\s\S]{0,300}'(?:CHALLENGE|AUTHENTICATE)'/u);
  assert.match(index, /authenticated-jsonl-session/u);
  assert.doesNotMatch(index, /deterministic.*session|fake.*session/iu);
});

test('durable authenticated batches stay internal, bounded, atomic, and deny-wired', () => {
  const codec = readFileSync('packages/agent-bridge/src/codec.ts', 'utf8');
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const decodeIndex = service.indexOf('envelopes = decodeBridgeBatch(input.bytes)');
  const transactionIndex = service.indexOf('private async acceptRuntimeEnvelopes');
  assert.ok(decodeIndex >= 0 && transactionIndex > decodeIndex);
  assert.match(codec, /export function decodeBridgeBatch/u);
  assert.match(codec, /MAX_BRIDGE_BUFFER_BYTES/u);
  assert.match(codec, /MAX_BRIDGE_BATCH_FRAMES/u);
  assert.match(codec, /Bridge batch must end with a complete JSON line/u);
  assert.match(service, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(service, /purpose: 'VERIFY_FRAME'/u);
  assert.match(service, /for \(const envelope of envelopes\)[\s\S]*verifyBridgeEnvelope/u);
  assert.match(service, /keys\.parentToRuntime\.fill\(0\)/u);
  assert.match(service, /keys\.runtimeToParent\.fill\(0\)/u);
  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/u);
  assert.match(service, /claimedDispatchIds[\s\S]*\.sort\(\)/u);
  assert.match(service, /\[\.\.\.claimedRunIds\]\.sort\(\)/u);
  assert.match(service, /\[\.\.\.claimedTaskIds\]\.sort\(\)/u);
  assert.match(service, /envelope\.type === 'HEARTBEAT'[\s\S]*commitNow\.getTime\(\) - 60_000/u);
  const brokerVerificationIndex = service.indexOf(
    'await this.brokerEvidence.verify(brokerEvidence)',
  );
  const acceptanceClockIndex = service.indexOf('const acceptanceNow = await databaseNow(tx)');
  const acceptanceMutationIndex = service.indexOf(
    "data: { state: 'ACCEPTED', acceptedAt: acceptanceNow }",
  );
  assert.ok(
    brokerVerificationIndex >= 0 &&
      acceptanceClockIndex > brokerVerificationIndex &&
      acceptanceMutationIndex > acceptanceClockIndex,
  );
  assert.match(service, /currentConnection\.version !== heartbeatIdentity\.version/u);
  assert.match(service, /data: \{ expectedSequence: \{ increment: 1 \} \}/u);
  assert.match(service, /session = await tx\.acpBridgeSession\.findUniqueOrThrow/u);
  assert.doesNotMatch(service, /@Controller\s*\(/u);
  assert.match(module, /new DenyBridgeSecretLeaseResolver\(\)/u);
  assert.match(module, /new DenyRuntimeProcessLauncher\(\)/u);
});

test('dispatch authorization outbox is metadata-only, directional, and has no delivery path', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260827090000_acp_dispatch_outbox/migration.sql',
    'utf8',
  );
  const outbox = schema.slice(
    schema.indexOf('model AcpBridgeDispatchOutbox'),
    schema.indexOf('model AcpBridgeEgressHandoffAttempt'),
  );
  const preparation = service.slice(
    service.indexOf('async prepareDispatchAuthorization'),
    service.indexOf('async requestCancellation'),
  );
  const dispatchPreparation = service.slice(
    service.indexOf('async prepareDispatch('),
    service.indexOf('async prepareDispatchAuthorization'),
  );
  assert.match(service, /prepareDispatchAuthorization/u);
  assert.match(service, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(service, /purpose: 'SIGN_FRAME'/u);
  assert.match(service, /signBridgeEnvelope\(unsigned, keys\.parentToRuntime\)/u);
  assert.match(service, /keys\.parentToRuntime\.fill\(0\)/u);
  assert.match(service, /keys\.runtimeToParent\.fill\(0\)/u);
  assert.match(service, /dispatch\.state !== 'PREPARED'/u);
  assert.match(service, /run\.requiredAuthority >= 4/u);
  assert.match(service, /connection\.lastHeartbeatAt\.getTime\(\) < now\.getTime\(\) - 60_000/u);
  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/u);
  assert.match(preparation, /error\.code === 'P2034'[\s\S]*error\.code === 'P2002'/u);
  assert.match(
    preparation,
    /acp_bridge_sessions[\s\S]*FOR UPDATE[\s\S]*acp_runtime_connections[\s\S]*FOR UPDATE[\s\S]*acp_bridge_dispatches[\s\S]*FOR UPDATE[\s\S]*acp_runs[\s\S]*FOR UPDATE[\s\S]*acp_tasks[\s\S]*FOR UPDATE/u,
  );
  assert.match(
    dispatchPreparation,
    /acp_bridge_sessions[\s\S]*FOR UPDATE[\s\S]*acp_runtime_connections[\s\S]*FOR UPDATE[\s\S]*acp_runs[\s\S]*FOR UPDATE[\s\S]*acp_tasks[\s\S]*FOR UPDATE/u,
  );
  assert.doesNotMatch(preparation, /reservation\.expiresAt/u);
  assert.doesNotMatch(
    outbox,
    /\b(?:mac|payload|rawLine|taskText|prompt|transcript|secret)\s+String\b/iu,
  );
  assert.match(outbox, /messageType\s+String\s+@default\("DISPATCH"\)/u);
  assert.match(outbox, /state\s+String\s+@default\("PREPARED"\)/u);
  assert.doesNotMatch(outbox, /SENT|DELIVERED|ACKNOWLEDGED/u);
  assert.match(migration, /dispatch authorization metadata is immutable/u);
  assert.match(migration, /outbound sequence mismatch/u);
  assert.match(migration, /"messageType" = 'DISPATCH'/u);
  assert.match(
    migration,
    /acp_bridge_sessions[\s\S]*FOR UPDATE;[\s\S]*acp_runtime_connections[\s\S]*FOR UPDATE;[\s\S]*acp_bridge_dispatches[\s\S]*FOR UPDATE;[\s\S]*acp_runs[\s\S]*FOR UPDATE;[\s\S]*acp_tasks[\s\S]*FOR UPDATE;[\s\S]*acp_runtimes[\s\S]*FOR UPDATE;[\s\S]*acp_broker_reservations[\s\S]*FOR UPDATE;[\s\S]*db_now := clock_timestamp\(\)/u,
  );
  assert.match(migration, /db_utc := db_now AT TIME ZONE 'UTC'/u);
  assert.match(migration, /active claimed reservation/u);
  assert.doesNotMatch(migration, /reservation_expires/u);
  assert.match(service, /existing\.signedEnvelopeDigest, signedEnvelopeDigest/u);
  assert.match(service, /existing\.authenticationTagDigest/u);
  assert.doesNotMatch(service, /@Controller\s*\(|\bfetch\s*\(|\b(?:spawn|exec|fork)\s*\(/u);
});

test('egress handoff claims are exclusive metadata and cannot send or promote status', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260827140000_acp_egress_handoff_claims/migration.sql',
    'utf8',
  );
  const integration = readFileSync(
    'apps/api/test/acp-bridge-admission.integration.spec.ts',
    'utf8',
  );
  const approvalReferencePolicy = readFileSync(
    'packages/agent-control-plane/src/approval-bridge.ts',
    'utf8',
  );
  const capabilityEventPolicy = readFileSync('packages/agent-control-plane/src/events.ts', 'utf8');
  const model = schema.slice(
    schema.indexOf('model AcpBridgeEgressHandoffAttempt'),
    schema.indexOf('model AcpRunUsage'),
  );
  const claim = service.slice(
    service.indexOf('async claimDispatchEgressHandoff'),
    service.indexOf('async requestCancellation'),
  );
  assert.match(claim, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(claim, /const ownerReference = context\.principalId/u);
  assert.match(claim, /ownerActorKind: actorKind/u);
  assert.doesNotMatch(claim, /input\.ownerReference/u);
  assert.match(claim, /purpose: 'SIGN_FRAME'/u);
  assert.match(claim, /signBridgeEnvelope\(unsigned, keys\.parentToRuntime\)/u);
  assert.match(claim, /keys\.parentToRuntime\.fill\(0\)/u);
  assert.match(claim, /keys\.runtimeToParent\.fill\(0\)/u);
  assert.match(claim, /let handoffCompleted = false/u);
  assert.match(claim, /handoffCompleted = true/u);
  assert.match(claim, /if \(!handoffCompleted \|\| !result\)/u);
  assert.match(claim, /Prisma\.TransactionIsolationLevel\.Serializable/u);
  assert.match(claim, /error\.code === 'P2034'[\s\S]*error\.code === 'P2002'/u);
  assert.match(
    claim,
    /acp_bridge_sessions[\s\S]*FOR UPDATE[\s\S]*acp_runtime_connections[\s\S]*FOR UPDATE[\s\S]*acp_bridge_dispatches[\s\S]*FOR UPDATE[\s\S]*acp_runs[\s\S]*FOR UPDATE[\s\S]*acp_tasks[\s\S]*FOR UPDATE[\s\S]*acp_runtimes[\s\S]*FOR UPDATE[\s\S]*acp_broker_reservations[\s\S]*FOR UPDATE[\s\S]*acp_bridge_dispatch_outbox[\s\S]*FOR UPDATE/u,
  );
  assert.match(claim, /outbox\.signedEnvelopeDigest, signedDigest/u);
  assert.match(claim, /outbox\.authenticationTagDigest/u);
  assert.match(
    claim,
    /existing\.signedEnvelopeDigest,[\s\S]{0,100}attemptData\.signedEnvelopeDigest/u,
  );
  assert.match(
    claim,
    /existing\.authenticationTagDigest,[\s\S]{0,100}attemptData\.authenticationTagDigest/u,
  );
  assert.doesNotMatch(
    claim,
    /SENT|DELIVERED|ACKNOWLEDGED|@Controller\s*\(|\bfetch\s*\(|\b(?:spawn|exec|fork)\s*\(/u,
  );
  assert.doesNotMatch(
    claim,
    /costGovernance|maximumCost|maximumCompute|approval|Approval|data:\s*\{\s*(?:status|state):\s*'(?:CONNECTED|SENT|DELIVERED)'/u,
  );
  assert.doesNotMatch(
    model,
    /\b(?:mac|payload|rawLine|taskText|prompt|transcript|secret)\s+String\b/iu,
  );
  assert.doesNotMatch(model, /SENT|DELIVERED|ACKNOWLEDGED/u);
  assert.match(migration, /egress handoff attempt metadata is immutable/u);
  assert.match(migration, /acp_bridge_egress_handoff_releases/u);
  assert.match(service, /async releaseDispatchEgressHandoff/u);
  assert.match(service, /AcpBridgeEgressHandoffRelease/u);
  assert.match(migration, /already exclusively claimed/u);
  assert.doesNotMatch(migration, /db_utc/u);
  assert.match(migration, /session_expires TIMESTAMPTZ/u);
  assert.match(migration, /heartbeat_at TIMESTAMPTZ/u);
  assert.match(migration, /s\."expiresAt" AT TIME ZONE 'UTC'/u);
  assert.match(migration, /c\."lastHeartbeatAt" AT TIME ZONE 'UTC'/u);
  assert.match(migration, /session_expires <= db_now/u);
  assert.match(migration, /heartbeat_at < db_now - INTERVAL '60 seconds'/u);
  assert.match(
    integration,
    /WITH db_clock AS \([\s\S]*date_trunc\('milliseconds', clock_timestamp\(\)\) AS claimed_at[\s\S]*JOIN "acp_bridge_dispatch_outbox" source/u,
  );
  assert.match(
    integration,
    /"lastHeartbeatAt" = \(clock_timestamp\(\) - INTERVAL '61 seconds'\) AT TIME ZONE 'UTC'/u,
  );
  assert.match(integration, /"lastHeartbeatAt" = clock_timestamp\(\) AT TIME ZONE 'UTC'/u);
  assert.match(migration, /source_row "acp_bridge_dispatch_outbox"%ROWTYPE/u);
  assert.match(migration, /ventureos_egress_safe_reference/u);
  assert.match(
    approvalReferencePolicy,
    /const SAFE_REFERENCE = \/\^\[A-Za-z0-9\]\[A-Za-z0-9:\._\/@-\]\{0,255\}\$\/u/u,
  );
  assert.match(migration, /value ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9:\._\/@-\]\{0,255\}\$'/u);
  assert.match(
    capabilityEventPolicy,
    /const SAFE_REFERENCE = \/\^\[A-Za-z0-9\]\[A-Za-z0-9:\._\/-\]\{0,255\}\$\/u/u,
  );
  assert.match(
    service,
    /const CAPABILITY_OWNER_REFERENCE = \/\^\[A-Za-z0-9\]\[A-Za-z0-9:\._\/-\]\{0,255\}\$\/u/u,
  );
  assert.match(
    service,
    /function auditSubjectReference[\s\S]*CAPABILITY_OWNER_REFERENCE\.test\(value\)/u,
  );
  assert.equal(
    (service.match(/auditSubjectReference\(input\.attemptId, 'attemptId'\)/gu) ?? []).length,
    2,
  );
  assert.match(service, /auditSubjectReference\(input\.releaseId, 'releaseId'\)/u);
  assert.match(
    migration,
    /ventureos_egress_safe_owner_reference[\s\S]*value ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9:\._\/-\]\{0,255\}\$'/u,
  );
  assert.match(migration, /ventureos_egress_safe_owner_reference\("ownerReference"\)/u);
  assert.match(
    migration,
    /acp_bridge_egress_handoff_reference_check[\s\S]*ventureos_egress_safe_owner_reference\("id"\)/u,
  );
  assert.match(
    migration,
    /acp_bridge_egress_handoff_release_reference_check[\s\S]*ventureos_egress_safe_owner_reference\("id"\)[\s\S]*ventureos_egress_safe_owner_reference\("attemptId"\)/u,
  );
  assert.doesNotMatch(service, /PRIVATE_REFERENCE/u);
  for (const secretFamily of [
    'github_pat',
    'npm',
    'glpat',
    'xox[baprs]',
    'hf',
    'AKIA',
    'AIza',
    'eyJ',
  ]) {
    assert.ok(approvalReferencePolicy.includes(secretFamily));
    assert.ok(migration.includes(secretFamily));
  }
  for (const exactPolicyFragment of [
    'chain[-_. ]?of[-_. ]?thought',
    'private[-_. ]?reasoning',
    '[A-Za-z0-9_-]{12,}',
    'AKIA[0-9A-Z]{16}',
    'AIza[A-Za-z0-9_-]{20,}',
    'eyJ[A-Za-z0-9_-]{5,}\\.eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{8,}',
  ]) {
    assert.ok(approvalReferencePolicy.includes(exactPolicyFragment));
    assert.ok(migration.includes(exactPolicyFragment));
  }
  assert.match(
    approvalReferencePolicy,
    /\^\[A-Za-z0-9\._-\]\+:\[A-Za-z0-9\._-\]\+@\[A-Za-z0-9\.-\]\+\$/u,
  );
  assert.match(migration, /\^\[A-Za-z0-9\._-\]\+:\[A-Za-z0-9\._-\]\+@\[A-Za-z0-9\.-\]\+\$/u);
  assert.match(model, /ownerActorKind\s+String/u);
  const handoffAdr = readFileSync('docs/ADR_0034_DURABLE_EGRESS_HANDOFF_CLAIMS.md', 'utf8');
  assert.match(
    handoffAdr,
    /Only service-created attempts and releases\s+carry the atomic audit guarantee/u,
  );
  assert.match(
    handoffAdr,
    /trigger-valid but unauthenticated correlation row without an audit event/u,
  );
  assert.doesNotMatch(migration, /INSERT INTO "audit_events"|auditService/u);
  assert.match(
    service,
    /function egressAuditIdempotencyKey[\s\S]*`bridge-egress-\$\{kind\}:\$\{sha256\(\{[\s\S]*ventureos\.bridge\.egress\.\$\{kind\}\.audit\.v1/u,
  );
  assert.match(service, /egressAuditIdempotencyKey\('claim'/u);
  assert.match(service, /egressAuditIdempotencyKey\('release'/u);
  assert.doesNotMatch(
    service,
    /idempotencyKey:\s*`bridge-egress-(?:handoff|release):\$\{input\.idempotencyKey\}`/u,
  );
  for (const indexName of [
    'acp_egress_handoff_claim_key',
    'acp_egress_handoff_generation_key',
    'acp_bridge_egress_handoff_active_idx',
    'acp_egress_release_attempt_key',
    'acp_egress_release_idempotency_key',
  ]) {
    assert.match(model, new RegExp(`map: "${indexName}"`, 'u'));
    assert.match(migration, new RegExp(`"${indexName}"`, 'u'));
  }
  assert.match(
    migration,
    /acp_bridge_sessions[\s\S]*FOR UPDATE;[\s\S]*acp_runtime_connections[\s\S]*FOR UPDATE;[\s\S]*acp_bridge_dispatches[\s\S]*FOR UPDATE;[\s\S]*acp_runs[\s\S]*FOR UPDATE;[\s\S]*acp_tasks[\s\S]*FOR UPDATE;[\s\S]*acp_runtimes[\s\S]*FOR UPDATE;[\s\S]*acp_broker_reservations[\s\S]*FOR UPDATE;[\s\S]*acp_bridge_dispatch_outbox[\s\S]*FOR UPDATE/u,
  );
});

test('bounded egress controller remains single-frame, local-only, and deny-wired', () => {
  const controller = readFileSync('packages/agent-bridge/src/egress-controller.ts', 'utf8');
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  assert.doesNotMatch(
    controller,
    /from\s+['"]node:(?:child_process|cluster|net|http|https|tls|dgram|worker_threads|fs)['"]/u,
  );
  assert.doesNotMatch(
    controller,
    /\b(?:fetch|spawn|spawnSync|exec|execFile|fork|connect|createConnection|createServer)\s*\(/u,
  );
  assert.doesNotMatch(controller, /@Controller\s*\(|\bprocess\.(?:env|cwd|platform)\b/u);
  assert.match(controller, /class DenyBridgeEgressTransport implements BridgeEgressTransport/u);
  assert.equal((controller.match(/implements BridgeEgressTransport/gu) ?? []).length, 1);
  assert.match(controller, /MAX_BRIDGE_EGRESS_WRITE_TIMEOUT_MS = 5_000/u);
  assert.match(controller, /Promise\.race\(\[this\.transport\.write\(request\), interruption\]\)/u);
  assert.match(controller, /payload\.schemaVersion !== 1/u);
  assert.match(controller, /signedEnvelopeDigest/u);
  assert.match(controller, /authenticationTagDigest/u);
  assert.match(controller, /encoded\.fill\(0\)/u);
  assert.match(controller, /line\.fill\(0\)/u);
  assert.doesNotMatch(
    controller,
    /\b(?:SENT|DELIVERED|ACKNOWLEDGED|CONNECTED|delivery|acknowledged|connected):\s*(?:true|['"])/u,
  );
  assert.match(index, /export \* from ['"]\.\/egress-controller['"]/u);
  assert.doesNotMatch(module, /BoundedBridgeEgressController|BridgeEgressTransport/u);
});

test('trusted executable evidence is Linux-only, opened-file bound, and cannot launch', () => {
  const reader = readFileSync('packages/agent-bridge/src/supervision-evidence-reader.ts', 'utf8');
  const authorization = readFileSync(
    'packages/agent-bridge/src/supervision-authorization.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const tsconfig = JSON.parse(readFileSync('packages/agent-bridge/tsconfig.json', 'utf8'));
  const testTsconfig = JSON.parse(readFileSync('packages/agent-bridge/tsconfig.test.json', 'utf8'));
  const packageJson = JSON.parse(readFileSync('packages/agent-bridge/package.json', 'utf8'));
  const runtimeAssertion = readFileSync(
    'packages/agent-bridge/scripts/assert-runtime-boundary.mjs',
    'utf8',
  );
  const runtimeCleaner = readFileSync(
    'packages/agent-bridge/scripts/clean-runtime-output.mjs',
    'utf8',
  );
  const imageWorkflow = readFileSync('.github/workflows/runtime-substrate-remediation.yml', 'utf8');
  const imageBoundary = readFileSync('scripts/verify-agent-bridge-runtime-root.mjs', 'utf8');
  assert.match(reader, /process\.platform !== 'linux'/u);
  assert.match(reader, /validatedLinuxInspectionFlags\(constants\)/u);
  assert.match(reader, /input\.O_NOFOLLOW[\s\S]*<= 0/u);
  assert.match(reader, /input\.O_NONBLOCK[\s\S]*<= 0/u);
  assert.equal((reader.match(/handle\.stat\(\{ bigint: true \}\)/gu) ?? []).length, 2);
  assert.match(reader, /digestOpenedFile\(handle\)/u);
  assert.match(reader, /finalStat\.ctimeNs !== stat\.ctimeNs/u);
  assert.match(reader, /currentPathStat\.ino !== finalStat\.ino/u);
  assert.match(reader, /finalResolvedPath !== manifest\.executable\.canonicalPath/u);
  assert.match(reader, /stat\.size > BigInt\(MAX_EXECUTABLE_BYTES\)/u);
  assert.match(reader, /stat\.mode & 0o7777n/u);
  assert.match(reader, /mode > 0o777 \|\| \(mode & 0o222\) !== 0/u);
  assert.match(reader, /identityReference !== authorization\.identityReference/u);
  assert.match(reader, /sha256 !== authorization\.sha256/u);
  const revalidationIndex = reader.indexOf(
    'authorization = validateLinuxExecutableAuthorization(storedAuthorization)',
  );
  const openIndex = reader.indexOf('handle = await fs.open(');
  assert.ok(revalidationIndex >= 0 && openIndex > revalidationIndex);
  assert.match(reader, /Math\.min\([\s\S]*authorizationExpiryMilliseconds/u);
  assert.match(authorization, /authorization\.testOnly !== true/u);
  assert.match(authorization, /verify\(/u);
  assert.match(reader, /authorizationHash: linuxExecutableAuthorizationHash\(authorization\)/u);
  assert.match(reader, /return validateSupervisorAdmission\(manifest, evidence\)\.evidence/u);
  assert.doesNotMatch(
    reader,
    /from\s+['"]node:(?:child_process|cluster|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(reader, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.doesNotMatch(reader, /\bprocess\.(?:env|cwd)\b/u);
  assert.match(index, /supervision-evidence-reader/u);
  assert.deepEqual(tsconfig.exclude, [
    'src/**/*.test.ts',
    'src/**/*.test.tsx',
    'src/**/*.test.cts',
    'src/**/*.test.mts',
    'src/**/*.spec.ts',
    'src/**/*.spec.tsx',
    'src/**/*.spec.cts',
    'src/**/*.spec.mts',
    'src/**/__tests__/**',
  ]);
  assert.deepEqual(testTsconfig.exclude, []);
  assert.equal(testTsconfig.compilerOptions.noEmit, true);
  assert.match(packageJson.scripts.build, /clean-runtime-output/u);
  assert.match(packageJson.scripts.build, /assert-runtime-boundary/u);
  assert.deepEqual(packageJson.files, ['dist']);
  assert.match(runtimeCleaner, /tsconfig\.tsbuildinfo/u);
  assert.match(runtimeAssertion, /\\\.\(\?:test\|spec\)\\\./u);
  assert.match(runtimeAssertion, /deterministic-supervision/u);
  assert.match(runtimeAssertion, /package allowlist is not runtime-only/u);
  assert.match(imageWorkflow, /packages\/agent-bridge\/\*\*/u);
  assert.match(imageWorkflow, /types: \[opened, synchronize, reopened, ready_for_review\]/u);
  assert.match(imageWorkflow, /Verify test signing material and fixtures are absent/u);
  assert.match(imageWorkflow, /verify-agent-bridge-runtime-root\.mjs/u);
  assert.match(imageWorkflow, /-mindepth 1 -printf '%y\\0%P\\0%l\\0'/u);
  assert.match(imageWorkflow, /find "\$rootfs" -type f -print0 > "\$runtime_file_manifest"/u);
  assert.match(imageWorkflow, /done < "\$runtime_file_manifest"/u);
  assert.doesNotMatch(imageWorkflow, /grep -R/u);
  assert.match(imageWorkflow, /grep -aFq/u);
  assert.doesNotMatch(imageWorkflow, /binary-files=without-match/u);
  assert.doesNotMatch(imageBoundary, /from ['"]node:fs['"]/u);
  assert.match(imageBoundary, /\\\.\(\?:test\|spec\)\\\./u);
  assert.match(imageBoundary, /TEST_SIGNING_FINGERPRINT/u);
  assert.match(imageBoundary, /for await \(const chunk of process\.stdin\)/u);
  assert.match(imageWorkflow, /MC4CAQAwBQYDK2VwBCIEIDXgLTsIlYz/u);
});

test('OS supervision policy is inert and the production launcher remains deny-only', () => {
  const supervision = readFileSync('packages/agent-bridge/src/supervision-policy.ts', 'utf8');
  const policy = readFileSync('packages/agent-bridge/src/policy.ts', 'utf8');
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  assert.doesNotMatch(
    supervision,
    /from\s+['"]node:(?:child_process|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(supervision, /\bprocess\.(?:env|cwd|platform)\b/u);
  assert.doesNotMatch(supervision, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.doesNotMatch(supervision, /\b(?:execute|launch)\s*\(/u);
  assert.match(
    supervision,
    /export function validateSupervisorAdmission\(\s*manifestInput: unknown,\s*evidenceInput: unknown,\s*\): ValidatedSupervisorAdmission/u,
  );
  assert.match(supervision, /const nowMs = Date\.now\(\)/u);
  assert.match(supervision, /authorizedWorktreeRoot/u);
  assert.match(supervision, /authorizedManifestHash/u);
  assert.match(supervision, /argumentPolicyReference/u);
  assert.match(supervision, /validatedManifest\.argvHash !== evidence\.argvHash/u);
  assert.match(supervision, /argvHash: sha256\(manifest\.argv\)/u);
  assert.doesNotMatch(index, /deterministic-supervision/u);
  assert.match(policy, /class DenyRuntimeProcessLauncher implements RuntimeProcessLauncher/u);
  assert.equal((policy.match(/implements RuntimeProcessLauncher/gu) ?? []).length, 1);
  assert.match(policy, /Runtime process launching is not enabled/u);
});

test('trusted supervisor composition requires live authority and remains deny-wired', () => {
  const composition = readFileSync('packages/agent-bridge/src/supervisor-composition.ts', 'utf8');
  const policy = readFileSync('packages/agent-bridge/src/policy.ts', 'utf8');
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  assert.doesNotMatch(
    composition,
    /from\s+['"]node:(?:child_process|cluster|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(composition, /\bprocess\.(?:env|cwd|platform)\b|@Controller\s*\(/u);
  assert.doesNotMatch(composition, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.match(composition, /class DenyTrustedSupervisorAuthorizationSource/u);
  assert.equal(
    (composition.match(/implements TrustedSupervisorAuthorizationSource/gu) ?? []).length,
    1,
  );
  assert.match(
    composition,
    /readonly #launchPlanStates = new WeakMap<object, LaunchPlanState>\(\)/u,
  );
  assert.match(
    composition,
    /readonly #launchRequestStates = new WeakMap<object, LaunchRequestState>\(\)/u,
  );
  assert.doesNotMatch(composition, /\nconst launch(?:Plan|Request)States = new WeakMap/u);
  assert.match(composition, /const consumedDecisionIds = new Map<string, number>\(\)/u);
  assert.match(composition, /const consumedLaunchNonces = new Map<string, number>\(\)/u);
  assert.match(composition, /requestHash:\s*string/u);
  assert.doesNotMatch(
    composition,
    /interface PrepareTrustedSupervisorLaunchInput[\s\S]{0,180}readonly (?:supervisionId|launchNonce)/u,
  );
  assert.match(composition, /validateLinuxExecutableAuthorization/u);
  assert.match(composition, /validateSupervisorAdmission/u);
  assert.match(composition, /createSupervisorProcessBinding/u);
  assert.match(composition, /async execute\(plan: unknown\): Promise<never>/u);
  assert.match(composition, /this\.#launchPlanStates/u);
  assert.match(composition, /this\.#launchRequestStates/u);
  assert.match(composition, /this\.#launcher\.launch/u);
  assert.match(composition, /#nativeLaunchHandoffStates = new WeakMap/u);
  assert.match(composition, /launcherFactory\(\(handoff\) => this\.#consumeNativeLaunchHandoff/u);
  assert.doesNotMatch(composition, /export function (?:issue|consume).*NativeLaunchHandoff/u);
  assert.match(
    composition,
    /Math\.min\([\s\S]*authorization\.validUntil[\s\S]*admission\.evidence\.expiresAt/u,
  );
  assert.ok((composition.match(/Date\.now\(\) >= [a-zA-Z]+\.expiresAt/gu) ?? []).length >= 2);
  assert.doesNotMatch(
    composition,
    /export function (?:activateTrustedSupervisorLaunchPlan|consumeRuntimeProcessLaunchRequest|validateRuntimeProcessLaunchRequest)/u,
  );
  const authorityRead = composition.indexOf('this.authorizationSource.read(authorizationRequest)');
  const decisionConsumption = composition.indexOf(
    'consumeAuthorizationDecision(authorizationDecision)',
  );
  const evidenceRead = composition.indexOf('this.evidenceReader.read(manifest, authorization)');
  assert.ok(
    authorityRead >= 0 && decisionConsumption > authorityRead && evidenceRead > decisionConsumption,
  );
  assert.match(module, /new DenyTrustedSupervisorAuthorizationSource\(\)/u);
  assert.match(module, /provide:\s*TRUSTED_SUPERVISOR_AUTHORIZATION_SOURCE/u);
  assert.match(module, /new DenyRuntimeProcessLauncher\(\)/u);
  assert.match(module, /provide:\s*RUNTIME_PROCESS_LAUNCHER/u);
  assert.match(
    module,
    /new TrustedSupervisorComposition\([\s\S]*denyRuntimeProcessLauncher[\s\S]*\)/u,
  );
  assert.equal((policy.match(/implements RuntimeProcessLauncher/gu) ?? []).length, 1);
  assert.doesNotMatch(index, /deterministic-supervision/u);
});

test('native supervisor evidence stays Linux-test-only and final images deny its fixtures', () => {
  const helper = readFileSync(
    'packages/agent-bridge/test/native/native-supervisor-helper.c',
    'utf8',
  );
  const fixture = readFileSync(
    'packages/agent-bridge/test/native/native-runtime-fixture.c',
    'utf8',
  );
  const addon = readFileSync('packages/agent-bridge/test/native/native-supervisor-addon.c', 'utf8');
  const testSource = readFileSync(
    'packages/agent-bridge/src/native-supervisor-boundary.test.ts',
    'utf8',
  );
  const policy = readFileSync('packages/agent-bridge/src/policy.ts', 'utf8');
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const dockerignore = readFileSync('.dockerignore', 'utf8');
  const runtimeAssertion = readFileSync(
    'packages/agent-bridge/scripts/assert-runtime-boundary.mjs',
    'utf8',
  );
  const imageBoundary = readFileSync('scripts/verify-agent-bridge-runtime-root.mjs', 'utf8');
  const imageWorkflow = readFileSync('.github/workflows/runtime-substrate-remediation.yml', 'utf8');

  assert.match(helper, /#if !defined\(__linux__\) \|\| !defined\(__x86_64__\)/u);
  assert.ok(
    (helper.match(/O_RDONLY \| O_CLOEXEC \| O_NOFOLLOW \| O_NONBLOCK/gu) ?? []).length >= 2,
  );
  assert.match(helper, /MAX_EXECUTABLE_BYTES/u);
  assert.match(helper, /bytes\[0\] != 0x7f[\s\S]*bytes\[3\] != 'F'/u);
  assert.match(helper, /SYS_memfd_create/u);
  assert.match(helper, /F_SEAL_WRITE \| F_SEAL_GROW \| F_SEAL_SHRINK \| F_SEAL_SEAL/u);
  assert.match(helper, /memcmp\(source_digest, sealed_digest, SHA256_BYTES\)/u);
  assert.match(helper, /metadata_equal\(&initial, &final_source\)/u);
  assert.match(helper, /metadata_equal\(&final_source, &current\)/u);
  assert.match(helper, /S_IWUSR \| S_IWGRP \| S_IWOTH/u);
  assert.match(helper, /SYS_openat2/u);
  assert.match(
    helper,
    /RESOLVE_BENEATH \| RESOLVE_NO_SYMLINKS \| RESOLVE_NO_MAGICLINKS \| RESOLVE_NO_XDEV/u,
  );
  assert.match(helper, /SYS_execveat[\s\S]*AT_EMPTY_PATH/u);
  assert.match(helper, /fixture_mode = authenticated_mode\(mode\) \? mode : "jsonl-fixture"/u);
  assert.match(helper, /CLOCK_REALTIME/u);
  assert.ok((helper.match(/permit_is_current\(expires_at_ms\)/gu) ?? []).length >= 2);
  assert.match(helper, /renameat\(root, "work", root, "work-retained"\)/u);
  assert.match(helper, /char \*const environment\[\] = \{NULL\}/u);
  assert.match(helper, /pipe2\(status_pipe, O_CLOEXEC\)/u);
  assert.match(helper, /SYS_pidfd_open/u);
  assert.match(helper, /setpgid\(0, 0\)/u);
  assert.match(helper, /kill\(-child, SIGTERM\)/u);
  assert.match(helper, /kill\(-child, SIGKILL\)/u);
  assert.match(helper, /process_monitor\.revents & POLLIN/u);
  assert.match(helper, /WIFSIGNALED\(child_status\)[\s\S]*WTERMSIG\(child_status\) != SIGKILL/u);
  assert.doesNotMatch(helper, /PR_SET_CHILD_SUBREAPER/u);
  assert.match(helper, /PR_SET_NO_NEW_PRIVS/u);
  assert.match(helper, /RLIMIT_CORE[\s\S]*RLIMIT_CPU[\s\S]*RLIMIT_AS[\s\S]*RLIMIT_NOFILE/u);
  assert.match(helper, /__NR_socket[\s\S]*__NR_clone[\s\S]*__NR_setsid[\s\S]*SECCOMP_RET_ERRNO/u);
  assert.doesNotMatch(helper, /getenv\s*\(/u);
  assert.match(fixture, /environ\[0\] != NULL/u);
  assert.match(fixture, /PR_GET_NO_NEW_PRIVS/u);
  assert.match(fixture, /argc != 3[\s\S]*strcmp\(argv\[1\], "--mode"\)/u);
  assert.match(fixture, /fork\(\) >= 0 \|\| errno != EPERM/u);
  assert.match(fixture, /errno != EPERM/u);
  assert.match(fixture, /memfd:ventureos-runtime-fixture/u);
  assert.match(testSource, /process\.platform === 'linux' && process\.arch === 'x64'/u);
  assert.match(
    testSource,
    /class NativeExecveatRuntimeProcessLauncher implements RuntimeProcessLauncher/u,
  );
  assert.match(testSource, /new TrustedSupervisorComposition\(/u);
  assert.match(testSource, /composition\.execute\(plan\)/u);
  assert.match(testSource, /manifest\.executable\.sha256/u);
  assert.match(testSource, /env: \{\}/u);
  assert.match(addon, /#include "native-supervisor-helper\.c"/u);
  assert.match(addon, /run_supervisor\(23, arguments, NULL, 0, evidence, NULL, 0, NULL\)/u);
  assert.match(addon, /napi_get_cb_info\(env, info, &actual, NULL/u);
  assert.match(addon, /napi_get_value_string_utf8\(env, value, NULL, 0, &required\)/u);
  assert.match(addon, /memchr\(output, '\\0', copied\)/u);
  assert.match(addon, /static napi_ref bound_consumer = NULL/u);
  assert.match(addon, /bound_consumer != NULL/u);
  assert.match(addon, /napi_call_function\(env, global, consumer, 1, handoff, &tuple\)/u);
  assert.match(addon, /napi_set_named_property\(env, exports, "bind", bind_function\)/u);
  assert.doesNotMatch(addon, /napi_set_named_property\(env, exports, "launch"/u);
  assert.match(
    testSource,
    /this\.addon\.bind\(\(handoff\) => this\.boundTuple\(consume\(handoff\)\)\)/u,
  );
  assert.doesNotMatch(index, /native-supervisor|native-runtime-fixture/u);
  assert.equal((policy.match(/implements RuntimeProcessLauncher/gu) ?? []).length, 1);
  assert.match(policy, /class DenyRuntimeProcessLauncher implements RuntimeProcessLauncher/u);
  assert.match(dockerignore, /^packages\/agent-bridge\/test\/native$/mu);
  assert.match(runtimeAssertion, /NATIVE_SUPERVISOR_DENIED/u);
  assert.match(imageBoundary, /NATIVE_TEST_FIXTURE/u);
  assert.match(imageWorkflow, /Native supervisor test helper entered a final runtime image/u);
});

test('authenticated supervised lifecycle evidence is test-only, bounded, and deny-wired', () => {
  const helper = readFileSync(
    'packages/agent-bridge/test/native/native-supervisor-helper.c',
    'utf8',
  );
  const fixture = readFileSync(
    'packages/agent-bridge/test/native/native-runtime-fixture.c',
    'utf8',
  );
  const addon = readFileSync(
    'packages/agent-bridge/test/native/authenticated-lifecycle-addon.c',
    'utf8',
  );
  const testSource = readFileSync(
    'packages/agent-bridge/src/authenticated-supervised-lifecycle.test.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const runtimeAssertion = readFileSync(
    'packages/agent-bridge/scripts/assert-runtime-boundary.mjs',
    'utf8',
  );
  const imageBoundary = readFileSync('scripts/verify-agent-bridge-runtime-root.mjs', 'utf8');
  const imageWorkflow = readFileSync('.github/workflows/runtime-substrate-remediation.yml', 'utf8');

  assert.match(helper, /pipe2\(secret_pipe, O_CLOEXEC\)/u);
  assert.match(helper, /write_all\(secret_pipe\[1\], secret, secret_length\)/u);
  assert.match(helper, /transcript_capacity[\s\S]*line_count != 3/u);
  assert.match(helper, /authenticated-cancel[\s\S]*kill\(-child, SIGTERM\)/u);
  assert.match(helper, /wait_child_bounded[\s\S]*cleanupCompletedBeforeEvidence/u);
  assert.match(
    helper,
    /hash_buffer\(\(const unsigned char \*\)transcript_output[\s\S]*transcriptDigest/u,
  );
  assert.match(helper, /AUTHENTICATED_TRANSCRIPT/u);
  assert.match(helper, /expectedTerminal/u);
  assert.doesNotMatch(helper, /authenticatedTerminal/u);
  assert.match(fixture, /#define SECRET_FD 3/u);
  assert.match(fixture, /derive_runtime_key\(secret, runtime_key\)/u);
  assert.match(fixture, /memset\(secret, 0, sizeof\(secret\)\)/u);
  assert.match(fixture, /memset\(runtime_key, 0, sizeof\(runtime_key\)\)/u);
  assert.match(fixture, /"CAPABILITIES"[\s\S]*"HEARTBEAT"[\s\S]*"CANCELLED" : "RESULT"/u);
  assert.doesNotMatch(fixture, /getenv\s*\(/u);
  assert.match(addon, /napi_get_typedarray_info/u);
  assert.match(addon, /secret_length != LIFECYCLE_SECRET_BYTES/u);
  assert.match(addon, /memset\(owned_secret, 0, sizeof\(owned_secret\)\)/u);
  assert.match(addon, /napi_call_function\(env, global, consumer, 1, arguments, &tuple\)/u);
  assert.doesNotMatch(addon, /napi_set_named_property\(env, exports, "launch"/u);
  assert.match(testSource, /new TrustedSupervisorComposition\(/u);
  assert.match(testSource, /new AuthenticatedRuntimeJsonlSession\(/u);
  assert.match(testSource, /ScopedBridgeSecretLeaseResolver/u);
  assert.match(
    testSource,
    /const envelope = this\.#consumeHandoff\(handoff\)[\s\S]*this\.secretResolver\.withSecret/u,
  );
  assert.match(testSource, /#nativeTokens = new WeakMap/u);
  assert.match(
    testSource,
    /const verified = await session\.ingest\(transcript\)[\s\S]*this\.completion = Object\.freeze/u,
  );
  assert.match(testSource, /expect\(source\.requests\)\.toHaveLength\(0\)/u);
  assert.match(testSource, /'session'[\s\S]*'nonce'[\s\S]*'generation'[\s\S]*'expiry'/u);
  assert.match(testSource, /\['CAPABILITIES', 'HEARTBEAT', 'RESULT'\]/u);
  assert.match(testSource, /\['CAPABILITIES', 'HEARTBEAT', 'CANCELLED'\]/u);
  assert.match(testSource, /cleanupCompletedBeforeEvidence: true/u);
  assert.doesNotMatch(index, /authenticated-supervised-lifecycle|authenticated-lifecycle-addon/u);
  assert.match(module, /new DenyBridgeSecretLeaseResolver\(\)/u);
  assert.match(module, /new DenyTrustedSupervisorAuthorizationSource\(\)/u);
  assert.match(module, /new DenyRuntimeProcessLauncher\(\)/u);
  assert.match(runtimeAssertion, /authenticated-supervised-lifecycle/u);
  assert.match(imageBoundary, /authenticated-lifecycle-addon/u);
  assert.match(imageWorkflow, /AUTHENTICATED_TRANSCRIPT/u);
});

test('process-tree evidence stays test-only, unexported, and absent from production images', () => {
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const policy = readFileSync('packages/agent-bridge/src/policy.ts', 'utf8');
  const dockerfile = readFileSync('Dockerfile.staging', 'utf8');
  const fixture = readFileSync('scripts/fixtures/runtime-process-tree-fixture.mjs', 'utf8');
  const harness = readFileSync('scripts/runtime-process-tree-evidence.test.mjs', 'utf8');
  assert.doesNotMatch(index, /runtime-process-tree|process-tree-evidence/u);
  assert.doesNotMatch(dockerfile, /runtime-process-tree/u);
  assert.match(fixture, /VENTUREOS_TEST_PROCESS_TREE/u);
  assert.match(fixture, /test-only process-tree fixture denied/u);
  assert.match(harness, /process\.execPath/u);
  assert.match(harness, /process\.kill\(pid, 'SIGKILL'\)/u);
  assert.doesNotMatch(harness, /process\.argv|process\.env\[[^\]]+\]\s*=|shell:\s*true/u);
  assert.match(policy, /class DenyRuntimeProcessLauncher implements RuntimeProcessLauncher/u);
  assert.equal((policy.match(/implements RuntimeProcessLauncher/gu) ?? []).length, 1);
});

test('deterministic fake is test-only and no real runtime can be marked connected', () => {
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260825190000_durable_agent_bridge_foundation/migration.sql',
    'utf8',
  );
  assert.doesNotMatch(index, /deterministic-fake/u);
  assert.doesNotMatch(migration, /'CONNECTED'/u);
  assert.match(migration, /"status" = 'NOT_CONFIGURED'/u);
  assert.match(migration, /DETERMINISTIC_FAKE[\s\S]*TEST_ONLY/u);
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  assert.match(module, /denyTestOnlyGate[\s\S]*return false/u);
  assert.match(module, /denyArtifactContent[\s\S]*return false/u);
  assert.match(module, /denyCandidates[\s\S]*candidates: \[\]/u);
  assert.match(module, /denyAgents[\s\S]*not configured/u);
});

test('broker reservation and dispatch use the same exact migration-backed binding', () => {
  const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260825230000_durable_broker_reservations/migration.sql',
    'utf8',
  );
  assert.match(
    schema,
    /brokerReservation\s+AcpBrokerReservation\s+@relation\(fields: \[workspaceId, brokerEvidenceId, brokerEvidenceHash, taskId, runId, agentId, runtimeId, connectionId\], references: \[workspaceId, id, evidenceHash, taskId, runId, agentId, runtimeId, connectionId\], onDelete: Cascade\)/u,
  );
  assert.match(migration, /acp_bridge_dispatches_broker_reservation_fkey/u);
  assert.match(
    schema,
    /run\s+AcpRun\s+@relation\(fields: \[workspaceId, runId, objectiveId, taskId\], references: \[workspaceId, id, objectiveId, taskId\]/u,
  );
  assert.match(
    schema,
    /connection\s+AcpRuntimeConnection\s+@relation\(fields: \[workspaceId, connectionId, runtimeId\], references: \[workspaceId, id, runtimeId\]/u,
  );
  assert.match(migration, /acp_bridge_dispatch_claims_broker AFTER INSERT/u);
  assert.match(
    migration,
    /FOR UPDATE OF r;[\s\S]*reservation_expires <= clock_timestamp\(\)[\s\S]*"state"='CLAIMED'/u,
  );
  assert.match(
    migration,
    /NEW\."state" IN \('COMPLETED','FAILED','CANCELLED'\)[\s\S]*"state"='RELEASED'/u,
  );
  assert.match(migration, /terminal exact dispatch required to release reservation/u);
  assert.match(
    migration,
    /broker reservation lifecycle fields are immutable without a transition/u,
  );
});

test('bridge receipts cannot persist raw payload, MAC, transcript, prompt, or secret material', () => {
  const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
  const receipt = schema.slice(
    schema.indexOf('model AcpBridgeReceipt'),
    schema.indexOf('model AcpBridgeDispatch'),
  );
  assert.doesNotMatch(receipt, /\b(?:payload|mac|prompt|transcript|secret|credential)\s+String/iu);
  assert.match(receipt, /payloadDigest\s+String/u);
  assert.match(receipt, /envelopeDigest\s+String/u);
});

test('usage correlation and monotonicity are serialized and database-bound', () => {
  const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260825190000_durable_agent_bridge_foundation/migration.sql',
    'utf8',
  );
  assert.match(
    schema,
    /receipt\s+AcpBridgeReceipt\s+@relation\(fields: \[workspaceId, receiptId, sessionId, dispatchId, runId, sequence\], references: \[workspaceId, id, sessionId, dispatchId, runId, sequence\], onDelete: Cascade\)/u,
  );
  assert.match(migration, /acp_run_usages_dispatch_correlation_fkey/u);
  assert.match(migration, /acp_run_usages_receipt_correlation_fkey/u);
  assert.match(
    migration,
    /FROM "acp_bridge_dispatches"[\s\S]*FOR UPDATE;[\s\S]*receipt_message_type IS DISTINCT FROM 'USAGE'/u,
  );
});

test('assignment reservation and dispatch terminal state share durable lifecycle locks', () => {
  const taskRunService = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-task-run.service.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260825190000_durable_agent_bridge_foundation/migration.sql',
    'utf8',
  );
  assert.match(
    taskRunService,
    /acp_runs[\s\S]*FOR UPDATE[\s\S]*acp_tasks[\s\S]*FOR UPDATE[\s\S]*assignmentVerifier\.verify/u,
  );
  assert.match(
    migration,
    /OLD\."state" IN \('ACCEPTED', 'CANCEL_REQUESTED'\)[\s\S]*durable_run_status IS DISTINCT FROM 'RUNNING'[\s\S]*assignmentEvidenceHash/u,
  );
});
