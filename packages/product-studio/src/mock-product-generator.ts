import { prisma } from '@ventureos/database';
import type { StorageProvider } from '@ventureos/integrations';

export const MOCK_GENERATOR_VERSION = 'mock-product-generator-v1';

/**
 * Inputs the mock generator reasons over. Deliberately just the fields
 * Phase 2 already computed (opportunity title/type) -- Phase 4 does not
 * invent new research, it executes generation from what's already approved.
 */
export interface ProductGenerationInput {
  workspaceId: string;
  productVersionId: string;
  opportunityTitle: string;
  productType: string;
  suggestedMarketplace: string | null;
}

interface AssetSpec {
  kind: string;
  label: string;
  fileName: string;
  mimeType: string;
  buildContent: (input: ProductGenerationInput) => Buffer;
}

function sanitize(text: string): string {
  return text.replace(/[()\\]/g, '');
}

/** Minimal but syntactically valid single-page PDF -- no external PDF library needed. */
function buildMockPdf(input: ProductGenerationInput): Buffer {
  const text = sanitize(`${input.opportunityTitle} -- VentureOS Mock Product Guide`);
  const streamBody = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`;
  const content = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj',
    '4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    `5 0 obj<</Length ${streamBody.length}>>stream`,
    streamBody,
    'endstream',
    'endobj',
    'xref',
    '0 6',
    'trailer<</Size 6/Root 1 0 R>>',
    'startxref',
    '0',
    '%%EOF',
  ].join('\n');
  return Buffer.from(content, 'utf-8');
}

function buildSpreadsheetCsv(input: ProductGenerationInput): Buffer {
  const header = 'Week,Platform,Content Theme,Post Date,Status\n';
  const rows = Array.from(
    { length: 4 },
    (_, i) => `Week ${i + 1},Instagram,${sanitize(input.opportunityTitle)} theme,TBD,Planned\n`,
  ).join('');
  return Buffer.from(header + rows, 'utf-8');
}

function buildEditableTemplate(input: ProductGenerationInput): Buffer {
  return Buffer.from(
    `# ${input.opportunityTitle} -- Editable Template\n\n[Replace this section with your own content plan]\n`,
    'utf-8',
  );
}

// 1x1 transparent PNG -- deterministic, real, valid image bytes reused as a
// mock preview (Phase 4 never generates or claims real photography/artwork).
const MOCK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function buildPreviewImage(): Buffer {
  return Buffer.from(MOCK_PNG_BASE64, 'base64');
}

function buildLicenceFile(input: ProductGenerationInput): Buffer {
  return Buffer.from(
    `VentureOS Mock Licence -- Personal & Commercial Use\n\nThis is a MOCK licence file generated for development/testing only (Phase 4, no live model calls). Product: ${input.opportunityTitle}.\n`,
    'utf-8',
  );
}

function buildReadme(input: ProductGenerationInput): Buffer {
  return Buffer.from(
    `# ${input.opportunityTitle}\n\nThis is a MOCK generated product package (Phase 4, no live model calls). Files included are placeholders demonstrating the generation pipeline -- never real copyrighted marketplace content.\n`,
    'utf-8',
  );
}

const ASSET_SPECS: AssetSpec[] = [
  {
    kind: 'PDF_GUIDE',
    label: 'main-guide',
    fileName: 'guide.pdf',
    mimeType: 'application/pdf',
    buildContent: buildMockPdf,
  },
  {
    kind: 'SPREADSHEET_TEMPLATE',
    label: 'planner',
    fileName: 'planner.csv',
    mimeType: 'text/csv',
    buildContent: buildSpreadsheetCsv,
  },
  {
    kind: 'EDITABLE_TEMPLATE',
    label: 'editable',
    fileName: 'template.txt',
    mimeType: 'text/plain',
    buildContent: buildEditableTemplate,
  },
  {
    kind: 'PREVIEW_IMAGE',
    label: 'preview-1',
    fileName: 'preview-1.png',
    mimeType: 'image/png',
    buildContent: buildPreviewImage,
  },
  {
    kind: 'PREVIEW_IMAGE',
    label: 'preview-2',
    fileName: 'preview-2.png',
    mimeType: 'image/png',
    buildContent: buildPreviewImage,
  },
  {
    kind: 'LICENCE_FILE',
    label: 'licence',
    fileName: 'LICENCE.txt',
    mimeType: 'text/plain',
    buildContent: buildLicenceFile,
  },
  {
    kind: 'README',
    label: 'readme',
    fileName: 'README.txt',
    mimeType: 'text/plain',
    buildContent: buildReadme,
  },
];

export function targetAssetKinds(): string[] {
  return Array.from(new Set(ASSET_SPECS.map((s) => s.kind)));
}

export interface GenerateProductAssetsResult {
  assetVersionIds: string[];
}

/**
 * Generates every mock asset for a ProductVersion and uploads each through
 * the caller-provided StorageProvider (real MinIO in dev/prod, MockStorageProvider
 * in tests) -- contentHash/sizeBytes always come from the upload result, never
 * hand-typed, so downstream ProductPackage hashing is real and verifiable.
 * Safe to call again for the same ProductVersion: each call creates a new
 * ProductAssetVersion (attempt N+1) rather than overwriting history.
 */
export async function generateProductAssets(
  input: ProductGenerationInput,
  storageProvider: StorageProvider,
): Promise<GenerateProductAssetsResult> {
  const assetVersionIds: string[] = [];

  for (const spec of ASSET_SPECS) {
    const buffer = spec.buildContent(input);
    const key = `products/${input.productVersionId}/${spec.label}-${spec.fileName}`;
    const uploaded = await storageProvider.upload({
      key,
      contentType: spec.mimeType,
      sizeBytes: buffer.length,
      body: buffer,
    });

    const asset = await prisma.productAsset.upsert({
      where: {
        productVersionId_kind_label: {
          productVersionId: input.productVersionId,
          kind: spec.kind,
          label: spec.label,
        },
      },
      update: {},
      create: {
        productVersionId: input.productVersionId,
        kind: spec.kind,
        label: spec.label,
      },
    });

    const existingVersions = await prisma.productAssetVersion.count({
      where: { productAssetId: asset.id },
    });

    const assetVersion = await prisma.productAssetVersion.create({
      data: {
        productAssetId: asset.id,
        attempt: existingVersions + 1,
        fileName: spec.fileName,
        mimeType: spec.mimeType,
        storageKey: uploaded.key,
        bucket: uploaded.bucket,
        sizeBytes: uploaded.sizeBytes,
        contentHash: uploaded.contentHash,
      },
    });

    if (spec.kind === 'LICENCE_FILE') {
      await prisma.licenceRecord.upsert({
        where: { productAssetVersionId: assetVersion.id },
        update: {},
        create: {
          productVersionId: input.productVersionId,
          productAssetVersionId: assetVersion.id,
          licenceType: 'PERSONAL_USE',
          termsSummary:
            'Mock personal-use licence generated by the VentureOS Phase 4 mock provider. Not a real legal licence.',
        },
      });
    }

    assetVersionIds.push(assetVersion.id);
  }

  return { assetVersionIds };
}
