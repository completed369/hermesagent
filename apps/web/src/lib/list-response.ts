export type ListResponseState<T> =
  | { kind: 'unavailable'; items: T[] }
  | { kind: 'empty'; items: T[] }
  | { kind: 'ready'; items: T[] };

/** A failed or malformed list request must never masquerade as a real zero state. */
export function resolveListResponse<T>(data: T[] | null, status: number): ListResponseState<T> {
  if (status !== 200 || data === null) return { kind: 'unavailable', items: [] };
  if (data.length === 0) return { kind: 'empty', items: data };
  return { kind: 'ready', items: data };
}
