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
  assert.doesNotMatch(index, /native-supervisor|native-runtime-fixture/u);
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
    /workItem:\s+completionRows\.length === 0 && existing\.expiresAt > now\s+\? workItemFor\(existing\)\s+: null/u,
  );
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

test('Codex process-session completions reproduce trusted claim authority on insert and replay', () => {
  const service = readFileSync(
    'apps/api/src/modules/agent-control-plane/acp-bridge-admission.service.ts',
    'utf8',
  );
  const methodStart = service.indexOf('async completeCodexValidationProcessSession');
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
    service.indexOf('async claimCodexValidationProcessSession('),
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
