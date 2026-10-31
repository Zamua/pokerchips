import type { ErrorCode } from './errors.js';
import type { Entry } from './ledger.js';
import type { Seat, Table } from './table.js';
import { MAIN_POT, NAME_MAX, dropNameChars, isChips, parseTableCode, sidePotNumber } from './values.js';

/** A room as version 2 persisted it. Every field is untrusted. */
export interface LegacyRoom {
  id?: unknown;
  createdAt?: unknown;
  creatorId?: unknown;
  settings?: { startingChips?: unknown };
  players?: unknown;
  pots?: unknown;
  pot?: unknown;
  sidePotCounter?: unknown;
  activityLog?: unknown;
  lastActivityAt?: unknown;
}

export type Imported = { ok: true; table: Table; entries: Entry[] } | { ok: false; code: ErrorCode; detail: string };

const time = (v: unknown, fallback: number) => (Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : fallback);

/** A seat id from a version 2 player id (a UUID): its first 16 hex digits. */
export function seatIdOf(legacyId: string): string {
  return legacyId.replaceAll('-', '').toLowerCase().slice(0, 16);
}

/** A version 2 name made valid: spaces collapsed, other characters dropped, cut to length. */
export function cleanName(raw: unknown, n: number): string {
  const name = dropNameChars((typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ')).trim().slice(0, NAME_MAX).trim();
  return name || `Player ${n}`;
}

function unique(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) {
    const suffix = ` ${i}`;
    candidate = name.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * A version 2 room as a table: same code, stacks, pots and host; every seat
 * away and keyless, to be claimed by name; its activity as notes.
 */
export function importLegacy(room: LegacyRoom, now: number): Imported {
  const fail = (code: ErrorCode, detail: string): Imported => ({ ok: false, code, detail });
  const code = parseTableCode(room.id);
  if (!code.ok) return fail('bad-code', 'room id');
  if (!Array.isArray(room.players) || room.players.length === 0) return fail('no-such-seat', 'no players');

  const createdAt = time(room.createdAt, now);
  const taken = new Set<string>();
  const seats: Seat[] = [];
  for (const [i, p] of (room.players as Record<string, unknown>[]).entries()) {
    if (typeof p?.id !== 'string' || seatIdOf(p.id).length !== 16) return fail('no-such-seat', `player ${i} id`);
    if (!isChips(p.chips)) return fail('bad-amount', `player ${i} chips`);
    const id = seatIdOf(p.id);
    if (seats.some((s) => s.id === id)) return fail('no-such-seat', `player ${i} id repeats`);
    seats.push({ id, name: unique(cleanName(p.name, i + 1), taken), stack: p.chips, keyHash: '', awaySince: now });
  }

  const legacyPots = Array.isArray(room.pots)
    ? (room.pots as Record<string, unknown>[])
    : [{ id: MAIN_POT, amount: room.pot ?? 0 }];
  const pots = [{ id: MAIN_POT, amount: 0 }];
  let highest = 0;
  for (const p of legacyPots) {
    if (!isChips(p?.amount)) return fail('bad-amount', `pot ${String(p?.id)}`);
    if (p.id === MAIN_POT) {
      pots[0].amount = p.amount;
      continue;
    }
    const side = typeof p.id === 'string' ? sidePotNumber(p.id) : null;
    if (side === null || pots.some((x) => x.id === p.id)) return fail('no-such-pot', `pot ${String(p.id)}`);
    highest = Math.max(highest, side);
    pots.push({ id: p.id as string, amount: p.amount });
  }
  const counter = Number.isSafeInteger(room.sidePotCounter) ? (room.sidePotCounter as number) : 0;

  const creator = typeof room.creatorId === 'string' ? seatIdOf(room.creatorId) : '';
  const host = seats.some((s) => s.id === creator) ? creator : seats[0].id;

  const log = Array.isArray(room.activityLog) ? (room.activityLog as Record<string, unknown>[]) : [];
  const entries: Entry[] = [];
  let at = createdAt;
  for (const item of log) {
    if (typeof item?.message !== 'string') continue;
    at = Math.max(at, time(item.createdAt, at));
    entries.push({ seq: entries.length + 1, at, by: null, byName: null, kind: 'note', note: 'imported', seat: null, name: '', text: item.message.slice(0, 200) });
  }
  const lastActivity = Math.max(at, time(room.lastActivityAt, createdAt));
  entries.push({ seq: entries.length + 1, at: now, by: null, byName: null, kind: 'note', note: 'imported', seat: null, name: '', text: 'Moved from the old pokerchips' });

  const buyIn = room.settings?.startingChips;
  const table: Table = {
    code: code.value,
    createdAt,
    buyIn: Number.isSafeInteger(buyIn) && (buyIn as number) >= 1 ? (buyIn as number) : 1_000,
    host,
    seats,
    pots,
    nextSidePot: Math.max(counter, highest) + 1,
    seq: entries.length,
    undoable: null,
    lastActivity,
  };
  return { ok: true, table, entries };
}
