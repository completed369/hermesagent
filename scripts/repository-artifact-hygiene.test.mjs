import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyRawArtifactPath,
  findRawTrackedArtifacts,
} from './repository-artifact-hygiene.mjs';

const forbidden = [
  'validation-log.txt',
  'VALIDATION-LOG12.TXT',
  'nested/e2e-log-final.TxT',
  'phase3-build.log',
  'phase3-build.LOG.TXT',
  'archive/phase3-build.log.txt.bak',
  'archive/phase3-build.logtxt',
  'capture/runtime-logging.txt',
  'phase2-test-integration2.log.txtcd',
  'captures/worker.log.json',
  'CHAT_TRANSCRIPT.txt',
  'nested/chat-transcript-2.OUT',
  'nested/chat-transcriptfinal.txt',
  'nested\\CHAT_TRANSCRIPT.TXT',
  'buildlog.txt',
  'nested\\BUILDLOG.TXT',
  'chattranscript.txt',
  'build-log',
  'chat-transcript',
  'test-output.txt',
  'console-capture.txt',
  'unit-test-output.txt',
  'api-build-output.txt',
  'browser-console-capture.txt',
  'phase4-test-output.txt',
  'archive-chattranscript.txt',
  'reports-api-build-output',
  'archive-chattranscript',
  'build log.txt',
  'chat transcript.txt',
  'build-log (1).txt',
  'archive chat transcript (12).OUT',
];

test('rejects raw log and transcript variants without case, suffix, or extension bypasses', () => {
  for (const filePath of forbidden) {
    assert.notEqual(classifyRawArtifactPath(filePath), null, filePath);
  }
});

test('allows source files and curated dated documentation', () => {
  const allowed = [
    'docs/RELEASE_READINESS_2026-08-26.md',
    'docs/HISTORICAL_EVIDENCE_POLICY.md',
    'packages/observability/src/logger.ts',
    'apps/api/src/modules/audit/audit-log.service.ts',
    'catalog.txt',
    'docs/build-log.md',
    'packages/testing/src/test-output.ts',
    'apps/web/src/console-capture.tsx',
    'packages/contracts/src/chat-transcript.ts',
    'build-logger.txt',
    'contest-output.txt',
    'rebuild-output.txt',
    'chattranscription.txt',
    'contest output.txt',
    'build logger.txt',
    'docs/build log.md',
    'packages/testing/src/test output.ts',
    'scripts/repository-artifact-hygiene.test.mjs',
  ];

  assert.deepEqual(findRawTrackedArtifacts(allowed), []);
});

test('reports every forbidden path with a fixed classification', () => {
  assert.deepEqual(findRawTrackedArtifacts(forbidden), [
    { filePath: 'validation-log.txt', reason: 'raw execution log capture' },
    { filePath: 'VALIDATION-LOG12.TXT', reason: 'raw execution log capture' },
    { filePath: 'nested/e2e-log-final.TxT', reason: 'raw execution log capture' },
    { filePath: 'phase3-build.log', reason: 'raw execution log capture' },
    { filePath: 'phase3-build.LOG.TXT', reason: 'raw execution log capture' },
    {
      filePath: 'archive/phase3-build.log.txt.bak',
      reason: 'raw execution log capture',
    },
    {
      filePath: 'archive/phase3-build.logtxt',
      reason: 'raw execution log capture',
    },
    { filePath: 'capture/runtime-logging.txt', reason: 'raw execution log capture' },
    {
      filePath: 'phase2-test-integration2.log.txtcd',
      reason: 'raw execution log capture',
    },
    { filePath: 'captures/worker.log.json', reason: 'raw execution log capture' },
    { filePath: 'CHAT_TRANSCRIPT.txt', reason: 'raw transcript capture' },
    { filePath: 'nested/chat-transcript-2.OUT', reason: 'raw transcript capture' },
    {
      filePath: 'nested/chat-transcriptfinal.txt',
      reason: 'raw transcript capture',
    },
    { filePath: 'nested\\CHAT_TRANSCRIPT.TXT', reason: 'raw transcript capture' },
    { filePath: 'buildlog.txt', reason: 'raw execution log capture' },
    { filePath: 'nested\\BUILDLOG.TXT', reason: 'raw execution log capture' },
    { filePath: 'chattranscript.txt', reason: 'raw transcript capture' },
    { filePath: 'build-log', reason: 'raw execution log capture' },
    { filePath: 'chat-transcript', reason: 'raw transcript capture' },
    { filePath: 'test-output.txt', reason: 'raw execution log capture' },
    { filePath: 'console-capture.txt', reason: 'raw execution log capture' },
    { filePath: 'unit-test-output.txt', reason: 'raw execution log capture' },
    { filePath: 'api-build-output.txt', reason: 'raw execution log capture' },
    { filePath: 'browser-console-capture.txt', reason: 'raw execution log capture' },
    { filePath: 'phase4-test-output.txt', reason: 'raw execution log capture' },
    { filePath: 'archive-chattranscript.txt', reason: 'raw transcript capture' },
    { filePath: 'reports-api-build-output', reason: 'raw execution log capture' },
    { filePath: 'archive-chattranscript', reason: 'raw transcript capture' },
    { filePath: 'build log.txt', reason: 'raw execution log capture' },
    { filePath: 'chat transcript.txt', reason: 'raw transcript capture' },
    { filePath: 'build-log (1).txt', reason: 'raw execution log capture' },
    { filePath: 'archive chat transcript (12).OUT', reason: 'raw transcript capture' },
  ]);
});
