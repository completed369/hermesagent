import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourcePath = path.resolve('apps/api/src/cli/stage6-preapproval-operator.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

test('Stage 6 operator cannot decide founder approvals', () => {
  const forbidden = [
    'ApprovalsService',
    'decideApprovalRequest',
    "from '../modules/approvals",
    "from '@ventureos/agent-runtime'",
    'founderDecisionSignal',
    "approval:decide",
  ];

  for (const value of forbidden) {
    assert.equal(source.includes(value), false, `forbidden approval capability found: ${value}`);
  }

  assert.match(source, /result: 'FOUNDER_APPROVAL_REQUIRED'/);
  assert.match(source, /approval\.state !== 'PENDING'/);
});

test('Stage 6 operator uses authoritative service boundaries for mutations', () => {
  assert.match(source, /new OpportunitiesService\(auditService\)/);
  assert.match(source, /opportunitiesService\.create\(/);
  assert.match(source, /opportunitiesService\.assessCompliance\(/);
  assert.match(source, /opportunitiesService\.promote\(/);
  assert.match(source, /new BoardService\(auditService\)/);
  assert.match(source, /boardService\.startReview\(/);

  const directBusinessWrites = [
    /prisma\.opportunity\.create\(/,
    /prisma\.evidenceArtifact\.create\(/,
    /prisma\.evidenceClaim\.create\(/,
    /prisma\.ventureProposal\.create\(/,
    /prisma\.boardReview\.create\(/,
    /prisma\.approvalRequest\.create\(/,
    /prisma\.\$executeRaw/,
    /prisma\.\$queryRaw/,
  ];
  for (const pattern of directBusinessWrites) {
    assert.equal(pattern.test(source), false, `direct business-state write found: ${pattern}`);
  }
});
