import { prisma, Prisma } from '@ventureos/database';

export const SEO_EVALUATOR_VERSION = 'mock-seo-evaluator-v1';

export interface SeoCheck {
  ruleId: string;
  result: 'PASS' | 'FAIL' | 'WARN';
  message: string;
}

export interface SeoEvaluationInput {
  title: string;
  description: string;
  tags: string[];
}

export interface SeoEvaluationResult {
  score: number;
  checks: SeoCheck[];
}

/**
 * Deterministic checks against listing content -- no live model calls (same
 * "mock/deterministic by default" principle as Phase 3's board agents).
 */
export function evaluateSeoContent(input: SeoEvaluationInput): SeoEvaluationResult {
  const checks: SeoCheck[] = [];
  let score = 100;

  if (input.title.length < 20) {
    checks.push({
      ruleId: 'title-length',
      result: 'WARN',
      message: 'Title is shorter than the recommended 20 characters.',
    });
    score -= 10;
  } else if (input.title.length > 140) {
    checks.push({
      ruleId: 'title-length',
      result: 'FAIL',
      message: 'Title exceeds the 140 character limit.',
    });
    score -= 25;
  } else {
    checks.push({
      ruleId: 'title-length',
      result: 'PASS',
      message: 'Title length is within range.',
    });
  }

  if (input.description.length < 100) {
    checks.push({
      ruleId: 'description-length',
      result: 'WARN',
      message: 'Description is shorter than recommended for search visibility.',
    });
    score -= 10;
  } else {
    checks.push({
      ruleId: 'description-length',
      result: 'PASS',
      message: 'Description length is adequate.',
    });
  }

  if (input.tags.length < 5) {
    checks.push({
      ruleId: 'tag-count',
      result: 'WARN',
      message: 'Fewer than 5 tags; more tags improve discoverability.',
    });
    score -= 10;
  } else if (input.tags.length > 13) {
    checks.push({
      ruleId: 'tag-count',
      result: 'FAIL',
      message: 'More than 13 tags; exceeds the marketplace limit.',
    });
    score -= 20;
  } else {
    checks.push({ ruleId: 'tag-count', result: 'PASS', message: 'Tag count is within range.' });
  }

  const hasDuplicateTags =
    input.tags.length !== new Set(input.tags.map((t) => t.toLowerCase())).size;
  if (hasDuplicateTags) {
    checks.push({
      ruleId: 'no-duplicate-tags',
      result: 'WARN',
      message: 'Duplicate tags detected.',
    });
    score -= 5;
  } else {
    checks.push({ ruleId: 'no-duplicate-tags', result: 'PASS', message: 'No duplicate tags.' });
  }

  return { score: Math.max(0, Math.min(100, score)), checks };
}

export async function runSeoEvaluation(listingVersionId: string): Promise<SeoEvaluationResult> {
  const listingVersion = await prisma.listingVersion.findUniqueOrThrow({
    where: { id: listingVersionId },
  });
  const result = evaluateSeoContent({
    title: listingVersion.title,
    description: listingVersion.description,
    tags: listingVersion.tags,
  });
  await prisma.sEOEvaluation.create({
    data: {
      listingVersionId,
      score: result.score,
      checks: result.checks as unknown as Prisma.InputJsonValue,
    },
  });
  return result;
}
