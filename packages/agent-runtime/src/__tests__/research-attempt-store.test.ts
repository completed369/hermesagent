import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  finance: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@ventureos/database', async (original) => ({
  ...(await original<typeof import('@ventureos/database')>()),
  hasAuditedCapabilityDispatch: mocks.audit,
  prisma: { $transaction: mocks.transaction },
}));
vi.mock('@ventureos/finance-engine', () => ({
  assertBusinessExecutionInTransaction: mocks.finance,
}));
import { claimResearchAttempt, recordResearchReceipt } from '../research-attempt-store.js';
const input = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  runId: 'research:one',
  requestDigest: 'a'.repeat(64),
  commitmentId: 'research:cost',
  expectedRunVersion: 3,
};
const key = 'b'.repeat(64);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const receipt = {
  schemaVersion: 1 as const,
  provider: 'anthropic' as const,
  workspaceId: input.workspaceId,
  runId: input.runId,
  requestDigest: input.requestDigest,
  requestedModel: 'claude-test-model',
  reportedModel: null,
  responseDigest: null,
  providerMessageId: null,
  observedAt: '2026-09-13T10:00:00.000Z',
  state: 'OUTCOME_UNKNOWN' as const,
  reason: 'TRANSPORT_ERROR' as const,
  usage: null,
  segments: [],
};
describe('research execution journal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', 'production');
    mocks.audit.mockReturnValue(true);
    mocks.transaction.mockImplementation((fn) =>
      fn({ $queryRaw: mocks.query, $executeRaw: mocks.execute }),
    );
    mocks.query.mockResolvedValue([{ eligible: true }]);
    mocks.finance.mockResolvedValue(undefined);
    mocks.execute.mockResolvedValue(1);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('claims only after run and reservation checks, storing a hash instead of the receipt key', async () => {
    const claim = await claimResearchAttempt(input);
    expect(claim.receiptKey).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(claim)).toBe(true);
    expect(mocks.finance).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenCalledTimes(2);
    const sql = mocks.execute.mock.calls[0]![0];
    expect(sql.values).toContain(hash(claim.receiptKey));
    expect(sql.values).not.toContain(claim.receiptKey);
  });
  it.each(['staging', 'development'])('denies %s without database access', async (env) => {
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', env);
    await expect(claimResearchAttempt(input)).rejects.toThrow('audited');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('denies missing capability audit before creating a claim', async () => {
    mocks.audit.mockReturnValue(false);
    await expect(claimResearchAttempt(input)).rejects.toThrow('audited');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('denies paused spending before run checks', async () => {
    mocks.finance.mockRejectedValue(new Error('paused'));
    await expect(claimResearchAttempt(input)).rejects.toThrow('paused');
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each([0, 1])('denies a failed run/reservation check %s', async (index) => {
    mocks.query
      .mockResolvedValueOnce([{ eligible: index !== 0 }])
      .mockResolvedValueOnce([{ eligible: index !== 1 }]);
    await expect(claimResearchAttempt(input)).rejects.toThrow();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('does not turn duplicate claim rejection into a resend permission', async () => {
    mocks.execute.mockRejectedValue(new Error('duplicate claim'));
    await expect(claimResearchAttempt(input)).rejects.toThrow('duplicate');
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  function acceptedAttempt() {
    mocks.query
      .mockResolvedValueOnce([{ request_digest: input.requestDigest, receipt_key_hash: hash(key) }])
      .mockResolvedValueOnce([]);
  }
  it('records unknown outcomes after pause without authorizing work or releasing funds', async () => {
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', 'staging');
    mocks.audit.mockReturnValue(false);
    acceptedAttempt();
    const ref = await recordResearchReceipt(receipt, key);
    expect(ref).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.finance).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0]![0].strings.join('')).toContain(
      'INSERT INTO business_research_receipts',
    );
  });
  it.each(['missing', 'digest', 'key'])('rejects %s claim binding', async (kind) => {
    mocks.query.mockResolvedValueOnce(
      kind === 'missing'
        ? []
        : [
            {
              request_digest: kind === 'digest' ? 'c'.repeat(64) : input.requestDigest,
              receipt_key_hash: kind === 'key' ? hash('c'.repeat(64)) : hash(key),
            },
          ],
    );
    await expect(recordResearchReceipt(receipt, key)).rejects.toThrow('does not match');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('scopes both lookups to the receipt workspace and run', async () => {
    acceptedAttempt();
    await recordResearchReceipt(receipt, key);
    for (const [query] of mocks.query.mock.calls) {
      expect(query.values).toContain(input.workspaceId);
      expect(query.values).toContain(input.runId);
    }
  });
  it('recovers an identical save replay without another write', async () => {
    acceptedAttempt();
    const ref = await recordResearchReceipt(receipt, key);
    mocks.execute.mockClear();
    mocks.query
      .mockResolvedValueOnce([{ request_digest: input.requestDigest, receipt_key_hash: hash(key) }])
      .mockResolvedValueOnce([{ receipt_digest: ref }]);
    expect(await recordResearchReceipt(receipt, key)).toBe(ref);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('rejects conflicting saved outcomes', async () => {
    mocks.query
      .mockResolvedValueOnce([{ request_digest: input.requestDigest, receipt_key_hash: hash(key) }])
      .mockResolvedValueOnce([{ receipt_digest: 'c'.repeat(64) }]);
    await expect(recordResearchReceipt(receipt, key)).rejects.toThrow('conflicts');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
