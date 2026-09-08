import { describe, expect, it } from 'vitest';
import {
  createExperimentSchema,
  recordExperimentResultSchema,
  recordRevenueRunCostReconciliationSchema,
  revenueRunIdSchema,
  createRevenueRunPlanSchema,
  recordRevenueRunCommercialEvidenceSchema,
} from './finance.dto';

const variantId = '11111111-1111-4111-8111-111111111111';
const metricId = '22222222-2222-4222-8222-222222222222';

describe('commercial observation DTOs', () => {
  it('defaults unspecified experiment results to MOCK/SYNTHETIC', () => {
    const parsed = recordExperimentResultSchema.parse({
      experimentVariantId: variantId,
      experimentMetricId: metricId,
      value: 12.5,
    });
    expect(parsed.evidenceMode).toBe('MOCK');
    expect(parsed.sourceType).toBe('SYNTHETIC');
  });

  it('accepts a fully provenanced REAL observation', () => {
    const parsed = recordExperimentResultSchema.parse({
      experimentVariantId: variantId,
      experimentMetricId: metricId,
      value: 4,
      evidenceMode: 'REAL',
      sourceType: 'CUSTOMER_SUPPORT',
      sourceRef: 'support-log:2026-08-15',
      observedAt: '2026-08-15T10:00:00.000Z',
    });
    expect(parsed.evidenceMode).toBe('REAL');
  });

  it('rejects unprovenanced or synthetic REAL observations', () => {
    for (const body of [
      {
        experimentVariantId: variantId,
        experimentMetricId: metricId,
        value: 1,
        evidenceMode: 'REAL',
        sourceType: 'SYNTHETIC',
        sourceRef: 'synthetic:test',
        observedAt: '2026-08-15T10:00:00.000Z',
      },
      {
        experimentVariantId: variantId,
        experimentMetricId: metricId,
        value: 1,
        evidenceMode: 'REAL',
        sourceType: 'MARKETPLACE_EXPORT',
        observedAt: '2026-08-15T10:00:00.000Z',
      },
      {
        experimentVariantId: variantId,
        experimentMetricId: metricId,
        value: 1,
        evidenceMode: 'REAL',
        sourceType: 'MARKETPLACE_EXPORT',
        sourceRef: 'etsy-export:batch-1',
      },
    ]) {
      expect(recordExperimentResultSchema.safeParse(body).success).toBe(false);
    }
  });

  it('supports explicit Gate-5 support-load metrics', () => {
    const parsed = createExperimentSchema.parse({
      name: 'Support load pilot',
      hypothesis: 'Support demand remains manageable.',
      variants: [{ name: 'Pilot', isControl: true }],
      metrics: [
        { name: 'SUPPORT_CONTACTS', unit: 'count' },
        { name: 'SUPPORT_MINUTES', unit: 'minutes' },
        { name: 'QUALITY_INCIDENTS', unit: 'count' },
      ],
    });
    expect(parsed.metrics.map((metric) => metric.name)).toEqual([
      'SUPPORT_CONTACTS',
      'SUPPORT_MINUTES',
      'QUALITY_INCIDENTS',
    ]);
  });
});

