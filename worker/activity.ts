import type { Entry } from '../domain/ledger.js';

export type Action = 'active' | 'table_created' | 'game_started' | 'hand_played';

/** The bindings activity events need; without both, nothing is written. */
export interface ActivityEnv {
  ACTIVITY?: AnalyticsEngineDataset;
  ACTIVITY_SALT?: string;
}

const APP = 'pokerchips';

/** A request with this header set to 1 is test traffic and counts for nothing. */
export const SKIP_HEADER = 'X-Activity-Skip';
export const skipped = (request: Request): boolean => request.headers.get(SKIP_HEADER) === '1';
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The actor a device id counts as: 16 hex characters of a keyed hash, so the
 * id itself is never written. null when there is no id or no key.
 */
export async function actorOf(env: ActivityEnv, device: string | null): Promise<string | null> {
  if (!device || !env.ACTIVITY || !env.ACTIVITY_SALT) return null;
  try {
    const text = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', text.encode(env.ACTIVITY_SALT), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, text.encode(`${APP}:${device}`));
    return hex(new Uint8Array(mac)).slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * Writes one event for an actor; no actor, no binding or a failed write is
 * silently nothing. The dataset samples per index, so only `active` is indexed
 * by the bare actor: every other action has its own index and keeps its count.
 */
export function record(env: ActivityEnv, actor: string | null, action: Action): void {
  if (!actor || !env.ACTIVITY) return;
  try {
    env.ACTIVITY.writeDataPoint({ indexes: [action === 'active' ? actor : `${actor}:${action}`], blobs: [APP, action, ''], doubles: [1] });
  } catch {
    // An event is never worth a failed request.
  }
}

/** The events a command's entries amount to; `played` says a bet was made at the table before. */
export function actionsOf(entries: readonly Entry[], played: boolean): Action[] {
  const actions: Action[] = [];
  if (!played && entries.some((e) => e.kind === 'bet')) actions.push('game_started');
  for (const e of entries) if (e.kind === 'collect' || e.kind === 'split') actions.push('hand_played');
  return actions;
}
