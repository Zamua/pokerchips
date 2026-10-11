import { describe, expect, it } from 'vitest';
import { chipColor, seatColor, towerOf } from './towers.js';

const shape = { unit: 100, perStack: 11, stacks: 3 };
const count = (t: string[][]) => t.reduce((n, s) => n + s.length, 0);

describe('chip towers', () => {
  it('draws nothing for an empty stack or pot', () => {
    expect(towerOf(0, shape)).toEqual([]);
  });

  it('reads a buy-in as ten chips and grows with the amount up to the shape', () => {
    expect(count(towerOf(1_000, shape))).toBe(10);
    expect(count(towerOf(1, shape))).toBe(1);
    const sizes = [5, 150, 900, 1_400, 2_600, 9_999_999].map((a) => count(towerOf(a, shape)));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(sizes.at(-1)).toBe(33);
  });

  it('keeps every stack within the shape, the tallest at the back', () => {
    for (const a of [1_200, 1_400, 2_500, 3_300, 50_000]) {
      const t = towerOf(a, shape);
      expect(t.length).toBeLessThanOrEqual(3);
      for (const s of t) expect(s.length).toBeLessThanOrEqual(11);
      expect(t.at(-1)!.length).toBe(Math.max(...t.map((s) => s.length)));
    }
    expect(towerOf(1_400, shape).map((s) => s.length)).toEqual([5, 9]);
  });

  it('draws the same amount the same way every time', () => {
    expect(towerOf(1_240, shape)).toEqual(towerOf(1_240, shape));
  });
});

it('colors quick-bet chips like a casino', () => {
  expect([5, 25, 100, 500].map(chipColor)).toEqual(['tomato', 'mint', 'ink', 'lilac']);
});

it('gives a seat the same avatar color everywhere, and neighbours different ones', () => {
  expect(seatColor('a1b2c3d4e5f60718')).toBe(seatColor('a1b2c3d4e5f60718'));
  const seats = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
  const colors = seats.map((s) => seatColor(s.id, seats));
  expect(new Set(colors).size).toBe(6);
});
