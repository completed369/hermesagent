const MAX_API_PATH_LENGTH = 2048;
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });

function apiOrigin(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('API base URL must be a valid absolute URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('API base URL must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('API base URL must not include credentials, query parameters, or fragments');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('API base URL must not include a path');
  }
  return parsed.origin;
}

export function buildApiUrl(baseUrl: string, path: string): string {
  if (
    path.length === 0 ||
    path.length > MAX_API_PATH_LENGTH ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.includes('#') ||
    hasControlCharacter(path) ||
    ENCODED_PATH_SEPARATOR.test(path)
  ) {
    throw new Error('API path must be a bounded root-relative path');
  }

  const origin = apiOrigin(baseUrl);
  const target = new URL(`/api${path}`, `${origin}/`);
  if (
    target.origin !== origin ||
    (target.pathname !== '/api' && !target.pathname.startsWith('/api/'))
  ) {
    throw new Error('API path must remain within the configured API origin and /api prefix');
  }
  return target.toString();
}
