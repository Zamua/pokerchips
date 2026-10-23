import { describe, expect, it } from 'vitest';
import { chipAt, disturbed, drawOrder, homes, homeward, kick, type Pose, restingOn, visualAngle } from './toy.js';
import { chipSize } from './towers.js';

const size = chipSize(54);
const flat = (x: number, y: number): Pose => ({ x, y, angle: 0 });
/** A stack of `n` level chips on the ground line, bottom first. */
const column = (x: number, n: number, ground = 300) => Array.from({ length: n }, (_, i) => flat(x, ground - (i + 0.5) * size.th));

describe('the chip toy', () => {
  it('rests every chip where the static stacks draw it', () => {
    const h = homes([['tomato', 'sun'], ['mint']], 390, 300, size);
    expect(h).toHaveLength(3);
    const left = (390 - (2 * 54 + 14)) / 2;
    expect(h[0]).toMatchObject({ color: 'tomato', stack: 0, level: 0, x: left + 7 + 27, y: 300 - size.th / 2, angle: 0 });
    expect(h[1]).toMatchObject({ color: 'sun', stack: 0, level: 1, x: left + 7 + 2 + 27, y: 300 - 1.5 * size.th });
    expect(h[2]).toMatchObject({ stack: 1, level: 0, x: left + 54 + 7 + 27 });
  });

  it('tips a tapped column away from the tapped side, its top fastest', () => {
    const poses = column(100, 5);
    const k = kick(poses, 1, 90, size, 0.3);
    expect(k.map((c) => c.index)).toEqual([1, 2, 3, 4]);
    for (const c of k) expect(c.vx).toBeGreaterThan(0);
    expect(k.map((c) => c.vx)).toEqual([...k.map((c) => c.vx)].sort((a, b) => a - b));
    expect(kick(poses, 0, 110, size, 0.3).every((c) => c.vx < 0)).toBe(true);
  });

  it('tips a column the other way when a taller stack stands where it would fall', () => {
    const short = column(100, 3);
    const tall = column(154, 6);
    const k = kick([...short, ...tall], 0, 90, size, 0.3);
    expect(k.map((c) => c.index)).toEqual([0, 1, 2]);
    for (const c of k) expect(c.vx).toBeLessThan(0);
  });

  it('flips a lone chip up off the ground', () => {
    const k = kick([flat(100, 290), flat(300, 290)], 0, 100, size, 0.9);
    expect(k).toHaveLength(1);
    expect(k[0].vy).toBeLessThan(0);
    expect(k[0].spin).not.toBe(0);
  });

  it('settles a chip dropped over a stack onto its top chip', () => {
    const stack = column(100, 4);
    const drop = flat(112, 150);
    expect(restingOn(drop, stack, size)).toBe(3);
  });

  it('settles nothing when the drop is beside the stacks or over a tilted chip', () => {
    const stack = column(100, 4);
    expect(restingOn(flat(170, 150), stack, size)).toBeNull();
    const tilted = [...stack.slice(0, 3), { ...stack[3], angle: 0.6 }];
    expect(restingOn(flat(100, 150), tilted, size)).toBe(2);
    expect(restingOn(flat(100, 150), [null, null, null, null], size)).toBeNull();
  });

  it('counts the chips disturbed only once one has moved off its home', () => {
    const h = homes([['tomato', 'sun', 'mint']], 390, 300, size);
    expect(disturbed(h, h)).toBe(false);
    expect(disturbed(h.map((p) => ({ ...p, x: p.x + 1, angle: Math.PI })), h)).toBe(false);
    expect(disturbed(h.map((p, i) => (i === 2 ? { ...p, x: p.x + 20 } : p)), h)).toBe(true);
    expect(disturbed(h.map((p, i) => (i === 0 ? { ...p, angle: 0.5 } : p)), h)).toBe(true);
  });

  it('draws a chip the same right side up or flipped over', () => {
    expect(visualAngle(0)).toBe(0);
    expect(visualAngle(Math.PI)).toBeCloseTo(0);
    expect(visualAngle(Math.PI + 0.2)).toBeCloseTo(0.2);
    expect(visualAngle(-0.3)).toBeCloseTo(-0.3);
    expect(Math.abs(visualAngle(7))).toBeLessThanOrEqual(Math.PI / 2);
  });

  it('draws lower chips first, the right one over the left, the held one last', () => {
    const poses = [flat(100, 280), flat(100, 270), flat(160, 280), flat(130, 290)];
    expect(drawOrder(poses, -1)).toEqual([3, 0, 2, 1]);
    expect(drawOrder(poses, 3)).toEqual([0, 2, 1, 3]);
  });

  it('finds the chip drawn on top under a point', () => {
    const stack = column(100, 3);
    expect(chipAt(stack, 100, stack[0].y + size.th / 2 + size.ry - 1, size)).toBe(0);
    expect(chipAt(stack, 100, stack[0].y + size.th / 2 + 2, size)).toBe(1);
    expect(chipAt(stack, 100, stack[2].y - size.th / 2 - size.ry + 2, size)).toBe(2);
    expect(chipAt(stack, 100 + 30, stack[1].y, size)).toBe(-1);
    expect(chipAt(stack, 100, 10, size)).toBe(-1);
  });

  it('brings a chip home on a hop, flat and exactly in place at the end', () => {
    const from = { x: 10, y: 290, angle: 1.2 };
    const to = flat(100, 290);
    expect(homeward(from, to, 0)).toEqual(from);
    expect(homeward(from, to, 0.5).y).toBeLessThan(270);
    const end = homeward(from, to, 1);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(290);
    expect(end.angle).toBeCloseTo(0);
  });
});
