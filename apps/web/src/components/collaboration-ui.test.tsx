import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.stubGlobal('React', React);

import { writeInvitationToClipboard } from '@/components/team-actions';
import { DashboardNav } from '@/components/dashboard-nav';

describe('collaboration invitation clipboard', () => {
  it('copies through the provided clipboard and reports unavailable clipboard access', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await writeInvitationToClipboard('https://example.test/join#token=secret', { writeText });
    expect(writeText).toHaveBeenCalledWith('https://example.test/join#token=secret');

    await expect(
      writeInvitationToClipboard('https://example.test/join#token=secret', undefined),
    ).rejects.toThrow('Clipboard access is unavailable');
  });
});

describe('permission-aware collaboration navigation', () => {
  it('does not advertise founder-only onboarding or settings to a viewer', () => {
    const html = renderToStaticMarkup(
      React.createElement(DashboardNav, { permissions: ['opportunity:view', 'board:view'] }),
    );
    expect(html).toContain('Opportunity Feed');
    expect(html).toContain('Board Room');
    expect(html).not.toContain('Onboarding');
    expect(html).not.toContain('Settings');
  });
});
