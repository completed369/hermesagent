import { describe, expect, it } from 'vitest';
import { evaluateQuality, type AssetForQa, type LicenceRecordForQa } from '../qa-checker';

const REQUIRED_KINDS = [
  'PDF_GUIDE',
  'SPREADSHEET_TEMPLATE',
  'EDITABLE_TEMPLATE',
  'PREVIEW_IMAGE',
  'LICENCE_FILE',
  'README',
];

function makeAsset(overrides: Partial<AssetForQa> & { kind: string }): AssetForQa {
  return {
    id: `asset-${overrides.kind}-${overrides.label ?? 'a'}`,
    label: overrides.label ?? 'a',
    latestVersion: {
      id: `${overrides.kind}-v1`,
      fileName: `${overrides.kind.toLowerCase()}.bin`,
      sizeBytes: 100,
      contentHash: `hash-${overrides.kind}`,
    },
    ...overrides,
  };
}

function completeAssetSet(): AssetForQa[] {
  return REQUIRED_KINDS.map((kind) => makeAsset({ kind, label: kind.toLowerCase() }));
}

function licenceRecordFor(assets: AssetForQa[]): LicenceRecordForQa[] {
  const licenceAsset = assets.find((a) => a.kind === 'LICENCE_FILE');
  if (!licenceAsset?.latestVersion) return [];
  return [{ productAssetVersionId: licenceAsset.latestVersion.id }];
}

describe('evaluateQuality', () => {
  it('passes overall when every required kind, integrity, naming, and licence record are present', () => {
    const assets = completeAssetSet();
    const result = evaluateQuality(assets, licenceRecordFor(assets));
    expect(result.overallPassed).toBe(true);
    expect(result.checks.every((c) => c.status === 'PASSED')).toBe(true);
  });

  it('fails COMPLETENESS when a required kind is missing', () => {
    const assets = completeAssetSet().filter((a) => a.kind !== 'README');
    const result = evaluateQuality(assets, licenceRecordFor(assets));
    const completeness = result.checks.find((c) => c.checkType === 'COMPLETENESS')!;
    expect(completeness.status).toBe('FAILED');
    expect(completeness.results[0]!.message).toContain('README');
    expect(result.overallPassed).toBe(false);
  });

  it('fails FILE_INTEGRITY when an asset has zero size or missing content hash', () => {
    const assets = completeAssetSet().map((a) =>
      a.kind === 'PDF_GUIDE' ? { ...a, latestVersion: { ...a.latestVersion!, sizeBytes: 0 } } : a,
    );
    const result = evaluateQuality(assets, licenceRecordFor(assets));
    const integrity = result.checks.find((c) => c.checkType === 'FILE_INTEGRITY')!;
    expect(integrity.status).toBe('FAILED');
    expect(result.overallPassed).toBe(false);
  });

  it('fails FILE_INTEGRITY when an asset has no generated version at all', () => {
    const assets = completeAssetSet().map((a) =>
      a.kind === 'README' ? { ...a, latestVersion: null } : a,
    );
    const result = evaluateQuality(assets, licenceRecordFor(assets));
    const integrity = result.checks.find((c) => c.checkType === 'FILE_INTEGRITY')!;
    expect(integrity.status).toBe('FAILED');
    expect(
      integrity.results.some(
        (r) => r.result === 'FAIL' && r.message.includes('no generated version'),
      ),
    ).toBe(true);
  });

  it('warns (does not fail) NAMING_CONVENTION for unsafe filenames', () => {
    const assets = completeAssetSet().map((a) =>
      a.kind === 'README'
        ? { ...a, latestVersion: { ...a.latestVersion!, fileName: 'bad name!.txt' } }
        : a,
    );
    const result = evaluateQuality(assets, licenceRecordFor(assets));
    const naming = result.checks.find((c) => c.checkType === 'NAMING_CONVENTION')!;
    expect(naming.status).toBe('PASSED'); // WARN does not flip status to FAILED
    expect(naming.results.some((r) => r.result === 'WARN')).toBe(true);
    expect(result.overallPassed).toBe(true);
  });

  it('warns (does not block) DUPLICATE_ASSET when two assets share a content hash', () => {
    const assets = completeAssetSet().map((a) =>
      a.kind === 'README'
        ? { ...a, latestVersion: { ...a.latestVersion!, contentHash: 'hash-PDF_GUIDE' } }
        : a,
    );
    const result = evaluateQuality(assets, licenceRecordFor(assets));
    const duplicate = result.checks.find((c) => c.checkType === 'DUPLICATE_ASSET')!;
    expect(duplicate.status).toBe('PASSED');
    expect(duplicate.results.some((r) => r.result === 'WARN')).toBe(true);
  });

  it('fails LICENCE_COMPLETENESS when the licence asset has no matching LicenceRecord', () => {
    const assets = completeAssetSet();
    const result = evaluateQuality(assets, []); // no licence records at all
    const licence = result.checks.find((c) => c.checkType === 'LICENCE_COMPLETENESS')!;
    expect(licence.status).toBe('FAILED');
    expect(result.overallPassed).toBe(false);
  });

  it('fails LICENCE_COMPLETENESS when there is no LICENCE_FILE asset at all', () => {
    const assets = completeAssetSet().filter((a) => a.kind !== 'LICENCE_FILE');
    const result = evaluateQuality(assets, []);
    const licence = result.checks.find((c) => c.checkType === 'LICENCE_COMPLETENESS')!;
    expect(licence.status).toBe('FAILED');
    expect(licence.results[0]!.message).toContain('No licence file asset');
  });

  it('is deterministic: identical input always produces identical output', () => {
    const assets = completeAssetSet();
    const records = licenceRecordFor(assets);
    expect(evaluateQuality(assets, records)).toEqual(evaluateQuality(assets, records));
  });
});
