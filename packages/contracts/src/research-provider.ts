import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ResearchProviderRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    runId: z.string().regex(/^[A-Za-z0-9:._/-]{1,200}$/),
    instruction: z.string().trim().min(1).max(2_000),
    model: z.string().regex(/^claude-[a-z0-9-]{1,90}$/),
    maximumOutputTokens: z.number().int().min(1).max(4_096),
    maximumSearches: z.number().int().min(1).max(3),
    maximumComputeUnits: z.number().int().min(1).max(100_000),
  })
  .strict();
export type ResearchProviderRequest = z.infer<typeof ResearchProviderRequestSchema>;

export const ResearchProviderUsageSchema = z
  .object({
    inputTokens: count,
    outputTokens: count,
    cacheReadTokens: count,
    cacheCreationTokens: count,
    searches: count,
    cacheCreation5mTokens: count,
    cacheCreation1hTokens: count,
    webFetches: count,
    serviceTier: z.string().max(100).nullable(),
    inferenceGeo: z.string().max(100).nullable(),
  })
  .strict();
export type ResearchProviderUsage = z.infer<typeof ResearchProviderUsageSchema>;

/** A provider receipt is not a verified artifact, a settled invoice or revenue. */
export const ResearchProviderReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal('anthropic'),
    requestedModel: z.string(),
    reportedModel: z.string().max(100).nullable(),
    workspaceId: z.string().uuid(),
    runId: z.string(),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    responseDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    providerMessageId: z.string().nullable(),
    observedAt: z.string().datetime(),
    state: z.enum(['AWAITING_VERIFICATION', 'REJECTED', 'OUTCOME_UNKNOWN']),
    reason: z.enum([
      'CITED_REPORT',
      'HTTP_ERROR',
      'TRANSPORT_ERROR',
      'INVALID_RESPONSE',
      'INCOMPLETE_TURN',
      'SEARCH_ERROR',
      'USAGE_REVIEW_REQUIRED',
      'LIMIT_EXCEEDED',
      'INSUFFICIENT_SOURCES',
    ]),
    usage: ResearchProviderUsageSchema.nullable(),
    segments: z
      .array(
        z
          .object({
            text: z.string().max(32_000),
            citations: z
              .array(
                z
                  .object({
                    url: z.string().url(),
                    title: z.string().max(1_000),
                    citedText: z.string().max(2_000),
                    providerPageAge: z.string().max(200).nullable(),
                  })
                  .strict(),
              )
              .max(50),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type ResearchProviderReceipt = z.infer<typeof ResearchProviderReceiptSchema>;
