import { cookies } from 'next/headers';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const AUTH_COOKIE_NAME = 'ventureos_session';

/**
 * Server-component fetch helper: forwards the incoming session cookie to the
 * API so server-rendered pages reflect real, server-verified auth state -
 * never a client-trusted flag.
 */
export async function serverApiFetch<T>(path: string): Promise<{ data: T | null; status: number }> {
  const cookieStore = cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    headers: token ? { Cookie: `${AUTH_COOKIE_NAME}=${token}` } : {},
    cache: 'no-store',
  });

  if (!res.ok) {
    return { data: null, status: res.status };
  }
  return { data: (await res.json()) as T, status: res.status };
}
