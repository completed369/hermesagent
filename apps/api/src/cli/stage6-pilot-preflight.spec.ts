import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  prepareReviewedStage6PilotPreflight,
  prepareStage6PilotPreflightForTest,
  REVIEWED_STAGE6_PILOT_INPUT_DIGEST,
} from './stage6-pilot-preflight';

const fixturePath = path.resolve(__dirname, '../../../../docs/stage6/pet-sitting-pilot-input.json');

type MutableFixture = Record<string, unknown> & {
  pilot: Record<string, unknown> & { evidence: Array<Record<string, unknown>> };
  compliance: Record<string, unknown>;
};

function fixture(): MutableFixture {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as MutableFixture;
}

describe('Stage 6 offline pilot preflight', () => {
  it('produces a deterministic sanitized PREPARED/BLOCKED packet', () => {
    const input = fixture();
    const now = new Date('2026-08-26T00:00:00.000Z');
    const first = prepareStage6PilotPreflightForTest(input, now);
    const second = prepareStage6PilotPreflightForTest(input, now);

    expect(first).toEqual(second);
    expect(first.result).toBe('PREPARED_BLOCKED');
    expect(first.opportunityScore).toEqual({
      formulaVersion: 'opportunity-score-v1',
      score: 76.95,
    });
    expect(first.sourceInputCompatibility).toMatchObject({
      result: 'SUPPORTED_SUBSET',
      marketplace: 'etsy',
      policyPackVersion: 'v1',
      supportedProductTypeCode: 'DIGITAL_TEMPLATE_BUNDLE',
      evaluatedCriteria: expect.arrayContaining(['supported-product-type', 'title-length']),
      notEvaluatedCriteria: expect.arrayContaining([
        'authoritative-policy-active-state',
        'listing-images',
        'pricing',
      ]),
    });
    expect(first.evidence).toMatchObject({
      count: 6,
      state: 'NEAR_EXPIRY',
      earliestExpiryAt: '2026-09-17T17:29:00.000Z',
    });
    expect(first.blockers).toEqual(
      expect.arrayContaining([
        'AUTHORITATIVE_POLICY_STATE_REQUIRED',
        'AUTHORITATIVE_TITLE_UNIQUENESS_REQUIRED',
        'AUTHORITATIVE_IDEMPOTENCY_STATE_REQUIRED',
        'AUTHORITATIVE_GATE_EXECUTION_REQUIRED',
        'AUTHORITATIVE_LISTING_POLICY_REVALIDATION_REQUIRED',
        'FOUNDER_APPROVAL_REQUIRED',
        'PUBLICATION_STATE_REVALIDATION_REQUIRED',
        'PRIVATE_STAGING_STATE_REVALIDATION_REQUIRED',
      ]),
    );
    expect(Object.values(first.execution).every((value) => value === false)).toBe(true);
    expect(first.pilot.inputDigest).toBe(REVIEWED_STAGE6_PILOT_INPUT_DIGEST);
    expect(first.inputProvenance).toEqual({
      reviewedFixtureDigestMatch: true,
      productionRunnerInputMode: 'FIXED_REVIEWED_FIXTURE',
    });

    const serialized = JSON.stringify(first);
    for (const sensitive of [
      'sourceIdentifier',
      'originalExcerpt',
      'painPoints',
      'buyingTriggers',
      'https://',
      '@',
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
    expect(serialized).not.toContain('PASS');
  });

  it('fails strict schema validation for unknown input fields', () => {
    const input = fixture();
    input.unexpected = 'rejected';
    expect(() => prepareStage6PilotPreflightForTest(input, new Date('2026-08-26'))).toThrow();

    const nested = fixture();
    nested.pilot.evidence[0]!.unexpected = 'rejected';
    expect(() => prepareStage6PilotPreflightForTest(nested, new Date('2026-08-26'))).toThrow();
  });

  it('rejects any input classified as containing customer or pseudonymous data', () => {
    for (const classification of ['PERSONAL', 'PSEUDONYMOUS']) {
      const input = fixture();
      input.pilot.evidence[0]!.personalDataClassification = classification;
      expect(() => prepareStage6PilotPreflightForTest(input, new Date('2026-08-26'))).toThrow(
        'offline preflight accepts only evidence classified NONE',
      );
    }
  });

  it('reports incompatible source policy inputs without inferring a gate result', () => {
    const input = fixture();
    input.pilot.suggestedProductType = 'PHYSICAL_WEAPON';
    input.compliance.declaredCategories = ['weapons'];
    const packet = prepareStage6PilotPreflightForTest(input, new Date('2026-08-26'));
    expect(packet.sourceInputCompatibility).toMatchObject({
      result: 'INCOMPATIBLE',
      supportedProductTypeCode: null,
      riskCodes: expect.arrayContaining([
        'PRODUCT_TYPE_SOURCE_UNSUPPORTED',
        'RESTRICTED_CATEGORY_DECLARED',
      ]),
    });
    expect(packet.blockers).toContain('SOURCE_POLICY_INPUT_INCOMPATIBLE');
    expect(packet.result).toBe('PREPARED_BLOCKED');
  });

  it.each(['DIGITAL_TEMPLATE_BUNDLE', 'PRINTABLE', 'PLANNER', 'SPREADSHEET_TOOL'])(
    'emits only the fixed safe product code %s',
    (productType) => {
      const input = fixture();
      input.pilot.suggestedProductType = productType;
      const packet = prepareStage6PilotPreflightForTest(input, new Date('2026-08-26'));
      expect(packet.sourceInputCompatibility.supportedProductTypeCode).toBe(productType);
    },
  );

  it('fails closed when the earliest evidence horizon has elapsed', () => {
    const packet = prepareStage6PilotPreflightForTest(
      fixture(),
      new Date('2026-09-18T00:00:00.000Z'),
    );
    expect(packet.evidence.state).toBe('EXPIRED');
    expect(packet.evidence.riskCodes).toContain('EVIDENCE_EXPIRED');
    expect(packet.blockers).toContain('EVIDENCE_REFRESH_REQUIRED');
  });

  it('does not echo secret, password, PII or chain-of-thought smuggling payloads', () => {
    const input = fixture();
    const smuggled = [
      'password=hunter2',
      'api_token=secret-value',
      'person@example.invalid',
      'private chain of thought: hidden reasoning',
    ];
    input.pilot.description = `${String(input.pilot.description)} ${smuggled.join(' ')}`;
    input.pilot.suggestedProductType = smuggled.join('-');
    const packet = prepareStage6PilotPreflightForTest(input, new Date('2026-08-26'));
    const serialized = JSON.stringify(packet);
    for (const value of smuggled) expect(serialized).not.toContain(value);
    expect(packet.sourceInputCompatibility.supportedProductTypeCode).toBeNull();
    expect(packet.inputProvenance.reviewedFixtureDigestMatch).toBe(false);
    expect(() => prepareReviewedStage6PilotPreflight(input)).toThrow(
      'reviewed Stage 6 pilot fixture digest mismatch',
    );
  });

  it('contains no persistence, network, dispatch, contact, provider or approval capability', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'stage6-pilot-preflight.ts'), 'utf8');
    for (const forbidden of [
      '@ventureos/database',
      'prisma',
      'fetch(',
      'http.request',
      'https.request',
      'child_process',
      'process.env',
      'runStage6PreapprovalOperator',
      'ApprovalsService',
      'decideApprovalRequest',
      'sendEmail',
    ]) {
      expect(source).not.toContain(forbidden);
    }

    const runner = fs.readFileSync(
      path.resolve(__dirname, 'stage6-pilot-preflight-runner.ts'),
      'utf8',
    );
    expect(runner).toContain('docs/stage6/pet-sitting-pilot-input.json');
    for (const forbidden of [
      'process.argv',
      'process.stdin',
      'fetch(',
      'http.request',
      'https.request',
      '@ventureos/database',
      'prisma',
    ]) {
      expect(runner).not.toContain(forbidden);
    }
  });
});
