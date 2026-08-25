import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const packageFiles = [
  'packages/agent-bridge/src/auth.ts',
  'packages/agent-bridge/src/codec.ts',
  'packages/agent-bridge/src/evidence.ts',
  'packages/agent-bridge/src/index.ts',
  'packages/agent-bridge/src/policy.ts',
  'packages/agent-bridge/src/protocol.ts',
  'packages/agent-bridge/src/secret-lease.ts',
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

test('production secret resolution is deny-only and has no ambient credential source', () => {
  const source = serviceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
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
