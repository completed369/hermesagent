import { createHash } from 'node:crypto';

/**
 * Deterministic SHA-256 content hash used for package/artefact integrity
 * (products, listings, approvals). Any change to canonical content MUST
 * change this hash, invalidating any approval bound to the previous hash.
 */
export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Stable JSON stringify (sorted keys) so object hashing is order-independent. */
export function canonicalJsonStringify(value: unknown): string {
  const sortKeys = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sortKeys);
    if (input !== null && typeof input === 'object') {
      return Object.keys(input as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = sortKeys((input as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return input;
  };
  return JSON.stringify(sortKeys(value));
}

export function hashObject(value: unknown): string {
  return hashContent(canonicalJsonStringify(value));
}

type DecimalStringable = { toString(): string };

export interface ProductListingBundleArtifact {
  assetVersionIds: string[];
  listing: {
    title: string;
    description: string;
    tags: string[];
    category: string;
    currency: string;
    priceEur: DecimalStringable;
  };
  images: Array<{
    id: string;
    productAssetVersionId: string;
    position: number;
    altText: string | null;
  }>;
  files: Array<{
    id: string;
    productAssetVersionId: string;
    displayName: string;
  }>;
}

/** Canonical approval hash for the exact product assets and mutable listing content. */
export function hashProductListingBundle(artifact: ProductListingBundleArtifact): string {
  return hashObject({
    assetVersionIds: [...artifact.assetVersionIds].sort(),
    listing: {
      title: artifact.listing.title,
      description: artifact.listing.description,
      tags: [...artifact.listing.tags].sort(),
      category: artifact.listing.category,
      currency: artifact.listing.currency,
      priceEur: artifact.listing.priceEur.toString(),
    },
    images: [...artifact.images]
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
      .map((image) => ({
        id: image.id,
        productAssetVersionId: image.productAssetVersionId,
        position: image.position,
        altText: image.altText,
      })),
    files: [...artifact.files]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((file) => ({
        id: file.id,
        productAssetVersionId: file.productAssetVersionId,
        displayName: file.displayName,
      })),
  });
}

type Stringable = { toString(): string };

export interface ScaleDecisionExperimentArtifact {
  id: string;
  name: string;
  hypothesis: string;
  status: string;
  listingVersionId: string | null;
  variants: Array<{
    id: string;
    name: string;
    description: string | null;
    isControl: boolean;
    trafficAllocationPercent: Stringable | null;
    results: Array<{
      id: string;
      experimentMetricId: string;
      value: Stringable;
      sampleSize: number | null;
      measuredAt: Date;
      provenance?: {
        evidenceMode: string;
        sourceType: string;
        sourceRef: string | null;
        observedAt: Date | null;
        recordedBy: string | null;
      } | null;
    }>;
  }>;
  metrics: Array<{
    id: string;
    name: string;
    targetValue: Stringable | null;
    unit: string | null;
  }>;
}

/** Canonical approval hash for the exact experiment evidence authorized to SCALE. */
export function hashScaleDecisionArtifact(params: {
  proposalVersionId: string;
  proposalSnapshot: unknown;
  experiment: ScaleDecisionExperimentArtifact;
}): string {
  const byId = <T extends { id: string }>(left: T, right: T) => left.id.localeCompare(right.id);
  return hashObject({
    proposalVersionId: params.proposalVersionId,
    proposalSnapshot: params.proposalSnapshot,
    experiment: {
      id: params.experiment.id,
      name: params.experiment.name,
      hypothesis: params.experiment.hypothesis,
      status: params.experiment.status,
      listingVersionId: params.experiment.listingVersionId,
      variants: [...params.experiment.variants].sort(byId).map((variant) => ({
        id: variant.id,
        name: variant.name,
        description: variant.description,
        isControl: variant.isControl,
        trafficAllocationPercent: variant.trafficAllocationPercent?.toString() ?? null,
        results: [...variant.results].sort(byId).map((result) => ({
          id: result.id,
          experimentMetricId: result.experimentMetricId,
          value: result.value.toString(),
          sampleSize: result.sampleSize,
          measuredAt: result.measuredAt.toISOString(),
          provenance: result.provenance
            ? {
                evidenceMode: result.provenance.evidenceMode,
                sourceType: result.provenance.sourceType,
                sourceRef: result.provenance.sourceRef,
                observedAt: result.provenance.observedAt?.toISOString() ?? null,
                recordedBy: result.provenance.recordedBy,
              }
            : {
                evidenceMode: 'MOCK',
                sourceType: 'SYNTHETIC',
                sourceRef: null,
                observedAt: null,
                recordedBy: null,
              },
        })),
      })),
      metrics: [...params.experiment.metrics].sort(byId).map((metric) => ({
        id: metric.id,
        name: metric.name,
        targetValue: metric.targetValue?.toString() ?? null,
        unit: metric.unit,
      })),
    },
  });
}
