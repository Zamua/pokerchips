import type { ErrorCode } from '../../../domain/errors.js';

export type Seated = { code: string; seatId: string; seatKey: string };
export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode | 'network' };

async function request<T>(path: string, body?: unknown): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: 'network' };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) return { ok: false, code: (json?.error as ErrorCode) ?? 'network' };
  return { ok: true, value: json as T };
}

export const api = {
  open: (name: string, buyIn: number) => request<Seated>('/api/tables', { name, buyIn }),
  info: (code: string) => request<{ code: string; seats: { name: string; here: boolean }[] }>(`/api/tables/${code}`),
  join: async (code: string, name: string): Promise<Result<Seated>> => {
    const r = await request<{ seatId: string; seatKey: string }>(`/api/tables/${code}/seats`, { name });
    return r.ok ? { ok: true, value: { code, ...r.value } } : r;
  },
  socketUrl: (code: string) => {
    const { protocol, host } = window.location;
    return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/tables/${code}/socket`;
  },
};
