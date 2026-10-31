import type { ErrorCode } from './errors.js';
import { type Deltas, type Entry, MOVES_CHIPS, deltasOf, isUndoable, negate } from './ledger.js';
import {
  type Chips,
  HOST_CLAIM_AFTER_MS,
  MAIN_POT,
  MAX_SEATS,
  MAX_SIDE_POTS,
  type PotId,
  type SeatId,
  type TableCode,
  parseAmount,
  parseBuyIn,
  parseDelta,
  parseSeatName,
  sameName,
  sidePotId,
} from './values.js';

export interface Seat {
  id: SeatId;
  name: string;
  stack: Chips;
  /** Hash of the seat key; opaque to the domain. */
  keyHash: string;
  /** null while a connection holds the seat. */
  awaySince: number | null;
}

export interface Pot {
  id: PotId;
  amount: Chips;
}

export interface Undoable {
  seq: number;
  by: SeatId;
  deltas: Deltas;
}

export interface Table {
  code: TableCode;
  createdAt: number;
  buyIn: Chips;
  host: SeatId;
  seats: Seat[];
  pots: Pot[];
  nextSidePot: number;
  /** The last ledger entry's sequence number. */
  seq: number;
  undoable: Undoable | null;
  lastActivity: number;
}

export type Command =
  | { type: 'bet'; pot: PotId; amount: number }
  | { type: 'collect'; pot: PotId; amount?: number }
  | { type: 'split'; pot: PotId; seats: SeatId[] }
  | { type: 'adjust'; seat?: SeatId; delta: number; reason: 'rebuy' | 'cashout' | 'correction' }
  | { type: 'undo'; seq: number }
  | { type: 'openPot' }
  | { type: 'closePot'; pot: PotId }
  | { type: 'clear' }
  | { type: 'handOver'; seat: SeatId }
  | { type: 'claimHost' }
  | { type: 'remove'; seat: SeatId };

type Refused = { ok: false; code: ErrorCode };

export type Outcome = { ok: true; table: Table; entries: Entry[] } | Refused;

/** Opening or joining: the outcome, and on success the seat it gave. */
export type SeatOutcome = { ok: true; table: Table; entries: Entry[]; seat: SeatId } | Refused;

/** An entry before the table numbers and stamps it. */
type Draft = Entry extends infer E ? (E extends Entry ? Omit<E, 'seq' | 'at'> : never) : never;

const refuse = (code: ErrorCode): Refused => ({ ok: false, code });

export interface NewSeat {
  name: unknown;
  seatId: SeatId;
  keyHash: string;
  now: number;
}

export function openTable(args: NewSeat & { code: TableCode; buyIn?: unknown }): SeatOutcome {
  const name = parseSeatName(args.name);
  if (!name.ok) return refuse(name.code);
  const buyIn = parseBuyIn(args.buyIn);
  if (!buyIn.ok) return refuse(buyIn.code);
  const table: Table = {
    code: args.code,
    createdAt: args.now,
    buyIn: buyIn.value,
    host: args.seatId,
    seats: [{ id: args.seatId, name: name.value, stack: 0, keyHash: args.keyHash, awaySince: args.now }],
    pots: [{ id: MAIN_POT, amount: 0 }],
    nextSidePot: 1,
    seq: 0,
    undoable: null,
    lastActivity: args.now,
  };
  return withSeat(commit(table, args.now, [buyInEntry(table, args.seatId, name.value)]), args.seatId);
}

/** A new name takes a new seat; the name of an away seat takes that seat over. */
export function join(table: Table, args: NewSeat): SeatOutcome {
  const name = parseSeatName(args.name);
  if (!name.ok) return refuse(name.code);
  const existing = table.seats.find((s) => sameName(s.name, name.value));
  if (existing) {
    if (existing.awaySince === null) return refuse('name-taken');
    const claimed = replaceSeat(table, { ...existing, keyHash: args.keyHash });
    const note: Draft = { kind: 'note', note: 'claimed', seat: existing.id, name: existing.name, by: existing.id, byName: existing.name };
    return withSeat(commit(claimed, args.now, [note]), existing.id);
  }
  if (table.seats.length >= MAX_SEATS) return refuse('table-full');
  const seat: Seat = { id: args.seatId, name: name.value, stack: 0, keyHash: args.keyHash, awaySince: args.now };
  const seated = { ...table, seats: [...table.seats, seat] };
  return withSeat(commit(seated, args.now, [buyInEntry(seated, seat.id, seat.name)]), seat.id);
}

