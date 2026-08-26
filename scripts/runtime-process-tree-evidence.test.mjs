import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const fixturePath = fileURLToPath(
  new URL('./fixtures/runtime-process-tree-fixture.mjs', import.meta.url),
);
const windows = process.platform === 'win32';
const allowedFaults = new Set([
  'NONE',
  'EARLY_EXIT',
  'MALFORMED',
  'MISMATCH_ROOT_PID',
  'OVERSIZE',
  'ROOT_FIRST_EXIT',
  'TIMEOUT',
]);

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

function validatePids(pids, expectedRootPid) {
  assert.ok(Array.isArray(pids) && pids.length >= 1 && pids.length <= 3);
  assert.ok(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
  assert.equal(new Set(pids).size, pids.length);
  assert.equal(pids[0], expectedRootPid, 'fixture root PID must match the spawned handle');
  return Object.freeze([...pids]);
}

async function killOwnedTree(pids) {
  const [rootPid] = validatePids(pids, pids[0]);
  const livePids = pids.filter(alive);
  if (livePids.length === 0) return 'ALREADY_EXITED';
  if (windows) {
    for (const pid of [...livePids].reverse()) {
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
  if (pids.every((pid) => !alive(pid))) return 'GRACEFUL_TREE_TERMINATION';
  process.kill(-rootPid, 'SIGKILL');
  return 'ESCALATED_TREE_TERMINATION';
}

async function cleanup(resource) {
  if (!resource) return;
  if (resource.child.connected) {
    try {
      resource.child.send({ type: 'FIXTURE_SHUTDOWN', nonce: resource.nonce }, () => undefined);
    } catch {
      // The exact process may have exited between the connected check and send; bounded kill follows.
    }
  }
  await Promise.race([resource.exited, new Promise((resolve) => setTimeout(resolve, 250))]);
  const pids = resource.ownedPids ?? Object.freeze([resource.child.pid]);
  await killOwnedTree(pids);
  await waitUntil(() => pids.every((pid) => !alive(pid)), 5_000, 'owned fixture cleanup');
  await Promise.race([
    resource.exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('fixture root exit was not observed')), 1_000),
    ),
  ]);
}

function exactMessage(message, keys) {
  assert.equal(typeof message, 'object');
  assert.notEqual(message, null);
  assert.deepEqual(Object.keys(message).sort(), [...keys].sort());
}

async function launch(role, nonce, options = {}) {
  const fault = options.fault ?? 'NONE';
  assert.ok(role === 'root' || role === 'leaf');
  assert.ok(allowedFaults.has(fault));
  const environment = {
    VENTUREOS_TEST_PROCESS_TREE: '1',
    VENTUREOS_TEST_PROCESS_TREE_FAULT: fault,
  };
  if (fault === 'MISMATCH_ROOT_PID') {
    assert.ok(Number.isSafeInteger(options.mismatchPid) && options.mismatchPid > 0);
    environment.VENTUREOS_TEST_MISMATCH_PID = String(options.mismatchPid);
  }
  const child = spawn(process.execPath, [fixturePath, role, nonce], {
    detached: !windows,
    env: environment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  const resource = { child, exited: once(child, 'exit'), nonce, ownedPids: null };
  let ownershipError = null;
  options.onSpawn?.(child.pid);
  child.on('message', (message) => {
    if (
      message?.type !== 'FIXTURE_OWNERSHIP' ||
      message.nonce !== nonce ||
      message.rootPid !== child.pid
    )
      return;
    try {
      resource.ownedPids = validatePids(message.pids, child.pid);
      options.onOwnership?.(resource.ownedPids);
    } catch (error) {
      ownershipError = error;
    }
  });
  let buffered = '';
  child.stdout.setEncoding('utf8');
  try {
    const message = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('fixture handshake timed out')), 750);
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
    if (ownershipError) throw ownershipError;
    if (role === 'root') {
      exactMessage(message, ['type', 'nonce', 'rootPid', 'childPid', 'grandchildPid']);
      assert.equal(message.type, 'tree_ready');
      assert.equal(message.rootPid, child.pid, 'reported root PID must bind to spawned handle');
      resource.ownedPids = validatePids(
        [message.rootPid, message.childPid, message.grandchildPid],
        child.pid,
      );
    } else {
      exactMessage(message, ['type', 'nonce', 'pid']);
      assert.equal(message.type, 'leaf_ready');
      assert.equal(message.pid, child.pid, 'reported leaf PID must bind to spawned handle');
      resource.ownedPids = validatePids([message.pid], child.pid);
    }
    assert.equal(message.nonce, nonce);
    return { ...resource, message };
  } catch (error) {
    await cleanup(resource);
    throw error;
  }
}

test(
  'test-only supervisor evidence cancels one exact deterministic process tree',
  { timeout: 15_000 },
  async () => {
    const resources = [];
    try {
      const tree = await launch('root', `tree-${process.pid}-${Date.now()}`);
      resources.push(tree);
      const sentinel = await launch('leaf', `sentinel-${process.pid}-${Date.now()}`);
      resources.push(sentinel);
      assert.ok(tree.ownedPids.every(alive));
      const result = await killOwnedTree(tree.ownedPids);
      assert.ok(
        windows
          ? result === 'FIXTURE_DESCENDANTS_TERMINATED'
          : result === 'ESCALATED_TREE_TERMINATION',
      );
      await waitUntil(
        () => tree.ownedPids.every((pid) => !alive(pid)),
        5_000,
        'fixture tree cleanup',
      );
      assert.equal(alive(sentinel.message.pid), true, 'unrelated sentinel must survive');
      assert.equal(await killOwnedTree(tree.ownedPids), 'ALREADY_EXITED');
    } finally {
      for (const resource of resources.reverse()) await cleanup(resource);
    }
  },
);

test('root-first exit never skips live descendants', { timeout: 10_000 }, async () => {
  const tree = await launch('root', `root-first-${process.pid}-${Date.now()}`, {
    fault: 'ROOT_FIRST_EXIT',
  });
  await tree.exited;
  await cleanup(tree);
  assert.ok(tree.ownedPids.every((pid) => !alive(pid)));
});

test(
  'every handshake failure self-cleans its acquired fixture ownership',
  { timeout: 15_000 },
  async () => {
    for (const fault of ['EARLY_EXIT', 'MALFORMED', 'OVERSIZE', 'TIMEOUT']) {
      let spawnedPid;
      let ownedPids;
      await assert.rejects(
        launch('root', `failure-${fault}-${process.pid}-${Date.now()}`, {
          fault,
          onSpawn: (pid) => {
            spawnedPid = pid;
          },
          onOwnership: (pids) => {
            ownedPids = pids;
          },
        }),
      );
      assert.ok(Number.isSafeInteger(spawnedPid));
      assert.equal(alive(spawnedPid), false, `${fault} root must not survive failed setup`);
      if (ownedPids)
        assert.ok(
          ownedPids.every((pid) => !alive(pid)),
          `${fault} descendants must not survive`,
        );
    }
  },
);

test(
  'mismatched reported root PID cannot target an unrelated process',
  { timeout: 10_000 },
  async () => {
    const sentinel = await launch('leaf', `mismatch-sentinel-${process.pid}-${Date.now()}`);
    try {
      await assert.rejects(
        launch('root', `mismatch-root-${process.pid}-${Date.now()}`, {
          fault: 'MISMATCH_ROOT_PID',
          mismatchPid: sentinel.child.pid,
        }),
        /reported root PID must bind/u,
      );
      assert.equal(alive(sentinel.child.pid), true, 'mismatched PID must never be killed');
    } finally {
      await cleanup(sentinel);
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
