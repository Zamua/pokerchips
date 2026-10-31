import { cleanName } from '../../../domain/legacy.js';
import { parseTableCode } from '../../../domain/values.js';
import type { RecentTable } from './recent.js';

/**
 * Version 2 kept the rooms a phone had been in under this key, as
 * `{ roomId, playerName, lastVisited }`. They show in Recent until opened;
 * opening one joins by name, which claims that seat, and drops the entry.
 */
export const LEGACY_KEY = 'pokerChipsRecentRooms';

export interface LegacyTable {
  code: string;
  /** The version 2 name made valid for version 3; empty when nothing usable was left. */
  name: string;
  openedAt: number;
}

/** The stored version 2 list as tables to adopt; anything unreadable is skipped. */
export function parseLegacy(raw: string | null): LegacyTable[] {
  let v: unknown;
  try {
    v = JSON.parse(raw ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: LegacyTable[] = [];
  for (const r of v as Record<string, unknown>[]) {
    const parsed = parseTableCode(r?.roomId);
    if (!parsed.ok || out.some((t) => t.code === parsed.value)) continue;
    const code = parsed.value;
    const name = typeof r.playerName === 'string' && /[a-zA-Z0-9]/.test(r.playerName) ? cleanName(r.playerName, 0) : '';
    const openedAt = Number.isSafeInteger(r.lastVisited) && (r.lastVisited as number) > 0 ? (r.lastVisited as number) : 0;
    out.push({ code, name, openedAt });
  }
  return out;
}

export type RecentItem = { kind: 'seat'; table: RecentTable } | { kind: 'legacy'; table: LegacyTable };

/** One Recent list, newest first; a table this device already has a seat at hides its version 2 entry. */
export function mergeRecent(seats: RecentTable[], legacy: LegacyTable[]): RecentItem[] {
  const held = new Set(seats.map((t) => t.code));
  const items: RecentItem[] = [
    ...seats.map((table) => ({ kind: 'seat' as const, table })),
    ...legacy.filter((t) => !held.has(t.code)).map((table) => ({ kind: 'legacy' as const, table })),
  ];
  return items.sort((a, b) => b.table.openedAt - a.table.openedAt);
}

/** The stored list without one room, keeping every other entry as version 2 wrote it. */
export function withoutRoom(raw: string | null, code: string): string | null {
  let v: unknown;
  try {
    v = JSON.parse(raw ?? '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(v)) return null;
  const kept = v.filter((r) => !(typeof r?.roomId === 'string' && r.roomId.trim().toLowerCase() === code));
  return kept.length ? JSON.stringify(kept) : null;
}

export const legacy = {
  list(): LegacyTable[] {
    try {
      return parseLegacy(localStorage.getItem(LEGACY_KEY));
    } catch {
      return [];
    }
  },
  get(code: string): LegacyTable | undefined {
    return legacy.list().find((t) => t.code === code);
  },
  drop(code: string): void {
    try {
      const next = withoutRoom(localStorage.getItem(LEGACY_KEY), code);
      if (next === null) localStorage.removeItem(LEGACY_KEY);
      else localStorage.setItem(LEGACY_KEY, next);
    } catch {
      // Storage unavailable: the entry stays, and opening it again just claims the seat again.
    }
  },
};
