import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { writeInvitationToClipboard } from '@/components/team-actions';

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
