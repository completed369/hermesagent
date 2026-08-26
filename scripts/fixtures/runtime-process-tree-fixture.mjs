import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEST_MARKER = 'VENTUREOS_TEST_PROCESS_TREE';
if (process.env[TEST_MARKER] !== '1') {
  process.stderr.write('test-only process-tree fixture denied\n');
  process.exit(64);
}

const [role, nonce] = process.argv.slice(2);
if (!['root', 'child', 'leaf'].includes(role) || !/^[A-Za-z0-9._-]{8,80}$/u.test(nonce ?? '')) {
  process.stderr.write('invalid fixed fixture invocation\n');
  process.exit(64);
}

const fixturePath = fileURLToPath(import.meta.url);
const fixedEnvironment = { [TEST_MARKER]: '1' };
const keepAlive = setInterval(() => undefined, 1_000);
process.on('SIGTERM', () => undefined);

if (role === 'leaf') {
  process.stdout.write(`${JSON.stringify({ type: 'leaf_ready', nonce, pid: process.pid })}\n`);
} else if (role === 'child') {
  const grandchild = spawn(process.execPath, [fixturePath, 'leaf', nonce], {
    env: fixedEnvironment,
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  grandchild.once('error', () => process.exit(70));
  process.stdout.write(
    `${JSON.stringify({ type: 'child_ready', nonce, childPid: process.pid, grandchildPid: grandchild.pid })}\n`,
  );
} else {
  const child = spawn(process.execPath, [fixturePath, 'child', nonce], {
    env: fixedEnvironment,
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  child.once('error', () => process.exit(70));
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    if (Buffer.byteLength(buffered, 'utf8') > 2_048) process.exit(70);
    const newline = buffered.indexOf('\n');
    if (newline < 0) return;
    const message = JSON.parse(buffered.slice(0, newline));
    if (message.type !== 'child_ready' || message.nonce !== nonce) process.exit(70);
    process.stdout.write(
      `${JSON.stringify({
        type: 'tree_ready',
        nonce,
        rootPid: process.pid,
        childPid: message.childPid,
        grandchildPid: message.grandchildPid,
      })}\n`,
    );
    child.stdout.removeAllListeners('data');
  });
}

process.on('exit', () => clearInterval(keepAlive));
