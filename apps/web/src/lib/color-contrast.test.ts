import { describe, expect, it } from 'vitest';
import { contrastRatio, deriveAccentTokens } from '@/lib/color-contrast';

describe('workspace accent tokens', () => {
  it.each(['#000000', '#ffffff', '#5b8def', '#7f7f7f', '#ff00ff'])(
    'derives readable semantic colours from %s',
    (accent) => {
      const tokens = deriveAccentTokens(accent);

      expect(contrastRatio(tokens.readableOnDark, '#0b0e14')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.readableOnDark, '#131722')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.readableOnLight, '#f5f6f8')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.readableOnLight, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('fails safely to the dashboard default for an invalid colour', () => {
    expect(deriveAccentTokens('not-a-colour').brand).toBe('#5b8def');
  });
});
