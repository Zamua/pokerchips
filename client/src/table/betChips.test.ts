import { describe, expect, it } from 'vitest';
import { chipSize } from '../ui/towers.js';
import { assortment, type Bet, bet, pile, startBet, type Tray } from './betChips.js';

const V = [5, 25, 100, 500];
const values = (b: Bet) => b.thrown.map((c) => c.value);
const worth = (t: Tray) => Object.entries(t).reduce((n, [v, c]) => n + Number(v) * c, 0);
const run = (b: Bet, ...actions: Parameters<typeof bet>[1][]) => actions.reduce(bet, b);
/** What a bet holds, in the tray and in the pot, always the stack it started from. */
const held = (b: Bet) => worth(b.tray) + b.thrown.reduce((n, c) => n + c.value, 0);

describe('betting with chips', () => {
  it('breaks a stack into chips that add up to it exactly', () => {
    expect(assortment(1_000, V)).toEqual({ 5: 10, 25: 6, 100: 3, 500: 1 });
    expect(assortment(650, V)).toEqual({ 5: 10, 25: 4, 100: 5, 500: 0 });
    for (const stack of [0, 3, 40, 999, 1_003, 7_385, 123_456]) expect(worth(assortment(stack, V))).toBe(stack);
  });

  it('puts an odd remainder in ones', () => {
    expect(assortment(1_003, V)).toMatchObject({ 1: 3 });
    expect(assortment(1_000, V)).not.toHaveProperty('1');
  });

  it('keeps every stack but the largest to a handful of chips', () => {
    const t = assortment(250_000, [100, 500, 1_000, 5_000]);
    for (const v of [100, 500, 1_000]) expect(t[v]).toBeLessThanOrEqual(25);
    expect(worth(t)).toBe(250_000);
  });

  it('moves a thrown chip from the tray to the pot and back on undo', () => {
    const b = run(startBet(1_000, V), { t: 'throw', value: 100 }, { t: 'throw', value: 25 });
    expect(b.amount).toBe(125);
    expect(b.tray).toMatchObject({ 25: 5, 100: 2 });
    expect(held(b)).toBe(1_000);
    const u = bet(b, { t: 'undo' });
    expect(u.amount).toBe(100);
    expect(u.tray).toMatchObject({ 25: 6 });
    expect(u.thrown.map((c) => c.id)).toEqual([b.thrown[0].id]);
  });

  it('breaks the smallest larger chip when a value runs out', () => {
    const b = run(startBet(1_000, V), { t: 'throw', value: 100 }, { t: 'throw', value: 100 }, { t: 'throw', value: 100 });
    expect(b.tray).toEqual({ 5: 10, 25: 6, 100: 5, 500: 0 });
    expect(held(b)).toBe(1_000);
  });

  it('gives back the starting tray on reset, however chips were broken', () => {
    const start = startBet(1_000, V);
    const fives = Array.from({ length: 12 }, () => ({ t: 'throw' as const, value: 5 }));
    const b = run(start, ...fives, { t: 'throw', value: 100 }, { t: 'throw', value: 100 }, { t: 'throw', value: 100 }, { t: 'throw', value: 100 });
    expect(b.tray).not.toEqual(start.tray);
    expect(bet(b, { t: 'reset' }).tray).toEqual(start.tray);
  });

  it('colors up chips that come back on undo, leaving stacks at their share alone', () => {
    const start = startBet(1_000, V);
    const fives = Array.from({ length: 11 }, () => ({ t: 'throw' as const, value: 5 }));
    const undos = Array.from({ length: 11 }, () => ({ t: 'undo' as const }));
    expect(run(start, ...fives, ...undos).tray).toEqual(start.tray);

    const hundreds = run(start, { t: 'throw', value: 100 }, { t: 'throw', value: 100 }, { t: 'throw', value: 100 });
    expect(bet(hundreds, { t: 'undo' }).tray).toEqual({ 5: 10, 25: 6, 100: 6, 500: 0 });
    expect(run(hundreds, { t: 'undo' }, { t: 'undo' }).tray).toEqual({ 5: 10, 25: 6, 100: 2, 500: 1 });
  });

  it('refuses a chip the tray has none of', () => {
    const b = startBet(400, [100, 500]);
    expect(b.tray[500]).toBe(0);
    expect(bet(b, { t: 'throw', value: 500 })).toBe(b);
  });

  it('takes every chip back on reset', () => {
    const start = startBet(1_000, V);
    const b = run(start, { t: 'throw', value: 5 }, { t: 'throw', value: 500 }, { t: 'reset' });
    expect(b.amount).toBe(0);
    expect(b.thrown).toEqual([]);
    expect(worth(b.tray)).toBe(1_000);
  });

  it('turns a typed amount into the fewest chips the tray gives, keeping chips already in', () => {
    const before = run(startBet(1_000, V), { t: 'throw', value: 25 }, { t: 'throw', value: 5 });
    const kept = before.thrown[0];
    const b = bet(before, { t: 'set', amount: 350 });
    expect(b.amount).toBe(350);
    expect(b.thrown[0]).toEqual(kept);
    expect([...values(b)].sort((x, y) => y - x)).toEqual([100, 100, 100, 25, 25]);
    expect(held(b)).toBe(1_000);
    expect(bet(b, { t: 'set', amount: 0 })).toMatchObject({ amount: 0, thrown: [] });
  });

  it('breaks chips to make a typed amount the tray lacks the change for', () => {
    const b = bet(startBet(1_000, [500]), { t: 'set', amount: 30 });
    expect(values(b).reduce((n, v) => n + v, 0)).toBe(30);
    expect(held(b)).toBe(1_000);
  });

  it('puts everything in for a typed amount over the stack, keeping the amount', () => {
    const b = bet(startBet(1_000, V), { t: 'set', amount: 2_000 });
    expect(b.amount).toBe(2_000);
    expect(worth(b.tray)).toBe(0);
    expect(values(b).reduce((n, v) => n + v, 0)).toBe(1_000);
  });

  it('starts over from a new stack, ids still fresh', () => {
    const b = run(startBet(1_000, V), { t: 'throw', value: 100 }, { t: 'restart', stack: 650 });
    expect(b).toMatchObject({ amount: 0, thrown: [], tray: assortment(650, V) });
    expect(bet(b, { t: 'throw', value: 5 }).thrown[0].id).toBeGreaterThan(1);
  });

  it('keeps tray and pot adding up to the stack through any run of actions', () => {
    let seed = 7;
    const rand = (n: number) => (seed = (seed * 48_271) % 2_147_483_647) % n;
    for (const stack of [1_000, 653, 12_340]) {
      let b = startBet(stack, V);
      for (let i = 0; i < 400; i++) {
        const k = rand(10);
        b = bet(b, k < 6 ? { t: 'throw', value: V[rand(4)] } : k < 8 ? { t: 'undo' } : k < 9 ? { t: 'set', amount: rand(stack) } : { t: 'reset' });
        expect(held(b)).toBe(stack);
        expect(Object.values(b.tray).every((n) => n >= 0)).toBe(true);
      }
    }
  });

  it('gives every chip its own id, never reused', () => {
    const b = run(startBet(1_000, V), { t: 'throw', value: 5 }, { t: 'undo' }, { t: 'throw', value: 5 }, { t: 'throw', value: 5 });
    const ids = b.thrown.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    expect(Math.min(...ids)).toBeGreaterThan(1);
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
