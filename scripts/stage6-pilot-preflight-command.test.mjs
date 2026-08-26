import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test(
  'the documented fixed-input preflight command runs from built workspace source',
  { skip: !process.env.npm_execpath },
  () => {
    const result = spawnSync(
      process.execPath,
      [process.env.npm_execpath, '--filter', '@ventureos/api', 'run', 'stage6:pilot-preflight'],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 600_000, windowsHide: true },
    );
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    const packetStart = result.stdout.lastIndexOf('\n{');
    assert.notEqual(packetStart, -1, result.stdout);
    const packet = JSON.parse(result.stdout.slice(packetStart + 1));
    assert.equal(packet.result, 'PREPARED_BLOCKED');
    assert.equal(packet.inputProvenance.reviewedFixtureDigestMatch, true);
    assert.equal(packet.inputProvenance.productionRunnerInputMode, 'FIXED_REVIEWED_FIXTURE');
    assert.deepEqual(packet.execution, {
      persistencePerformed: false,
      dispatchPerformed: false,
      contactPerformed: false,
      providerActivated: false,
    });
  },
);
