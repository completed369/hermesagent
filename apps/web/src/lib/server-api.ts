import { cookies } from 'next/headers';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const AUTH_COOKIE_NAME = 'ventureos_session';

/**
 * Server-component fetch helper: forwards the incoming session cookie to the
 * API so server-rendered pages reflect real, server-verified auth state -
 * never a client-trusted flag.
 */
export async function serverApiFetch<T>(path: string): Promise<{ data: T | null; status: number }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    headers: token ? { Cookie: `${AUTH_COOKIE_NAME}=${token}` } : {},
    cache: 'no-store',
  });

  if (!res.ok) {
    return { data: null, status: res.status };
  }

  // NestJS sends a genuinely empty response body (not the text "null") when a
  // controller handler returns `null` or `undefined` -- it special-cases nil
  // results as "no body to serialize" rather than calling res.json(null).
  // Every GET-by-something endpoint in this API can legitimately return null
  // (e.g. no FinancialAssumption/FinancialForecast generated yet for a fresh
  // venture), so naively calling res.json() here throws "Unexpected end of
  // JSON input" the first time a real zero-state page is hit -- caught by
  // Phase 7 live browser verification. Read the body as text first and treat
  // an empty string as `null`, matching what every caller's `T | null` return
  // type already expects.
  const text = await res.text();
  if (!text) {
    return { data: null, status: res.status };
  }
  return { data: JSON.parse(text) as T, status: res.status };
}