/** The host's seat is gone, or has been away long enough for another player to take it over. */
export function hostClaimable(t: Pick<Table, 'host'> & { seats: readonly Pick<Seat, 'id' | 'awaySince'>[] }, now: number): boolean {
  const host = t.seats.find((s) => s.id === t.host);
  return host === undefined || (host.awaySince !== null && now - host.awaySince >= HOST_CLAIM_AFTER_MS);
}

export function seatByKeyHash(table: Table, keyHash: string): Seat | undefined {
  return table.seats.find((s) => s.keyHash === keyHash);
}

/** A connection now holds the seat. */
export function arrive(table: Table, seatId: SeatId, now: number): Table {
  const seat = seatOf(table, seatId);
  if (!seat) return table;
  return { ...replaceSeat(table, { ...seat, awaySince: null }), lastActivity: now };
}

/** The seat's last connection closed. */
export function depart(table: Table, seatId: SeatId, now: number): Table {
  const seat = seatOf(table, seatId);
  if (!seat || seat.awaySince !== null) return table;
  return { ...replaceSeat(table, { ...seat, awaySince: now }), lastActivity: now };
}

export function execute(table: Table, actor: SeatId, cmd: Command, now: number): Outcome {
  const me = seatOf(table, actor);
  if (!me) return refuse('no-such-seat');
  const isHost = table.host === actor;
  const by = { by: actor, byName: me.name };
  switch (cmd.type) {
    case 'bet': {
      const amount = parseAmount(cmd.amount);
      if (!amount.ok) return refuse(amount.code);
      if (!potOf(table, cmd.pot)) return refuse('no-such-pot');
      if (amount.value > me.stack) return refuse('short-stack');
      return commit(table, now, [{ kind: 'bet', pot: cmd.pot, amount: amount.value, ...by }]);
    }
    case 'collect': {
      const pot = potOf(table, cmd.pot);
      if (!pot) return refuse('no-such-pot');
      const amount = parseAmount(cmd.amount ?? pot.amount);
      if (!amount.ok) return refuse(pot.amount === 0 ? 'short-pot' : amount.code);
      if (amount.value > pot.amount) return refuse('short-pot');
      return commit(table, now, [{ kind: 'collect', pot: pot.id, amount: amount.value, ...by }]);
    }
    case 'split': {
      const pot = potOf(table, cmd.pot);
      if (!pot) return refuse('no-such-pot');
      const ids = Array.isArray(cmd.seats) ? cmd.seats : [];
      if (ids.length < 2 || ids.length > MAX_SEATS || new Set(ids).size !== ids.length) return refuse('bad-frame');
      const seats = ids.map((id) => seatOf(table, id));
      if (seats.some((s) => !s)) return refuse('no-such-seat');
      if (pot.amount === 0) return refuse('short-pot');
      const each = Math.floor(pot.amount / ids.length);
      const extra = pot.amount % ids.length;
      const shares = seats.map((s, i) => ({ seat: s!.id, name: s!.name, amount: each + (i < extra ? 1 : 0) }));
      return commit(table, now, [{ kind: 'split', pot: pot.id, shares, ...by }]);
    }
    case 'adjust': {
      const target = seatOf(table, cmd.seat ?? actor);
      if (!target) return refuse('no-such-seat');
      if (target.id !== actor && !isHost) return refuse('not-host');
      if (!['rebuy', 'cashout', 'correction'].includes(cmd.reason)) return refuse('bad-frame');
      const delta = parseDelta(cmd.delta);
      if (!delta.ok) return refuse(delta.code);
      if (target.stack + delta.value < 0) return refuse('short-stack');
      return commit(table, now, [
        { kind: 'adjust', seat: target.id, name: target.name, delta: delta.value, reason: cmd.reason, ...by },
      ]);
    }
    case 'undo': {
      const u = table.undoable;
      if (!u || u.seq !== cmd.seq) return refuse('not-undoable');
      if (u.by !== actor && !isHost) return refuse('not-host');
      return commit(table, now, [{ kind: 'undo', of: u.seq, deltas: negate(u.deltas), ...by }]);
    }
    case 'openPot': {
      if (!isHost) return refuse('not-host');
      if (table.pots.length - 1 >= MAX_SIDE_POTS) return refuse('too-many-pots');
      const id = sidePotId(table.nextSidePot);
      const opened = { ...table, pots: [...table.pots, { id, amount: 0 }], nextSidePot: table.nextSidePot + 1 };
      return commit(opened, now, [{ kind: 'openPot', pot: id, ...by }]);
    }
    case 'closePot': {
      if (!isHost) return refuse('not-host');
      if (cmd.pot === MAIN_POT) return refuse('main-pot');
      const pot = potOf(table, cmd.pot);
      if (!pot) return refuse('no-such-pot');
      const pots = table.pots
        .filter((p) => p.id !== pot.id)
        .map((p) => (p.id === MAIN_POT ? { ...p, amount: p.amount + pot.amount } : p));
      return commit({ ...table, pots }, now, [{ kind: 'closePot', pot: pot.id, moved: pot.amount, ...by }], false);
    }
    case 'clear': {
      if (!isHost) return refuse('not-host');
      const full = table.pots.filter((p) => p.amount > 0).map((p) => ({ pot: p.id, amount: p.amount }));
      if (full.length === 0) return { ok: true, table, entries: [] };
      return commit(table, now, [{ kind: 'clear', pots: full, ...by }]);
    }
    case 'handOver': {
      if (!isHost) return refuse('not-host');
      const to = seatOf(table, cmd.seat);
      if (!to) return refuse('no-such-seat');
      if (to.id === actor) return { ok: true, table, entries: [] };
      return commit({ ...table, host: to.id }, now, [{ kind: 'handOver', to: to.id, toName: to.name, ...by }]);
    }
    case 'claimHost': {
      if (isHost) return { ok: true, table, entries: [] };
      if (!hostClaimable(table, now)) return refuse('host-here');
      return commit({ ...table, host: actor }, now, [{ kind: 'handOver', to: actor, toName: me.name, ...by }]);
    }
    case 'remove': {
      if (!isHost) return refuse('not-host');
      const target = seatOf(table, cmd.seat);
      if (!target) return refuse('no-such-seat');
      if (target.awaySince === null) return refuse('not-away');
      const drafts: Draft[] = [];
      if (target.stack > 0) {
        drafts.push({ kind: 'adjust', seat: target.id, name: target.name, delta: -target.stack, reason: 'cashout', ...by });
      }
      drafts.push({ kind: 'note', note: 'removed', seat: target.id, name: target.name, ...by });
      const cashed = commit(table, now, drafts);
      if (!cashed.ok) return cashed;
      const seats = cashed.table.seats.filter((s) => s.id !== target.id);
      return { ...cashed, table: { ...cashed.table, seats, undoable: null } };
    }
    default:
      return refuse('bad-frame');
  }
}

