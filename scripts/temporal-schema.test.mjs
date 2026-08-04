import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const schemaScript = resolve(import.meta.dirname, '..', 'deploy/private-staging/temporal/schema.sh');

const runMode = (mode) => {
  const directory = mkdtempSync(join(tmpdir(), 'ventureos-temporal-schema-'));
  try {
    const bin = join(directory, 'bin');
    const secrets = join(directory, 'secrets');
    const calls = join(directory, 'calls');
    mkdirSync(bin);
    mkdirSync(secrets);
    writeFileSync(join(secrets, 'postgres_temporal_password'), 'synthetic-temporal-password\n');
    const tool = join(bin, 'temporal-sql-tool');
    writeFileSync(tool, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CALLS_FILE"\n');
    chmodSync(tool, 0o755);

    const result = spawnSync('sh', [schemaScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
        CALLS_FILE: calls,
        TEMPORAL_SCHEMA_MODE: mode,
        VENTUREOS_SECRET_ROOT: secrets,
      },
    });
    return {
      result,
      calls: result.status === 0 ? readFileSync(calls, 'utf8').trim().split('\n') : [],
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('Temporal initialize performs setup then update for both schemas', () => {
  const { result, calls } = runMode('initialize');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((call) => call.includes('setup-schema -v 0.0')).length, 2);
  assert.equal(calls.filter((call) => call.includes('update-schema -d')).length, 2);
});

test('Temporal upgrade updates both schemas without rerunning setup', () => {
  const { result, calls } = runMode('upgrade');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 2);
  assert.equal(calls.some((call) => call.includes('setup-schema')), false);
  assert.equal(calls.every((call) => call.includes('update-schema -d')), true);
});

test('Temporal schema wrapper rejects unknown modes', () => {
  const { result } = runMode('unexpected');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be initialize or upgrade/);
});
