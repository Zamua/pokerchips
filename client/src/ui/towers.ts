/** The chip palette, also the page's accent colors. */
export const COLORS = {
  tomato: '#FF5B3D',
  sun: '#FFD23F',
  mint: '#2CCB7F',
  pink: '#FF9BD2',
  sky: '#A8D8FF',
  lilac: '#9C7BFF',
  ink: '#14143A',
  paper: '#FFFFFF',
  mist: '#C9CFF5',
} as const;

export type ChipColor = keyof typeof COLORS;

/** A chip seen from the side: its width, edge thickness, and the vertical radius of its face. */
export interface ChipSize {
  w: number;
  th: number;
  ry: number;
}

export const chipSize = (w: number): ChipSize => ({ w, th: w * 0.2, ry: w * 0.26 });

const JITTER = [0, 2, -1, 3, -2, 1, 0, -3, 2, -1, 1, -2];

/** How far the chip at `level` of a drawn stack sits off the stack's line; the bottom chip sits on it. */
export const stackJitter = (level: number) => JITTER[level % JITTER.length];

const LIGHT: ReadonlySet<ChipColor> = new Set(['paper', 'sun', 'sky', 'mist', 'pink']);

/** The edge-mark color that reads on a chip of this color. */
export const markOn = (c: ChipColor) => (LIGHT.has(c) ? COLORS.ink : COLORS.paper);

/** Quick-bet chips by value, as a casino colors them; other values get a palette color. */
const BY_VALUE: Record<number, ChipColor> = { 1: 'paper', 5: 'tomato', 25: 'mint', 100: 'ink', 500: 'lilac', 1_000: 'sun', 5_000: 'pink', 25_000: 'sky' };

export const chipColor = (value: number): ChipColor => BY_VALUE[value] ?? 'paper';

const SEAT_COLORS: ChipColor[] = ['pink', 'sky', 'lilac', 'mint', 'tomato', 'sun'];

/**
 * An avatar color: by place at the table when the seats are given, so
 * neighbours differ and every phone agrees; otherwise from the id alone.
 */
export function seatColor(id: string, seats?: readonly { id: string }[]): ChipColor {
  const i = seats?.findIndex((s) => s.id === id) ?? -1;
  if (i >= 0) return SEAT_COLORS[i % SEAT_COLORS.length];
  let h = 2_166_136_261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16_777_619) >>> 0;
  return SEAT_COLORS[h % SEAT_COLORS.length];
}

export interface TowerShape {
  /** Chips that stand for one tenth of the buy-in. */
  unit: number;
  perStack: number;
  stacks: number;
}

const TOWER_COLORS: ChipColor[] = ['tomato', 'mint', 'ink', 'paper', 'lilac', 'sun', 'sky'];

/**
 * Chip stacks for an amount, colors bottom to top: a buy-in reads as ten
 * chips, so a tower grows with the amount until the shape is full. The same
 * amount always draws the same tower.
 */
export function towerOf(amount: number, shape: TowerShape): ChipColor[][] {
  if (!(amount > 0)) return [];
  const cap = shape.perStack * shape.stacks;
  const chips = Math.min(cap, Math.max(1, Math.ceil(amount / Math.max(1, shape.unit))));
  const k = Math.ceil(chips / shape.perStack);
  const heights = Array.from({ length: k }, (_, i) => Math.floor(chips / k) + (i >= k - (chips % k) ? 1 : 0));
  if (k > 1) {
    const move = Math.min(Math.floor(heights[0] * 0.35), shape.perStack - heights[k - 1]);
    heights[0] -= move;
    heights[k - 1] += move;
  }
  let seed = (amount % 2_147_483_647) || 1;
  const next = () => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed;
  };
  return heights.map((h) => Array.from({ length: h }, () => TOWER_COLORS[next() % TOWER_COLORS.length]));
}
