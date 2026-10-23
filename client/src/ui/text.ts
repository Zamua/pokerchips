import type { ErrorCode } from '../../../domain/errors.js';
import type { Entry } from '../../../domain/ledger.js';

const SENTENCES: Record<ErrorCode | 'network', string> = {
  'bad-name': 'Names are 1 to 20 letters, digits, spaces or - _ \' .',
  'bad-amount': 'That amount does not work.',
  'bad-code': 'A table code is 8 letters and digits.',
  'not-found': 'That table does not exist any more.',
  'name-taken': 'Someone at the table already has that name.',
  'table-full': 'The table is full (24 seats).',
  'not-host': 'Only the host can do that.',
  'no-such-seat': 'That player has left the table.',
  'no-such-pot': 'That pot is gone.',
  'short-stack': 'You do not have that many chips.',
  'short-pot': 'The pot does not hold that much any more.',
  'too-many-pots': 'A table has at most 8 side pots.',
  'main-pot': 'The main pot cannot close.',
  'not-undoable': 'Too late to undo that.',
  'host-here': 'The host is still here.',
  'not-away': 'Only a player who is away can be removed.',
  'rate-limited': 'Slow down a little.',
  'bad-frame': 'Something went wrong. Try again.',
  network: 'Cannot reach pokerchips. Check your connection.',
};

export const sentence = (code: ErrorCode | 'network') => SENTENCES[code];

export const chips = (n: number) => n.toLocaleString('en-US');

export const potName = (id: string) => (id === 'main' ? 'main pot' : `side pot ${id.slice('side-'.length)}`);

/** 8-character codes read best in two groups: "7b2e41c9" shows as "7B2E 41C9". */
export const showCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`.toUpperCase();

export const DENOMINATIONS = [1, 5, 25, 100, 500, 1_000, 5_000, 25_000, 100_000];

/** Four chip values for quick bets: the largest at most half the buy-in. */
export function quickChips(buyIn: number): number[] {
  const fit = DENOMINATIONS.filter((d) => d <= Math.max(1, buyIn / 2));
  return fit.slice(-4);
}

/** One ledger line, from the reader's point of view. */
export function describe(e: Entry, me: string | null): string {
  const who = e.by === me ? 'You' : (e.byName ?? 'The table');
  switch (e.kind) {
    case 'bet':
      return `${who} bet ${chips(e.amount)} into the ${potName(e.pot)}`;
    case 'collect':
      return `${who} won ${chips(e.amount)} from the ${potName(e.pot)}`;
    case 'split':
      return `${who} split the ${potName(e.pot)}: ${e.shares.map((s) => `${s.seat === me ? 'you' : s.name} ${chips(s.amount)}`).join(', ')}`;
    case 'adjust': {
      const whose = e.seat !== e.by ? `${e.seat === me ? 'your' : `${e.name}'s`}` : e.by === me ? 'your' : 'their';
      if (e.reason === 'buyin') return `${e.seat === me ? 'You' : e.name} bought in for ${chips(e.delta)}`;
      if (e.reason === 'rebuy') return `${who} added ${chips(e.delta)} to ${whose} stack`;
      if (e.reason === 'cashout') return `${who} cashed out ${chips(-e.delta)} from ${whose} stack`;
      return `${who} corrected ${whose} stack by ${e.delta > 0 ? '+' : ''}${chips(e.delta)}`;
    }
    case 'clear':
      return `${who} cleared the pots (${chips(e.pots.reduce((n, p) => n + p.amount, 0))} out of play)`;
    case 'undo':
      return `${who} undid a move`;
    case 'openPot':
      return `${who} opened ${potName(e.pot)}`;
    case 'closePot':
      return `${who} closed ${potName(e.pot)}${e.moved ? `, ${chips(e.moved)} moved to the main pot` : ''}`;
    case 'handOver':
      return `${e.to === me ? 'You are' : `${e.toName} is`} now the host`;
    case 'note':
      if (e.note === 'claimed') return `${e.seat === me ? 'You' : e.name} came back on a new device`;
      if (e.note === 'removed') return `${who} removed ${e.name}`;
      if (e.note === 'imported') return e.text ?? 'Moved from the old pokerchips';
      return `${e.name} joined`;
  }
}

/** A seat's avatar letter. */
export const initial = (name: string) => (name.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase();

/** How long ago, compactly: "now", "4m", "2h", "3d". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When a table was last open, as a phrase: "tonight", "yesterday", "on Sep 27". */
export function when(at: number, now: number): string {
  const a = new Date(at);
  const n = new Date(now);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(n) - day(a)) / 86_400_000);
  if (days <= 0) return a.getHours() >= 17 ? 'tonight' : 'today';
  if (days === 1) return 'yesterday';
  const date = `${MONTHS[a.getMonth()]} ${a.getDate()}`;
  return a.getFullYear() === n.getFullYear() ? `on ${date}` : `on ${date}, ${a.getFullYear()}`;
}

export type Segment = { text: string; kind: 'name' | 'num' | 'plain' };

/** A ledger line in pieces: the actor's name up front, and the chip amounts. */
export function emphasize(line: string, actor: string | null): Segment[] {
  const out: Segment[] = [];
  let rest = line;
  for (const name of ['You', actor]) {
    if (name && rest.startsWith(name) && /^\W|^$/.test(rest.slice(name.length))) {
      out.push({ text: name, kind: 'name' });
      rest = rest.slice(name.length);
      break;
    }
  }
  for (const part of rest.split(/(\d+(?:,\d{3})*)/)) {
    if (!part) continue;
    out.push({ text: part, kind: /^\d/.test(part) ? 'num' : 'plain' });
  }
  return out;
}
