import { describe, expect, it } from 'vitest';
import { chipSize } from '../ui/towers.js';
import { type Bet, bet, change, emptyBet, FELT_CAP, pile, tray } from './betChips.js';

const values = (b: Bet) => b.thrown.map((c) => c.value);
const run = (...actions: Parameters<typeof bet>[1][]) => actions.reduce(bet, emptyBet);

describe('betting with chips', () => {
  it('fills each tray stack with what the rest of the stack covers, nine at most', () => {
    expect(tray([5, 25, 100, 500], 1_240)).toEqual([9, 9, 9, 2]);
    expect(tray([5, 25, 100, 500], 890)).toEqual([9, 9, 8, 1]);
    expect(tray([5, 25, 100, 500], 4)).toEqual([0, 0, 0, 0]);
  });

  it('makes an amount from the fewest chips, ones for what is left', () => {
    expect(change(350)).toEqual([100, 100, 100, 25, 25]);
    expect(change(352)).toEqual([100, 100, 100, 25, 25, 1, 1]);
    expect(change(1_240)).toEqual([1_000, 100, 100, 25, 5, 5, 5]);
    expect(change(0)).toEqual([]);
  });

  it('shows at most the felt cap of chips, the largest ones', () => {
    const big = change(99_999_999);
    expect(big).toHaveLength(FELT_CAP);
    expect(big.every((v) => v === 100_000)).toBe(true);
  });

  it('adds a thrown chip to the total and takes the last one back on undo', () => {
    const b = run({ t: 'throw', value: 100 }, { t: 'throw', value: 25 }, { t: 'throw', value: 100 });
    expect(b.amount).toBe(225);
    expect(values(b)).toEqual([100, 25, 100]);
    const u = bet(b, { t: 'undo' });
    expect(u.amount).toBe(125);
    expect(u.thrown.map((c) => c.id)).toEqual(b.thrown.slice(0, 2).map((c) => c.id));
    expect(bet(emptyBet, { t: 'undo' })).toEqual(emptyBet);
  });

  it('takes every chip back on reset', () => {
    const b = bet(run({ t: 'throw', value: 5 }, { t: 'throw', value: 500 }), { t: 'reset' });
    expect(b.amount).toBe(0);
    expect(b.thrown).toEqual([]);
  });

  it('gives every chip its own id, never reused', () => {
    const b = run({ t: 'throw', value: 5 }, { t: 'undo' }, { t: 'throw', value: 5 }, { t: 'throw', value: 5 });
    const ids = b.thrown.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    expect(Math.min(...ids)).toBeGreaterThan(1);
  });

  it('turns a typed amount into chips, keeping the chips that still fit', () => {
    const before = run({ t: 'throw', value: 25 }, { t: 'throw', value: 5 }, { t: 'throw', value: 5 });
    const kept = before.thrown[0];
    const b = bet(before, { t: 'set', amount: 350 });
    expect(b.amount).toBe(350);
    expect(b.thrown[0]).toEqual(kept);
    expect([...values(b)].sort((x, y) => y - x)).toEqual([100, 100, 100, 25, 25]);
    expect(bet(b, { t: 'set', amount: 0 })).toMatchObject({ amount: 0, thrown: [] });
  });

  it('stacks still chips by value, largest first, side by side', () => {
    const size = chipSize(44);
    const at = pile([25, 100, 100, 5], 200, 300, size);
    const gap = 50;
    expect(at[1]).toEqual({ x: 200 - gap, y: 300 - size.th / 2 });
    expect(at[2]).toEqual({ x: 200 - gap, y: 300 - 1.5 * size.th });
    expect(at[0].x).toBe(200);
    expect(at[3].x).toBe(200 + gap);
    expect(pile([5, 5, 5], 200, 300, size, 2).map((p) => p.x)).toEqual([175, 175, 225]);
  });
});