/** Numbers, stamps and applies drafts; refuses if any stack or pot would break. */
function commit(table: Table, now: number, drafts: Draft[], undoableAfter = true): Outcome {
  let next = table;
  const entries: Entry[] = [];
  for (const draft of drafts) {
    const entry = { ...draft, seq: next.seq + 1, at: now } as Entry;
    const deltas = deltasOf(entry);
    const moved = applyDeltas(next, deltas);
    if (!moved) return refuse('bad-amount');
    const undoable =
      isUndoable(entry) && undoableAfter && !(entry.kind === 'adjust' && entry.reason === 'buyin')
        ? { seq: entry.seq, by: entry.by, deltas }
        : MOVES_CHIPS.has(entry.kind)
          ? null
          : next.undoable;
    next = { ...moved, seq: entry.seq, undoable, lastActivity: now };
    entries.push(entry);
  }
  return { ok: true, table: next, entries };
}

function applyDeltas(table: Table, d: Deltas): Table | null {
  const seats = table.seats.map((s) => ({ ...s, stack: s.stack + (d.stacks[s.id] ?? 0) }));
  const pots = table.pots.map((p) => ({ ...p, amount: p.amount + (d.pots[p.id] ?? 0) }));
  const known =
    Object.keys(d.stacks).every((id) => seats.some((s) => s.id === id)) &&
    Object.keys(d.pots).every((id) => pots.some((p) => p.id === id));
  const valid = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!known || !seats.every((s) => valid(s.stack)) || !pots.every((p) => valid(p.amount))) return null;
  return { ...table, seats, pots };
}

function buyInEntry(table: Table, seat: SeatId, name: string): Draft {
  return { kind: 'adjust', seat, name, delta: table.buyIn, reason: 'buyin', by: seat, byName: name };
}

function withSeat(outcome: Outcome, seat: SeatId): SeatOutcome {
  return outcome.ok ? { ...outcome, seat } : outcome;
}

function seatOf(table: Table, id: SeatId): Seat | undefined {
  return table.seats.find((s) => s.id === id);
}

function potOf(table: Table, id: PotId): Pot | undefined {
  return table.pots.find((p) => p.id === id);
}

function replaceSeat(table: Table, seat: Seat): Table {
  return { ...table, seats: table.seats.map((s) => (s.id === seat.id ? seat : s)) };
}
