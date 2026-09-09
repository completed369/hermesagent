import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RootPage from '@/app/page';
import ProgressPage from '@/app/progress/page';
import { BUILD_STATUS } from './build-status';

vi.stubGlobal('React', React);

describe('public build truth', () => {
  it('keeps both public routes aligned without claiming live release evidence', () => {
    for (const page of [RootPage, ProgressPage]) {
      const html = renderToStaticMarkup(React.createElement(page));
      for (const milestone of BUILD_STATUS.milestones) {
        const title = milestone.title.replaceAll('&', '&amp;');
        expect(html).toContain(title);
      }
      expect(html).toContain('mock-provider rehearsals');
      expect(html).toContain('Not verified');
      expect(html).not.toMatch(
        /Explore live progress|shipped platform capability|systems complete/,
      );
    }
  });
});
