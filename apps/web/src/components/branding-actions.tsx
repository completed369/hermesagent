'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

interface BrandingActionProps {
  brandName: string | null;
  logoUrl: string | null;
  primaryColorHex: string;
}

/** Updates white-label branding (Phase 8 deliverable #4) -- applied to the
 * dashboard shell via the same /workspaces/current summary every page
 * already fetches, so a reselling customer's installation can show its own
 * name/color instead of "VentureOS". */
export function UpdateBrandingAction({ brandName, logoUrl, primaryColorHex }: BrandingActionProps) {
  const router = useRouter();
  const [name, setName] = useState(brandName ?? '');
  const [logo, setLogo] = useState(logoUrl ?? '');
  const [color, setColor] = useState(primaryColorHex);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/workspaces/branding', {
        method: 'PATCH',
        body: JSON.stringify({
          brandName: name || undefined,
          logoUrl: logo || undefined,
          primaryColorHex: color || undefined,
        }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update branding');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10, maxWidth: 360 }}>
      {error && <p className="vos-error">{error}</p>}
      <label style={{ fontSize: 13 }}>
        Brand name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ display: 'block', width: '100%', marginTop: 4 }}
        />
      </label>
      <label style={{ fontSize: 13 }}>
        Logo URL
        <input
          type="text"
          value={logo}
          onChange={(e) => setLogo(e.target.value)}
          placeholder="https://..."
          style={{ display: 'block', width: '100%', marginTop: 4 }}
        />
      </label>
      <label style={{ fontSize: 13 }}>
        Accent color
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{ display: 'block', marginTop: 4 }}
        />
      </label>
      <button onClick={submit} disabled={loading} style={{ justifySelf: 'start' }}>
        {loading ? 'Saving...' : 'Save branding'}
      </button>
    </div>
  );
}