describe('revenue-run cost-reconciliation DTO', () => {
  it('requires a UUID revenue-run route identifier', () => {
    expect(revenueRunIdSchema.safeParse('11111111-1111-4111-8111-111111111111').success).toBe(true);
    expect(revenueRunIdSchema.safeParse('revenue-run').success).toBe(false);
  });

  it('accepts exact JSON-safe BIGINT input without precision loss', () => {
    const parsed = recordRevenueRunCostReconciliationSchema.parse({
      overlapMinorUnits: '9007199254740993',
      basisReference: 'audit:cost-overlap-review-1',
      idempotencyKey: 'cost-reconciliation-1',
    });

    expect(parsed.overlapMinorUnits).toBe(9_007_199_254_740_993n);
  });

  it.each([1, '-1', '+1', '01', '1.0', ' 1', '9223372036854775808'])(
    'rejects a non-canonical or out-of-range overlap: %s',
    (overlapMinorUnits) => {
      expect(
        recordRevenueRunCostReconciliationSchema.safeParse({
          overlapMinorUnits,
          basisReference: 'audit:cost-overlap-review-1',
          idempotencyKey: 'cost-reconciliation-1',
        }).success,
      ).toBe(false);
    },
  );

  it('rejects padded or unbounded assertion metadata', () => {
    for (const body of [
      {
        overlapMinorUnits: '0',
        basisReference: ' padded',
        idempotencyKey: 'cost-reconciliation-1',
      },
      {
        overlapMinorUnits: '0',
        basisReference: 'audit:cost-overlap-review-1',
        idempotencyKey: 'x'.repeat(201),
      },
    ]) {
      expect(recordRevenueRunCostReconciliationSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('revenue-run plan DTO', () => {
  const plan = {
    opportunityId: '11111111-1111-4111-8111-111111111111',
    ventureProposalId: '22222222-2222-4222-8222-222222222222',
    taskId: '33333333-3333-4333-8333-333333333333',
    runId: '44444444-4444-4444-8444-444444444444',
    currency: 'EUR',
    expectedRevenueMinorUnits: '9007199254740993',
    expectedCostMinorUnits: '6000',
    downsideMinorUnits: '1200',
    confidenceBps: 6500,
    timeToCashDays: 30,
    forecastEvidenceHash: 'a'.repeat(64),
    idempotencyKey: 'revenue-run-plan-1',
  };

  it('parses exact amounts and preserves the task/run binding', () => {
    const parsed = createRevenueRunPlanSchema.parse(plan);

    expect(parsed.expectedRevenueMinorUnits).toBe(9_007_199_254_740_993n);
    expect(parsed.taskId).toBe(plan.taskId);
    expect(parsed.runId).toBe(plan.runId);
  });

  it('requires task identity when an ACP run is supplied', () => {
    const { taskId: _taskId, ...withoutTask } = plan;
    expect(createRevenueRunPlanSchema.safeParse(withoutTask).success).toBe(false);
  });

  it.each([
    { ...plan, expectedCostMinorUnits: 6000 },
    { ...plan, expectedCostMinorUnits: '01' },
    { ...plan, expectedCostMinorUnits: '9223372036854775808' },
    { ...plan, currency: 'eur' },
    { ...plan, forecastEvidenceHash: 'A'.repeat(64) },
    { ...plan, confidenceBps: 10_001 },
    { ...plan, timeToCashDays: 36_501 },
  ])('rejects malformed or unbounded planning evidence', (input) => {
    expect(createRevenueRunPlanSchema.safeParse(input).success).toBe(false);
  });
});

describe('revenue-run commercial-evidence DTO', () => {
  const evidence = {
    kind: 'PAYMENT_SETTLEMENT',
    sourceType: 'MARKETPLACE_EXPORT',
    sourceReferenceHash: 'a'.repeat(64),
    sourceArtifactSha256: 'b'.repeat(64),
    observedAt: '2026-09-08T01:00:00.000Z',
    idempotencyKey: 'commercial-evidence-1',
  };

  it('accepts only bounded privacy-minimized provenance and derives a Date', () => {
    const parsed = recordRevenueRunCommercialEvidenceSchema.parse(evidence);

    expect(parsed.observedAt).toEqual(new Date(evidence.observedAt));
    expect(parsed).not.toHaveProperty('verificationState');
    expect(parsed).not.toHaveProperty('sourceReference');
  });

  it.each([
    { ...evidence, kind: 'VERIFIED_PAYMENT' },
    { ...evidence, sourceType: 'SYNTHETIC' },
    { ...evidence, sourceReferenceHash: 'A'.repeat(64) },
    { ...evidence, sourceArtifactSha256: 'b'.repeat(63) },
    { ...evidence, observedAt: 'not-a-date' },
    { ...evidence, idempotencyKey: ' padded' },
    { ...evidence, idempotencyKey: 'x'.repeat(201) },
  ])('rejects unsupported, unhashed, malformed, or unbounded provenance', (input) => {
    expect(recordRevenueRunCommercialEvidenceSchema.safeParse(input).success).toBe(false);
  });
});
