import { readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const SECRET_ENV_NAMES = Object.freeze([
  'DATABASE_URL',
  'AUTH_SECRET',
  'AUTH_ABUSE_DIGEST_SECRET',
  'ANTHROPIC_API_KEY',
  'MINIO_ROOT_PASSWORD',
  'DEV_FOUNDER_PASSWORD',
]);

const MAX_SECRET_BYTES = 64 * 1024;

export function applySecretFiles(environment = process.env) {
  for (const name of SECRET_ENV_NAMES) {
    const fileName = `${name}_FILE`;
    const filePath = environment[fileName];
    if (filePath === undefined) continue;
    if (environment[name] !== undefined) {
      throw new Error(`${name} and ${fileName} cannot both be set`);
    }

    const metadata = statSync(filePath);
    if (!metadata.isFile() || metadata.size > MAX_SECRET_BYTES) {
      throw new Error(`${fileName} must reference a regular file no larger than 64 KiB`);
    }
    const value = readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
    if (value.length === 0) {
      throw new Error(`${fileName} must not be empty`);
    }
    if (value.includes('\0')) {
      throw new Error(`${fileName} must not contain a NUL byte`);
    }

    environment[name] = value;
    delete environment[fileName];
  }

  const requiredRole = environment.VENTUREOS_REQUIRED_DATABASE_ROLE;
  if (requiredRole !== undefined) {
    if (!/^[a-z_][a-z0-9_]*$/.test(requiredRole)) {
      throw new Error('VENTUREOS_REQUIRED_DATABASE_ROLE must be a PostgreSQL identifier');
    }
    if (!environment.DATABASE_URL) {
      throw new Error('DATABASE_URL is required when a PostgreSQL role is enforced');
    }

    let databaseUrl;
    try {
      databaseUrl = new URL(environment.DATABASE_URL);
    } catch {
      throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
    }
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
      throw new Error('DATABASE_URL must use the postgres or postgresql protocol');
    }

    const requiredSetting = `role=${requiredRole}`;
    const optionTokens = databaseUrl.searchParams
      .getAll('options')
      .flatMap((options) => options.trim().split(/\s+/));
    const assumesRequiredRole = optionTokens.some(
      (token, index) => token === requiredSetting && optionTokens[index - 1] === '-c',
    );
    if (!assumesRequiredRole) {
      throw new Error(`DATABASE_URL must explicitly assume PostgreSQL role ${requiredRole}`);
    }
  }

  return environment;
}

function run() {
  const environment = applySecretFiles(process.env);
  const commandArguments = process.argv.slice(2);
  if (commandArguments[0] === '--') commandArguments.shift();
  const command = commandArguments.shift();
  if (!command) throw new Error('A runtime command is required');

  const child = spawn(command, commandArguments, {
    env: environment,
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('error', (error) => {
    console.error(`Unable to start runtime command: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) run();
