import { describe, expect, it } from 'vitest';
import { createExperimentSchema, recordExperimentResultSchema } from './finance.dto';

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
