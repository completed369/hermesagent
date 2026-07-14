import { z } from 'zod';

/**
 * Every material business claim must be classified as exactly one of these
 * six types (master spec section 15). An agent assumption must never be
 * silently presented as a verified fact -- this schema is the enforcement
 * point: any claim with an unrecognised or missing classification is
 * invalid and rejected, never defaulted to a "safe-sounding" type.
 */
export const EvidenceClaimType = z.enum([
  'VERIFIED_FACT',
  'EXTERNAL_ESTIMATE',
  'FOUNDER_PROVIDED_FACT',
  'SYSTEM_CALCULATED_VALUE',
  'AGENT_ASSUMPTION',
  'UNKNOWN',
]);
export type EvidenceClaimType = z.infer<typeof EvidenceClaimType>;

export const EvidenceClaimSchema = z.object({
  claimType: EvidenceClaimType,
  statement: z.string().min(1),
  value: z.unknown().optional(),
});
export type EvidenceClaimInput = z.infer<typeof EvidenceClaimSchema>;

/**
 * Full provenance record required for any EvidenceArtifact (master spec
 * section 15): source, retrieval date, reliability/freshness/relevance
 * scores, terms-of-use, personal-data classification, content hash.
 */
export const EvidenceArtifactSchema = z.object({
  sourceName: z.string().min(1),
  sourceIdentifier: z.string().optional(),
  retrievedAt: z.string().datetime(),
  region: z.string().optional(),
  language: z.string().default('en'),
  collectionMethod: z.enum(['API', 'MANUAL_IMPORT', 'FOUNDER_PROVIDED', 'SYSTEM_CALCULATED']),
  collectionAgent: z.string().optional(),
  originalExcerpt: z.string().optional(),
  reliabilityScore: z.number().min(0).max(100),
  freshnessScore: z.number().min(0).max(100),
  relevanceScore: z.number().min(0).max(100),
  termsOfUseNote: z.string().optional(),
  personalDataClassification: z.enum(['NONE', 'PSEUDONYMOUS', 'PERSONAL']).default('NONE'),
  contentHash: z.string().min(1),
});
export type EvidenceArtifactInput = z.infer<typeof EvidenceArtifactSchema>;
