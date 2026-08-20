import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const API_BASE = 'http://127.0.0.1:3001/api';
const repositoryRoot = resolve(import.meta.dirname, '..');
const RESULT_FILE = join(repositoryRoot, '.staging', 'load-results.json');
const WEB_ORIGIN = validateWebOrigin(
  process.env.STAGING_LOAD_WEB_ORIGIN ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000',
);
const EMAIL = process.env.STAGING_FOUNDER_EMAIL ?? process.env.DEV_FOUNDER_EMAIL;
const PASSWORD = process.env.STAGING_FOUNDER_PASSWORD ?? process.env.DEV_FOUNDER_PASSWORD;
const RATE_LIMIT_SETTLE_MS = 65_000;
const CANONICAL_OPPORTUNITY_TITLE = 'Social Media Content Planning Kit';

if (!EMAIL || !PASSWORD) throw new Error('Synthetic staging founder credentials are required');

function validateWebOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Synthetic staging web origin must be a valid URL');
  }
  if (
    parsed.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    parsed.port !== '3000' ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('Synthetic staging web origin must be loopback HTTP on port 3000');
  }
  return parsed.origin;
}

const encodePathSegment = (value) => encodeURIComponent(String(value));

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? 0
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchTimed(path, options = {}) {
  const started = performance.now();
  const response = await fetch(`${API_BASE}${path}`, {
    signal: AbortSignal.timeout(15_000),
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body, durationMs: performance.now() - started };
}

async function runConcurrent(name, count, concurrency, operation, validateStatus) {
  const durations = [];
  const statuses = new Map();
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= count) return;
      const result = await operation(index);
      durations.push(result.durationMs);
      statuses.set(result.response.status, (statuses.get(result.response.status) ?? 0) + 1);
      if (!validateStatus(result.response.status, result.body)) {
        throw new Error(`${name} returned unexpected HTTP ${result.response.status}`);
      }
    }
  });
  await Promise.all(workers);
  const summary = {
    name,
    requests: count,
    concurrency,
    statuses: Object.fromEntries([...statuses.entries()].sort(([a], [b]) => a - b)),
    p50Ms: Math.round(percentile(durations, 50)),
    p95Ms: Math.round(percentile(durations, 95)),
    maxMs: Math.round(Math.max(...durations)),
  };
  console.log(`LOAD ${name}: ${JSON.stringify(summary)}`);
  return summary;
}

if (RATE_LIMIT_SETTLE_MS > 0) {
  console.log(`LOAD settling rate-limit window for ${RATE_LIMIT_SETTLE_MS}ms`);
  await sleep(RATE_LIMIT_SETTLE_MS);
}

const login = await fetchTimed('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (login.response.status !== 200) {
  throw new Error(`Synthetic founder login failed: ${login.response.status}`);
}
const setCookie = login.response.headers.get('set-cookie');
if (!setCookie) throw new Error('Login did not return a session cookie');
const cookie = setCookie.split(';', 1)[0];
const authHeaders = { cookie };
// Cookie-authenticated unsafe requests are protected by the same global
// same-origin guard used by the browser. Model a legitimate browser request
// rather than weakening/bypassing CSRF protection for the load test.
const authMutationHeaders = { cookie, origin: WEB_ORIGIN };

const results = [];
results.push(
  await runConcurrent(
    'api-liveness',
    20,
    20,
    () => fetchTimed('/health/live'),
    (status) => status === 200,
  ),
);
results.push(
  await runConcurrent(
    'authenticated-workspace-read',
    20,
    20,
    () => fetchTimed('/workspaces/current', { headers: authHeaders }),
    (status) => status === 200,
  ),
);

// Earlier integration suites are free to create/delete other opportunities.
// Always target the canonical seeded opportunity instead of relying on list
// ordering, and reuse its proposal if it survived integration cleanup.
const ventures = await fetchTimed('/ventures', { headers: authHeaders });
if (ventures.response.status !== 200 || !Array.isArray(ventures.body)) {
  throw new Error(`Workspace ventures are unavailable: ${ventures.response.status}`);
}
const canonicalVenture = ventures.body.find(
  (venture) => venture?.opportunity?.title === CANONICAL_OPPORTUNITY_TITLE,
);
let proposalId = canonicalVenture?.id ?? null;

