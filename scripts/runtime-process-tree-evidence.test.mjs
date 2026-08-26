import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const fixturePath = fileURLToPath(
  new URL('./fixtures/runtime-process-tree-fixture.mjs', import.meta.url),
);
const fixedEnvironment = { VENTUREOS_TEST_PROCESS_TREE: '1' };
const windows = process.platform === 'win32';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function killTree(pids) {
  if (
    !Array.isArray(pids) ||
    pids.length < 1 ||
    pids.some((pid) => !Number.isSafeInteger(pid) || pid < 1)
  )
    throw new Error('invalid fixed fixture pid set');
  const [rootPid] = pids;
  if (!alive(rootPid)) return 'ALREADY_EXITED';
  if (windows) {
    for (const pid of [...pids].reverse()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
    return 'FIXTURE_DESCENDANTS_TERMINATED';
  }
  process.kill(-rootPid, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (!alive(rootPid)) return 'GRACEFUL_TREE_TERMINATION';
  process.kill(-rootPid, 'SIGKILL');
  return 'ESCALATED_TREE_TERMINATION';
}

async function launch(role, nonce) {
  const child = spawn(process.execPath, [fixturePath, role, nonce], {
    detached: !windows,
    env: fixedEnvironment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const exited = once(child, 'exit');
  let buffered = '';
  child.stdout.setEncoding('utf8');
  const message = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('fixture handshake timed out')), 5_000);
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`fixture exited before handshake: ${code}`)));
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      if (Buffer.byteLength(buffered, 'utf8') > 4_096) {
        clearTimeout(timeout);
        reject(new Error('fixture handshake exceeded bound'));
        return;
      }
      const newline = buffered.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(buffered.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
  });
  assert.equal(message.nonce, nonce);
  return { child, exited, message };
}

test(
  'test-only supervisor evidence cancels one exact deterministic process tree',
  { timeout: 15_000 },
  async () => {
    const nonce = `tree-${process.pid}-${Date.now()}`;
    const sentinelNonce = `sentinel-${process.pid}-${Date.now()}`;
    const tree = await launch('root', nonce);
    const sentinel = await launch('leaf', sentinelNonce);
    const pids = [tree.message.rootPid, tree.message.childPid, tree.message.grandchildPid];
    try {
      assert.equal(tree.message.type, 'tree_ready');
      assert.equal(sentinel.message.type, 'leaf_ready');
      assert.ok(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
      assert.ok(pids.every(alive));

      const result = await killTree(pids);
      assert.ok(
        windows
          ? result === 'FIXTURE_DESCENDANTS_TERMINATED'
          : result === 'ESCALATED_TREE_TERMINATION',
      );
      await waitUntil(() => pids.every((pid) => !alive(pid)), 5_000, 'fixture tree cleanup');
      assert.equal(alive(sentinel.message.pid), true, 'unrelated sentinel must survive');
      assert.equal(await killTree(pids), 'ALREADY_EXITED');
    } finally {
      if (alive(tree.message.rootPid)) await killTree(pids).catch(() => undefined);
      if (alive(sentinel.message.pid))
        await killTree([sentinel.message.pid]).catch(() => undefined);
      await Promise.allSettled([tree.exited, sentinel.exited]);
    }
  },
);

test('test-only fixture refuses ambient or arbitrary invocation', { timeout: 5_000 }, async () => {
  const denied = spawn(process.execPath, [fixturePath, 'leaf', 'nonce-fixture'], {
    env: {},
    shell: false,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  const [code] = await once(denied, 'exit');
  assert.equal(code, 64);
});
