import { DENOMINATIONS } from '../ui/text.js';
import type { ChipSize } from '../ui/towers.js';

/** The most chips the felt draws; a bet of more chips draws its first ones. */
export const FELT_CAP = 40;
/** Every stack but the largest starts with about this many chips at most. */
const SMALL_STACK = 20;
/** The share of a stack each smaller value starts with, smallest value first; the largest takes the rest. */
const SHARES = [0.05, 0.15, 0.3];

/** Chips by value. */
export type Tray = Record<number, number>;

/** A chip put in; its id follows it from the tray to the felt and back. */
export interface Thrown {
  id: number;
  value: number;
}

/**
 * A bet being made with chips: the tray holds the chips left, the thrown ones
 * are in, in the order they went. Tray and thrown always add up to the stack
 * the bet started from; `amount` is the total, which only a typed amount over
 * the stack makes larger than the thrown chips.
 */
export interface Bet {
  amount: number;
  thrown: Thrown[];
  tray: Tray;
  values: readonly number[];
  next: number;
}

export type BetAction =
  | { t: 'throw'; value: number }
  | { t: 'undo' }
  | { t: 'reset' }
  | { t: 'set'; amount: number }
  | { t: 'restart'; stack: number };

/** Change for a chip of value `amount`, in smaller chips, largest first: the tray's values, then any others. */
function changeFor(amount: number, values: readonly number[]): Tray {
  const out: Tray = {};
  let rest = amount;
  const use = [...new Set([...values, ...DENOMINATIONS])].filter((v) => v < amount).sort((a, b) => b - a);
  for (const v of use) {
    const n = Math.floor(rest / v);
    if (n > 0) out[v] = (out[v] ?? 0) + n;
    rest -= n * v;
  }
  return out;
}

const add = (t: Tray, more: Tray): Tray => {
  const out = { ...t };
  for (const [v, n] of Object.entries(more)) out[Number(v)] = (out[Number(v)] ?? 0) + n;
  return out;
};

/**
 * A stack as chips, the way a cashier pays a buy-in: a few of each small
 * value, the largest value for the rest, and ones for a remainder below the
 * smallest value.
 */
export function assortment(stack: number, values: readonly number[]): Tray {
  const vs = [...values].sort((a, b) => a - b);
  const shares = vs.length > 1 ? SHARES.slice(-(vs.length - 1)) : [];
  const t: Tray = Object.fromEntries(vs.map((v) => [v, 0]));
  let rest = Math.max(0, stack);
  vs.slice(0, -1).forEach((v, i) => {
    const n = Math.min(SMALL_STACK, Math.floor((stack * (shares[i] ?? 0)) / v));
    t[v] = n;
    rest -= n * v;
  });
  for (const v of [...vs].reverse()) {
    const n = Math.floor(rest / v);
    t[v] += n;
    rest -= n * v;
  }
  if (rest > 0) t[1] = (t[1] ?? 0) + rest;
  return t;
}

/** Breaks the smallest chip larger than `value` into change, if the tray has one. */
function breakFor(t: Tray, value: number, values: readonly number[]): Tray | null {
  const bigger = Object.keys(t)
    .map(Number)
    .filter((v) => v > value && t[v] > 0)
    .sort((a, b) => a - b)[0];
  if (bigger === undefined) return null;
  return add({ ...t, [bigger]: t[bigger] - 1 }, changeFor(bigger, values));
}

const worth = (t: Tray) => Object.entries(t).reduce((n, [v, c]) => n + Number(v) * c, 0);

/**
 * Swaps extra small chips for larger ones: wherever a stack holds more than
 * its share of a fresh buy-in by a whole larger chip's worth, keeping at
 * least one chip in each of the tray's own stacks.
 */
function colorUp(t: Tray, values: readonly number[]): Tray {
  const share = assortment(worth(t), values);
  const out = { ...t };
  for (const v of [...new Set([...Object.keys(out).map(Number), ...values])].sort((a, b) => a - b)) {
    const up = values.filter((u) => u > v && u % v === 0).sort((a, b) => a - b)[0];
    if (up === undefined) continue;
    const per = up / v;
    const keep = Math.max(share[v] ?? 0, values.includes(v) ? 1 : 0);
    while ((out[v] ?? 0) - per >= keep) {
      out[v] -= per;
      out[up] = (out[up] ?? 0) + 1;
    }
  }
  return out;
}

/** Refills each of the tray's values that ran out, breaking larger chips. */
function refill(t: Tray, values: readonly number[]): Tray {
  let out = t;
  for (const v of [...values].sort((a, b) => a - b)) {
    while (!out[v]) {
      const broken = breakFor(out, v, values);
      if (!broken) break;
      out = broken;
    }
  }
  return out;
}

export const startBet = (stack: number, values: readonly number[]): Bet => ({
  amount: 0,
  thrown: [],
  tray: assortment(stack, values),
  values,
  next: 1,
});

/** The chips for `amount` taken from `pool`, fewest first, breaking chips when the pool lacks change. */
function take(pool: Tray, amount: number, values: readonly number[]): { taken: number[]; left: Tray } {
  let left = { ...pool };
  const taken: number[] = [];
  let rest = amount;
  while (rest > 0) {
    const fits = Object.keys(left)
      .map(Number)
      .filter((v) => v <= rest && left[v] > 0)
      .sort((a, b) => b - a)[0];
    if (fits !== undefined) {
      const n = Math.min(left[fits], Math.floor(rest / fits));
      for (let i = 0; i < n; i++) taken.push(fits);
      left[fits] -= n;
      rest -= n * fits;
      continue;
    }
    const broken = breakFor(left, rest, values);
    if (!broken) break;
    left = broken;
  }
  return { taken, left };
}

export function bet(b: Bet, a: BetAction): Bet {
  switch (a.t) {
    case 'throw': {
      if (!b.tray[a.value]) return b;
      return {
        ...b,
        amount: b.amount + a.value,
        thrown: [...b.thrown, { id: b.next, value: a.value }],
        tray: refill({ ...b.tray, [a.value]: b.tray[a.value] - 1 }, b.values),
        next: b.next + 1,
      };
    }
    case 'undo': {
      const last = b.thrown.at(-1);
      if (!last) return { ...b, amount: 0 };
      return { ...b, amount: Math.max(0, b.amount - last.value), thrown: b.thrown.slice(0, -1), tray: colorUp(add(b.tray, { [last.value]: 1 }), b.values) };
    }
    case 'reset':
      return { ...b, amount: 0, thrown: [], tray: assortment(worth(b.tray) + b.thrown.reduce((n, c) => n + c.value, 0), b.values) };
    case 'restart':
      return { ...startBet(a.stack, b.values), next: b.next };
    case 'set': {
      const pool = b.thrown.reduce((t, c) => add(t, { [c.value]: 1 }), b.tray);
      const { taken, left } = take(pool, a.amount, b.values);
      const thrown = b.thrown.filter((c) => {
        const k = taken.indexOf(c.value);
        if (k < 0) return false;
        taken.splice(k, 1);
        return true;
      });
      let next = b.next;
      for (const value of taken) thrown.push({ id: next++, value });
      return { ...b, amount: a.amount, thrown, tray: refill(colorUp(left, b.values), b.values), next };
    }
  }
}

/** The tray's stacks in order: its values, even when empty, and any other value it holds. */
export const stacksOf = (b: Bet) =>
  [...new Set([...b.values, ...Object.keys(b.tray).map(Number).filter((v) => b.tray[v] > 0)])].sort((x, y) => x - y);

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
