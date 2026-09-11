import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const audit = vi.hoisted(() => vi.fn());
vi.mock('@ventureos/database', () => ({ hasAuditedCapabilityDispatch: audit }));
import { requestAnthropicResearch } from '../anthropic-research-provider.js';
import { ResearchProviderReceiptSchema } from '@ventureos/contracts';
const request = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  runId: 'research:one',
  instruction: 'Compare customer problems and propose a small experiment.',
  model: 'claude-test-model',
  maximumOutputTokens: 1000,
  maximumSearches: 2,
  maximumComputeUnits: 5000,
};
const secret = 'synthetic_test_secret_not_a_real_key';
function fixture() {
  const sources = ['https://example.com/report', 'https://example.org/data'].map((url, i) => ({
    type: 'web_search_result',
    url,
    title: `Source ${i}`,
    encrypted_content: 'opaque-private-state',
    page_age: '2026-09-01',
  }));
  return {
    id: 'msg_synthetic',
    type: 'message',
    role: 'assistant',
    model: request.model,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      inference_geo: 'global',
      service_tier: 'standard',
      output_tokens_details: { thinking_tokens: 0 },
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
    },
    content: [
      {
        type: 'server_tool_use',
        id: 'search_one',
        name: 'web_search',
        input: { query: 'synthetic buyer research' },
      },
      { type: 'web_search_tool_result', tool_use_id: 'search_one', content: sources },
      {
        type: 'text',
        text: 'Hypothesis: test demand before investing. These sources require verification.',
        citations: sources.map((s) => ({
          type: 'web_search_result_location',
          url: s.url,
          title: s.title,
          cited_text: 'Short supporting excerpt',
          encrypted_index: 'opaque-index',
        })),
      },
    ],
  };
}
const send = vi.fn();
const claim = vi.fn();
function respond(value: unknown = fixture()) {
  send.mockResolvedValue(new Response(JSON.stringify(value)));
}
async function run(value: unknown = fixture()) {
  respond(value);
  return requestAnthropicResearch(request, secret, claim);
}
describe('bounded Anthropic research transport (synthetic responses only)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', 'production');
    vi.stubGlobal('fetch', send);
    audit.mockReturnValue(true);
    claim.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllEnvs());
  it('claims the bound request before one fixed, non-streaming request and returns only an unverified receipt', async () => {
    send.mockImplementation(async () => {
      expect(claim).toHaveBeenCalledOnce();
      return new Response(JSON.stringify(fixture()));
    });
    const receipt = await requestAnthropicResearch(request, secret, claim);
    expect(receipt.state).toBe('AWAITING_VERIFICATION');
    expect(ResearchProviderReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(receipt.usage).toMatchObject({ inputTokens: 100, outputTokens: 200, searches: 1 });
    expect(receipt.segments[0]?.citations).toHaveLength(2);
    expect(send).toHaveBeenCalledOnce();
    const [url, options] = send.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'x-api-key': secret },
    });
    expect(JSON.parse(options.body)).toMatchObject({
      model: request.model,
      max_tokens: 1000,
      stream: false,
      tools: [{ type: 'web_search_20250305', max_uses: 2, allowed_callers: ['direct'] }],
    });
    expect(Object.isFrozen(claim.mock.calls[0]![0])).toBe(true);
    for (const privateValue of [
      secret,
      'opaque-index',
      'opaque-private-state',
      'synthetic buyer research',
    ])
      expect(JSON.stringify(receipt)).not.toContain(privateValue);
  });
  it.each(['staging', 'development', ''])(
    'denies %s before any claim or HTTP request',
    async (environment) => {
      vi.stubEnv('DEPLOYMENT_ENVIRONMENT', environment);
      await expect(requestAnthropicResearch(request, secret, claim)).rejects.toThrow(
        'audited production',
      );
      expect(claim).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );
  it.each([0, 1])('requires both capability audits (missing %s)', async (missing) => {
    audit.mockImplementationOnce(() => missing !== 0).mockImplementationOnce(() => missing !== 1);
    await expect(requestAnthropicResearch(request, secret, claim)).rejects.toThrow(
      'audited production',
    );
    expect(send).not.toHaveBeenCalled();
  });
  it('does not send when the durable reservation/claim fails', async () => {
    claim.mockRejectedValue(new Error('paused'));
    await expect(requestAnthropicResearch(request, secret, claim)).rejects.toThrow('paused');
    expect(send).not.toHaveBeenCalled();
  });
  it('binds workspace, run and compute ceiling into the authorization digest', async () => {
    respond();
    await requestAnthropicResearch(request, secret, claim);
    const original = claim.mock.calls[0]![0].requestDigest;
    for (const patch of [
      { maximumComputeUnits: 4999 },
      { runId: 'research:two' },
      { workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]) {
      await requestAnthropicResearch({ ...request, ...patch }, secret, claim);
      expect(claim.mock.lastCall![0].requestDigest).not.toBe(original);
    }
  });
  it.each(['pause_turn', 'max_tokens', 'tool_use', 'refusal'])(
    'never continues %s',
    async (stop_reason) => {
      const receipt = await run({ ...fixture(), stop_reason });
      expect(receipt).toMatchObject({
        state: 'REJECTED',
        reason: 'INCOMPLETE_TURN',
        usage: { outputTokens: 200 },
      });
      expect(send).toHaveBeenCalledOnce();
    },
  );
  it('rejects citations that are not returned by search and retains usage', async () => {
    const value = fixture();
    value.content[2]!.citations![0]!.url = 'https://forged.example.com/report';
    expect(await run(value)).toMatchObject({
      state: 'REJECTED',
      reason: 'INVALID_RESPONSE',
      usage: { searches: 1 },
      segments: [],
    });
  });
  it('requires two distinct cited sources', async () => {
    const value = fixture();
    value.content[2]!.citations!.pop();
    expect(await run(value)).toMatchObject({ reason: 'INSUFFICIENT_SOURCES' });
  });
  it('rejects unsupported client tools without hiding usage', async () => {
    expect(
      await run({ ...fixture(), content: [{ type: 'tool_use', name: 'shell', input: {} }] }),
    ).toMatchObject({ state: 'REJECTED', usage: { outputTokens: 200 } });
  });
  it('recognizes HTTP 200 search errors', async () => {
    const value = fixture();
    expect(
      await run({
        ...value,
        content: [
          value.content[0],
          {
            type: 'web_search_tool_result',
            tool_use_id: 'search_one',
            content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' },
          },
        ],
      }),
    ).toMatchObject({ reason: 'SEARCH_ERROR' });
  });
  it.each(['http', 'transport', 'oversized'])(
    'retains uncertain liability on %s errors without retries',
    async (kind) => {
      if (kind === 'http') send.mockResolvedValue(new Response(secret, { status: 429 }));
      if (kind === 'transport') send.mockRejectedValue(new Error(secret));
      if (kind === 'oversized') send.mockResolvedValue(new Response('x'.repeat(512 * 1024 + 1)));
      const receipt = await requestAnthropicResearch(request, secret, claim);
      expect(receipt).toMatchObject({ state: 'OUTCOME_UNKNOWN', usage: null });
      expect(send).toHaveBeenCalledOnce();
      expect(JSON.stringify(receipt)).not.toContain(secret);
    },
  );
  it('retains known usage but rejects unknown billing dimensions', async () => {
    const value = fixture();
    expect(
      await run({ ...value, usage: { ...value.usage, new_billable_resource: 3 } }),
    ).toMatchObject({ reason: 'USAGE_REVIEW_REQUIRED', usage: { inputTokens: 100 } });
  });
  it.each([{ webFetches: true }, { geo: true }, { cache: true }])(
    'requires review of unexpected charge modes: %j',
    async (mode) => {
      const value = fixture();
      if ('webFetches' in mode) value.usage.server_tool_use.web_fetch_requests = 1;
      if ('geo' in mode) value.usage.inference_geo = 'us';
      if ('cache' in mode) value.usage.cache_creation_input_tokens = 1;
      expect(await run(value)).toMatchObject({ reason: 'USAGE_REVIEW_REQUIRED' });
    },
  );
  it('retains over-limit usage for reconciliation', async () => {
    const value = fixture();
    value.usage.output_tokens = 1001;
    expect(await run(value)).toMatchObject({
      state: 'REJECTED',
      reason: 'LIMIT_EXCEEDED',
      usage: { outputTokens: 1001 },
    });
  });
  it.each([null, { input_tokens: -1 }, { input_tokens: Number.MAX_SAFE_INTEGER + 1 }])(
    'never fabricates missing or invalid usage: %j',
    async (usage) => {
      expect(await run({ ...fixture(), usage })).toMatchObject({ state: 'REJECTED', usage: null });
    },
  );
});
