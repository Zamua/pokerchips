import { DENOMINATIONS } from '../ui/text.js';
import type { ChipSize } from '../ui/towers.js';

/** The most chips a tray stack holds. */
export const TRAY_CAP = 9;
/** The most chips the felt shows; a larger typed amount shows its largest chips. */
export const FELT_CAP = 30;

/** A chip put in; its id follows it from the tray to the felt and back. */
export interface Thrown {
  id: number;
  value: number;
}

/** A bet being made with chips: its total, and the chips that show it, in the order they went in. */
export interface Bet {
  amount: number;
  thrown: Thrown[];
  next: number;
}

export type BetAction = { t: 'throw'; value: number } | { t: 'undo' } | { t: 'reset' } | { t: 'set'; amount: number };

export const emptyBet: Bet = { amount: 0, thrown: [], next: 1 };

/** Chips per tray stack: as many of each value as `left` covers, up to TRAY_CAP. */
export const tray = (values: readonly number[], left: number) => values.map((v) => Math.min(TRAY_CAP, Math.floor(Math.max(0, left) / v)));

/** The fewest chips that make an amount, largest first, at most `cap` of them. */
export function change(amount: number, cap = FELT_CAP): number[] {
  const out: number[] = [];
  let rest = amount;
  for (let i = DENOMINATIONS.length - 1; i >= 0 && out.length < cap; i--) {
    const v = DENOMINATIONS[i];
    while (rest >= v && out.length < cap) {
      out.push(v);
      rest -= v;
    }
  }
  return out;
}

export function bet(b: Bet, a: BetAction): Bet {
  switch (a.t) {
    case 'throw':
      return { amount: b.amount + a.value, thrown: [...b.thrown, { id: b.next, value: a.value }], next: b.next + 1 };
    case 'undo': {
      const last = b.thrown.at(-1);
      if (!last) return { ...b, amount: 0 };
      return { ...b, amount: Math.max(0, b.amount - last.value), thrown: b.thrown.slice(0, -1) };
    }
    case 'reset':
      return { ...b, amount: 0, thrown: [] };
    case 'set': {
      const want = change(a.amount);
      const thrown = b.thrown.filter((c) => {
        const k = want.indexOf(c.value);
        if (k < 0) return false;
        want.splice(k, 1);
        return true;
      });
      let next = b.next;
      for (const value of want) thrown.push({ id: next++, value });
      return { amount: a.amount, thrown, next };
    }
  }
}

/**
 * Neat stacks for chips that are not tumbling: one or more stacks per value,
 * largest value first, centered on `center` with their bottoms on `ground`.
 * Positions follow `values`' order.
 */
export function pile(values: readonly number[], center: number, ground: number, size: ChipSize, perStack = 8): { x: number; y: number }[] {
  const cols: number[][] = [];
  for (const v of [...new Set(values)].sort((a, b) => b - a)) {
    let col: number[] = [];
    values.forEach((x, i) => {
      if (x !== v) return;
      if (col.length === perStack) {
        cols.push(col);
        col = [];
      }
      col.push(i);
    });
    cols.push(col);
  }
  const gap = size.w + 6;
  const out: { x: number; y: number }[] = new Array(values.length);
  cols.forEach((col, c) => col.forEach((i, level) => (out[i] = { x: center + (c - (cols.length - 1) / 2) * gap, y: ground - (level + 0.5) * size.th })));
  return out;
}
