import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@ventureos/database';
import {
  buildApprovalDecisionMemoryWrite,
  buildBoardReviewMemoryWrite,
  captureApprovalDecisionMemory,
  captureBoardReviewMemory,
  MEMORY_CAPTURE_ACTOR,
  type CaptureApprovalDecisionMemoryInput,
  type CaptureBoardReviewMemoryInput,
} from '../memory-capture.js';
import type { MemoryRecord, MemoryStore, MemoryWrite } from '../memory.js';
import type { MemoryAtomicOrdering } from '../memory-store.js';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_WORKSPACE_ID = '99999999-9999-4999-8999-999999999999';
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333';
const PROPOSAL_VERSION_ID = '44444444-4444-4444-8444-444444444444';
const BOARD_REVIEW_ID = '55555555-5555-4555-8555-555555555555';
const DECISION_SUMMARY_ID = '66666666-6666-4666-8666-666666666666';
const APPROVAL_REQUEST_ID = '77777777-7777-4777-8777-777777777777';
const APPROVAL_DECISION_ID = '88888888-8888-4888-8888-888888888888';
const REVOKE_DECISION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMORY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REVOKE_MEMORY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function recordFrom(write: MemoryWrite, id: string): MemoryRecord {
  return {
    id,
    ...write,
    createdAt: new Date('2026-08-14T00:00:00Z'),
    updatedAt: new Date('2026-08-14T00:00:00Z'),
    supersededById: null,
    revokedAt: null,
  };
}

function decisionTime(record: Pick<MemoryRecord, 'payload' | 'createdAt'>): number {
  const decidedAt =
    typeof record.payload.decidedAt === 'string'
      ? new Date(record.payload.decidedAt).getTime()
      : Number.NaN;
  return Number.isFinite(decidedAt) ? decidedAt : record.createdAt.getTime();
}

function tieBreakRank(
  record: Pick<MemoryRecord, 'payload'>,
  ordering?: MemoryAtomicOrdering,
): number {
  const key = ordering?.tieBreak?.payloadKey;
  if (!key) return 0;
  return ordering.tieBreak?.rankByValue[String(record.payload[key])] ?? 0;
}

function compareMemoryOrder(
  replacement: Pick<MemoryRecord, 'payload' | 'createdAt'>,
  current: Pick<MemoryRecord, 'payload' | 'createdAt'>,
  ordering?: MemoryAtomicOrdering,
): number {
  const timeDelta = decisionTime(replacement) - decisionTime(current);
  if (timeDelta !== 0) return timeDelta;
  return tieBreakRank(replacement, ordering) - tieBreakRank(current, ordering);
}

function createStore(): MemoryStore & {
  records: MemoryRecord[];
  putMock: ReturnType<typeof vi.fn>;
  queryMock: ReturnType<typeof vi.fn>;
  supersedeMock: ReturnType<typeof vi.fn>;
} {
  const records: MemoryRecord[] = [];
  const store = {
    records,
    putMock: vi.fn(),
    queryMock: vi.fn(),
    supersedeMock: vi.fn(),
    async put(input: MemoryWrite) {
      store.putMock(input);
      const created = recordFrom(input, records.length === 0 ? MEMORY_ID : REVOKE_MEMORY_ID);
      records.unshift(created);
      return created;
    },
    async query(input: Parameters<MemoryStore['query']>[0]) {
      store.queryMock(input);
      return records.filter(
        (record) =>
          record.workspaceId === input.workspaceId &&
          !record.revokedAt &&
          !record.supersededById &&
          (!input.kinds || input.kinds.includes(record.kind)) &&
          (!input.subject || input.subject === record.subject) &&
          (!input.keys || input.keys.includes(record.key)),
      );
    },
    async revoke() {
      throw new Error('not used');
    },
    async supersede(
      workspaceId: string,
      memoryId: string,
      replacement: MemoryWrite,
      actorId: string,
    ) {
      store.supersedeMock(workspaceId, memoryId, replacement, actorId);
      const previous = records.find(
        (record) => record.workspaceId === workspaceId && record.id === memoryId,
      );
      if (!previous) throw new Error('Memory not found in workspace');
      const replacementRecord = recordFrom(replacement, REVOKE_MEMORY_ID);
      previous.supersededById = replacementRecord.id;
      records.unshift(replacementRecord);
      return { previous, replacement: replacementRecord };
    },
  } satisfies MemoryStore & {
    records: MemoryRecord[];
    putMock: ReturnType<typeof vi.fn>;
    queryMock: ReturnType<typeof vi.fn>;
    supersedeMock: ReturnType<typeof vi.fn>;
  };
  return store;
}

