import type { Chips, PotId, SeatId } from './values.js';

export type AdjustReason = 'buyin' | 'rebuy' | 'cashout' | 'correction';
export type NoteKind = 'joined' | 'claimed' | 'removed' | 'imported';

/** Signed changes to stacks and pots, keyed by seat and pot id. */
export interface Deltas {
  stacks: Record<SeatId, number>;
  pots: Record<PotId, number>;
}

interface Base {
  seq: number;
  at: number;
}

/** The seat that acted, and its name then, so the entry still reads after a removal. */
interface Acted {
  by: SeatId;
  byName: string;
}

export type Entry = Base &
  (
    | (Acted &
        (
          | { kind: 'bet'; pot: PotId; amount: Chips }
          | { kind: 'collect'; pot: PotId; amount: Chips }
          | { kind: 'split'; pot: PotId; shares: { seat: SeatId; name: string; amount: Chips }[] }
          | { kind: 'adjust'; seat: SeatId; name: string; delta: number; reason: AdjustReason }
          | { kind: 'clear'; pots: { pot: PotId; amount: Chips }[] }
          | { kind: 'undo'; of: number; deltas: Deltas }
          | { kind: 'openPot'; pot: PotId }
          | { kind: 'closePot'; pot: PotId; moved: Chips }
          | { kind: 'handOver'; to: SeatId; toName: string }
        ))
    /** A note from the table itself, such as an import, has no actor. */
    | ({ kind: 'note'; note: NoteKind; seat: SeatId | null; name: string; text?: string } & (Acted | { by: null; byName: null }))
  );

export type EntryKind = Entry['kind'];

const UNDOABLE_KINDS = ['bet', 'collect', 'split', 'adjust', 'clear'] as const satisfies readonly EntryKind[];
type UndoableKind = (typeof UNDOABLE_KINDS)[number];
const UNDOABLE: ReadonlySet<EntryKind> = new Set(UNDOABLE_KINDS);

/** Entries an undo can reverse. */
export const isUndoable = (e: Entry): e is Extract<Entry, { kind: UndoableKind }> => UNDOABLE.has(e.kind);

/** Entries that move chips; each one ends the undo window of the one before. */
export const MOVES_CHIPS: ReadonlySet<EntryKind> = new Set([
  'bet',
  'collect',
  'split',
  'adjust',
  'clear',
  'undo',
  'closePot',
]);

export function deltasOf(entry: Entry): Deltas {
  const d: Deltas = { stacks: {}, pots: {} };
  const stack = (seat: SeatId, n: number) => (d.stacks[seat] = (d.stacks[seat] ?? 0) + n);
  const pot = (id: PotId, n: number) => (d.pots[id] = (d.pots[id] ?? 0) + n);
  switch (entry.kind) {
    case 'bet':
      stack(entry.by, -entry.amount);
      pot(entry.pot, entry.amount);
      break;
    case 'collect':
      pot(entry.pot, -entry.amount);
      stack(entry.by, entry.amount);
      break;
    case 'split':
      for (const share of entry.shares) {
        pot(entry.pot, -share.amount);
        stack(share.seat, share.amount);
      }
      break;
    case 'adjust':
      stack(entry.seat, entry.delta);
      break;
    case 'clear':
      for (const p of entry.pots) pot(p.pot, -p.amount);
      break;
    case 'undo':
      return entry.deltas;
    default:
      break;
  }
  return d;
}

export function negate(d: Deltas): Deltas {
  const flip = (r: Record<string, number>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, -v]));
  return { stacks: flip(d.stacks), pots: flip(d.pots) };
}
