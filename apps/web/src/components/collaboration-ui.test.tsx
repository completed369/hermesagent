import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const teamSource = fs.readFileSync(new URL('./team-actions.tsx', import.meta.url), 'utf8');
const joinSource = fs.readFileSync(
  new URL('../app/join/[token]/page.tsx', import.meta.url),
  'utf8',
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { writeInvitationToClipboard } from '@/components/team-actions';

describe('collaboration UI accessibility', () => {
  it('keeps status announcements and responsive team hooks in the rendered component', () => {
    expect(teamSource).toMatch(/role="status"\s+aria-live="polite"\s+aria-atomic="true"/);
    expect(teamSource).toContain('className="vos-team-invite"');
    expect(teamSource).toContain('aria-label="Workspace members"');
    expect(teamSource).toContain('aria-busy={busy === member.id}');
    expect(teamSource).toContain('Single use · expires in 72 hours · no email provider');
  });

  it('copies through the provided clipboard and reports unavailable clipboard access', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await writeInvitationToClipboard('https://example.test/join/token', { writeText });
    expect(writeText).toHaveBeenCalledWith('https://example.test/join/token');

    await expect(
      writeInvitationToClipboard('https://example.test/join/token', undefined),
    ).rejects.toThrow('Clipboard access is unavailable');
  });

  it('keeps invitation verification announced without a misleading sign-in action', () => {
    expect(joinSource).toContain("previewState === 'checking' || accepting");
    expect(joinSource).toMatch(/role="status"\s+aria-live="polite"\s+aria-atomic="true"/);
    expect(joinSource).toContain('Checking this invitation.');
    expect(joinSource).toContain('This invitation creates a new workspace account.');
    expect(joinSource).not.toContain('Already registered?');
    expect(joinSource).not.toContain('href="/login"');
  });
});