if (!proposalId) {
  const opportunities = await fetchTimed('/opportunities', { headers: authHeaders });
  if (opportunities.response.status !== 200 || !Array.isArray(opportunities.body)) {
    throw new Error(`Opportunities are unavailable: ${opportunities.response.status}`);
  }
  const opportunity = opportunities.body.find(
    (item) => item?.title === CANONICAL_OPPORTUNITY_TITLE,
  );
  if (!opportunity?.id) throw new Error('Canonical seeded opportunity is unavailable');
  const promotion = await fetchTimed(
    `/opportunities/${encodePathSegment(opportunity.id)}/promote`,
    {
      method: 'POST',
      headers: authMutationHeaders,
    },
  );
  if (![200, 201].includes(promotion.response.status) || !promotion.body?.proposal?.id) {
    throw new Error(`Opportunity promotion failed: ${promotion.response.status}`);
  }
  proposalId = promotion.body.proposal.id;
}

const encodedProposalId = encodePathSegment(proposalId);
const reviewsBefore = await fetchTimed(`/venture-proposals/${encodedProposalId}/board-reviews`, {
  headers: authHeaders,
});
if (reviewsBefore.response.status !== 200 || !Array.isArray(reviewsBefore.body)) {
  throw new Error(`Existing board reviews are unavailable: ${reviewsBefore.response.status}`);
}
const completedBefore = reviewsBefore.body.filter((review) => review.status === 'COMPLETED').length;
const completedTarget = completedBefore + 20;

results.push(
  await runConcurrent(
    'board-review-start',
    20,
    20,
    () =>
      fetchTimed(`/venture-proposals/${encodedProposalId}/board-reviews`, {
        method: 'POST',
        headers: authMutationHeaders,
      }),
    (status) => status === 200 || status === 201,
  ),
);

let completedReviews = completedBefore;
const reviewDeadline = Date.now() + 120_000;
while (Date.now() < reviewDeadline) {
  const reviews = await fetchTimed(`/venture-proposals/${encodedProposalId}/board-reviews`, {
    headers: authHeaders,
  });
  if (reviews.response.status === 200 && Array.isArray(reviews.body)) {
    completedReviews = reviews.body.filter((review) => review.status === 'COMPLETED').length;
    if (completedReviews >= completedTarget) break;
  }
  await sleep(1000);
}
const newlyCompletedReviews = completedReviews - completedBefore;
if (newlyCompletedReviews < 20) {
  throw new Error(`Only ${newlyCompletedReviews}/20 new board reviews completed within 120s`);
}

const contracts = await fetchTimed('/research/contracts', { headers: authHeaders });
if (
  contracts.response.status !== 200 ||
  !Array.isArray(contracts.body) ||
  contracts.body.length === 0
) {
  throw new Error('Research contracts are unavailable for load testing');
}
const contract =
  contracts.body.find(
    (item) => !item.disabled && item.rateLimitPerMinute == null && item.rateLimitPerDay == null,
  ) ?? null;
if (!contract?.id) {
  throw new Error('No uncapped synthetic research contract is available for load testing');
}

results.push(
  await runConcurrent(
    'research-acquisition',
    20,
    20,
    () =>
      fetchTimed(`/research/contracts/${encodePathSegment(contract.id)}/run`, {
        method: 'POST',
        headers: authMutationHeaders,
      }),
    (status, body) =>
      (status === 200 || status === 201) &&
      body &&
      typeof body.status === 'string' &&
      !body.status.startsWith('BLOCKED_') &&
      body.status !== 'FAILED',
  ),
);

const report = {
  generatedAt: new Date().toISOString(),
  apiBase: API_BASE,
  webOrigin: WEB_ORIGIN,
  boardReviewsCompletedBefore: completedBefore,
  boardReviewsCompletedAfter: completedReviews,
  boardReviewsNewlyCompleted: newlyCompletedReviews,
  researchContract: contract.name ?? contract.id,
  results,
};
mkdirSync(dirname(RESULT_FILE), { recursive: true });
writeFileSync(RESULT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const thresholds = {
  'api-liveness': 1000,
  'authenticated-workspace-read': 1500,
  'board-review-start': 3000,
  'research-acquisition': 3000,
};
for (const result of results) {
  const limit = thresholds[result.name];
  if (limit && result.p95Ms > limit) {
    throw new Error(`${result.name} p95 ${result.p95Ms}ms exceeds ${limit}ms threshold`);
  }
}

console.log(`STAGING_LOAD_TEST_PASS ${RESULT_FILE}`);
