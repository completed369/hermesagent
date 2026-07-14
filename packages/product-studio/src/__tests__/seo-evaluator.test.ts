import { describe, expect, it } from 'vitest';
import { evaluateSeoContent, type SeoEvaluationInput } from '../seo-evaluator';

const goodInput: SeoEvaluationInput = {
  title: 'Social Media Content Planning Kit — Digital Template Bundle',
  description:
    'A complete digital planner for scheduling and organizing social media content across platforms. Instant download, editable, print-ready.',
  tags: [
    'digital download',
    'template',
    'planner',
    'printable',
    'social media',
    'content calendar',
  ],
};

describe('evaluateSeoContent', () => {
  it('scores a well-formed listing at 100 with all checks passing', () => {
    const result = evaluateSeoContent(goodInput);
    expect(result.score).toBe(100);
    expect(result.checks.every((c) => c.result === 'PASS')).toBe(true);
  });

  it('warns and deducts for a short title (<20 chars)', () => {
    const result = evaluateSeoContent({ ...goodInput, title: 'Short' });
    const check = result.checks.find((c) => c.ruleId === 'title-length')!;
    expect(check.result).toBe('WARN');
    expect(result.score).toBe(90);
  });

  it('fails and deducts more for a title over 140 chars', () => {
    const result = evaluateSeoContent({ ...goodInput, title: 'x'.repeat(141) });
    const check = result.checks.find((c) => c.ruleId === 'title-length')!;
    expect(check.result).toBe('FAIL');
    expect(result.score).toBe(75);
  });

  it('warns and deducts for a short description (<100 chars)', () => {
    const result = evaluateSeoContent({ ...goodInput, description: 'Too short.' });
    const check = result.checks.find((c) => c.ruleId === 'description-length')!;
    expect(check.result).toBe('WARN');
    expect(result.score).toBe(90);
  });

  it('warns for fewer than 5 tags', () => {
    const result = evaluateSeoContent({ ...goodInput, tags: ['a', 'b'] });
    const check = result.checks.find((c) => c.ruleId === 'tag-count')!;
    expect(check.result).toBe('WARN');
    expect(result.score).toBe(90);
  });

  it('fails for more than 13 tags', () => {
    const manyTags = Array.from({ length: 14 }, (_, i) => `tag${i}`);
    const result = evaluateSeoContent({ ...goodInput, tags: manyTags });
    const check = result.checks.find((c) => c.ruleId === 'tag-count')!;
    expect(check.result).toBe('FAIL');
    expect(result.score).toBe(80);
  });

  it('warns on duplicate tags (case-insensitive)', () => {
    const result = evaluateSeoContent({
      ...goodInput,
      tags: [...goodInput.tags, 'Digital Download'],
    });
    const check = result.checks.find((c) => c.ruleId === 'no-duplicate-tags')!;
    expect(check.result).toBe('WARN');
    expect(result.score).toBe(95);
  });

  it('clamps the score to a minimum of 0', () => {
    const result = evaluateSeoContent({
      title: 'x'.repeat(200),
      description: 'short',
      tags: Array.from({ length: 20 }, (_, i) => `tag${i}`),
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic: identical input always produces identical output', () => {
    expect(evaluateSeoContent(goodInput)).toEqual(evaluateSeoContent(goodInput));
  });
});
