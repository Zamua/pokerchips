import type { ErrorCode } from '../domain/errors.js';
import type { Entry } from '../domain/ledger.js';
import type { Command, Table } from '../domain/table.js';
import { type Chips, LEDGER_TAIL, type Parsed, type SeatId, type SeatName, isPotId, parseBuyIn, parseSeatName } from '../domain/values.js';

export interface SeatView {
  id: SeatId;
  name: string;
  stack: number;
  /** The same as isHere(seat); still sent for clients on an older build. */
  here: boolean;
  /** null while a connection holds the seat. */
  awaySince: number | null;
}

export const isHere = (seat: Pick<SeatView, 'awaySince'>) => seat.awaySince === null;

/** The whole table as every client sees it; never a seat key. */
export interface TableView {
  code: string;
  createdAt: number;
  buyIn: number;
  seq: number;
  host: SeatId;
  seats: SeatView[];
  pots: { id: string; amount: number }[];
  ledger: Entry[];
  undoable: number | null;
}

export type ClientFrame =
  | { t: 'hello'; seatKey: string }
  | { t: 'cmd'; op: string; cmd: Command }
  | { t: 'history'; before: number }
  | { t: 'ping' };

export type ServerFrame =
  | { t: 'welcome'; seatId: SeatId; state: TableView }
  | { t: 'denied'; code: 'not-found' | 'bad-frame' }
  | { t: 'state'; state: TableView }
  | { t: 'ack'; op: string; seq: number }
  | { t: 'nack'; op: string; code: ErrorCode }
  | { t: 'history'; entries: Entry[] }
  | { t: 'pong' };

export const PING = JSON.stringify({ t: 'ping' });
export const PONG = JSON.stringify({ t: 'pong' });

/** The newest ledger entries, oldest first, as a view carries them. */
export function viewOf(table: Table, ledgerTail: Entry[]): TableView {
  return {
    code: table.code,
    createdAt: table.createdAt,
    buyIn: table.buyIn,
    seq: table.seq,
    host: table.host,
    seats: table.seats.map((s) => ({
      id: s.id,
      name: s.name,
      stack: s.stack,
      here: isHere(s),
      awaySince: s.awaySince,
    })),
    pots: table.pots.map((p) => ({ id: p.id, amount: p.amount })),
    ledger: ledgerTail.slice(-LEDGER_TAIL),
    undoable: table.undoable?.seq ?? null,
  };
}

const OP = /^[A-Za-z0-9_-]{1,64}$/;
const KEY = /^[0-9a-f]{32}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The op of a frame that may not parse as a whole, or '' when it has none. */
export function opOf(text: string): string {
  try {
    const v: unknown = JSON.parse(text);
    return isObject(v) && typeof v.op === 'string' && OP.test(v.op) ? v.op : '';
  } catch {
    return '';
  }
}

/** Untrusted text to a frame, or null. The domain still applies its rules to the values. */
export function parseClientFrame(text: string): ClientFrame | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(v)) return null;
  switch (v.t) {
    case 'hello':
      return typeof v.seatKey === 'string' && KEY.test(v.seatKey) ? { t: 'hello', seatKey: v.seatKey } : null;
    case 'ping':
      return { t: 'ping' };
    case 'history':
      return Number.isSafeInteger(v.before) ? { t: 'history', before: v.before as number } : null;
    case 'cmd': {
      if (typeof v.op !== 'string' || !OP.test(v.op)) return null;
      const cmd = parseCommand(v.cmd);
      return cmd ? { t: 'cmd', op: v.op, cmd } : null;
    }
    default:
      return null;
  }
}

function parseCommand(c: unknown): Command | null {
  if (!isObject(c)) return null;
  const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : undefined);
  const num = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : undefined);
  const pot = str('pot');
  switch (c.type) {
    case 'bet':
      return isPotId(pot) && num('amount') !== undefined ? { type: 'bet', pot, amount: num('amount')! } : null;
    case 'collect':
      if (!isPotId(pot) || (c.amount !== undefined && num('amount') === undefined)) return null;
      return num('amount') === undefined ? { type: 'collect', pot } : { type: 'collect', pot, amount: num('amount')! };
    case 'split':
      return isPotId(pot) && Array.isArray(c.seats) && c.seats.every((s) => typeof s === 'string')
        ? { type: 'split', pot, seats: c.seats as string[] }
        : null;
    case 'adjust': {
      const reason = str('reason');
      if (num('delta') === undefined || (reason !== 'rebuy' && reason !== 'cashout' && reason !== 'correction')) return null;
      if (c.seat !== undefined && str('seat') === undefined) return null;
      const adjust: Command = { type: 'adjust', delta: num('delta')!, reason };
      return str('seat') === undefined ? adjust : { ...adjust, seat: str('seat')! };
    }
    case 'undo':
      return Number.isSafeInteger(c.seq) ? { type: 'undo', seq: c.seq as number } : null;
    case 'openPot':
    case 'clear':
    case 'claimHost':
      return { type: c.type };
    case 'closePot':
      return isPotId(pot) ? { type: 'closePot', pot } : null;
    case 'handOver':
    case 'remove':
      return str('seat') !== undefined ? { type: c.type, seat: str('seat')! } : null;
    default:
      return null;
  }
}

/** The body of `POST /api/tables`. */
export interface OpenRequest {
  name: SeatName;
  buyIn: Chips;
}

/** The body of `POST /api/tables/<code>/seats`. */
export interface JoinRequest {
  name: SeatName;
}

/** Untrusted JSON to a join request, or why not. */
export function parseJoinRequest(body: unknown): Parsed<JoinRequest> {
  if (!isObject(body)) return { ok: false, code: 'bad-frame' };
  const name = parseSeatName(body.name);
  return name.ok ? { ok: true, value: { name: name.value } } : name;
}

/** Untrusted JSON to an open request, or why not; a missing buy-in takes the default. */
export function parseOpenRequest(body: unknown): Parsed<OpenRequest> {
  if (!isObject(body)) return { ok: false, code: 'bad-frame' };
  const name = parseSeatName(body.name);
  if (!name.ok) return name;
  const buyIn = parseBuyIn(body.buyIn);
  return buyIn.ok ? { ok: true, value: { name: name.value, buyIn: buyIn.value } } : buyIn;
}
