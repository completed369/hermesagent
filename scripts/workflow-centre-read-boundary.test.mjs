import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controller = readFileSync(
  new URL('../apps/api/src/modules/workflow-centre/workflow-centre.controller.ts', import.meta.url),
  'utf8',
);
const service = readFileSync(
  new URL('../apps/api/src/modules/workflow-centre/workflow-centre.service.ts', import.meta.url),
  'utf8',
);
const page = readFileSync(
  new URL('../apps/web/src/app/dashboard/workflows/page.tsx', import.meta.url),
  'utf8',
);

test('Workflow Centre exposes one authenticated permission-scoped GET only', () => {
  assert.match(controller, /@Controller\('workflow-centre'\)/u);
  assert.match(controller, /@UseGuards\(SessionAuthGuard, PermissionGuard\)/u);
  assert.match(controller, /@RequirePermission\('workflow:view'\)/u);
  assert.equal((controller.match(/@Get\(/gu) ?? []).length, 1);
  assert.doesNotMatch(controller, /@(Post|Put|Patch|Delete)\(/u);
  assert.doesNotMatch(controller, /@(?:Query|Param|Body)\(/u);
  assert.match(controller, /@Inject\(WorkflowCentreService\)/u);
  assert.match(controller, /snapshot\(user\.workspaceId\)/u);
});

test('Workflow Centre service is a bounded repeatable-read projection with no writer calls', () => {
  assert.match(service, /TransactionIsolationLevel\.RepeatableRead/u);
  assert.match(service, /dependencies: 1_000/u);
  for (const limit of [50, 20, 200, 200, 50, 100, 50]) {
    assert.match(service, new RegExp(`\\b${limit}\\b`, 'u'));
  }
  assert.doesNotMatch(
    service,
    /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/u,
  );
  assert.doesNotMatch(service, /\$executeRaw/u);
});

test('every collection has a deterministic bound and hierarchical rows cannot escape it', () => {
  for (const collection of [
    'workflowRuns',
    'objectives',
    'tasks',
    'dependencies',
    'runs',
    'runtimes',
    'connections',
    'pendingApprovals',
  ]) {
    assert.match(service, new RegExp(`take: LIMITS\\.${collection}`, 'u'), collection);
    assert.match(service, new RegExp(`${collection}: truncate\\(`, 'u'), collection);
  }
  assert.match(service, /take: LIMITS\.stepsPerWorkflow \+ 1/u);
  assert.match(service, /stepsTruncated: row\.steps\.length > LIMITS\.stepsPerWorkflow/u);
  assert.match(service, /orderBy: \[\{ startedAt: 'desc' \}, \{ id: 'asc' \}\]/u);
  assert.match(service, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'asc' \}\]/u);
  assert.match(service, /orderBy: \[\{ updatedAt: 'desc' \}, \{ id: 'asc' \}\]/u);
  assert.match(service, /orderBy: \[\{ taskId: 'asc' \}, \{ dependsOnTaskId: 'asc' \}\]/u);
  assert.match(service, /objectiveId: \{ in: objectiveIds \}/u);
  assert.match(service, /taskId: \{ in: taskIds \}/u);
});

test('pending Founder summaries are unexpired Level-4 requests at the transaction clock', () => {
  assert.equal((service.match(/requiredAuthorityLevel: 4/gu) ?? []).length, 2);
  assert.equal((service.match(/expiresAt: \{ gt: clock\.observedAt \}/gu) ?? []).length, 2);
  assert.equal((service.match(/state: 'PENDING'/gu) ?? []).length, 2);
});

test('Workflow Centre response source excludes authority-bearing and sensitive fields', () => {
  for (const forbidden of [
    'input: row.input',
    'output: row.output',
    'error: row.error',
    'desiredOutcome: row.desiredOutcome',
    'acceptanceCriteria: row.acceptanceCriteria',
    'verificationCriteria: row.verificationCriteria',
    'stopConditions: row.stopConditions',
    'policyHash: row.policyHash',
    'evidenceHash: row.evidenceHash',
    'exactTarget: row.exactTarget',
    'secretReference: row.secretReference',
    'principalReference: row.principalReference',
    'requesterActorKind: row.requesterActorKind',
    'requiredAuthority: row.requiredAuthorityLevel',
    'uriReference: row.uriReference',
    'costMinorUnits: row.costMinorUnits',
    'computeUnits: row.computeUnits',
  ]) {
    assert.doesNotMatch(service, new RegExp(forbidden.replaceAll('.', '\\.'), 'u'));
  }
  assert.match(service, /mode: 'READ_ONLY'/u);
  assert.match(service, /status: 'NOT_CONFIGURED'/u);
  assert.match(service, /targets: \['CODEX', 'HERMES', 'PI'\]/u);
  assert.match(service, /\[\\p\{Cc\}\\p\{Cf\}\]/u);
});

test('Workflow Centre page has no mutation or approval-action surface', () => {
  assert.match(page, /serverApiFetch<WorkflowCentreSnapshot>\('\/workflow-centre'\)/u);
  assert.doesNotMatch(page, /\bapiFetch\b/u);
  assert.doesNotMatch(page, /<(?:button|form)\b/u);
  assert.doesNotMatch(page, /\b(?:approve|reject|hold|cancel|start|execute)\s*\(/iu);
  assert.match(page, /This page cannot start, cancel, approve, or execute work\./u);
});
