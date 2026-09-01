import { createInterface } from 'node:readline';

const mode = process.argv[2];
if (mode !== 'success' && mode !== 'unsafe-tool') process.exit(64);

const emit = (...messages) => {
  process.stdout.write(`${messages.map((message) => JSON.stringify(message)).join('\n')}\n`);
};

const fail = (reason) => {
  process.stderr.write(`fixture denied: ${reason}\n`);
  process.exitCode = 65;
  process.stdin.destroy();
};

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
lines.on('line', (line) => {
  try {
    const request = JSON.parse(line);
    if (request.method === 'initialize' && request.id === 1) {
      emit({
        id: 1,
        result: {
          userAgent: 'ventureos-deterministic-codex-fixture/1',
          platformFamily: process.platform === 'win32' ? 'windows' : 'unix',
          platformOs: process.platform,
        },
      });
      return;
    }
    if (request.method === 'initialized' && request.id === undefined) return;
    if (request.method === 'thread/start' && request.id === 2) {
      const restrictions = request.params;
      if (
        restrictions?.approvalPolicy !== 'never' ||
        restrictions?.ephemeral !== true ||
        restrictions?.sandbox !== 'read-only'
      ) {
        fail('thread restrictions');
        return;
      }
      emit({
        id: 2,
        result: {
          thread: {
            id: 'thr_composed_123',
            sessionId: 'session_composed_123',
            forkedFromId: null,
            parentThreadId: null,
            preview: '',
            ephemeral: true,
            section: null,
            sectionEnteredAt: null,
            projectId: null,
            historyMode: 'legacy',
            modelProvider: 'deterministic-fixture',
            createdAt: 1,
            updatedAt: 1,
            recencyAt: 1,
            status: { type: 'idle' },
            path: null,
            cwd: '/deterministic/read-only',
            cliVersion: '1.0.0',
            source: 'appServer',
            threadSource: null,
            agentNickname: null,
            agentRole: null,
            gitInfo: null,
            name: null,
            turns: [],
          },
          model: 'deterministic-model',
          modelProvider: 'deterministic-fixture',
          serviceTier: null,
          cwd: '/deterministic/read-only',
          instructionSources: [],
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          sandbox: { type: 'readOnly', networkAccess: false },
          reasoningEffort: 'low',
        },
      });
      return;
    }
    if (request.method === 'turn/start' && request.id === 3) {
      const restrictions = request.params;
      const text = restrictions?.input?.[0]?.text;
      const match =
        typeof text === 'string'
          ? /ventureos-validation:([A-Za-z0-9][A-Za-z0-9:._/-]{0,255})/u.exec(text)
          : null;
      if (
        restrictions?.approvalPolicy !== 'never' ||
        restrictions?.sandboxPolicy?.type !== 'readOnly' ||
        restrictions?.sandboxPolicy?.networkAccess !== false ||
        !match
      ) {
        fail('turn restrictions');
        return;
      }
      const token = `ventureos-validation:${match[1]}`;
      const item =
        mode === 'unsafe-tool'
          ? { type: 'commandExecution', id: 'item_unsafe', command: 'denied' }
          : { type: 'agentMessage', id: 'item_safe', text: token };
      emit(
        {
          id: 3,
          result: {
            turn: { id: 'turn_composed_456', status: 'inProgress', items: [], error: null },
          },
        },
        {
          method: 'turn/started',
          params: {
            threadId: 'thr_composed_123',
            turn: { id: 'turn_composed_456', status: 'inProgress', items: [], error: null },
          },
        },
        {
          method: 'item/started',
          params: {
            threadId: 'thr_composed_123',
            turnId: 'turn_composed_456',
            item,
          },
        },
        {
          method: 'turn/completed',
          params: {
            threadId: 'thr_composed_123',
            turn: { id: 'turn_composed_456', status: 'completed', items: [item], error: null },
          },
        },
      );
      return;
    }
    fail('unexpected request');
  } catch {
    fail('malformed request');
  }
});

lines.on('close', () => {
  if (process.exitCode === undefined) process.exitCode = 0;
});
