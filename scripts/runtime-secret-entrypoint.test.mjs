import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applySecretFiles } from './runtime-secret-entrypoint.mjs';

const withSecretDirectory = (run) => {
  const directory = mkdtempSync(join(tmpdir(), 'ventureos-secret-adapter-'));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('runtime secret adapter reads supported Docker secret files and trims one trailing newline', () =>
  withSecretDirectory((directory) => {
    const database = join(directory, 'database-url');
    const auth = join(directory, 'auth-secret');
    writeFileSync(database, 'postgresql://synthetic.invalid/app\n', { mode: 0o600 });
    writeFileSync(auth, 'synthetic-auth-value\r\n', { mode: 0o600 });

    const environment = {
      DATABASE_URL_FILE: database,
      AUTH_SECRET_FILE: auth,
    };

    applySecretFiles(environment);

    assert.equal(environment.DATABASE_URL, 'postgresql://synthetic.invalid/app');
    assert.equal(environment.AUTH_SECRET, 'synthetic-auth-value');
    assert.equal(environment.DATABASE_URL_FILE, undefined);
    assert.equal(environment.AUTH_SECRET_FILE, undefined);
  }));

test('runtime secret adapter fails closed when direct and file values conflict', () =>
  withSecretDirectory((directory) => {
    const secret = join(directory, 'auth-secret');
    writeFileSync(secret, 'synthetic-file-value', { mode: 0o600 });
    const environment = {
      AUTH_SECRET: 'synthetic-direct-value',
      AUTH_SECRET_FILE: secret,
    };

    assert.throws(() => applySecretFiles(environment), /AUTH_SECRET and AUTH_SECRET_FILE/);
    assert.equal(environment.AUTH_SECRET, 'synthetic-direct-value');
  }));

test('runtime secret adapter rejects empty files without exposing their contents', () =>
  withSecretDirectory((directory) => {
    const secret = join(directory, 'auth-secret');
    writeFileSync(secret, '', { mode: 0o600 });

    assert.throws(() => applySecretFiles({ AUTH_SECRET_FILE: secret }), /must not be empty/);
  }));

test('runtime secret adapter leaves unrelated standard *_FILE variables untouched', () => {
  const environment = { SSL_CERT_FILE: '/etc/ssl/certs/custom.pem' };
  assert.deepEqual(applySecretFiles(environment), environment);
});

test('runtime secret adapter enforces the required PostgreSQL migration role', () => {
  const valid = {
    DATABASE_URL:
      'postgresql://migrator:synthetic@postgres/ventureos?options=-c%20role%3Dventureos_owner',
    VENTUREOS_REQUIRED_DATABASE_ROLE: 'ventureos_owner',
  };
  assert.equal(applySecretFiles(valid), valid);

  assert.throws(
    () =>
      applySecretFiles({
        DATABASE_URL: 'postgresql://migrator:synthetic@postgres/ventureos',
        VENTUREOS_REQUIRED_DATABASE_ROLE: 'ventureos_owner',
      }),
    /must explicitly assume PostgreSQL role ventureos_owner/,
  );
});