type AtomicTestStore = MemoryStore & {
  records: MemoryRecord[];
  putOrSupersedeActiveByKey: ReturnType<typeof vi.fn>;
};

function createAtomicStore(): AtomicTestStore {
  const records: MemoryRecord[] = [];
  let queue: Promise<void> = Promise.resolve();
  const queryRecords = (input: Parameters<MemoryStore['query']>[0]): MemoryRecord[] =>
    records.filter(
      (record) =>
        record.workspaceId === input.workspaceId &&
        !record.revokedAt &&
        !record.supersededById &&
        (!input.kinds || input.kinds.includes(record.kind)) &&
        (!input.subject || input.subject === record.subject) &&
        (!input.keys || input.keys.includes(record.key)),
    );

  const store: AtomicTestStore = {
    records,
    async put(input: MemoryWrite): Promise<MemoryRecord> {
      const created = recordFrom(input, records.length === 0 ? MEMORY_ID : REVOKE_MEMORY_ID);
      records.unshift(created);
      return created;
    },
    async query(input: Parameters<MemoryStore['query']>[0]): Promise<MemoryRecord[]> {
      return queryRecords(input);
    },
    async revoke(): Promise<MemoryRecord> {
      throw new Error('not used');
    },
    async supersede(): Promise<{ previous: MemoryRecord; replacement: MemoryRecord }> {
      throw new Error('fallback supersede should not be used');
    },
    putOrSupersedeActiveByKey: vi.fn(
      async (input: MemoryWrite, _actorId: string, ordering?: MemoryAtomicOrdering) => {
        const run = async (): Promise<{
          active: MemoryRecord;
          inserted: MemoryRecord;
          superseded: MemoryRecord[];
        }> => {
          const existing = queryRecords({
            workspaceId: input.workspaceId,
            kinds: [input.kind],
            subject: input.subject,
            keys: [input.key],
          });
          const currentActive = [...existing].sort((a, b) => compareMemoryOrder(b, a, ordering))[0];
          const replacement = recordFrom(
            input,
            records.length === 0 ? MEMORY_ID : REVOKE_MEMORY_ID,
          );
          if (!currentActive || compareMemoryOrder(replacement, currentActive, ordering) >= 0) {
            for (const record of existing) {
              record.supersededById = replacement.id;
            }
            records.unshift(replacement);
            return { active: replacement, inserted: replacement, superseded: existing };
          }
          replacement.supersededById = currentActive.id;
          records.unshift(replacement);
          return { active: currentActive, inserted: replacement, superseded: [replacement] };
        };
        const result = queue.then(run, run);
        queue = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    ),
  };
  return store;
}

const boardInput: Omit<CaptureBoardReviewMemoryInput, 'store'> = {
  boardReview: {
    id: BOARD_REVIEW_ID,
    workspaceId: WORKSPACE_ID,
    ventureProposalId: PROPOSAL_ID,
    ventureProposalVersionId: PROPOSAL_VERSION_ID,
    blocked: false,
    meetsThreshold: true,
  },
  decisionSummary: {
    id: DECISION_SUMMARY_ID,
    recommendation: 'APPROVE',
    overallConfidence: 0.82,
  },
};

const approvalInput: Omit<CaptureApprovalDecisionMemoryInput, 'store'> = {
  approvalRequest: {
    id: APPROVAL_REQUEST_ID,
    workspaceId: WORKSPACE_ID,
    ventureProposalId: PROPOSAL_ID,
    kind: 'VENTURE_PROPOSAL',
  },
  approvalDecision: {
    id: APPROVAL_DECISION_ID,
    decision: 'APPROVE',
    conditions: [],
    approvedAmountEur: new Prisma.Decimal(50),
    decidedAt: new Date('2026-08-14T12:00:00Z'),
    approvedArtifactVersionId: PROPOSAL_VERSION_ID,
  },
};

describe('governed workflow memory capture', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('builds an advisory board-review EPISODE record at the completed-review boundary', () => {
    expect(buildBoardReviewMemoryWrite(boardInput)).toEqual({
      workspaceId: WORKSPACE_ID,
      kind: 'EPISODE',
      subject: `venture-proposal:${PROPOSAL_ID}`,
      key: `board-review:${BOARD_REVIEW_ID}`,
      payload: {
        boardReviewId: BOARD_REVIEW_ID,
        ventureProposalId: PROPOSAL_ID,
        ventureProposalVersionId: PROPOSAL_VERSION_ID,
        decisionSummaryId: DECISION_SUMMARY_ID,
        blocked: false,
        meetsThreshold: true,
        recommendation: 'APPROVE',
        overallConfidence: 0.82,
      },
      sourceRef: `decision-summary:${DECISION_SUMMARY_ID}`,
      confidence: 1,
      sensitivity: 'INTERNAL',
      createdBy: MEMORY_CAPTURE_ACTOR,
    });
  });

  it('builds an advisory founder approval DECISION pointer with a stable approval-request key', () => {
    expect(buildApprovalDecisionMemoryWrite(approvalInput)).toMatchObject({
      workspaceId: WORKSPACE_ID,
      kind: 'DECISION',
      subject: `venture-proposal:${PROPOSAL_ID}`,
      key: `approval-request:${APPROVAL_REQUEST_ID}`,
      sourceRef: `approval-decision:${APPROVAL_DECISION_ID}`,
      confidence: 1,
      sensitivity: 'INTERNAL',
      createdBy: MEMORY_CAPTURE_ACTOR,
      payload: {
        approvalRequestId: APPROVAL_REQUEST_ID,
        approvalDecisionId: APPROVAL_DECISION_ID,
        kind: 'VENTURE_PROPOSAL',
        decision: 'APPROVE',
        conditions: [],
        approvedAmountEur: 50,
        decidedAt: '2026-08-14T12:00:00.000Z',
        approvedArtifactVersionId: PROPOSAL_VERSION_ID,
      },
    });
  });

  it('puts the first approval decision memory then supersedes it on revoke', async () => {
    const store = createStore();

    const approved = await captureApprovalDecisionMemory({ ...approvalInput, store });
    expect(approved?.payload).toMatchObject({ decision: 'APPROVE' });
    expect(store.putMock).toHaveBeenCalledTimes(1);
    expect(store.supersedeMock).not.toHaveBeenCalled();

    const revoked = await captureApprovalDecisionMemory({
      approvalRequest: approvalInput.approvalRequest,
      approvalDecision: {
        ...approvalInput.approvalDecision,
        id: REVOKE_DECISION_ID,
        decision: 'REVOKE',
        decidedAt: new Date('2026-08-14T13:00:00Z'),
      },
      store,
    });

    expect(revoked?.payload).toMatchObject({
      approvalDecisionId: REVOKE_DECISION_ID,
      decision: 'REVOKE',
    });
    expect(store.supersedeMock).toHaveBeenCalledWith(
      WORKSPACE_ID,
      approved?.id,
      expect.objectContaining({ key: `approval-request:${APPROVAL_REQUEST_ID}` }),
      MEMORY_CAPTURE_ACTOR,
    );
    const active = await store.query({
      workspaceId: WORKSPACE_ID,
      kinds: ['DECISION'],
      subject: `venture-proposal:${PROPOSAL_ID}`,
      keys: [`approval-request:${APPROVAL_REQUEST_ID}`],
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.payload).toMatchObject({ decision: 'REVOKE' });
    expect(store.records).toHaveLength(2);
    expect(store.records.find((record) => record.id === approved?.id)?.supersededById).toBe(
      revoked?.id,
    );
  });

  it('serializes concurrent APPROVE and REVOKE capture to one active approval-request memory', async () => {
    const store = createAtomicStore();

    const [approveResult, revokeResult] = await Promise.all([
      captureApprovalDecisionMemory({ ...approvalInput, store }),
      captureApprovalDecisionMemory({
        approvalRequest: approvalInput.approvalRequest,
        approvalDecision: {
          ...approvalInput.approvalDecision,
          id: REVOKE_DECISION_ID,
          decision: 'REVOKE',
          decidedAt: new Date('2026-08-14T13:00:00Z'),
        },
        store,
      }),
    ]);

    expect(approveResult?.payload).toMatchObject({ decision: 'APPROVE' });
    expect(revokeResult?.payload).toMatchObject({ decision: 'REVOKE' });

    const active = await store.query({
      workspaceId: WORKSPACE_ID,
      kinds: ['DECISION'],
      subject: `venture-proposal:${PROPOSAL_ID}`,
      keys: [`approval-request:${APPROVAL_REQUEST_ID}`],
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.payload).toMatchObject({ decision: 'REVOKE' });
    expect(store.records).toHaveLength(2);
    expect(
      store.records.find((record) => record.payload.decision === 'APPROVE')?.supersededById,
    ).toBe(active[0]?.id);
  });

  it('keeps equal-timestamp REVOKE active when it follows an APPROVE memory', async () => {
    const store = createAtomicStore();
    const equalDecidedAt = new Date('2026-08-14T12:00:00.000Z');

    const approved = await captureApprovalDecisionMemory({
      approvalRequest: approvalInput.approvalRequest,
      approvalDecision: { ...approvalInput.approvalDecision, decidedAt: equalDecidedAt },
      store,
    });
    const revoked = await captureApprovalDecisionMemory({
      approvalRequest: approvalInput.approvalRequest,
      approvalDecision: {
        ...approvalInput.approvalDecision,
        id: REVOKE_DECISION_ID,
        decision: 'REVOKE',
        decidedAt: equalDecidedAt,
      },
      store,
    });

    const active = await store.query({
      workspaceId: WORKSPACE_ID,
      kinds: ['DECISION'],
      subject: `venture-proposal:${PROPOSAL_ID}`,
      keys: [`approval-request:${APPROVAL_REQUEST_ID}`],
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(revoked?.id);
    expect(active[0]?.payload).toMatchObject({ decision: 'REVOKE' });
    expect(store.records.find((record) => record.id === approved?.id)?.supersededById).toBe(
      revoked?.id,
    );
  });

  it('keeps equal-timestamp REVOKE active when stale APPROVE capture arrives later', async () => {
    const store = createAtomicStore();
    const equalDecidedAt = new Date('2026-08-14T12:00:00.000Z');

    const revoked = await captureApprovalDecisionMemory({
      approvalRequest: approvalInput.approvalRequest,
      approvalDecision: {
        ...approvalInput.approvalDecision,
        id: REVOKE_DECISION_ID,
        decision: 'REVOKE',
        decidedAt: equalDecidedAt,
      },
      store,
    });
    const staleApproveResult = await captureApprovalDecisionMemory({
      approvalRequest: approvalInput.approvalRequest,
      approvalDecision: { ...approvalInput.approvalDecision, decidedAt: equalDecidedAt },
      store,
    });

    const active = await store.query({
      workspaceId: WORKSPACE_ID,
      kinds: ['DECISION'],
      subject: `venture-proposal:${PROPOSAL_ID}`,
      keys: [`approval-request:${APPROVAL_REQUEST_ID}`],
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(revoked?.id);
    expect(active[0]?.payload).toMatchObject({ decision: 'REVOKE' });
    expect(staleApproveResult?.id).toBe(revoked?.id);
    expect(
      store.records.find((record) => record.payload.decision === 'APPROVE')?.supersededById,
    ).toBe(revoked?.id);
  });

  it('does not cross workspace boundaries when looking for memory to supersede', async () => {
    const store = createStore();
    store.records.push(
      recordFrom(
        buildApprovalDecisionMemoryWrite({
          ...approvalInput,
          approvalRequest: { ...approvalInput.approvalRequest, workspaceId: OTHER_WORKSPACE_ID },
        }),
        MEMORY_ID,
      ),
    );

    await captureApprovalDecisionMemory({ ...approvalInput, store });

    expect(store.supersedeMock).not.toHaveBeenCalled();
    expect(store.putMock).toHaveBeenCalledTimes(1);
  });

  it('logs but swallows advisory capture failures', async () => {
    const failingStore: MemoryStore = {
      put: vi.fn().mockRejectedValue(new Error('memory unavailable')),
      query: vi.fn().mockRejectedValue(new Error('memory unavailable')),
      revoke: vi.fn(),
      supersede: vi.fn(),
    };

    await expect(captureBoardReviewMemory({ ...boardInput, store: failingStore })).resolves.toBe(
      null,
    );
    await expect(
      captureApprovalDecisionMemory({ ...approvalInput, store: failingStore }),
    ).resolves.toBe(null);

    expect(consoleSpy).toHaveBeenCalledTimes(2);
    expect(consoleSpy.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
      'memory capture failed',
    );
  });
});
