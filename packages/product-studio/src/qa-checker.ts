import { enforceWorkspaceCapability, prisma } from '@ventureos/database';

export type QualityCheckType =
  | 'COMPLETENESS'
  | 'FILE_INTEGRITY'
  | 'NAMING_CONVENTION'
  | 'DUPLICATE_ASSET'
  | 'LICENCE_COMPLETENESS';

export interface QualityRuleResult {
  ruleId: string;
  result: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface QualityCheckOutcome {
  checkType: QualityCheckType;
  status: 'PASSED' | 'FAILED';
  results: QualityRuleResult[];
}

export interface RunQualityChecksResult {
  overallPassed: boolean;
  checks: QualityCheckOutcome[];
}

const REQUIRED_KINDS = [
  'PDF_GUIDE',
  'SPREADSHEET_TEMPLATE',
  'EDITABLE_TEMPLATE',
  'PREVIEW_IMAGE',
  'LICENCE_FILE',
  'README',
];

/** Plain-data shape of a ProductAsset + its latest version, decoupled from
 * Prisma's include shape so evaluateQuality() can be unit-tested with
 * hand-built fixtures (no database, no mocking prisma). */
export interface AssetForQa {
  id: string;
  kind: string;
  label: string;
  latestVersion: {
    id: string;
    fileName: string;
    sizeBytes: number;
    contentHash: string;
  } | null;
}

export interface LicenceRecordForQa {
  productAssetVersionId: string;
}

/**
 * Deterministic QA pass, pure function over plain data -- Operations and
 * Quality Officer's domain, now checking real generated/uploaded files. No
 * live model calls; every rule is a pure check against asset fields
 * (sizeBytes, contentHash, fileName, LicenceRecord presence).
 */
export function evaluateQuality(
  assets: AssetForQa[],
  licenceRecords: LicenceRecordForQa[],
): RunQualityChecksResult {
  const checks: QualityCheckOutcome[] = [];

  // COMPLETENESS: every required asset kind must be present.
  const presentKinds = new Set(assets.map((a) => a.kind));
  const missingKinds = REQUIRED_KINDS.filter((k) => !presentKinds.has(k));
  const completenessResults: QualityRuleResult[] = [
    missingKinds.length === 0
      ? {
          ruleId: 'all-required-kinds-present',
          result: 'PASS',
          message: 'All required asset kinds are present.',
          severity: 'LOW',
        }
      : {
          ruleId: 'all-required-kinds-present',
          result: 'FAIL',
          message: `Missing required asset kinds: ${missingKinds.join(', ')}.`,
          severity: 'CRITICAL',
        },
  ];
  checks.push({
    checkType: 'COMPLETENESS',
    status: missingKinds.length === 0 ? 'PASSED' : 'FAILED',
    results: completenessResults,
  });

  // FILE_INTEGRITY: every asset must have a generated version with a real size + hash.
  const integrityResults: QualityRuleResult[] = [];
  for (const asset of assets) {
    const latest = asset.latestVersion;
    if (!latest) {
      integrityResults.push({
        ruleId: `asset-${asset.id}-has-version`,
        result: 'FAIL',
        message: `Asset "${asset.label}" has no generated version.`,
        severity: 'CRITICAL',
      });
      continue;
    }
    if (latest.sizeBytes <= 0 || !latest.contentHash) {
      integrityResults.push({
        ruleId: `asset-${asset.id}-integrity`,
        result: 'FAIL',
        message: `Asset "${asset.label}" file is empty or missing a content hash.`,
        severity: 'HIGH',
      });
    } else {
      integrityResults.push({
        ruleId: `asset-${asset.id}-integrity`,
        result: 'PASS',
        message: `Asset "${asset.label}" has a valid size and content hash.`,
        severity: 'LOW',
      });
    }
  }
  checks.push({
    checkType: 'FILE_INTEGRITY',
    status: integrityResults.every((r) => r.result !== 'FAIL') ? 'PASSED' : 'FAILED',
    results: integrityResults,
  });

  // NAMING_CONVENTION: filenames must be simple/safe (warn, not block).
  const namingResults: QualityRuleResult[] = assets.map((asset) => {
    const latest = asset.latestVersion;
    const ok = !!latest && /^[a-z0-9._-]+$/i.test(latest.fileName);
    return ok
      ? {
          ruleId: `asset-${asset.id}-naming`,
          result: 'PASS' as const,
          message: `Filename "${latest?.fileName}" follows the naming convention.`,
          severity: 'LOW' as const,
        }
      : {
          ruleId: `asset-${asset.id}-naming`,
          result: 'WARN' as const,
          message: `Filename "${latest?.fileName ?? '(missing)'}" contains unexpected characters.`,
          severity: 'MEDIUM' as const,
        };
  });
  checks.push({
    checkType: 'NAMING_CONVENTION',
    status: namingResults.some((r) => r.result === 'FAIL') ? 'FAILED' : 'PASSED',
    results: namingResults,
  });

  // DUPLICATE_ASSET: no two assets should share identical content (warn, not block).
  const hashCounts = new Map<string, number>();
  for (const asset of assets) {
    const latest = asset.latestVersion;
    if (!latest) continue;
    hashCounts.set(latest.contentHash, (hashCounts.get(latest.contentHash) ?? 0) + 1);
  }
  const duplicateHashes = [...hashCounts.entries()].filter(([, count]) => count > 1);
  const duplicateResults: QualityRuleResult[] =
    duplicateHashes.length === 0
      ? [
          {
            ruleId: 'no-duplicate-content-hashes',
            result: 'PASS',
            message: 'No two assets share identical content.',
            severity: 'LOW',
          },
        ]
      : duplicateHashes.map(([hash]) => ({
          ruleId: `duplicate-hash-${hash.slice(0, 8)}`,
          result: 'WARN' as const,
          message: `Multiple assets share content hash ${hash.slice(0, 8)}...`,
          severity: 'MEDIUM' as const,
        }));
  checks.push({ checkType: 'DUPLICATE_ASSET', status: 'PASSED', results: duplicateResults });

  // LICENCE_COMPLETENESS: the licence-file asset must have a real LicenceRecord.
  const licenceAsset = assets.find((a) => a.kind === 'LICENCE_FILE');
  const licenceResults: QualityRuleResult[] = [];
  if (!licenceAsset) {
    licenceResults.push({
      ruleId: 'licence-file-present',
      result: 'FAIL',
      message: 'No licence file asset exists.',
      severity: 'CRITICAL',
    });
  } else {
    const latest = licenceAsset.latestVersion;
    const hasRecord = !!latest && licenceRecords.some((r) => r.productAssetVersionId === latest.id);
    licenceResults.push(
      hasRecord
        ? {
            ruleId: 'licence-record-present',
            result: 'PASS',
            message: 'Licence record exists for the licence file asset.',
            severity: 'LOW',
          }
        : {
            ruleId: 'licence-record-present',
            result: 'FAIL',
            message: 'Licence file asset exists but has no LicenceRecord.',
            severity: 'HIGH',
          },
    );
  }
  checks.push({
    checkType: 'LICENCE_COMPLETENESS',
    status: licenceResults.every((r) => r.result !== 'FAIL') ? 'PASSED' : 'FAILED',
    results: licenceResults,
  });

  return { overallPassed: checks.every((c) => c.status === 'PASSED'), checks };
}

/** Thin DB-touching wrapper: fetches a ProductVersion's current assets/licence
 * records and delegates the actual rule evaluation to evaluateQuality(). */
export async function runQualityChecks(
  workspaceId: string,
  productVersionId: string,
): Promise<RunQualityChecksResult> {
  await prisma.productVersion.findFirstOrThrow({
    where: { id: productVersionId, product: { workspaceId } },
    select: { id: true },
  });

  const assets = await prisma.productAsset.findMany({
    where: { productVersionId },
    include: { versions: { orderBy: { attempt: 'desc' as const }, take: 1 } },
  });
  const licenceRecords = await prisma.licenceRecord.findMany({ where: { productVersionId } });

  const assetsForQa: AssetForQa[] = assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    label: a.label,
    latestVersion: a.versions[0]
      ? {
          id: a.versions[0].id,
          fileName: a.versions[0].fileName,
          sizeBytes: a.versions[0].sizeBytes,
          contentHash: a.versions[0].contentHash,
        }
      : null,
  }));

  return evaluateQuality(
    assetsForQa,
    licenceRecords.map((r) => ({ productAssetVersionId: r.productAssetVersionId })),
  );
}

/** Persists the QualityCheck + QualityCheckResult rows for a completed run. */
export async function persistQualityChecks(
  workspaceId: string,
  productVersionId: string,
  result: RunQualityChecksResult,
): Promise<void> {
  await enforceWorkspaceCapability({
    workspaceId,
    capability: 'PRODUCT_GENERATION',
    stage: 'DISPATCH',
  });

  await prisma.productVersion.findFirstOrThrow({
    where: { id: productVersionId, product: { workspaceId } },
    select: { id: true },
  });

  for (const check of result.checks) {
    const record = await prisma.qualityCheck.create({
      data: {
        productVersionId,
        checkType: check.checkType,
        status: check.status,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });
    if (check.results.length > 0) {
      await prisma.qualityCheckResult.createMany({
        data: check.results.map((r) => ({
          qualityCheckId: record.id,
          ruleId: r.ruleId,
          result: r.result,
          message: r.message,
          severity: r.severity,
        })),
      });
    }
  }
}
