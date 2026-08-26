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
const faultMode = process.env.VENTUREOS_TEST_PROCESS_TREE_FAULT ?? 'NONE';
const keepAlive = setInterval(() => undefined, 1_000);
process.on('SIGTERM', () => undefined);

const descendants = [];
function shutdown(message) {
  if (message?.type !== 'FIXTURE_SHUTDOWN' || message.nonce !== nonce) return;
  for (const descendant of descendants) {
    if (descendant.connected) descendant.send(message);
  }
  clearInterval(keepAlive);
  setTimeout(() => process.exit(0), 50).unref();
}
process.on('message', shutdown);
process.on('disconnect', () => shutdown({ type: 'FIXTURE_SHUTDOWN', nonce }));

function emit(message) {
  if (faultMode === 'TIMEOUT') return;
  if (faultMode === 'OVERSIZE') {
    process.stdout.write('x'.repeat(5_000));
    return;
  }
  if (faultMode === 'MALFORMED') {
    process.stdout.write('{not-json}\n');
    return;
  }
  if (faultMode === 'EARLY_EXIT') {
    process.exit(70);
  }
  if (faultMode === 'MISMATCH_ROOT_PID' && message.type === 'tree_ready') {
    process.stdout.write(
      `${JSON.stringify({ ...message, rootPid: Number(process.env.VENTUREOS_TEST_MISMATCH_PID) })}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(message)}\n`);
  if (faultMode === 'ROOT_FIRST_EXIT' && message.type === 'tree_ready') {
    setTimeout(() => process.exit(0), 10).unref();
  }
}

if (role === 'leaf') {
  if (process.send)
    process.send({ type: 'FIXTURE_OWNERSHIP', nonce, rootPid: process.pid, pids: [process.pid] });
  emit({ type: 'leaf_ready', nonce, pid: process.pid });
} else if (role === 'child') {
  const grandchild = spawn(process.execPath, [fixturePath, 'leaf', nonce], {
    env: fixedEnvironment,
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  descendants.push(grandchild);
  grandchild.once('error', () => process.exit(70));
  emit({ type: 'child_ready', nonce, childPid: process.pid, grandchildPid: grandchild.pid });
} else {
  const child = spawn(process.execPath, [fixturePath, 'child', nonce], {
    env: fixedEnvironment,
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
    windowsHide: true,
  });
  descendants.push(child);
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
    if (process.send) {
      process.send({
        type: 'FIXTURE_OWNERSHIP',
        nonce,
        rootPid: process.pid,
        pids: [process.pid, message.childPid, message.grandchildPid],
      });
    }
    emit({
      type: 'tree_ready',
      nonce,
      rootPid: process.pid,
      childPid: message.childPid,
      grandchildPid: message.grandchildPid,
    });
    child.stdout.removeAllListeners('data');
  });
}

process.on('exit', () => clearInterval(keepAlive));
