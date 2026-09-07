import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const packageFiles = [
  'packages/agent-bridge/src/authenticated-jsonl-session.ts',
  'packages/agent-bridge/src/auth.ts',
  'packages/agent-bridge/src/codec.ts',
  'packages/agent-bridge/src/codex-app-server-policy.ts',
  'packages/agent-bridge/src/codex-app-server-session.ts',
  'packages/agent-bridge/src/codex-app-server-stdio-transport.ts',
  'packages/agent-bridge/src/codex-authenticated-registration.ts',
  'packages/agent-bridge/src/codex-capability-exchange.ts',
  'packages/agent-bridge/src/codex-heartbeat.ts',
  'packages/agent-bridge/src/codex-validation-dispatch.ts',
  'packages/agent-bridge/src/codex-validation-egress-controller.ts',
  'packages/agent-bridge/src/codex-validation-protocol-runner.ts',
  'packages/agent-bridge/src/codex-validation-runtime-adapter.ts',
  'packages/agent-bridge/src/codex-validation-round-trip.ts',
  'packages/agent-bridge/src/evidence.ts',
  'packages/agent-bridge/src/index.ts',
  'packages/agent-bridge/src/policy.ts',
  'packages/agent-bridge/src/protocol.ts',
  'packages/agent-bridge/src/retained-native-supervisor-linux-client.ts',
  'packages/agent-bridge/src/retained-native-supervisor-linux-session.ts',
  'packages/agent-bridge/src/retained-native-supervisor-listener-lifecycle.ts',
  'packages/agent-bridge/src/retained-native-supervisor-recovery.ts',
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

test('retained-native recovery is challenge-bound, signed, bounded, and process-handle-free', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-recovery.ts',
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(source, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork|kill)\s*\(/u);
  assert.doesNotMatch(source, /\b(?:processId|pid|pidfd|nativeHandle|processHandle)\b/u);
  assert.match(source, /randomBytes\(32\)/u);
  assert.match(source, /REQUEST_LIFETIME_MS = 2_000/u);
  assert.match(source, /domain: 'ventureos\.retained-native-supervisor\.recovery-request\.v1'/u);
  assert.match(source, /purpose: 'RETAINED_NATIVE_RECOVERY_OBSERVATION'/u);
  assert.match(source, /identityAuthority: 'RETAINED_NATIVE_IDENTITY'/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(source, /new AbortController\(\)/u);
  assert.match(source, /class DenyRetainedNativeSupervisorRecoveryTransport/u);
  assert.match(source, /class DenyRetainedNativeSupervisorRecoveryResponseVerifier/u);
  assert.doesNotMatch(source, /runtimeConnection:\s*'(?:CONNECTED|HEALTHY)'/u);
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

test('Codex app-server stdio transport is bounded and cannot launch or promote truth', () => {
  const transport = readFileSync(
    'packages/agent-bridge/src/codex-app-server-stdio-transport.ts',
    'utf8',
  );
  assert.doesNotMatch(
    transport,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(
    transport,
    /\b(?:fetch|spawn|spawnSync|exec|execFile|fork|connect|createConnection|createServer)\s*\(/u,
  );
  assert.doesNotMatch(transport, /process\.(?:env|stdin|stdout)/u);
  assert.match(transport, /MAX_CODEX_STDIO_LINE_BYTES = 65_536/u);
  assert.match(transport, /MAX_CODEX_STDIO_BUFFER_BYTES = 131_072/u);
  assert.match(transport, /MAX_CODEX_STDIO_SESSION_BYTES = 8 \* 1_024 \* 1_024/u);
  assert.match(transport, /MAX_CODEX_STDIO_OPERATION_TIMEOUT_MS = 5_000/u);
  assert.match(transport, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(transport, /this\.stdin\.destroy\(\)/u);
  assert.match(transport, /this\.stdout\.destroy\(\)/u);
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

test('Codex validation runner is dispatch-bound, side-effect denied, and injection-only', () => {
  const runner = readFileSync(
    'packages/agent-bridge/src/codex-validation-protocol-runner.ts',
    'utf8',
  );
  const session = readFileSync('packages/agent-bridge/src/codex-app-server-session.ts', 'utf8');
  assert.doesNotMatch(
    runner,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(runner, /\bprocess\.(?:env|cwd|platform)\b|@Controller\s*\(|Prisma/u);
  assert.doesNotMatch(runner, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.match(runner, /MAX_PROGRESS_EVENTS = 128/u);
  assert.match(runner, /MAX_RUN_MS = 15_000/u);
  assert.match(runner, /ventureos-validation:\$\{dispatchId\}/u);
  assert.match(runner, /validationRestrictionsAccepted\(\)/u);
  assert.match(runner, /session\.interrupt\(\)/u);
  assert.match(runner, /message\.id !== interruptRequestId/u);
  assert.match(runner, /evidence\.status !== 'interrupted'/u);
  assert.match(runner, /addEventListener\('abort', requestInterrupt, \{ once: true \}\)/u);
  assert.match(
    runner,
    /SAFE_ITEM_TYPES = new Set\(\['userMessage', 'agentMessage', 'reasoning'\]\)/u,
  );
  assert.match(session, /approvalPolicy: 'never'/u);
  assert.match(session, /ephemeral: true/u);
  assert.match(session, /sandbox: 'read-only'/u);
  assert.match(session, /sandboxPolicy: \{ type: 'readOnly', networkAccess: false \}/u);
  assert.doesNotMatch(runner, /runtimeConnection:\s*'(?:CONNECTED|HEALTHY)'/u);
});

test('Codex validation runtime adapter authenticates both directions without launch authority', () => {
  const adapter = readFileSync(
    'packages/agent-bridge/src/codex-validation-runtime-adapter.ts',
    'utf8',
  );
  assert.doesNotMatch(
    adapter,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(adapter, /\bprocess\.(?:env|cwd|platform)\b|@Controller\s*\(|Prisma/u);
  assert.doesNotMatch(adapter, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.match(adapter, /bridge,\s*'VERIFY_FRAME'/u);
  assert.match(adapter, /bridge,\s*'SIGN_FRAME'/u);
  assert.match(adapter, /keys\.parentToRuntime/u);
  assert.match(adapter, /keys\.runtimeToParent/u);
  assert.match(adapter, /MAX_TRACKED_DISPATCHES = 1_024/u);
  assert.match(adapter, /MAX_FRAME_NODES = 1_024/u);
  assert.match(adapter, /MAX_FRAME_DEPTH = 8/u);
  assert.match(adapter, /sequence === 2 \? 'DISPATCH_ACCEPTED' : 'RESULT'/u);
  assert.match(adapter, /type: 'CANCELLED'/u);
  assert.match(adapter, /this\.write\(dispatch, cancellationEnvelope, deadline, undefined\)/u);
  assert.match(adapter, /new DenyBridgeSecretLeaseResolver\(\)/u);
  assert.match(adapter, /new DenyBridgeEgressTransport\(\)/u);
  assert.match(
    adapter,
    /terminal\.status === 'interrupted'[\s\S]*createCodexValidationCancellationCandidate/u,
  );
  assert.doesNotMatch(adapter, /runtimeConnection:\s*'(?:CONNECTED|HEALTHY)'/u);
});

test('composed Codex validation process evidence remains deterministic and test-only', () => {
  const adapter = readFileSync(
    'packages/agent-bridge/src/codex-validation-runtime-adapter.ts',
    'utf8',
  );
  const composition = readFileSync(
    'packages/agent-bridge/src/codex-validation-runtime-adapter.test.ts',
    'utf8',
  );
  const fixture = readFileSync(
    'packages/agent-bridge/test/fixtures/codex-validation-app-server.mjs',
    'utf8',
  );
  const production = serviceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.match(composition, /new BoundedCodexAppServerStdioTransport/u);
  assert.match(composition, /new BoundedCodexValidationProtocolRunner/u);
  assert.match(composition, /new BoundedCodexValidationRuntimeAdapter/u);
  assert.match(composition, /env:\s*\{\}/u);
  assert.match(composition, /stdio:\s*\['pipe', 'pipe', 'pipe'\]/u);
  assert.match(adapter, /options\.timeoutMs === undefined/u);
  assert.match(fixture, /approvalPolicy !== 'never'/u);
  assert.match(fixture, /sandboxPolicy\?\.networkAccess !== false/u);
  assert.match(fixture, /request\.method === 'turn\/interrupt'/u);
  assert.match(fixture, /status: 'interrupted'/u);
  assert.doesNotMatch(
    fixture,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(production, /codex-validation-app-server|unsafe-tool/u);
  assert.doesNotMatch(production, /runtimeConnection:\s*'(?:CONNECTED|HEALTHY)'/u);
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

test('Codex capability exchange is complete, stable-surface, hashed, and non-authorizing', () => {
  const exchange = readFileSync('packages/agent-bridge/src/codex-capability-exchange.ts', 'utf8');
  assert.doesNotMatch(
    exchange,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(exchange, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.doesNotMatch(exchange, /experimentalApi|experimentalFeature|Prisma|@Controller/u);
  assert.match(exchange, /request\.method !== 'model\/list'/u);
  assert.match(exchange, /params\.includeHidden !== false/u);
  assert.match(exchange, /result\.nextCursor !== null/u);
  assert.match(exchange, /modelCatalogHash = sha256/u);
  assert.match(exchange, /capabilityAuthorization: 'NOT_CONFIGURED'/u);
  assert.match(exchange, /providerAccess: 'NOT_CONFIGURED'/u);
  assert.match(exchange, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(exchange, /class DenyCodexCapabilityExchangeAuthorizationSource/u);
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

test('durable Codex capability evidence is immutable, tenant-bound, and production-denied', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260831170000_durable_codex_capability_evidence/migration.sql',
    'utf8',
  );
  const acceptance = service.slice(
    service.indexOf('async acceptCodexCapabilityExchange('),
    service.indexOf('async acceptCodexHeartbeatEvidence('),
  );
  assert.match(module, /new DenyCodexCapabilityExchangeAuthorizationSource\(\)/u);
  assert.match(acceptance, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(acceptance, /this\.capabilityPolicy\.verify/u);
  assert.match(acceptance, /createCodexCapabilityExchangeAuthorizationRequest/u);
  assert.match(acceptance, /"acp_runtime_capability_evidence"/u);
  assert.match(acceptance, /status !== 'NOT_CONFIGURED'/u);
  assert.match(acceptance, /connection\.capabilityCodes\.length !== 0/u);
  assert.doesNotMatch(acceptance, /acpRuntimeConnection\.(?:create|update|upsert)/u);
  assert.match(migration, /acp_runtime_capability_evidence_registration_fkey/u);
  assert.match(migration, /acp_runtime_capability_evidence_connection_fkey/u);
  assert.match(migration, /ventureos_reject_capability_evidence_update/u);
  assert.doesNotMatch(
    migration,
    /displayName|modelIdentifier|description|rawPayload|credential|accessToken|apiKey/u,
  );
});

test('durable Codex heartbeat evidence is MAC-verified, immutable, and truth-preserving', () => {
  const heartbeat = readFileSync('packages/agent-bridge/src/codex-heartbeat.ts', 'utf8');
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260831203000_durable_codex_heartbeat_evidence/migration.sql',
    'utf8',
  );
  const acceptance = service.slice(
    service.indexOf('async acceptCodexHeartbeatEvidence('),
    service.indexOf('async provisionRuntime('),
  );
  assert.doesNotMatch(
    heartbeat,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(heartbeat, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.match(heartbeat, /envelope\.type !== 'HEARTBEAT'/u);
  assert.match(heartbeat, /envelope\.sequence !== 1/u);
  assert.match(heartbeat, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(acceptance, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(acceptance, /purpose: 'VERIFY_FRAME'/u);
  assert.match(acceptance, /verifyBridgeEnvelope\(input\.envelope, keys\.runtimeToParent/u);
  assert.match(acceptance, /"acp_runtime_heartbeat_evidence"/u);
  assert.match(acceptance, /connection\.lastHeartbeatAt !== null/u);
  assert.doesNotMatch(acceptance, /acpRuntimeConnection\.(?:create|update|upsert)/u);
  assert.match(migration, /acp_runtime_heartbeat_evidence_registration_fkey/u);
  assert.match(migration, /acp_runtime_heartbeat_evidence_capability_fkey/u);
  assert.match(migration, /acp_runtime_registration_evidence_heartbeat_binding_key/u);
  assert.match(migration, /acp_runtime_capability_evidence_heartbeat_binding_key/u);
  assert.match(migration, /ventureos_reject_heartbeat_evidence_update/u);
  assert.doesNotMatch(migration, /\bmac\b|rawPayload|credential|accessToken|apiKey/u);
});

test('Codex validation dispatch is zero-spend, signed, immutable, and not delivered', () => {
  const dispatch = readFileSync('packages/agent-bridge/src/codex-validation-dispatch.ts', 'utf8');
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260831210000_codex_validation_dispatch_evidence/migration.sql',
    'utf8',
  );
  const acceptance = service.slice(
    service.indexOf('async prepareCodexValidationDispatch('),
    service.indexOf('async provisionRuntime('),
  );
  assert.doesNotMatch(
    dispatch,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(dispatch, /\b(?:fetch|spawn|spawnSync|exec|execFile|fork)\s*\(/u);
  assert.match(dispatch, /maximumCostMinorUnits !== 0/u);
  assert.match(dispatch, /assignmentState: 'NOT_CONFIGURED'/u);
  assert.match(dispatch, /deliveryState: 'NOT_SENT'/u);
  assert.match(dispatch, /providerAccess: 'NOT_CONFIGURED'/u);
  assert.match(dispatch, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(dispatch, /class DenyCodexValidationDispatchAuthorizationSource/u);
  assert.match(module, /new DenyCodexValidationDispatchAuthorizationSource\(\)/u);
  assert.match(acceptance, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(acceptance, /purpose: 'SIGN_FRAME'/u);
  assert.match(acceptance, /signBridgeEnvelope\(unsigned, keys\.parentToRuntime\)/u);
  assert.match(acceptance, /run\.task\.maximumCostMinorUnits !== 0n/u);
  assert.match(acceptance, /connection\.status !== 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(
    acceptance,
    /acp(?:Run|Task|Runtime|RuntimeConnection)\.(?:create|update|upsert)/u,
  );
  assert.match(migration, /acp_codex_validation_dispatch_heartbeat_fkey/u);
  assert.match(migration, /acp_runtime_heartbeat_evidence_dispatch_binding_key/u);
  assert.match(migration, /ventureos_reject_codex_validation_dispatch_update/u);
  assert.doesNotMatch(
    migration,
    /\bmac\b|rawPayload|prompt|transcript|credential|accessToken|apiKey/u,
  );
});

test('Codex validation egress is one-shot, bounded, local-only, and truth preserving', () => {
  const controller = readFileSync(
    'packages/agent-bridge/src/codex-validation-egress-controller.ts',
    'utf8',
  );
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260831220000_codex_validation_egress_handoff/migration.sql',
    'utf8',
  );
  const claim = service.slice(
    service.indexOf('async claimCodexValidationEgressHandoff('),
    service.indexOf('async provisionRuntime('),
  );
  assert.doesNotMatch(
    controller,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(
    controller,
    /\b(?:fetch|spawn|spawnSync|exec|execFile|fork|connect|createConnection|createServer)\s*\(/u,
  );
  assert.match(controller, /new DenyBridgeEgressTransport\(\)/u);
  assert.match(controller, /MAX_CLAIM_MS = 15_000/u);
  assert.match(controller, /MAX_WRITE_MS = 5_000/u);
  assert.match(controller, /Promise\.race/u);
  assert.match(controller, /USED_HANDOFF/u);
  assert.match(controller, /TRANSPORT_MUTATED_FRAME/u);
  assert.match(controller, /encoded\.fill\(0\)/u);
  assert.match(controller, /line\.fill\(0\)/u);
  assert.doesNotMatch(
    controller,
    /\b(?:SENT|DELIVERED|ACKNOWLEDGED|CONNECTED|delivery|acknowledged|connected):\s*(?:true|['"])/u,
  );
  assert.match(claim, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(claim, /purpose: 'SIGN_FRAME'/u);
  assert.match(claim, /connection\.status !== 'NOT_CONFIGURED'/u);
  assert.match(claim, /run\.assignedAgentId !== null/u);
  assert.match(migration, /generation" = 1/u);
  assert.match(migration, /state" = 'CLAIMED'/u);
  assert.match(migration, /INTERVAL '15 seconds'/u);
  assert.match(migration, /ventureos_reject_codex_validation_egress_handoff_change/u);
  assert.match(
    migration,
    /TG_OP = 'DELETE'[\s\S]*NOT EXISTS[\s\S]*FROM "workspaces"[\s\S]*RETURN OLD/u,
  );
  assert.doesNotMatch(
    migration,
    /^\s+"(?:mac|rawPayload|prompt|transcript|credential|accessToken|apiKey)"\s+/mu,
  );
});

test('Codex validation round-trip evidence is authenticated, immutable, and truth preserving', () => {
  const roundTrip = readFileSync(
    'packages/agent-bridge/src/codex-validation-round-trip.ts',
    'utf8',
  );
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260901013000_codex_validation_round_trip_evidence/migration.sql',
    'utf8',
  );
  const acceptance = service.slice(
    service.indexOf('async acceptCodexValidationRoundTripEvidence('),
    service.indexOf('async provisionRuntime('),
  );
  assert.doesNotMatch(
    roundTrip,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(
    roundTrip,
    /\b(?:fetch|spawn|spawnSync|exec|execFile|fork|connect|createConnection|createServer)\s*\(/u,
  );
  assert.match(roundTrip, /statusEnvelope\.type !== 'DISPATCH_ACCEPTED'/u);
  assert.match(roundTrip, /statusEnvelope\.sequence !== 2/u);
  assert.match(roundTrip, /terminalEnvelope\.type !== 'RESULT'/u);
  assert.match(roundTrip, /terminalEnvelope\.sequence !== 3/u);
  assert.match(roundTrip, /maximumCostMinorUnits: 0 as const/u);
  assert.match(roundTrip, /providerAccess: 'NOT_CONFIGURED'/u);
  assert.match(roundTrip, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(roundTrip, /connectionTransition: 'NOT_APPLIED'/u);
  assert.match(acceptance, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(acceptance, /purpose: 'VERIFY_FRAME'/u);
  assert.match(acceptance, /verifyBridgeEnvelope\([\s\S]*keys\.runtimeToParent/u);
  assert.match(acceptance, /connection\.status !== 'NOT_CONFIGURED'/u);
  assert.match(acceptance, /run\.status !== 'PREPARED'/u);
  assert.doesNotMatch(
    acceptance,
    /acp(?:Run|Task|Runtime|RuntimeConnection)\.(?:create|update|upsert)/u,
  );
  assert.match(migration, /maximumCostMinorUnits" = 0/u);
  assert.match(migration, /runtimeConnection" = 'NOT_CONFIGURED'/u);
  assert.match(migration, /connectionTransition" = 'NOT_APPLIED'/u);
  assert.match(migration, /acp_codex_validation_round_trip_handoff_fkey/u);
  assert.match(migration, /acp_codex_validation_round_trip_messages_pkey/u);
  assert.match(migration, /acp_codex_validation_round_trip_messages_immutable/u);
  assert.match(migration, /ventureos_reject_codex_validation_round_trip_change/u);
  assert.match(
    migration,
    /TG_OP = 'DELETE'[\s\S]*NOT EXISTS[\s\S]*FROM "workspaces"[\s\S]*RETURN OLD/u,
  );
  assert.doesNotMatch(
    migration,
    /^\s+"(?:mac|rawPayload|prompt|transcript|credential|accessToken|apiKey)"\s+/mu,
  );
});

test('Codex validation cancellation evidence is authenticated, immutable, and truth preserving', () => {
  const cancellation = readFileSync(
    'packages/agent-bridge/src/codex-validation-cancellation.ts',
    'utf8',
  );
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260901080000_codex_validation_cancellation_evidence/migration.sql',
    'utf8',
  );
  const acceptance = service.slice(
    service.indexOf('async acceptCodexValidationCancellationEvidence('),
    service.indexOf('async acceptCodexValidationRoundTripEvidence('),
  );
  assert.doesNotMatch(
    cancellation,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(
    cancellation,
    /\b(?:fetch|spawn|spawnSync|exec|execFile|fork|connect|createConnection|createServer)\s*\(/u,
  );
  assert.match(cancellation, /cancellationEnvelope\.type !== 'CANCELLED'/u);
  assert.match(cancellation, /cancellationEnvelope\.sequence !== 2/u);
  assert.match(cancellation, /maximumCostMinorUnits: 0 as const/u);
  assert.match(cancellation, /providerAccess: 'NOT_CONFIGURED'/u);
  assert.match(cancellation, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(cancellation, /connectionTransition: 'NOT_APPLIED'/u);
  assert.match(acceptance, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(acceptance, /purpose: 'VERIFY_FRAME'/u);
  assert.match(acceptance, /verifyBridgeEnvelope\([\s\S]*keys\.runtimeToParent/u);
  assert.match(acceptance, /completedRows\.length > 0/u);
  assert.match(acceptance, /connection\.status !== 'NOT_CONFIGURED'/u);
  assert.match(acceptance, /run\.status !== 'PREPARED'/u);
  assert.doesNotMatch(
    acceptance,
    /acp(?:Run|Task|Runtime|RuntimeConnection)\.(?:create|update|upsert)/u,
  );
  assert.match(migration, /maximumCostMinorUnits" = 0/u);
  assert.match(migration, /runtimeConnection" = 'NOT_CONFIGURED'/u);
  assert.match(migration, /connectionTransition" = 'NOT_APPLIED'/u);
  assert.match(migration, /acp_codex_validation_cancellation_handoff_fkey/u);
  assert.match(migration, /acp_codex_validation_cancellation_handoff_key/u);
  assert.match(migration, /ventureos_enforce_codex_validation_terminal_exclusivity/u);
  assert.match(migration, /acp_codex_validation_cancellation_terminal_exclusive/u);
  assert.match(migration, /acp_codex_validation_round_trip_terminal_exclusive/u);
  assert.match(migration, /acp_codex_validation_egress_handoff_attempts[\s\S]*FOR UPDATE/u);
  assert.match(migration, /ventureos_reject_codex_validation_cancellation_change/u);
  assert.match(
    migration,
    /TG_OP = 'DELETE'[\s\S]*NOT EXISTS[\s\S]*FROM "workspaces"[\s\S]*RETURN OLD/u,
  );
  assert.doesNotMatch(
    migration,
    /^\s+"(?:mac|rawPayload|prompt|transcript|credential|accessToken|apiKey)"\s+/mu,
  );
});

test('Codex validation usage observations are bounded, digest-only, zero-cost evidence', () => {
  const runner = readFileSync(
    'packages/agent-bridge/src/codex-validation-protocol-runner.ts',
    'utf8',
  );
  const adapter = readFileSync(
    'packages/agent-bridge/src/codex-validation-runtime-adapter.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260901100000_codex_validation_usage_observation_evidence/migration.sql',
    'utf8',
  );
  assert.match(runner, /ventureos\.codex-validation\.progress\.v1/u);
  assert.match(runner, /ventureos\.codex-validation\.token-usage\.v1/u);
  assert.match(runner, /MAX_PROGRESS_EVENTS = 128/u);
  assert.match(runner, /recognizedCostMinorUnits: 0/u);
  assert.match(runner, /recognizedComputeUnits: 0/u);
  assert.match(adapter, /terminal\.recognizedCostMinorUnits !== 0/u);
  assert.match(adapter, /terminal\.recognizedComputeUnits !== 0/u);
  assert.match(migration, /"tokenUsageEventCount" BETWEEN 0 AND "progressEventCount"/u);
  assert.match(migration, /"recognizedCostMinorUnits" = 0/u);
  assert.match(migration, /"recognizedComputeUnits" = 0/u);
  assert.match(migration, /'LEGACY_NOT_CAPTURED'/u);
  assert.match(migration, /ventureos_reject_new_codex_validation_legacy_usage/u);
  assert.doesNotMatch(
    migration,
    /^\s+"(?:rawUsage|tokenValues|providerData|prompt|transcript|mac|secret)"\s+/mu,
  );
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
    3,
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
    'authorization = this.authorizationVerifier.verify(storedAuthorization)',
  );
  const openIndex = reader.indexOf('handle = await fs.open(');
  assert.ok(revalidationIndex >= 0 && openIndex > revalidationIndex);
  assert.match(reader, /Math\.min\([\s\S]*authorizationExpiryMilliseconds/u);
  assert.match(authorization, /authorization\.testOnly !== true/u);
  assert.match(authorization, /class DenyLinuxExecutableAuthorizationVerifier/u);
  assert.match(authorization, /class BoundedLinuxExecutableAuthorizationVerifier/u);
  assert.match(authorization, /class TestOnlyLinuxExecutableAuthorizationVerifier/u);
  assert.match(reader, /new DenyLinuxExecutableAuthorizationVerifier\(\)/u);
  assert.match(reader, /authorizationHash: linuxExecutableAuthorizationHash\(authorization\)/u);
  assert.match(
    reader,
    /validateSupervisorAdmissionWithAuthorizationVerifier\([\s\S]*this\.authorizationVerifier/u,
  );
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
    /export function validateSupervisorAdmissionWithAuthorizationVerifier\([\s\S]*authorizationVerifier: LinuxExecutableAuthorizationVerifier/u,
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
  assert.match(composition, /authorizationVerifier\.verify/u);
  assert.match(composition, /this\.authorityTrustSource\.read\(\)/u);
  assert.ok((composition.match(/await this\.#freshAuthorizationVerifier\(/gu) ?? []).length === 2);
  assert.match(composition, /if \(allowTestOnlyFallback\) return this\.authorizationVerifier/u);
  assert.match(composition, /new DenyLinuxExecutableAuthorizationVerifier\(\)/u);
  assert.doesNotMatch(composition, /validateLinuxExecutableAuthorization/u);
  assert.match(composition, /validateSupervisorAdmissionWithAuthorizationVerifier/u);
  assert.match(composition, /validateSupervisorProcessBinding/u);
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
  const freshTrustRead = composition.indexOf(
    'const authorizationVerifier = await this.#freshAuthorizationVerifier(manifest.testOnly)',
  );
  const authorityRead = composition.indexOf('this.authorizationSource.read(authorizationRequest)');
  const decisionConsumption = composition.indexOf(
    'consumeAuthorizationDecision(authorizationDecision)',
  );
  const evidenceRead = composition.indexOf(
    'this.evidenceReader.read(manifest, authorization, authorizationVerifier)',
  );
  assert.ok(
    freshTrustRead >= 0 &&
      authorityRead > freshTrustRead &&
      decisionConsumption > authorityRead &&
      evidenceRead > decisionConsumption,
  );
  assert.match(module, /new DenyTrustedSupervisorAuthorizationSource\(\)/u);
  assert.match(module, /provide:\s*TRUSTED_SUPERVISOR_AUTHORIZATION_SOURCE/u);
  assert.match(module, /new DenyLinuxExecutableAuthorizationVerifier\(\)/u);
  assert.match(module, /provide:\s*LINUX_EXECUTABLE_AUTHORIZATION_VERIFIER/u);
  assert.doesNotMatch(module, /TestOnlyLinuxExecutableAuthorizationVerifier/u);
  assert.doesNotMatch(module, /BoundedLinuxExecutableAuthorizationVerifier/u);
  assert.match(module, /new DenyRuntimeProcessLauncher\(\)/u);
  assert.match(module, /provide:\s*RUNTIME_PROCESS_LAUNCHER/u);
  assert.match(
    module,
    /new TrustedSupervisorComposition\([\s\S]*denyRuntimeProcessLauncher[\s\S]*denyExecutableAuthorityTrust[\s\S]*\)/u,
  );
  assert.equal((policy.match(/implements RuntimeProcessLauncher/gu) ?? []).length, 1);
  assert.doesNotMatch(index, /deterministic-supervision/u);
});

test('executable trust snapshots are authenticated, anti-rollback, and unconfigured', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/supervision-authority-trust-source.ts',
    'utf8',
  );
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  assert.match(source, /class DenyLinuxExecutableAuthorityTrustSource/u);
  assert.match(source, /class BoundedLinuxExecutableAuthorityTrustSource/u);
  assert.match(source, /LinuxExecutableAuthorityTrustCheckpointStore/u);
  assert.match(source, /compareAndSwap/u);
  assert.match(source, /snapshot\.snapshotVersion !== current\.snapshotVersion \+ 1/u);
  assert.match(source, /snapshot\.previousSnapshotHash !== current\.snapshotHash/u);
  assert.match(source, /minimumSnapshotVersion/u);
  assert.match(source, /MAX_SNAPSHOT_LIFETIME_MS = 15 \* 60 \* 1_000/u);
  assert.match(source, /class SnapshotBoundAuthorizationVerifier/u);
  assert.match(source, /snapshot\.previousSnapshotHash !== null/u);
  assert.match(source, /value\.purpose !== 'LINUX_EXECUTABLE_AUTHORITY_TRUST_SNAPSHOT'/u);
  assert.match(source, /new BoundedLinuxExecutableAuthorizationVerifier/u);
  assert.doesNotMatch(
    source,
    /from\s+['"]node:(?:child_process|cluster|fs|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(source, /\bprocess\.(?:env|cwd|platform)\b|\bfetch\s*\(/u);
  assert.match(module, /new DenyLinuxExecutableAuthorityTrustSource\(\)/u);
  assert.match(module, /provide:\s*LINUX_EXECUTABLE_AUTHORITY_TRUST_SOURCE/u);
  assert.doesNotMatch(module, /BoundedLinuxExecutableAuthorityTrustSource/u);
});

test('durable executable trust state is exact, atomic, audited, and uncomposed', () => {
  const adapter = readFileSync(
    'apps/api/src/modules/agent-control-plane/executable-authority-trust-state.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260901040000_executable_authority_trust_state/migration.sql',
    'utf8',
  );
  const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const integration = readFileSync(
    'apps/api/test/executable-authority-trust-state.integration.spec.ts',
    'utf8',
  );

  assert.match(adapter, /implements LinuxExecutableAuthorityTrustSnapshotReader/u);
  assert.match(adapter, /implements LinuxExecutableAuthorityTrustCheckpointStore/u);
  assert.match(adapter, /ORDER BY "snapshotVersion" DESC[\s\S]*LIMIT 1/u);
  assert.match(adapter, /ON CONFLICT \("signerKeyId"\) DO NOTHING/u);
  assert.match(
    adapter,
    /nextCheckpoint\.snapshotVersion !== expectedCheckpoint\.snapshotVersion \+ 1/u,
  );
  assert.match(
    adapter,
    /AND "snapshotId" = \$\{expectedCheckpoint\.snapshotId\}[\s\S]*AND "snapshotVersion" = \$\{expectedCheckpoint\.snapshotVersion\}[\s\S]*AND "snapshotHash" = \$\{expectedCheckpoint\.snapshotHash\}/u,
  );
  assert.doesNotMatch(
    adapter,
    /\bprocess\.(?:env|cwd|platform)\b|\bfetch\s*\(|\$queryRawUnsafe|\$executeRawUnsafe/u,
  );

  assert.match(migration, /CREATE TABLE "acp_executable_authority_trust_snapshots"/u);
  assert.match(migration, /CREATE TABLE "acp_executable_authority_trust_checkpoints"/u);
  assert.match(migration, /CREATE TABLE "acp_executable_authority_trust_checkpoint_events"/u);
  assert.match(migration, /"snapshot" \?& ARRAY\[/u);
  assert.match(migration, /"snapshot" - ARRAY\[/u);
  assert.match(migration, /INTERVAL '15 minutes'/u);
  assert.match(
    migration,
    /FOREIGN KEY \("signerKeyId", "snapshotVersion", "snapshotId", "snapshotHash"\)/u,
  );
  assert.match(migration, /NEW\."snapshotVersion" <> OLD\."snapshotVersion" \+ 1/u);
  assert.match(
    migration,
    /AFTER INSERT OR UPDATE[\s\S]*ventureos_audit_executable_authority_trust_checkpoint/u,
  );
  assert.match(migration, /trust_snapshots_immutable/u);
  assert.match(migration, /checkpoint_events_immutable/u);
  assert.match(schema, /model AcpExecutableAuthorityTrustSnapshot/u);
  assert.match(schema, /model AcpExecutableAuthorityTrustCheckpoint/u);
  assert.match(schema, /model AcpExecutableAuthorityTrustCheckpointEvent/u);
  assert.match(integration, /Promise\.all\(\[/u);
  assert.match(integration, /expect\(results\.sort\(\)\)\.toEqual\(\[false, true\]\)/u);
  assert.doesNotMatch(module, /PostgresLinuxExecutableAuthorityTrust/u);
  assert.match(module, /new DenyLinuxExecutableAuthorityTrustSource\(\)/u);
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
  assert.match(testSource, /beforeAll\([\s\S]*?\}, 60_000\);/u);
  assert.match(addon, /#include "native-supervisor-helper\.c"/u);
  assert.match(
    addon,
    /run_supervisor\(23, arguments, NULL, 0, NULL, 0, evidence, NULL, 0, NULL\)/u,
  );
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
  assert.doesNotMatch(index, /native-supervisor-boundary|native-runtime-fixture|test\/native/u);
  assert.equal((policy.match(/implements RuntimeProcessLauncher/gu) ?? []).length, 1);
  assert.match(policy, /class DenyRuntimeProcessLauncher implements RuntimeProcessLauncher/u);
  assert.match(dockerignore, /^packages\/agent-bridge\/test\/native$/mu);
  assert.match(runtimeAssertion, /NATIVE_SUPERVISOR_DENIED/u);
  assert.match(imageBoundary, /NATIVE_TEST_FIXTURE/u);
  assert.match(imageWorkflow, /Native supervisor test helper entered a final runtime image/u);
});

test('authenticated supervised lifecycle and dispatch evidence is test-only, bounded, and deny-wired', () => {
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
  assert.match(helper, /pipe2\(dispatch_pipe, O_CLOEXEC\)/u);
  assert.match(helper, /write_all\(dispatch_pipe\[1\], dispatch, dispatch_length\)/u);
  assert.match(helper, /const size_t expected_lines = has_dispatch \? 4U : 3U/u);
  assert.match(helper, /line_count != expected_lines/u);
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
  assert.match(fixture, /derive_parent_key\(secret, parent_key\)/u);
  assert.match(fixture, /verify_dispatch\(parent_key\)/u);
  assert.match(fixture, /parse_utc_millis\(expires_at, &expires_ms\)/u);
  assert.match(fixture, /expires_ms - issued_ms != 30000/u);
  assert.match(fixture, /expires_ms <= observed_ms/u);
  assert.match(fixture, /"DISPATCH_ACCEPTED"/u);
  assert.match(fixture, /memset\(secret, 0, sizeof\(secret\)\)/u);
  assert.match(fixture, /memset\(runtime_key, 0, sizeof\(runtime_key\)\)/u);
  assert.match(fixture, /"CAPABILITIES"[\s\S]*"HEARTBEAT"/u);
  assert.match(fixture, /cancelled \? "CANCELLED"/u);
  assert.match(fixture, /"DISPATCH_ACCEPTED" : "RESULT"/u);
  assert.doesNotMatch(fixture, /getenv\s*\(/u);
  assert.match(addon, /napi_get_typedarray_info/u);
  assert.match(addon, /secret_length != LIFECYCLE_SECRET_BYTES/u);
  assert.match(addon, /dispatch_length > LIFECYCLE_DISPATCH_BYTES/u);
  assert.match(addon, /strcmp\(lifecycle_mode, "authenticated-dispatch"\) != 0/u);
  assert.match(addon, /memset\(owned_secret, 0, sizeof\(owned_secret\)\)/u);
  assert.match(addon, /memset\(owned_dispatch, 0, sizeof\(owned_dispatch\)\)/u);
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
  assert.match(testSource, /\['CAPABILITIES', 'HEARTBEAT', 'DISPATCH_ACCEPTED', 'RESULT'\]/u);
  assert.match(testSource, /denies a mutated parent dispatch/u);
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

test('Codex process-session ownership authenticates and cleans up before egress with deny defaults', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/codex-validation-process-session-owner.ts',
    'utf8',
  );
  const adapter = readFileSync(
    'packages/agent-bridge/src/codex-validation-runtime-adapter.ts',
    'utf8',
  );
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  assert.match(source, /new DenyCodexValidationProcessSessionOwner\(\)/u);
  assert.match(source, /await adapter\.authenticate\(input, options\)[\s\S]*this\.owner\.open/u);
  assert.match(
    source,
    /await this\.boundedClose[\s\S]*session\.stdin\.destroy\(\)[\s\S]*adapter\.execute/u,
  );
  assert.match(source, /validationDispatchCandidateHash/u);
  assert.match(source, /ventureos\.codex-validation\.process-cleanup\.v1/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(source, /connectionTransition: 'NOT_APPLIED'/u);
  assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(|\bexec\s*\(|process\.env/u);
  assert.match(adapter, /async authenticate\([\s\S]*authenticateInput/u);
  assert.doesNotMatch(module, /CodexValidationProcessSessionOwner/u);
});

test('Codex process-session claims and cleanup are durable prerequisites for terminal evidence', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260901130000_codex_validation_process_sessions/migration.sql',
    'utf8',
  );
  assert.match(service, /claimCodexValidationProcessSession/u);
  assert.match(service, /completeCodexValidationProcessSession/u);
  assert.match(service, /validateCodexValidationProcessCleanupEvidence/u);
  assert.match(service, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(migration, /acp_codex_validation_process_session_claims/u);
  assert.match(migration, /acp_codex_validation_process_session_completions/u);
  assert.match(migration, /ventureos_require_codex_validation_process_cleanup/u);
  assert.match(migration, /round_trip_requires_process_cleanup/u);
  assert.match(migration, /cancellation_requires_process_cleanup/u);
  assert.match(migration, /process_session_claims_immutable/u);
  assert.match(migration, /process_session_completions_immutable/u);
  assert.match(migration, /runtimeConnection" = 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(migration, /credential|accessToken|apiKey|rawPayload|\bmac\b/u);
});

test('Codex process-session claims reproduce trusted handoff authority on insert and replay', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const replay = service.slice(
    service.indexOf('const existingById = existingRows.find', service.indexOf('async claimCodex')),
    service.indexOf('const [claim] = await tx.$queryRaw', service.indexOf('async claimCodex')),
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260901153000_codex_process_session_claim_trust/migration.sql',
    'utf8',
  );
  for (const field of [
    'workspaceId',
    'handoffAttemptId',
    'runtimeId',
    'connectionId',
    'sessionId',
    'dispatchId',
    'ownerReference',
    'ownerActorKind',
    'supervisionId',
    'launchNonce',
    'platform',
    'manifestHash',
    'admissionEvidenceHash',
    'admissionBindingHash',
    'testOnly',
    'state',
    'runtimeConnection',
    'expiresAt',
  ])
    assert.match(replay, new RegExp(`existing\\.${field}`));
  assert.match(migration, /BEFORE INSERT ON "acp_codex_validation_process_session_claims"/u);
  assert.match(migration, /Existing Codex validation process-session claim crossed/u);
  assert.match(migration, /handoff\."ownerReference" IS DISTINCT FROM NEW\."ownerReference"/u);
  assert.match(migration, /handoff\."ownerActorKind" IS DISTINCT FROM NEW\."ownerActorKind"/u);
  assert.match(migration, /handoff\."state" IS DISTINCT FROM 'CLAIMED'/u);
  assert.match(migration, /handoff\."expiresAt" IS DISTINCT FROM NEW\."expiresAt"/u);
  assert.match(migration, /NEW\."claimedAt" < handoff\."claimedAt"/u);
  assert.match(migration, /NEW\."claimedAt" > LOCALTIMESTAMP\(3\)/u);
  assert.match(migration, /NEW\."claimedAt" >= handoff\."expiresAt"/u);
  assert.doesNotMatch(migration, /CONNECTED|credential|provider|payload|transcript|secret/u);
});

test('Codex process recovery leases are expired-only, exclusive, append-only, and non-operational', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const owner = readFileSync(
    'packages/agent-bridge/src/codex-validation-process-session-owner.ts',
    'utf8',
  );
  const workItemContract = owner.slice(
    owner.indexOf('export interface CodexValidationProcessSessionRecoveryWorkItem'),
    owner.indexOf('export interface CodexValidationProcessCleanupEvidence'),
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260901170000_codex_process_session_recovery_leases/migration.sql',
    'utf8',
  );
  const method = service.slice(
    service.indexOf('async claimCodexValidationProcessSessionRecoveryLease'),
    service.indexOf(
      '/**\n   * Durably claims one process-session identity',
      service.indexOf('async claimCodexValidationProcessSessionRecoveryLease'),
    ),
  );
  assert.match(method, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(method, /FOR UPDATE/u);
  assert.match(method, /claim\.ownerReference !== context\.principalId/u);
  assert.match(method, /claim\.ownerActorKind !== actorKind/u);
  assert.match(method, /claim\.expiresAt > now/u);
  assert.match(method, /completionRows\.length > 0/u);
  assert.match(method, /latest\.expiresAt > now/u);
  assert.match(method, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(method, /validateSupervisorProcessBinding/u);
  assert.match(
    method,
    /const workItem =\s+completionRows\.length === 0 && existing\.expiresAt > now\s+\? workItemFor\(existing\)\s+: null/u,
  );
  assert.match(service, /function recoveryDispatchCandidateFromRow/u);
  assert.match(service, /validateCodexValidationDispatchCandidate/u);
  assert.match(method, /FOR SHARE OF dispatch/u);
  assert.match(method, /dispatch: workItem \? recoveryDispatch : null/u);
  assert.match(method, /dispatch: recoveryDispatch/u);
  assert.match(
    method,
    /recoveryDispatch\.validationDispatchCandidateHash !==\s+claim\.validationDispatchCandidateHash/u,
  );
  assert.doesNotMatch(method, /recoveryDispatch\.expiresAt !== claim\.expiresAt/u);
  for (const field of [
    'recoveryLeaseId',
    'recoveryGeneration',
    'claimId',
    'handoffAttemptId',
    'validationDispatchCandidateHash',
    'sessionId',
    'dispatchId',
    'runId',
    'binding',
    'processClaimedAt',
    'processExpiresAt',
    'leaseClaimedAt',
    'leaseExpiresAt',
    'runtimeConnection',
  ]) {
    assert.match(method, new RegExp(`${field}:`));
    assert.match(workItemContract, new RegExp(`readonly ${field}:`));
  }
  assert.doesNotMatch(method, /CONNECTED|spawn\s*\(|exec\s*\(|node:child_process|providerAccess/u);
  assert.doesNotMatch(method, /\b(?:pid|processHandle|nativeHandle)\b/iu);
  assert.doesNotMatch(
    workItemContract,
    /CONNECTED|\b(?:pid|processHandle|nativeHandle|payload|transcript|credential|secret)\b/iu,
  );
  assert.match(migration, /ventureos_require_codex_validation_process_recovery_lease/u);
  assert.match(migration, /FOR UPDATE/u);
  assert.match(migration, /trusted_claim\."expiresAt" > LOCALTIMESTAMP\(3\)/u);
  assert.match(migration, /NEW\."claimedAt" IS DISTINCT FROM LOCALTIMESTAMP\(3\)/u);
  assert.match(migration, /"expiresAt" = "claimedAt" \+ INTERVAL '15 seconds'/u);
  assert.match(migration, /completion_excludes_active_recovery/u);
  assert.match(
    migration,
    /ventureos_reject_completion_during_codex_process_recovery\(\)[\s\S]*FOR UPDATE/u,
  );
  assert.match(migration, /recovery_leases_immutable/u);
  assert.doesNotMatch(
    migration,
    /CONNECTED|"(?:payload|transcript|credential|providerResponse|secretReference)"\s+(?:TEXT|JSON)/u,
  );
});

test('Codex recovery work-item validation is exact, active-only, and non-operational', () => {
  const validator = readFileSync(
    'packages/agent-bridge/src/codex-validation-process-session-recovery.ts',
    'utf8',
  );
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  assert.match(validator, /validateCodexValidationProcessSessionRecoveryWorkItem/u);
  assert.match(validator, /validateSupervisorProcessBinding/u);
  assert.match(validator, /leaseClaimedAtMs < processExpiresAtMs/u);
  assert.match(validator, /leaseExpiresAtMs !== leaseClaimedAtMs \+ LEASE_DURATION_MS/u);
  assert.match(validator, /observedAt\.getTime\(\) < leaseClaimedAtMs/u);
  assert.match(validator, /observedAt\.getTime\(\) >= leaseExpiresAtMs/u);
  assert.match(validator, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(service, /validateCodexValidationProcessSessionRecoveryWorkItem\(candidate, now\)/u);
  assert.doesNotMatch(
    validator,
    /CONNECTED|spawn\s*\(|exec\s*\(|node:child_process|providerAccess|\b(?:pid|processHandle|nativeHandle)\b/iu,
  );
});

test('Codex recovery exit evidence is retained-identity-only, lease-bound, and deny-default', () => {
  const evidence = readFileSync(
    'packages/agent-bridge/src/codex-validation-process-session-recovery-evidence.ts',
    'utf8',
  );
  assert.match(evidence, /class DenyCodexValidationProcessSessionRecoveryEvidenceSource/u);
  assert.match(evidence, /identityAuthority: 'RETAINED_NATIVE_IDENTITY'/u);
  assert.match(evidence, /validateCodexValidationProcessSessionRecoveryWorkItem\(workItemInput/u);
  assert.match(evidence, /Date\.parse\(exitedAt\) > Date\.parse\(workItem\.processExpiresAt\)/u);
  assert.match(evidence, /Date\.parse\(verifiedAt\) >= Date\.parse\(workItem\.leaseExpiresAt\)/u);
  assert.match(evidence, /Date\.parse\(evidence\.verifiedAt\) < startedAt\.getTime\(\)/u);
  assert.match(evidence, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(
    evidence,
    /CONNECTED|spawn\s*\(|exec\s*\(|node:child_process|providerAccess|process\.kill|\b(?:pid|processHandle|nativeHandle)\b/iu,
  );
});

test('Codex recovery completion is lease-bound, cancellation-only, append-only, and non-operational', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const start = service.indexOf('async completeCodexValidationProcessSessionRecovery');
  const method = service.slice(start, service.indexOf('/** Records exact owner-reported', start));
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260901210000_codex_process_session_recovery_completion/migration.sql',
    'utf8',
  );
  assert.ok(start > 0);
  assert.match(method, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(
    method,
    /validateCodexValidationProcessSessionRecoveryWorkItem\(input\.workItem, now\)/u,
  );
  assert.match(method, /validateCodexValidationProcessSessionRecoveryExitEvidence/u);
  assert.match(method, /reason: 'CANCELLED'/u);
  assert.match(method, /Prisma\.TransactionIsolationLevel\.Serializable/u);
  assert.doesNotMatch(method, /dispatch\.expiresAt !== workItem\.processExpiresAt/u);
  assert.ok(
    method.indexOf('INSERT INTO "acp_codex_validation_process_session_recovery_exit_evidence"') <
      method.indexOf('INSERT INTO "acp_codex_validation_process_session_completions"'),
  );
  assert.match(migration, /NEW\."reason" = 'CANCELLED'/u);
  assert.match(migration, /lease\."expiresAt" > clock_timestamp\(\)/u);
  assert.match(migration, /completion drifted from recovery evidence/u);
  assert.match(migration, /recovery_exit_evidence_immutable/u);
  assert.doesNotMatch(
    method,
    /CONNECTED|spawn\s*\(|exec\s*\(|node:child_process|providerAccess|process\.kill|\b(?:pid|processHandle|nativeHandle)\b/iu,
  );
  assert.doesNotMatch(migration, /'CONNECTED'|"(?:payload|transcript|credential|secret)"/iu);
});

test('Codex recovery coordinator is ordered, bounded, deny-default, and non-operational', () => {
  const coordinator = readFileSync(
    'packages/agent-bridge/src/codex-validation-process-session-recovery-coordinator.ts',
    'utf8',
  );
  assert.match(coordinator, /MAX_ACTIVE_RECOVERIES = 1_024/u);
  assert.match(
    coordinator,
    /workItem\.binding\.workspaceId.*workItem\.recoveryLeaseId.*workItem\.recoveryGeneration/u,
  );
  assert.match(coordinator, /class DenyCodexValidationProcessSessionRecoveryCompletionAuthority/u);
  assert.match(coordinator, /new DenyCodexValidationProcessSessionRecoveryEvidenceSource\(\)/u);
  assert.match(
    coordinator,
    /observeCodexValidationProcessSessionRecoveryExit[\s\S]*completionAuthority\.complete/u,
  );
  assert.match(
    coordinator,
    /validateCodexValidationProcessSessionRecoveryExitEvidence[\s\S]*completionAuthority\.complete/u,
  );
  assert.match(coordinator, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(coordinator, /connectionTransition: 'NOT_APPLIED'/u);
  assert.doesNotMatch(
    coordinator,
    /CONNECTED|spawn\s*\(|exec\s*\(|node:child_process|providerAccess|process\.kill|\b(?:pid|processHandle|nativeHandle)\b/iu,
  );
});

test('control-plane Codex recovery completion authority is exact, frozen, and non-operational', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const start = service.indexOf('createCodexValidationProcessSessionRecoveryCompletionAuthority(');
  const authority = service.slice(
    start,
    service.indexOf('/**\n   * Binds one active durable lease bundle', start),
  );
  assert.ok(start > 0);
  assert.match(authority, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(authority, /validateCodexValidationProcessSessionRecoveryWorkItem/u);
  assert.match(authority, /validateCodexValidationDispatchCandidate/u);
  assert.match(authority, /Object\.freeze\(\{[\s\S]*workspaceId:[\s\S]*principalId:/u);
  assert.match(authority, /canonicalJson\(requestedWorkItem\) !== canonicalJson\(boundWorkItem\)/u);
  assert.match(authority, /completeCodexValidationProcessSessionRecovery/u);
  assert.match(authority, /runtimeConnection !== 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(authority, /workItem\.processExpiresAt !== dispatch\.expiresAt/u);
  assert.doesNotMatch(authority, /\.\.\.identity|CONNECTED|spawn\s*\(|exec\s*\(|process\.kill/u);
});

test('control-plane Codex recovery execution is lease-bound, single-attempt, and deny-default', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const start = service.indexOf('createCodexValidationProcessSessionRecoveryExecutionAuthority(');
  const authority = service.slice(
    start,
    service.indexOf('/**\n   * Claims one exact durable recovery bundle', start),
  );
  assert.ok(start > 0);
  assert.match(authority, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(authority, /new DenyCodexValidationProcessSessionRecoveryEvidenceSource\(\)/u);
  assert.match(authority, /createCodexValidationProcessSessionRecoveryCompletionAuthority/u);
  assert.match(authority, /new BoundedCodexValidationProcessSessionRecoveryCoordinator/u);
  assert.match(authority, /lease\.ownerReference !== context\.principalId/u);
  assert.match(authority, /lease\.ownerActorKind !== actorKind/u);
  assert.match(authority, /lease\.leaseState !== 'ACTIVE'/u);
  assert.match(authority, /lease\.expiresAt !== workItem\.leaseExpiresAt/u);
  assert.match(authority, /if \(started\)/u);
  assert.match(authority, /started = true/u);
  assert.match(authority, /coordinator\.execute\(workItem\)/u);
  assert.doesNotMatch(
    authority,
    /CONNECTED|spawn\s*\(|exec\s*\(|node:child_process|providerAccess|process\.kill|setInterval|setTimeout/iu,
  );
});

test('control-plane Codex recovery claim and execution are one exact deny-default operation', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const start = service.indexOf('async executeCodexValidationProcessSessionRecovery(');
  const operation = service.slice(
    start,
    service.indexOf('/**\n   * Executes one bounded owner-scoped inventory page', start),
  );
  assert.ok(start > 0);
  assert.match(operation, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(operation, /new DenyCodexValidationProcessSessionRecoveryEvidenceSource\(\)/u);
  assert.match(operation, /claimCodexValidationProcessSessionRecoveryLease/u);
  assert.match(operation, /recoveryLeaseId: input\.recoveryLeaseId/u);
  assert.match(operation, /idempotencyKey: input\.idempotencyKey/u);
  assert.match(operation, /createCodexValidationProcessSessionRecoveryExecutionAuthority/u);
  assert.match(operation, /bundle\.lease\.leaseState === 'EXPIRED'/u);
  assert.match(operation, /bundle\.workItem === null \|\| bundle\.dispatch === null/u);
  assert.match(operation, /completionIdempotencyKey: input\.completionIdempotencyKey/u);
  assert.match(operation, /recoveryState: 'RECORDED'/u);
  assert.match(operation, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(operation, /connectionTransition: 'NOT_APPLIED'/u);
  assert.doesNotMatch(
    operation,
    /CONNECTED|spawn\s*\(|exec\s*\(|node:child_process|providerAccess|process\.kill|setInterval|setTimeout/iu,
  );
});

test('control-plane Codex recovery worker is one-page, sequential, and preflight-denied', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const start = service.indexOf('async executeCodexValidationProcessSessionRecoveryPage(');
  const worker = service.slice(
    start,
    service.indexOf('/**\n   * Lists a bounded owner-scoped snapshot', start),
  );
  assert.ok(start > 0);
  assert.match(worker, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(
    worker,
    /attemptIdentitySource instanceof[\s\S]*DenyCodexValidationProcessSessionRecoveryAttemptIdentitySource/u,
  );
  assert.match(
    worker,
    /evidenceSource instanceof DenyCodexValidationProcessSessionRecoveryEvidenceSource/u,
  );
  assert.match(worker, /listCodexValidationProcessSessionRecoveryInventory/u);
  assert.match(worker, /for \(const item of page\.items\)/u);
  assert.match(worker, /item\.recoveryState === 'ACTIVE'/u);
  assert.match(worker, /attemptIdentitySource\.issue\(item, page\.observedAt\)/u);
  assert.match(worker, /const identity = Object\.freeze\(\{/u);
  assert.match(worker, /identity\.claimId !== item\.claimId/u);
  assert.match(worker, /executeCodexValidationProcessSessionRecovery/u);
  assert.match(worker, /result\.lease\.claimId !== item\.claimId/u);
  assert.match(worker, /result\.lease\.recoveryLeaseId !== identity\.recoveryLeaseId/u);
  assert.match(worker, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(worker, /connectionTransition: 'NOT_APPLIED'/u);
  assert.doesNotMatch(
    worker,
    /CONNECTED|Promise\.all|spawn\s*\(|exec\s*\(|node:child_process|providerAccess|process\.kill|setInterval|setTimeout/iu,
  );
});

test('Codex process-session completions reproduce trusted claim authority on insert and replay', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const methodStart = service.indexOf('async completeCodexValidationProcessSession(\n');
  const replay = service.slice(
    service.indexOf('const existing = existingByClaim', methodStart),
    service.indexOf('const [completion] = await tx.$queryRaw', methodStart),
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260901190000_codex_process_session_completion_trust/migration.sql',
    'utf8',
  );
  for (const field of [
    'workspaceId',
    'cleanupEvidenceHash',
    'claimId',
    'handoffAttemptId',
    'validationDispatchCandidateHash',
    'runtimeId',
    'connectionId',
    'sessionId',
    'dispatchId',
    'reason',
    'processState',
    'exitCode',
    'signal',
    'closedAt',
    'runtimeConnection',
    'completionIdempotencyKey',
  ])
    assert.match(replay, new RegExp(`existing\\.${field}`));
  assert.match(migration, /BEFORE INSERT ON "acp_codex_validation_process_session_completions"/u);
  assert.match(migration, /Existing Codex validation process-session completion crossed/u);
  assert.match(migration, /FOR UPDATE/u);
  assert.match(migration, /trusted_claim\."state" IS DISTINCT FROM 'CLAIMED'/u);
  assert.match(migration, /trusted_claim\."runtimeConnection" IS DISTINCT FROM 'NOT_CONFIGURED'/u);
  assert.match(migration, /NEW\."closedAt" < trusted_claim\."claimedAt"/u);
  assert.match(migration, /NEW\."closedAt" > trusted_claim\."expiresAt"/u);
  assert.match(migration, /NEW\."createdAt" < trusted_claim\."claimedAt"/u);
  assert.match(migration, /NEW\."createdAt" IS DISTINCT FROM LOCALTIMESTAMP\(3\)/u);
  assert.doesNotMatch(
    migration,
    /CONNECTED|"(?:payload|transcript|credential|providerResponse|secretReference)"\s+(?:TEXT|JSON)/u,
  );
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

test('Codex process sessions require durable authority before open and terminal egress', () => {
  const owner = readFileSync(
    'packages/agent-bridge/src/codex-validation-process-session-owner.ts',
    'utf8',
  );
  assert.match(owner, /class DenyCodexValidationProcessSessionAuthority/u);
  assert.match(owner, /authority: CodexValidationProcessSessionAuthority = new Deny/u);
  assert.match(owner, /await this\.authority\.claim[\s\S]*await this\.owner\.open/u);
  assert.match(
    owner,
    /createCodexValidationProcessCleanupEvidence[\s\S]*await this\.authority\.complete[\s\S]*adapter\.execute/u,
  );
});

test('control-plane Codex process authority is Level-3, identity-bound, and non-launching', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const factory = service.slice(
    service.indexOf('createCodexValidationProcessSessionAuthority('),
    service.indexOf('createCodexValidationProcessSessionRecoveryCompletionAuthority('),
  );
  assert.match(factory, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(factory, /Object\.freeze\(\{[\s\S]*workspaceId:[\s\S]*principalId:/u);
  assert.match(factory, /claimCodexValidationProcessSession/u);
  assert.match(factory, /completeCodexValidationProcessSession/u);
  assert.match(factory, /canonicalJson\(validatedBinding\) !== canonicalJson\(cleanup\.binding\)/u);
  assert.doesNotMatch(factory, /\.\.\.identity/u);
  assert.doesNotMatch(factory, /spawn|exec|credential|accessToken|apiKey|CONNECTED/u);
});

test('Codex process recovery discovery is bounded, owner-scoped, and read-only', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const inventory = service.slice(
    service.indexOf('async listCodexValidationProcessSessionRecoveryInventory('),
    service.indexOf('async claimCodexValidationProcessSessionRecoveryLease('),
  );
  assert.match(inventory, /assertControlPlane\(capability, context, 3\)/u);
  assert.match(inventory, /input\.limit < 1 \|\| input\.limit > 100/u);
  assert.match(inventory, /claim\."workspaceId" = CAST\(\$\{context\.workspaceId\} AS uuid\)/u);
  assert.match(inventory, /claim\."ownerReference" = \$\{context\.principalId\}/u);
  assert.match(inventory, /claim\."ownerActorKind" = \$\{actorKind\}/u);
  assert.match(inventory, /completion\."claimId" IS NULL/u);
  assert.match(inventory, /ORDER BY claim\."id" ASC/u);
  assert.match(inventory, /LIMIT \$\{input\.limit \+ 1\}/u);
  assert.match(inventory, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(inventory, /Object\.freeze\(items\)/u);
  assert.doesNotMatch(
    inventory,
    /\b(?:INSERT|UPDATE|DELETE)\b|spawn|exec|provider|credential|CONNECTED/u,
  );
});

test('retained-native recovery peer signs only after bounded native cleanup evidence', () => {
  const peer = readFileSync('packages/agent-bridge/src/retained-native-supervisor-peer.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  assert.match(peer, /class DenyRetainedNativeRecoveryNativeAuthority/u);
  assert.match(peer, /class AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer/u);
  assert.match(peer, /ventureos\.retained-native-supervisor\.recovery-request\.v1/u);
  assert.match(peer, /Promise\.race\(\[[\s\S]*observeAndCleanup/u);
  assert.match(peer, /retainedIdentityKind !== 'PIDFD'/u);
  assert.match(peer, /cleanupState !== 'PROCESS_GROUP_GONE'/u);
  assert.match(peer, /identityVerifiedAt[\s\S]*request\.issuedAt/u);
  assert.match(peer, /sign\([\s\S]*canonicalJson\(payload\)/u);
  assert.match(peer, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(peer, /from 'node:(?:child_process|fs|net)'/u);
  assert.doesNotMatch(peer, /\bCONNECTED\b|provider|deployment|publish|spend/u);
  assert.doesNotMatch(apiComposition, /AuthenticatedLocalRetainedNativeSupervisorRecoveryPeer/u);
});

test('Linux retained-pidfd recovery fixture keeps native identity test-only and one-shot', () => {
  const fixture = readFileSync(
    'packages/agent-bridge/test/native/retained-pidfd-recovery-addon.c',
    'utf8',
  );
  const evidence = readFileSync(
    'packages/agent-bridge/src/retained-pidfd-recovery-authority.test.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const runtimeAssertion = readFileSync(
    'packages/agent-bridge/scripts/assert-runtime-boundary.mjs',
    'utf8',
  );
  assert.match(fixture, /SYS_pidfd_open/u);
  assert.match(fixture, /static struct retained_launch launch_state/u);
  assert.match(fixture, /poll\(&retained, 1, 1000\)/u);
  assert.match(fixture, /strcmp\(supervision_id, launch_state\.supervision_id\)/u);
  assert.match(fixture, /strcmp\(launch_nonce, launch_state\.launch_nonce\)/u);
  assert.match(fixture, /kill\(-launch_state\.process_group, SIGTERM\)/u);
  assert.match(fixture, /errno == ESRCH/u);
  assert.match(fixture, /napi_add_env_cleanup_hook\(env, environment_cleanup/u);
  assert.match(fixture, /close_state\(\);[\s\S]*return result/u);
  assert.match(evidence, /class LinuxRetainedPidfdAuthority/u);
  assert.match(evidence, /Object\.isFrozen\(request\)/u);
  assert.match(evidence, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(evidence, /substituted-supervision/u);
  assert.match(evidence, /verify\([\s\S]*response\.signature/u);
  assert.doesNotMatch(evidence, /\bCONNECTED\b|provider|deployment|publish|spend/u);
  assert.doesNotMatch(index, /retained-pidfd-recovery/u);
  assert.match(runtimeAssertion, /retained-pidfd-recovery/u);
});

test('retained-native local IPC kernel evidence remains test-only and substitution-safe', () => {
  const fixture = readFileSync(
    'packages/agent-bridge/test/native/retained-native-local-ipc-addon.c',
    'utf8',
  );
  const evidence = readFileSync(
    'packages/agent-bridge/src/retained-native-local-ipc-linux-evidence.test.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const runtimeAssertion = readFileSync(
    'packages/agent-bridge/scripts/assert-runtime-boundary.mjs',
    'utf8',
  );
  assert.match(fixture, /AF_UNIX/u);
  assert.match(fixture, /SO_PEERCRED/u);
  assert.match(fixture, /lstat\(fixture_state\.path, &before\)/u);
  assert.match(fixture, /lstat\(fixture_state\.path, &after\)/u);
  assert.match(fixture, /same_identity\(&before, &after\)/u);
  assert.match(fixture, /unlink_owned/u);
  assert.match(fixture, /napi_add_env_cleanup_hook\(env, environment_cleanup/u);
  assert.match(evidence, /describeLinux/u);
  assert.match(evidence, /INVALID_ATTESTATION/u);
  assert.match(evidence, /substituted-marker/u);
  assert.match(evidence, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(evidence, /\bCONNECTED\b|provider|deployment|publish|spend/u);
  assert.doesNotMatch(index, /retained-native-local-ipc-linux-evidence/u);
  assert.match(runtimeAssertion, /retained-native-local-ipc-addon/u);
});

test('Linux retained-native IPC client owns a bounded deny-default lifecycle and is uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-linux-client.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  assert.match(source, /class DenyLinuxRetainedNativeSupervisorBinding/u);
  assert.match(source, /class BoundedLinuxRetainedNativeSupervisorLocalIpcClient/u);
  assert.match(source, /lstatUnixSocket/u);
  assert.match(source, /connectUnixSocket/u);
  assert.match(source, /peerCredentials/u);
  assert.match(source, /writeAndShutdown/u);
  assert.match(source, /readToEof/u);
  assert.match(source, /await this\.closeConnection\(opened\)/u);
  assert.match(source, /async close\(\): Promise<void>/u);
  assert.match(source, /await this\.closeConnection\(active\)/u);
  assert.match(source, /MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES/u);
  assert.match(source, /authority: 'LINUX_LSTAT_UNIX_SOCKET'/u);
  assert.match(source, /authority: 'LINUX_SO_PEERCRED'/u);
  assert.doesNotMatch(
    source,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(source, /\bCONNECTED\b|provider|deployment|publish|spend/u);
  assert.doesNotMatch(apiComposition, /retained-native-supervisor-linux-client/u);
});

test('Linux retained-native supervisor session is bounded, deny-default, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-linux-session.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  assert.match(source, /class DenyLinuxRetainedNativeSupervisorSessionBinding/u);
  assert.match(source, /class BoundedLinuxRetainedNativeSupervisorSession/u);
  assert.match(
    source,
    /AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler/u,
  );
  assert.match(source, /#state: 'READY' \| 'IN_FLIGHT' \| 'ATTEMPTED'/u);
  assert.match(source, /acceptAuthorizedUnixSocket/u);
  assert.match(source, /peerCredentials/u);
  assert.match(source, /readToEof/u);
  assert.match(source, /handler\.handle/u);
  assert.match(source, /writeAndShutdown/u);
  assert.match(source, /await opened\.close\(\)/u);
  assert.match(source, /await this\.handler\.close\(\)/u);
  assert.match(source, /MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES/u);
  assert.match(source, /authority: 'LINUX_LSTAT_UNIX_SOCKET'/u);
  assert.match(source, /authority: 'LINUX_SO_PEERCRED'/u);
  assert.doesNotMatch(
    source,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(source, /\b(?:bind|listen|unlink|chmod)\s*\(/u);
  assert.doesNotMatch(source, /\bCONNECTED\b|provider|deployment|publish|spend/u);
  assert.doesNotMatch(apiComposition, /retained-native-supervisor-linux-session/u);
});

test('Linux retained-native listener lifecycle is ownership-safe, bounded, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-listener-lifecycle.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /class DenyLinuxRetainedNativeSupervisorListenerLifecycleBinding/u);
  assert.match(source, /class BoundedLinuxRetainedNativeSupervisorListenerLifecycle/u);
  assert.match(source, /createOwnedListener/u);
  assert.match(source, /pathDisposition: 'FAIL_IF_PRESENT'/u);
  assert.match(source, /bindDisposition !== 'CREATED_WITHOUT_REPLACEMENT'/u);
  assert.match(source, /value\.parentMode !== 0o700/u);
  assert.match(source, /value\.socketMode !== 0o600/u);
  assert.match(source, /value\.listenBacklog !== 1/u);
  assert.match(source, /expectedWorkerPid: positive/u);
  assert.match(source, /expectedPeerPid: this\.#authorization\.expectedWorkerPid/u);
  assert.match(source, /new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler/u);
  assert.match(
    source,
    /class DenyLinuxRetainedNativeSupervisorModuleAuthorizationSigningCustodyFactory/u,
  );
  assert.match(source, /async runSigningOne/u);
  assert.match(
    source,
    /purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SIGNING_CUSTODY'/u,
  );
  assert.match(source, /authenticateRetainedNativeSupervisorModuleAuthorizationSignerKeyId/u);
  assert.match(
    source,
    /new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler/u,
  );
  assert.match(source, /await Promise\.race/u);
  assert.ok(
    source.indexOf('identity = assertAuthorizedCreation(') <
      source.indexOf('const handler = await createHandler(identity)'),
  );
  assert.match(source, /assertCleanup\(listener\.closeAndUnlinkOwned\(\), identity\)/u);
  assert.match(source, /evidence\.disposition !== 'OWNED_SOCKET_REMOVED'/u);
  assert.match(source, /new BoundedLinuxRetainedNativeSupervisorSession/u);
  assert.doesNotMatch(
    source,
    /from\s+['"]node:(?:child_process|cluster|fs|os|net|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(source, /runtimeConnection:\s*'CONNECTED'/u);
  assert.doesNotMatch(
    source,
    /createPrivateKey|createSecretKey|generateKeyPair|privateKey|from\s+['"]node:(?:crypto|fs|net|tls)['"]/u,
  );
  assert.doesNotMatch(apiComposition, /retained-native-supervisor-listener-lifecycle/u);
  assert.doesNotMatch(workerComposition, /retained-native-supervisor-listener-lifecycle/u);
});

test('retained-native listener lifecycle kernel evidence is Linux-test-only and ownership-safe', () => {
  const fixture = readFileSync(
    'packages/agent-bridge/test/native/retained-native-listener-lifecycle-addon.c',
    'utf8',
  );
  const evidence = readFileSync(
    'packages/agent-bridge/src/retained-native-listener-lifecycle-linux-evidence.test.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const runtimeAssertion = readFileSync(
    'packages/agent-bridge/scripts/assert-runtime-boundary.mjs',
    'utf8',
  );
  assert.match(fixture, /lstat\(parent_path/u);
  assert.match(fixture, /\(fixture_state\.parent_identity\.st_mode & 0777\) != 0700/u);
  assert.match(fixture, /lstat\(path, &existing\) == 0/u);
  assert.match(fixture, /bind\(listener/u);
  assert.match(fixture, /chmod\(path, 0600\)/u);
  assert.match(fixture, /listen\(listener, 1\)/u);
  assert.match(
    fixture,
    /same_directory_identity\(&fixture_state\.parent_identity, &current_parent\)/u,
  );
  assert.match(fixture, /SO_PEERCRED/u);
  assert.match(fixture, /MAX_FRAME_BYTES 32768/u);
  assert.match(fixture, /volatile uint8_t \*cursor = data/u);
  assert.match(fixture, /clear_bytes\(buffer, sizeof\(buffer\)\)/u);
  assert.match(fixture, /clear_bytes\(observed, sizeof\(observed\)\)/u);
  assert.match(fixture, /same_identity\(&fixture_state\.listener_identity, &current\)/u);
  assert.match(fixture, /SUBSTITUTION_PRESERVED/u);
  assert.match(fixture, /if \(!listener_closed\)[\s\S]*LISTENER_CLOSE_FAILED/u);
  assert.match(evidence, /process\.platform === 'linux' && process\.arch === 'x64'/u);
  assert.match(evidence, /expectedWorkerPid: process\.pid/u);
  assert.match(evidence, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(index, /retained-native-listener-lifecycle-linux-evidence/u);
  assert.match(runtimeAssertion, /retained-native-listener-lifecycle-addon/u);
  assert.doesNotMatch(evidence, /runtimeConnection:\s*'CONNECTED'/u);
});

test('Linux retained-native listener native binding is exact, one-shot, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-linux-native-listener-binding.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  assert.match(source, /class DenyLinuxRetainedNativeSupervisorListenerNativeModule/u);
  assert.match(source, /class BoundedLinuxRetainedNativeSupervisorNativeListenerBinding/u);
  assert.match(source, /const MODULE_KEYS = \['abiVersion', 'createOwnedListener', 'platform'\]/u);
  assert.match(source, /value\.createOwnedListener[\s\S]*\.bind\(\s*native/u);
  assert.match(source, /pathDisposition !== 'FAIL_IF_PRESENT'/u);
  assert.match(source, /maximumBytes !== MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES/u);
  assert.match(source, /socketPath !== this\.socketPath/u);
  assert.match(source, /ownedFrame\.fill\(0\)/u);
  assert.match(source, /if \(result instanceof Promise\) deny\('EXCHANGE_DENIED'\)/u);
  assert.match(source, /if \(signal\.aborted\) \{[\s\S]*listener\.closeAndUnlinkOwned\(\)/u);
  assert.match(index, /retained-native-supervisor-linux-native-listener-binding/u);
  assert.doesNotMatch(
    source,
    /from\s+['"]node:(?:child_process|cluster|fs|module|net|os|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(source, /(?:require|import)\s*\(/u);
  assert.doesNotMatch(source, /runtimeConnection:\s*'CONNECTED'/u);
  assert.doesNotMatch(apiComposition, /retained-native-supervisor-linux-native-listener-binding/u);
});

test('production Linux retained-native listener source is async, bounded, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/native/linux-retained-native-listener.c',
    'utf8',
  );
  const evidence = readFileSync(
    'packages/agent-bridge/src/retained-native-listener-module-linux-evidence.test.ts',
    'utf8',
  );
  const packageJson = JSON.parse(readFileSync('packages/agent-bridge/package.json', 'utf8'));
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  assert.match(source, /SOCK_STREAM \| SOCK_CLOEXEC \| SOCK_NONBLOCK/u);
  assert.match(source, /lstat\(path, &existing\) == 0/u);
  assert.match(source, /pathDisposition[^\n]*FAIL_IF_PRESENT/u);
  assert.match(source, /chmod\(path, 0600\)/u);
  assert.match(source, /listen\(state->descriptor, 1\)/u);
  assert.match(source, /napi_create_async_work/u);
  assert.match(source, /pipe2\(operation->cancellation, O_CLOEXEC \| O_NONBLOCK\)/u);
  assert.match(source, /poll\(descriptors, 2, -1\)/u);
  assert.match(source, /SO_PEERCRED/u);
  assert.match(source, /MAX_FRAME_BYTES 32768/u);
  assert.match(source, /MSG_NOSIGNAL/u);
  assert.match(source, /clear_bytes\(operation->bytes/u);
  assert.match(source, /same_identity\(&state->listener_identity, &current\)/u);
  assert.match(source, /SUBSTITUTION_PRESERVED/u);
  assert.match(evidence, /process\.platform === 'linux' && process\.arch === 'x64'/u);
  assert.match(evidence, /-Werror/u);
  assert.match(evidence, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.deepEqual(packageJson.files, ['dist']);
  assert.doesNotMatch(apiComposition, /linux-retained-native-listener/u);
  assert.doesNotMatch(source, /runtimeConnection|CONNECTED|provider|deployment|publish|spend/u);
});

test('Linux retained-native client native binding is exact, ordered, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-linux-native-client-binding.ts',
    'utf8',
  );
  const listener = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-linux-native-listener-binding.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /class DenyLinuxRetainedNativeSupervisorClientNativeModule/u);
  assert.match(source, /class BoundedLinuxRetainedNativeSupervisorNativeClientBinding/u);
  assert.match(
    source,
    /const MODULE_KEYS = \[[\s\S]*'connectUnixSocket'[\s\S]*'lstatUnixSocket'[\s\S]*'platform'/u,
  );
  assert.match(
    source,
    /const CONNECTION_KEYS = \[[\s\S]*'peerCredentials'[\s\S]*'readToEof'[\s\S]*'writeAndShutdown'/u,
  );
  assert.match(source, /value\.lstatUnixSocket[\s\S]*\.bind\(native\)/u);
  assert.match(source, /value\.connectUnixSocket[\s\S]*\.bind\(native\)/u);
  assert.match(source, /this\.#lstatCount !== 1[\s\S]*!this\.#responseRead/u);
  assert.match(source, /maximumBytes !== MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES/u);
  assert.match(source, /ownedFrame\.fill\(0\)/u);
  assert.match(source, /clearUint8Array\.call\(input, 0\)/u);
  assert.match(source, /this\.#connection\?\.clearDeliveredResponse\(\)/u);
  assert.match(source, /cleanupMalformedConnection/u);
  assert.match(listener, /cleanupMalformedOwnedListener/u);
  assert.match(index, /retained-native-supervisor-linux-native-client-binding/u);
  assert.doesNotMatch(
    source,
    /from\s+['"]node:(?:child_process|cluster|fs|module|net|os|http|https|tls|dgram|worker_threads)['"]/u,
  );
  assert.doesNotMatch(source, /(?:require|import)\s*\(/u);
  assert.doesNotMatch(source, /runtimeConnection:\s*'CONNECTED'/u);
  assert.doesNotMatch(apiComposition, /retained-native-supervisor-linux-native-client-binding/u);
  assert.doesNotMatch(workerComposition, /retained-native-supervisor-linux-native-client-binding/u);
});

test('production Linux retained-native client source is async, bounded, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/native/linux-retained-native-client.c',
    'utf8',
  );
  const evidence = readFileSync(
    'packages/agent-bridge/src/retained-native-client-module-linux-evidence.test.ts',
    'utf8',
  );
  const packageJson = JSON.parse(readFileSync('packages/agent-bridge/package.json', 'utf8'));
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /socket\(AF_UNIX, SOCK_STREAM \| SOCK_CLOEXEC \| SOCK_NONBLOCK/u);
  assert.match(source, /lstat\(path, &identity\)/u);
  assert.match(source, /connect\(operation->connected_descriptor/u);
  assert.match(source, /SO_ERROR/u);
  assert.match(source, /napi_create_async_work/u);
  assert.match(source, /pipe2\(operation->cancellation, O_CLOEXEC \| O_NONBLOCK\)/u);
  assert.match(source, /poll\(descriptors, 2, -1\)/u);
  assert.match(source, /SO_PEERCRED/u);
  assert.match(source, /MAX_FRAME_BYTES 32768/u);
  assert.match(source, /MSG_NOSIGNAL/u);
  assert.match(source, /clear_bytes\(operation->bytes/u);
  assert.match(evidence, /process\.platform === 'linux' && process\.arch === 'x64'/u);
  assert.match(evidence, /-Werror/u);
  assert.match(evidence, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(evidence, /code: 'INVALID_ATTESTATION'/u);
  assert.deepEqual(packageJson.files, ['dist']);
  assert.doesNotMatch(apiComposition, /linux-retained-native-client/u);
  assert.doesNotMatch(workerComposition, /linux-retained-native-client/u);
  assert.doesNotMatch(source, /runtimeConnection|CONNECTED|provider|deployment|publish|spend/u);
});

test('Linux retained-native module loading is descriptor-bound, authorized, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-linux-module-loader.ts',
    'utf8',
  );
  const evidence = readFileSync(
    'packages/agent-bridge/src/retained-native-module-loader-linux-evidence.test.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const runtimeAssertion = readFileSync(
    'packages/agent-bridge/scripts/assert-runtime-boundary.mjs',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /class DenyLinuxRetainedNativeSupervisorModuleAuthorizationSource/u);
  assert.match(source, /class DenyLinuxRetainedNativeSupervisorModuleHost/u);
  assert.match(source, /class RetainedDescriptorLinuxNativeSupervisorModuleHost/u);
  assert.doesNotMatch(source, /export class RetainedDescriptorLinuxNativeSupervisorModuleHost/u);
  assert.match(source, /createRetainedDescriptorLinuxNativeSupervisorModuleLoader/u);
  assert.match(source, /class BoundedLinuxRetainedNativeSupervisorModuleLoader/u);
  assert.match(source, /#attempted = false/u);
  assert.match(source, /MAX_AUTHORIZATION_LIFETIME_MS = 5 \* 60 \* 1_000/u);
  assert.match(source, /fsConstants\.O_NOFOLLOW/u);
  assert.match(source, /fsConstants\.O_DIRECTORY/u);
  assert.match(source, /MAX_RETAINED_MODULE_DESCRIPTORS = 2/u);
  assert.match(source, /retainedDlopenDescriptors\.add\(descriptor\)/u);
  assert.match(source, /retainedLoadedModules\.get\(authorization\.moduleKind\)/u);
  assert.match(source, /socketDirectoryMode !== 0o700/u);
  assert.match(source, /createHash\('sha256'\)\.update\(bytes\)\.digest\('hex'\)/u);
  assert.match(source, /dlopen\(holder, `\/proc\/self\/fd\/\$\{descriptor\}`/u);
  assert.ok(
    source.indexOf('observedDigest !== authorization.moduleSha256') <
      source.indexOf('dlopen(holder'),
  );
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(evidence, /process\.platform === 'linux' && process\.arch === 'x64'/u);
  assert.match(evidence, /symlinked module/u);
  assert.match(evidence, /symlinked socket directory/u);
  assert.match(evidence, /replacement identity for an already loaded module kind/u);
  assert.match(index, /retained-native-supervisor-linux-module-loader/u);
  assert.match(runtimeAssertion, /native binary entered runtime output/u);
  assert.doesNotMatch(
    source,
    /process\.(?:env|cwd)\b|\bCONNECTED\b|provider|deployment|publish|spend/u,
  );
  assert.doesNotMatch(apiComposition, /retained-native-supervisor-linux-module-loader/u);
  assert.doesNotMatch(workerComposition, /retained-native-supervisor-linux-module-loader/u);
});

test('Linux retained-native path provisioning is owner-only, identity-bound, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-linux-path-provisioner.ts',
    'utf8',
  );
  const evidence = readFileSync(
    'packages/agent-bridge/src/retained-native-path-provisioner-linux-evidence.test.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /class DenyLinuxRetainedNativeSupervisorPathProvisionAuthority/u);
  assert.match(source, /class DenyLinuxRetainedNativeSupervisorPathProvisionHost/u);
  assert.match(source, /class RetainedDescriptorLinuxNativeSupervisorPathProvisionHost/u);
  assert.doesNotMatch(
    source,
    /export class RetainedDescriptorLinuxNativeSupervisorPathProvisionHost/u,
  );
  assert.match(source, /class BoundedLinuxRetainedNativeSupervisorPathProvisioner/u);
  assert.match(source, /#attempted = false/u);
  assert.match(source, /MAX_GRANT_LIFETIME_MS = 5 \* 60 \* 1_000/u);
  assert.match(source, /OWNER_ONLY_DIRECTORY_MODE = 0o700/u);
  assert.match(source, /OWNER_ONLY_MODULE_MODE = 0o500/u);
  assert.match(source, /fsConstants\.O_NOFOLLOW/u);
  assert.match(source, /fsConstants\.O_EXCL/u);
  assert.match(source, /`\/proc\/self\/fd\/\$\{moduleParentDescriptor\}/u);
  assert.match(source, /sameIdentity\(moduleStat, reopenedModule\)/u);
  assert.match(source, /sourceModulePath === canonicalModulePath/u);
  assert.match(source, /lstatSync\(grant\.socketPath\)/u);
  assert.match(source, /fsyncSync\(moduleDescriptor\)/u);
  assert.match(source, /bytes\?\.fill\(0\)/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(evidence, /process\.platform === 'linux' && process\.arch === 'x64'/u);
  assert.match(evidence, /symlinked source/u);
  assert.match(evidence, /non-owner-only retained parent/u);
  assert.match(evidence, /refuses an existing module without replacing its bytes/u);
  assert.match(index, /retained-native-supervisor-linux-path-provisioner/u);
  assert.doesNotMatch(source, /\bdlopen\b|createOwnedListener|connectUnixSocket/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process)'/u,
  );
  assert.doesNotMatch(apiComposition, /RetainedNativeSupervisorPathProvision/u);
  assert.doesNotMatch(workerComposition, /RetainedNativeSupervisorPathProvision/u);
});

test('bounded retained-native provisioning controller is attestation-chained and transport-free', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-provisioning-controller.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  const operationIndex = source.indexOf('async provision(\n    input: unknown');
  const rootIndex = source.indexOf('this.#runtimeRootProvision', operationIndex);
  const parentIndex = source.indexOf('this.#parentDirectoryProvision', rootIndex + 1);
  const clientIndex = source.indexOf('this.#clientProvision', parentIndex + 1);
  const listenerIndex = source.indexOf('this.#listenerProvision', clientIndex + 1);
  assert.match(source, /class DenyLinuxRetainedNativeSupervisorProvisioningPort/u);
  assert.match(source, /class BoundedLinuxRetainedNativeSupervisorProvisioningController/u);
  assert.match(source, /#attempted = false/u);
  assert.match(source, /#lastObservedNow = -1/u);
  assert.ok(rootIndex >= 0 && parentIndex > rootIndex && clientIndex > parentIndex);
  assert.ok(listenerIndex > clientIndex);
  assert.match(source, /PROVISIONED_NOT_ACTIVATED/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(source, /assertFreshWindow\(evidence\.authorizedFrom/u);
  assert.match(source, /client\.socketDirectoryIdentityReference !==/u);
  assert.match(index, /retained-native-supervisor-provisioning-controller/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|provider|deployment|publish|spend|from 'node:(?:fs|net|tls|child_process)'/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /BoundedLinuxRetainedNativeSupervisorProvisioningController/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /BoundedLinuxRetainedNativeSupervisorProvisioningController/u,
  );
});

test('shared retained-runtime topology requires two retained role-local views and remains uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-shared-runtime-topology.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /class DenyLinuxRetainedNativeSupervisorTopologyObservationPort/u);
  assert.match(source, /class RetainedDescriptorLinuxNativeSupervisorTopologyObserver/u);
  assert.match(
    source,
    /class BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler/u,
  );
  assert.match(source, /fsConstants\.O_NOFOLLOW/u);
  assert.match(source, /LINUX_RETAINED_DESCRIPTORS/u);
  assert.match(source, /LINUX_EFFECTIVE_IDENTITY/u);
  assert.match(source, /Promise\.all\(\[/u);
  assert.match(source, /SHARED_RUNTIME_VISIBLE_NOT_PROVISIONED/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(index, /retained-native-supervisor-shared-runtime-topology/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process)'/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler/u,
  );
});

test('retained-runtime provisioning is gated by exact fresh shared topology and remains uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-topology-gated-provisioning.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(
    source,
    /class BoundedLinuxRetainedNativeSupervisorTopologyGatedProvisioningController/u,
  );
  assert.ok(source.indexOf('this.#attest(plan') < source.indexOf('this.#provision(plan'));
  assert.match(source, /remainingFreshnessMs/u);
  assert.match(source, /TOPOLOGY_ATTESTED_PROVISIONED_NOT_ACTIVATED/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(index, /retained-native-supervisor-topology-gated-provisioning/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process)'/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /BoundedLinuxRetainedNativeSupervisorTopologyGatedProvisioningController/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /BoundedLinuxRetainedNativeSupervisorTopologyGatedProvisioningController/u,
  );
});

test('role-local topology observation IPC is kernel-authenticated, bounded, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-topology-observation-local-ipc.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /authenticateRetainedNativeSupervisorLocalIpcClientExchange/u);
  assert.match(source, /authenticateRetainedNativeSupervisorLocalIpcInboundExchange/u);
  assert.match(source, /VENTUREOS_RETAINED_NATIVE_TOPOLOGY_OBSERVATION_IPC/u);
  assert.match(source, /COORDINATOR_TO_OBSERVER/u);
  assert.match(source, /OBSERVER_TO_COORDINATOR/u);
  assert.match(source, /requestHash/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(index, /retained-native-supervisor-topology-observation-local-ipc/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process|fs)'/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservation/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservation/u,
  );
});

test('cross-container topology observation carrier is mutually authenticated, bounded, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-topology-observation-carrier.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL/u);
  assert.match(source, /COORDINATOR_TO_WORKER/u);
  assert.match(source, /WORKER_TO_COORDINATOR/u);
  assert.match(source, /workerPrincipalReference/u);
  assert.match(source, /coordinatorPrincipalReference/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(index, /retained-native-supervisor-topology-observation-carrier/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process|fs)'/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservation/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservation/u,
  );
});

test('topology carrier delivery is signed through keyless ports and remains uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-topology-observation-carrier-signature.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY/u);
  assert.match(
    source,
    /class DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner/u,
  );
  assert.match(
    source,
    /class Ed25519RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator/u,
  );
  assert.match(
    source,
    /class Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationCarrier/u,
  );
  assert.match(source, /class Ed25519RetainedNativeSupervisorTopologyObservationWorkerEndpoint/u);
  assert.match(source, /verify\(null, canonicalBytes\(payload/u);
  assert.match(source, /MAX_RETAINED_NATIVE_TOPOLOGY_SIGNED_DELIVERY_BYTES = 64 \* 1_024/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|\bcreatePrivateKey\b|\bgenerateKeyPair\b|\bprivateKey\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process|fs)'/u,
  );
  assert.doesNotMatch(apiComposition, /TopologyObservationCarrierSignature/u);
  assert.doesNotMatch(workerComposition, /TopologyObservationCarrierSignature/u);
});

test('topology carrier public roots require exact live binding and Level-3 durable evidence', () => {
  const registry = readFileSync(
    'apps/api/src/modules/agent-control-plane/topology-carrier-signature-root-registry.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260906210000_topology_carrier_signature_root_registry/migration.sql',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(registry, /validateRetainedNativeSupervisorTopologyObservationCarrierBinding/u);
  assert.match(registry, /retainedNativeSupervisorTopologyObservationCarrierBindingHash/u);
  assert.match(registry, /authorityLevelFor\(boundContext\) !== 3/u);
  assert.match(registry, /actorKind === 'RUNTIME'/u);
  assert.match(registry, /root\.rootRecordVersion !== 1/u);
  assert.match(registry, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(migration, /INTERVAL '5 seconds'/u);
  assert.match(migration, /binding is not currently authorized/u);
  assert.match(migration, /root role bound exceeded/u);
  assert.match(migration, /Level-3 evidence is required/u);
  assert.match(migration, /public-root state is immutable/u);
  assert.doesNotMatch(
    registry,
    /process\.env|\bCONNECTED\b|\bcreatePrivateKey\b|\bgenerateKeyPair\b|\bprivateKey\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process|fs)'/u,
  );
  assert.doesNotMatch(apiComposition, /PostgresTopologyCarrierSignatureRootRegistry/u);
  assert.doesNotMatch(workerComposition, /PostgresTopologyCarrierSignatureRootRegistry/u);
});

test('role-local topology carrier composition resolves opposite roots and remains uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-topology-observation-carrier-composition.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(
    source,
    /class DenyRetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource/u,
  );
  assert.match(source, /class RootResolvedRetainedNativeSupervisorTopologyObservationCoordinator/u);
  assert.match(source, /class RootResolvedRetainedNativeSupervisorTopologyObservationWorker/u);
  assert.match(source, /'WORKER_CLIENT'/u);
  assert.match(source, /'API_COORDINATOR'/u);
  assert.match(source, /#attempted/u);
  assert.match(source, /await this\.#carrier\.close\(\)/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|\bcreatePrivateKey\b|\bgenerateKeyPair\b|\bprivateKey\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process|fs)'/u,
  );
  assert.doesNotMatch(apiComposition, /RootResolvedRetainedNativeSupervisorTopologyObservation/u);
  assert.doesNotMatch(
    workerComposition,
    /RootResolvedRetainedNativeSupervisorTopologyObservation/u,
  );
});

test('topology carrier byte framing is one-use, bounded, canonical, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-topology-observation-carrier-channel.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_CHANNEL_FRAME_BYTES = 64 \* 1_024/u);
  assert.match(source, /class DenyRetainedNativeSupervisorTopologyObservationCarrierByteChannel/u);
  assert.match(source, /class BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel/u);
  assert.match(
    source,
    /class BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint/u,
  );
  assert.match(source, /new TextDecoder\('utf-8', \{ fatal: true \}\)/u);
  assert.match(source, /canonicalJson\(value\) !== text/u);
  assert.match(source, /#attempted/u);
  assert.match(source, /await this\.close\(\)/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process|fs)'/u,
  );
  assert.doesNotMatch(apiComposition, /TopologyObservationCarrierChannel/u);
  assert.doesNotMatch(workerComposition, /TopologyObservationCarrierChannel/u);
});

test('topology carrier delivery signing is role-bound, keyless, bounded, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-topology-observation-carrier-keyless-signer.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(
    source,
    /class DenyRetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport/u,
  );
  assert.match(
    source,
    /class BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner/u,
  );
  assert.match(source, /MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_SIGNING_REQUEST_BYTES = 72 \* 1_024/u);
  assert.match(source, /principalRole: this\.#role/u);
  assert.match(source, /principalReference: this\.#principalReference/u);
  assert.match(source, /signingRequestHash: hash\(requestBinding\)/u);
  assert.match(source, /Promise\.resolve\(\)\.then\(\(\) => this\.#exchange/u);
  assert.match(source, /Promise\.resolve\(\)\.then\(\(\) => this\.#close\(\)\)/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|\bcreatePrivateKey\b|\bgenerateKeyPair\b|\bprivateKey\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process|fs)'/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner/u,
  );
});

test('API coordinator resolves only the exact durable worker carrier root and remains uncomposed', () => {
  const source = readFileSync(
    'apps/api/src/modules/agent-control-plane/topology-carrier-signature-root-source.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /class PostgresApiCoordinatorTopologyCarrierSignatureRootSource/u);
  assert.match(
    source,
    /implements RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource/u,
  );
  assert.match(source, /principalRole !== 'WORKER_CLIENT'/u);
  assert.match(source, /canonicalJson\(supplied\) !== canonicalJson\(this\.#binding\)/u);
  assert.match(source, /this\.#registry\.read\(this\.#binding, 'WORKER_CLIENT', this\.clock\)/u);
  assert.match(source, /validateRetainedNativeSupervisorTopologyObservationCarrierBinding/u);
  assert.match(
    source,
    /root\.bindingHash !== retainedNativeSupervisorTopologyObservationCarrierBindingHash/u,
  );
  assert.match(source, /#attempted/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|\bcreatePrivateKey\b|\bgenerateKeyPair\b|\bprivateKey\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process|fs)'/u,
  );
  assert.doesNotMatch(apiComposition, /PostgresApiCoordinatorTopologyCarrierSignatureRootSource/u);
  assert.doesNotMatch(
    workerComposition,
    /PostgresApiCoordinatorTopologyCarrierSignatureRootSource/u,
  );
});

test('API published root source resolves only its coordinator grant and remains uncomposed', () => {
  const source = readFileSync(
    'apps/api/src/modules/agent-control-plane/topology-carrier-signature-root-source.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /class PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource/u);
  assert.match(source, /principalRole !== 'API_COORDINATOR'/u);
  assert.match(source, /canonicalJson\(supplied\) !== canonicalJson\(this\.#binding\)/u);
  assert.match(source, /this\.#registry\.read\(this\.#binding, 'API_COORDINATOR', this\.clock\)/u);
  assert.match(source, /assertExactRoot\(candidate, this\.#binding, 'API_COORDINATOR'\)/u);
  assert.match(source, /#attempted/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|\bcreatePrivateKey\b|\bgenerateKeyPair\b|\bprivateKey\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process|fs)'/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource/u,
  );
});

test('worker carrier root lookup requires independent mutual identity and remains uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-topology-observation-carrier-root-lookup.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT/u);
  assert.match(source, /principalRole !== 'API_COORDINATOR'/u);
  assert.match(source, /canonicalJson\(candidate\) !== canonicalJson\(this\.#binding\)/u);
  assert.match(source, /requesterPrincipalRole: 'WORKER_CLIENT'/u);
  assert.match(source, /requestedPrincipalRole: 'API_COORDINATOR'/u);
  assert.match(source, /challenge: challenge\(\(\) => randomBytes\(32\)\)/u);
  assert.match(source, /value\.requestHash !== hash\(request\)/u);
  assert.match(source, /MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_REQUEST_BYTES/u);
  assert.match(source, /MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_ROOT_LOOKUP_RESPONSE_BYTES/u);
  assert.match(source, /Promise\.resolve\(\)\.then\(\(\) => this\.#close\(\)\)/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|\bcreatePrivateKey\b|\bgenerateKeyPair\b|\bprivateKey\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process|fs)'/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource/u,
  );
});

test('API carrier root lookup handler trusts only sideband mutual identity and remains uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-topology-observation-carrier-root-lookup-handler.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT/u);
  assert.match(source, /localPrincipalRole !== 'API_COORDINATOR'/u);
  assert.match(source, /peerPrincipalRole !== 'WORKER_CLIENT'/u);
  assert.match(source, /authenticatedAt < Date\.parse\(this\.#binding\.issuedAt\)/u);
  assert.match(source, /canonicalJson\(suppliedBinding\) !== canonicalJson\(this\.#binding\)/u);
  assert.match(source, /this\.#read\(this\.#binding, 'API_COORDINATOR', attempt\.signal\)/u);
  assert.match(source, /requestHash: hash\(request\)/u);
  assert.match(source, /#attempted = false/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|\bcreatePrivateKey\b|\bgenerateKeyPair\b|\bprivateKey\b|provider|deployment|publish|spend|from 'node:(?:net|tls|child_process|fs)'/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler/u,
  );
});

test('role-local topology observation listeners require exact Level-3 one-session authority', () => {
  const lifecycle = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-listener-lifecycle.ts',
    'utf8',
  );
  const owner = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-service-owner.ts',
    'utf8',
  );
  const authority = readFileSync(
    'apps/api/src/modules/agent-control-plane/retained-native-service-authority.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(lifecycle, /runTopologyObservationOne/u);
  assert.match(
    lifecycle,
    /AuthenticatedLinuxLocalRetainedNativeSupervisorTopologyObservationHandler/u,
  );
  assert.match(owner, /TOPOLOGY_OBSERVATION_API_LISTENER/u);
  assert.match(owner, /TOPOLOGY_OBSERVATION_WORKER_CLIENT/u);
  assert.match(owner, /maximumSessionDurationMs/u);
  assert.match(authority, /authorityLevelFor\(boundContext\) !== 3/u);
  assert.match(authority, /actorKind === 'RUNTIME'/u);
  assert.doesNotMatch(
    apiComposition,
    /BoundedLinuxRetainedNativeSupervisorServiceOwner|BoundedLevel3RetainedNativeSupervisorServiceAuthority/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /BoundedLinuxRetainedNativeSupervisorServiceOwner|BoundedLevel3RetainedNativeSupervisorServiceAuthority/u,
  );
});

test('retained-native module authorization trust is signed, revocable, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-module-authorization-trust-source.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(source, /class DenyRetainedNativeSupervisorModuleAuthorizationTrustSource/u);
  assert.match(source, /class BoundedRetainedNativeSupervisorModuleAuthorizationTrustSource/u);
  assert.match(
    source,
    /class BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator/u,
  );
  assert.match(
    source,
    /class DenyRetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore/u,
  );
  assert.match(
    source,
    /class BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotPublisher/u,
  );
  assert.match(source, /new AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot/u);
  assert.match(source, /RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT/u);
  assert.match(source, /RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION/u);
  assert.match(source, /MAX_SNAPSHOT_LIFETIME_MS = 5 \* 60 \* 1_000/u);
  assert.match(source, /snapshot\.previousSnapshotHash !== current\.snapshotHash/u);
  assert.match(source, /checkpoints\.compareAndSwap/u);
  assert.match(source, /clientAuthorizationHash/u);
  assert.match(source, /listenerAuthorizationHash/u);
  assert.match(source, /snapshot\.authorizations\.find/u);
  assert.match(index, /retained-native-supervisor-module-authorization-trust-source/u);
  assert.doesNotMatch(source, /from 'node:(?:child_process|fs|net|tls)'/u);
  assert.doesNotMatch(source, /process\.env|\bCONNECTED\b|provider|deployment|spend/u);
  assert.doesNotMatch(source, /createPrivateKey|generateKeyPair|\.sign\(/u);
  assert.doesNotMatch(
    apiComposition,
    /BoundedRetainedNativeSupervisorModuleAuthorizationTrustSource/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /BoundedRetainedNativeSupervisorModuleAuthorizationTrustSource/u,
  );
});

test('retained-native module snapshot issuance is approval-bound, keyless, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-module-authorization-controller.ts',
    'utf8',
  );
  const auditedPublisher = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-module-authorization-audited-publisher.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(
    source,
    /class DenyRetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthority/u,
  );
  assert.match(source, /class DenyRetainedNativeSupervisorModuleAuthorizationSnapshotSigner/u);
  assert.match(
    source,
    /class DenyRetainedNativeSupervisorModuleAuthorizationSnapshotPublicationSink/u,
  );
  assert.match(
    source,
    /class BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController/u,
  );
  assert.match(source, /#attempted = false/u);
  assert.match(source, /MAX_LIFETIME_MS = 5 \* 60 \* 1_000/u);
  assert.match(source, /value\.authorityLevel !== 3/u);
  assert.match(source, /value\.moduleMode !== 0o500/u);
  assert.match(source, /value\.socketDirectoryMode !== 0o700/u);
  assert.match(source, /linuxRetainedNativeSupervisorModuleLoadRequestHash/u);
  assert.match(source, /approvalEvidenceHash/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(index, /retained-native-supervisor-module-authorization-controller/u);
  assert.match(
    auditedPublisher,
    /class BoundedRetainedNativeSupervisorModuleAuthorizationAuditedPublisher/u,
  );
  assert.match(
    auditedPublisher,
    /AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance\.assertAuthenticated/u,
  );
  assert.match(
    auditedPublisher,
    /AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot\.assertAuthenticated/u,
  );
  assert.match(index, /retained-native-supervisor-module-authorization-audited-publisher/u);
  assert.doesNotMatch(source, /from 'node:(?:child_process|fs|net|tls)'/u);
  assert.doesNotMatch(source, /process\.env|\bCONNECTED\b|provider|deployment|spend/u);
  assert.doesNotMatch(source, /createPrivateKey|generateKeyPair|privateKey/u);
  assert.doesNotMatch(
    apiComposition,
    /BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController/u,
  );
});

test('retained-native module snapshot signing is bounded, keyless, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-module-authorization-keyless-signer.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(
    source,
    /class DenyRetainedNativeSupervisorModuleAuthorizationKeylessSigningTransport/u,
  );
  assert.match(
    source,
    /class BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner/u,
  );
  assert.match(source, /#attempted = false/u);
  assert.match(source, /MAX_RETAINED_NATIVE_MODULE_SIGNING_REQUEST_BYTES = 32 \* 1_024/u);
  assert.match(source, /MAX_RETAINED_NATIVE_MODULE_SIGNING_RESPONSE_BYTES = 1_024/u);
  assert.match(source, /MAX_TIMEOUT_MS = 5_000/u);
  assert.match(source, /signingRequestHash/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(source, /await Promise\.race/u);
  assert.match(source, /this\.#close\(\)/u);
  assert.match(index, /retained-native-supervisor-module-authorization-keyless-signer/u);
  assert.doesNotMatch(source, /from 'node:(?:child_process|fs|net|tls)'/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bCONNECTED\b|createPrivateKey|createSecretKey|generateKeyPair/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner/u,
  );
});

test('native-module signing transport is Linux-authenticated, one-use, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-module-authorization-linux-signing-transport.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(
    source,
    /class AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport/u,
  );
  assert.match(source, /LINUX_LSTAT_UNIX_SOCKET/u);
  assert.match(source, /LINUX_SO_PEERCRED/u);
  assert.match(source, /runtimeConnection !== 'NOT_CONFIGURED'/u);
  assert.match(source, /#state: 'READY' \| 'IN_FLIGHT' \| 'ATTEMPTED' \| 'CLOSED'/u);
  assert.match(source, /MAX_RETAINED_NATIVE_MODULE_SIGNING_REQUEST_BYTES/u);
  assert.match(source, /MAX_RETAINED_NATIVE_MODULE_SIGNING_RESPONSE_BYTES/u);
  assert.match(source, /await this\.#closeClient\(\)/u);
  assert.match(index, /retained-native-supervisor-module-authorization-linux-signing-transport/u);
  assert.doesNotMatch(
    source,
    /from 'node:(?:child_process|crypto|fs|net|tls)'|process\.(?:env|cwd|platform)|\bCONNECTED\b|createPrivateKey|createSecretKey|generateKeyPair/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport/u,
  );
});

test('native-module supervisor signing handler is authenticated, bounded, and uncomposed', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-module-authorization-signing-handler.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const workerComposition = readFileSync('apps/worker/src/worker.ts', 'utf8');
  assert.match(
    source,
    /class DenyRetainedNativeSupervisorModuleAuthorizationSigningCustodySession/u,
  );
  assert.match(
    source,
    /class AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler/u,
  );
  assert.match(source, /authenticateRetainedNativeSupervisorLocalIpcInboundExchange/u);
  assert.match(source, /#attempted = false/u);
  assert.match(source, /MAX_RETAINED_NATIVE_MODULE_SIGNING_REQUEST_BYTES/u);
  assert.match(source, /MAX_RETAINED_NATIVE_MODULE_SIGNING_RESPONSE_BYTES/u);
  assert.match(source, /signingRequestHash/u);
  assert.match(source, /snapshotPayloadHash/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(source, /this\.#close\(\)/u);
  assert.match(source, /#activeController/u);
  assert.match(source, /#closePromise/u);
  assert.match(source, /async close\(\): Promise<void>/u);
  assert.match(index, /retained-native-supervisor-module-authorization-signing-handler/u);
  assert.doesNotMatch(
    source,
    /from 'node:(?:child_process|fs|net|tls)'|process\.(?:env|cwd|platform)|\bCONNECTED\b|createPrivateKey|createSecretKey|generateKeyPair|privateKey/u,
  );
  assert.doesNotMatch(
    apiComposition,
    /AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler/u,
  );
  assert.doesNotMatch(
    workerComposition,
    /AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler/u,
  );
});

test('native-module issuance Level-3 authority is exact, one-shot, and uncomposed', () => {
  const source = readFileSync(
    'apps/api/src/modules/agent-control-plane/retained-native-module-authorization-issuance-authority.ts',
    'utf8',
  );
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const worker = readFileSync('apps/worker/src/worker.ts', 'utf8');
  const integration = readFileSync(
    'apps/api/test/retained-native-module-authorization-trust-state.integration.spec.ts',
    'utf8',
  );
  assert.match(source, /class BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority/u);
  assert.match(source, /capability\.assertSource\('CONTROL_PLANE'\)/u);
  assert.match(source, /capability\.authorityLevelFor\(boundContext\) !== 3/u);
  assert.match(source, /actorKind === 'RUNTIME'/u);
  assert.match(source, /#attempted = false/u);
  assert.match(source, /AUTHORIZATION_LIFETIME_MS = 60_000/u);
  assert.match(source, /RETAINED_NATIVE_MODULE_SNAPSHOT_LEVEL3_AUTHORIZATION/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(source, /ApprovalsService|AcpApprovalBridgeService|authorityLevel: 4/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bfetch\s*\(|from 'node:(?:child_process|fs|net|tls)'/u,
  );
  assert.doesNotMatch(module, /BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority/u);
  assert.doesNotMatch(worker, /BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority/u);
});

test('retained-native supervisor trust snapshots are fresh, revocable, and anti-rollback', () => {
  const source = readFileSync(
    'packages/agent-bridge/src/retained-native-supervisor-trust-source.ts',
    'utf8',
  );
  const apiComposition = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const index = readFileSync('packages/agent-bridge/src/index.ts', 'utf8');
  assert.match(source, /class DenyRetainedNativeSupervisorTrustSource/u);
  assert.match(source, /class BoundedRetainedNativeSupervisorTrustSource/u);
  assert.match(source, /RETAINED_NATIVE_SUPERVISOR_TRUST_SNAPSHOT/u);
  assert.match(source, /MAX_SNAPSHOT_LIFETIME_MS = 15 \* 60 \* 1_000/u);
  assert.match(
    source,
    /canonicalJson\(retainedNativeSupervisorTrustSnapshotPayload\(snapshot\)\)/u,
  );
  assert.match(source, /snapshot\.previousSnapshotHash !== current\.snapshotHash/u);
  assert.match(source, /checkpoints\.compareAndSwap/u);
  assert.match(source, /checkpoints\.read\(snapshot\.supervisorInstanceId\)/u);
  assert.match(source, /activeSupervisorKeyId === next\.activeSupervisorKeyId/u);
  assert.match(source, /activePublicKeySpkiSha256 !== next\.activePublicKeySpkiSha256/u);
  assert.match(source, /snapshot\.record === null/u);
  assert.match(index, /retained-native-supervisor-trust-source/u);
  assert.doesNotMatch(source, /from 'node:(?:child_process|fs|net|tls)'/u);
  assert.doesNotMatch(source, /process\.env|\bCONNECTED\b|provider|deployment|publish|spend/u);
  assert.doesNotMatch(apiComposition, /BoundedRetainedNativeSupervisorTrustSource/u);
});

test('durable retained-native supervisor trust state is exact, audited, and uncomposed', () => {
  const adapter = readFileSync(
    'apps/api/src/modules/agent-control-plane/retained-native-supervisor-trust-state.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260902030000_retained_native_supervisor_trust_state/migration.sql',
    'utf8',
  );
  const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const integration = readFileSync(
    'apps/api/test/retained-native-supervisor-trust-state.integration.spec.ts',
    'utf8',
  );

  assert.match(adapter, /implements RetainedNativeSupervisorTrustSnapshotReader/u);
  assert.match(adapter, /implements RetainedNativeSupervisorTrustCheckpointStore/u);
  assert.match(adapter, /WHERE "supervisorInstanceId" = \$\{this\.#supervisorInstanceId\}/u);
  assert.match(adapter, /ON CONFLICT \("supervisorInstanceId"\) DO NOTHING/u);
  assert.match(adapter, /successor\.snapshotVersion !== current\.snapshotVersion \+ 1/u);
  assert.match(adapter, /IS NOT DISTINCT FROM \$\{current\.activeTrustRecordVersion\}/u);
  assert.doesNotMatch(
    adapter,
    /\bprocess\.(?:env|cwd|platform)\b|\bfetch\s*\(|\$queryRawUnsafe|\$executeRawUnsafe/u,
  );

  assert.match(migration, /CREATE TABLE "acp_retained_native_supervisor_trust_snapshots"/u);
  assert.match(migration, /CREATE TABLE "acp_retained_native_supervisor_trust_checkpoints"/u);
  assert.match(migration, /CREATE TABLE "acp_retained_native_supervisor_trust_checkpoint_events"/u);
  assert.match(migration, /INTERVAL '15 minutes'/u);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE/u);
  assert.match(migration, /bound_record->>'publicKeySpkiSha256'/u);
  assert.match(migration, /NEW\."snapshotVersion" <> OLD\."snapshotVersion" \+ 1/u);
  assert.match(migration, /AFTER INSERT OR UPDATE/u);
  assert.match(migration, /checkpoint_events_immutable/u);
  assert.match(schema, /model AcpRetainedNativeSupervisorTrustSnapshot/u);
  assert.match(schema, /model AcpRetainedNativeSupervisorTrustCheckpoint/u);
  assert.match(schema, /model AcpRetainedNativeSupervisorTrustCheckpointEvent/u);
  assert.match(integration, /exactly one winner/u);
  assert.match(integration, /wrong-native-key/u);
  assert.doesNotMatch(module, /PostgresRetainedNativeSupervisorTrust/u);
  assert.doesNotMatch(adapter, /\bCONNECTED\b|provider|deployment|publish|spend/u);
});

test('durable native-module authorization state is grant-bound, audited, and uncomposed', () => {
  const adapter = readFileSync(
    'apps/api/src/modules/agent-control-plane/retained-native-module-authorization-trust-state.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260905183000_retained_native_module_trust_state/migration.sql',
    'utf8',
  );
  const publicationMigration = readFileSync(
    'packages/database/prisma/migrations/20260905210000_guard_native_module_snapshot_publication/migration.sql',
    'utf8',
  );
  const issuanceMigration = readFileSync(
    'packages/database/prisma/migrations/20260906000000_native_module_snapshot_issuance_audit/migration.sql',
    'utf8',
  );
  const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const integration = readFileSync(
    'apps/api/test/retained-native-module-authorization-trust-state.integration.spec.ts',
    'utf8',
  );

  assert.match(adapter, /implements RetainedNativeSupervisorModuleAuthorizationSnapshotReader/u);
  assert.match(
    adapter,
    /implements RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore/u,
  );
  assert.match(
    adapter,
    /AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot\.assertAuthenticated/u,
  );
  assert.match(
    adapter,
    /AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication\.assertAuthenticated/u,
  );
  assert.match(adapter, /WITH inserted_snapshot AS/u);
  assert.match(adapter, /inserted_evidence AS/u);
  assert.match(adapter, /ON CONFLICT \("supervisorInstanceId", "snapshotVersion"\) DO NOTHING/u);
  assert.match(adapter, /implements RetainedNativeSupervisorModuleAuthorizationCheckpointStore/u);
  assert.match(adapter, /ON CONFLICT \("supervisorInstanceId"\) DO NOTHING/u);
  assert.match(adapter, /successor\.snapshotVersion !== current\.snapshotVersion \+ 1/u);
  assert.match(
    adapter,
    /"listenerAuthorizationHash" IS NOT DISTINCT FROM \$\{current\.listenerAuthorizationHash\}/u,
  );
  assert.doesNotMatch(
    adapter,
    /\bprocess\.(?:env|cwd|platform)\b|\bfetch\s*\(|\$queryRawUnsafe|\$executeRawUnsafe/u,
  );

  assert.match(migration, /CREATE TABLE "acp_retained_native_module_authorization_snapshots"/u);
  assert.match(migration, /ventureos_canonical_retained_native_module_json/u);
  assert.match(migration, /INTERVAL '5 minutes'/u);
  assert.match(migration, /checkpoint grant binding denied/u);
  assert.match(migration, /NEW\."snapshotVersion" <> OLD\."snapshotVersion" \+ 1/u);
  assert.match(migration, /AFTER INSERT OR UPDATE/u);
  assert.match(migration, /checkpoint_events_immutable/u);
  assert.match(publicationMigration, /pg_advisory_xact_lock/u);
  assert.match(publicationMigration, /snapshot bootstrap denied/u);
  assert.match(publicationMigration, /snapshot equivocation denied/u);
  assert.match(publicationMigration, /snapshot chain transition denied/u);
  assert.match(
    issuanceMigration,
    /CREATE TABLE "acp_retained_native_module_authorization_issuance_evidence"/u,
  );
  assert.match(issuanceMigration, /"authorityLevel" = 3/u);
  assert.match(issuanceMigration, /INTERVAL '5 minutes'/u);
  assert.match(issuanceMigration, /clock_timestamp\(\)/u);
  assert.match(issuanceMigration, /issuance_evidence_freshness/u);
  assert.match(issuanceMigration, /supervisor workspace binding denied/u);
  assert.match(issuanceMigration, /issuance_evidence_update_deny/u);
  assert.match(issuanceMigration, /issuance_evidence_delete_deny/u);
  assert.match(schema, /model AcpRetainedNativeModuleAuthorizationSnapshot/u);
  assert.match(schema, /model AcpRetainedNativeModuleAuthorizationIssuanceEvidence/u);
  assert.match(schema, /model AcpRetainedNativeModuleAuthorizationCheckpoint/u);
  assert.match(schema, /model AcpRetainedNativeModuleAuthorizationCheckpointEvent/u);
  assert.match(integration, /exactly one winner/u);
  assert.match(integration, /wrong-client-grant/u);
  assert.match(integration, /immutable approval audit evidence/u);
  assert.doesNotMatch(module, /PostgresRetainedNativeModuleAuthorization/u);
  assert.doesNotMatch(adapter, /\bCONNECTED\b|provider|deployment|publish|spend/u);
});

test('native-module public roots are tenant-scoped, Level-3 audited, immutable, and uncomposed', () => {
  const registry = readFileSync(
    'apps/api/src/modules/agent-control-plane/retained-native-module-authorization-root-registry.ts',
    'utf8',
  );
  const migration = readFileSync(
    'packages/database/prisma/migrations/20260906140000_native_module_public_root_registry/migration.sql',
    'utf8',
  );
  const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const integration = readFileSync(
    'apps/api/test/retained-native-module-authorization-root-registry.integration.spec.ts',
    'utf8',
  );

  assert.match(registry, /capability\.assertSource\('CONTROL_PLANE'\)/u);
  assert.match(registry, /authorityLevelFor\(boundContext\) !== 3/u);
  assert.match(registry, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.match(registry, /inserted_root AS/u);
  assert.match(registry, /inserted_scope AS/u);
  assert.match(registry, /bound_scope AS/u);
  assert.match(registry, /ON CONFLICT DO NOTHING/u);
  assert.match(registry, /SELECT 1 FROM inserted_scope[\s\S]*UNION ALL/u);
  assert.match(registry, /inserted_evidence AS/u);
  assert.match(registry, /rows\.length > 8/u);
  assert.match(registry, /\) current_roots[\s\S]*"revokedAt" IS NULL/u);
  assert.doesNotMatch(
    registry,
    /\bcreatePrivateKey\b|\bgenerateKeyPair|\bsign\s*\(|\bfetch\s*\(|\bprocess\.(?:env|cwd|platform)\b|\$queryRawUnsafe|\$executeRawUnsafe/u,
  );

  assert.match(migration, /public-root cross-workspace supervisor binding denied/u);
  assert.match(migration, /root_scopes_binding_key/u);
  assert.match(migration, /public-root scope is immutable/u);
  assert.match(migration, /public-root version transition denied/u);
  assert.match(migration, /public-root equivocation denied/u);
  assert.match(migration, /public-root signer identity reuse denied/u);
  assert.match(migration, /active public-root bound exceeded/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(migration, /public-root Level-3 evidence is required/u);
  assert.match(migration, /public-root state is immutable/u);
  assert.match(migration, /"authorityLevel" = 3/u);
  assert.match(schema, /model AcpRetainedNativeModuleAuthorizationRoot/u);
  assert.match(schema, /model AcpRetainedNativeModuleAuthorizationRootScope/u);
  assert.match(schema, /model AcpRetainedNativeModuleAuthorizationRootEvidence/u);
  assert.match(integration, /unaudited-root/u);
  assert.match(integration, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(module, /PostgresRetainedNativeModuleAuthorizationRootRegistry/u);
});

test('native-module issuance composition binds roots, approval, signing, and audit without activation', () => {
  const source = readFileSync(
    'apps/api/src/modules/agent-control-plane/retained-native-module-authorization-issuance-composition.ts',
    'utf8',
  );
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const worker = readFileSync('apps/worker/src/worker.ts', 'utf8');
  const rootBindingMigration = readFileSync(
    'packages/database/prisma/migrations/20260906190000_bind_native_module_snapshot_to_current_root/migration.sql',
    'utf8',
  );

  assert.match(source, /#attempted = false/u);
  assert.match(
    source,
    /validateRetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest\(input\)/u,
  );
  assert.match(source, /new BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority/u);
  assert.match(
    source,
    /this\.#roots\.read\(request\.workspaceId, request\.supervisorInstanceId\)/u,
  );
  assert.match(source, /root\.signerKeyId === request\.signerKeyId/u);
  assert.match(source, /new BoundedRetainedNativeSupervisorModuleAuthorizationAuditedPublisher/u);
  assert.match(source, /new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController/u);
  assert.match(source, /runtimeConnection: 'NOT_CONFIGURED'/u);
  assert.doesNotMatch(
    source,
    /\bcreatePrivateKey\b|\bgenerateKeyPair|\bprivateKey\b|process\.env|\bfetch\s*\(|from 'node:(?:child_process|fs|net|tls)'|\bCONNECTED\b/u,
  );
  assert.doesNotMatch(module, /PostgresRetainedNativeModuleAuthorizationIssuanceComposition/u);
  assert.doesNotMatch(worker, /PostgresRetainedNativeModuleAuthorizationIssuanceComposition/u);
  assert.match(rootBindingMigration, /pg_advisory_xact_lock/u);
  assert.match(rootBindingMigration, /90503/u);
  assert.match(rootBindingMigration, /SELECT DISTINCT ON \(roots\."rootRecordId"\)/u);
  assert.match(rootBindingMigration, /current_roots\."signerKeyId" = NEW\."signerKeyId"/u);
  assert.match(
    rootBindingMigration,
    /current_roots\."minimumSnapshotVersion" <= NEW\."snapshotVersion"/u,
  );
  assert.match(rootBindingMigration, /current public-root binding denied/u);
});

test('native-module trust composition requires audited current roots and remains unactivated', () => {
  const source = readFileSync(
    'apps/api/src/modules/agent-control-plane/retained-native-module-authorization-trust-composition.ts',
    'utf8',
  );
  const state = readFileSync(
    'apps/api/src/modules/agent-control-plane/retained-native-module-authorization-trust-state.ts',
    'utf8',
  );
  const registry = readFileSync(
    'apps/api/src/modules/agent-control-plane/retained-native-module-authorization-root-registry.ts',
    'utf8',
  );
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const worker = readFileSync('apps/worker/src/worker.ts', 'utf8');
  const integration = readFileSync(
    'apps/api/test/retained-native-module-authorization-trust-state.integration.spec.ts',
    'utf8',
  );

  assert.match(source, /#attempted = false/u);
  assert.match(source, /BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotAuthenticator/u);
  assert.match(source, /BoundedRetainedNativeSupervisorModuleAuthorizationTrustSource/u);
  assert.match(source, /\$transaction/u);
  assert.match(source, /isolationLevel: 'Serializable'/u);
  assert.ok(source.indexOf('90497') < source.indexOf('90503'));
  assert.match(state, /issuance_evidence/u);
  assert.match(registry, /clock_timestamp\(\)/u);
  assert.match(state, /class PostgresRetainedNativeModuleAuthorizationAuditedSnapshotReader/u);
  assert.match(state, /JOIN "acp_retained_native_module_authorization_issuance_evidence"/u);
  assert.doesNotMatch(
    source,
    /\bcreatePrivateKey\b|\bgenerateKeyPair|\bprivateKey\b|process\.env|\bfetch\s*\(|from 'node:(?:child_process|fs|net|tls)'|\bCONNECTED\b/u,
  );
  assert.doesNotMatch(module, /PostgresRetainedNativeModuleAuthorizationTrustComposition/u);
  assert.doesNotMatch(worker, /PostgresRetainedNativeModuleAuthorizationTrustComposition/u);
  assert.match(integration, /new PostgresRetainedNativeModuleAuthorizationTrustComposition/u);
});

test('audited native-module trust supplies the retained-descriptor loader composition and remains unactivated', () => {
  const source = readFileSync(
    'apps/api/src/modules/agent-control-plane/retained-native-module-loader-composition.ts',
    'utf8',
  );
  const module = readFileSync(
    'apps/api/src/modules/agent-control-plane/agent-control-plane.module.ts',
    'utf8',
  );
  const worker = readFileSync('apps/worker/src/worker.ts', 'utf8');

  assert.match(source, /PostgresRetainedNativeModuleAuthorizationTrustComposition/u);
  assert.match(source, /createRetainedDescriptorLinuxNativeSupervisorModuleLoader/u);
  assert.doesNotMatch(source, /\.load\s*\(|\.node['"`]|\.sock['"`]/u);
  assert.doesNotMatch(
    source,
    /process\.env|\bfetch\s*\(|from 'node:(?:child_process|fs|net|tls)'|\bCONNECTED\b/u,
  );
  assert.doesNotMatch(module, /createPostgresRetainedDescriptorLinuxNativeSupervisorModuleLoader/u);
  assert.doesNotMatch(worker, /createPostgresRetainedDescriptorLinuxNativeSupervisorModuleLoader/u);
});
