import { describe, expect, it } from 'vitest';
import { MAX_ENTRY, deltaFor, press, splitPreview } from './amount.js';

describe('keypad entry', () => {
  it('appends digits, drops a leading zero, and deletes from the right', () => {
    let a = 0;
    for (const d of [0, 1, 2, 5]) a = press(a, { t: 'digit', d });
    expect(a).toBe(125);
    expect(press(a, { t: 'back' })).toBe(12);
    expect(press(7, { t: 'back' })).toBe(0);
    expect(press(a, { t: 'clear' })).toBe(0);
  });

  it('adds quick chips and sets an exact amount, never past the readout', () => {
    expect(press(125, { t: 'add', n: 25 })).toBe(150);
    expect(press(MAX_ENTRY - 1, { t: 'add', n: 500 })).toBe(MAX_ENTRY);
    expect(press(10, { t: 'set', n: 1240 })).toBe(1240);
    expect(press(10, { t: 'set', n: -5 })).toBe(0);
  });

  it('ignores a digit that would overflow the readout', () => {
    expect(press(MAX_ENTRY, { t: 'digit', d: 9 })).toBe(MAX_ENTRY);
  });
});

it('previews a split the way the table divides it', () => {
  expect(splitPreview(360, 3)).toEqual({ each: 120, extra: 0 });
  expect(splitPreview(101, 2)).toEqual({ each: 50, extra: 1 });
  expect(splitPreview(5, 0)).toEqual({ each: 0, extra: 0 });
});

it('signs an adjust by its reason', () => {
  expect(deltaFor('rebuy', 500, -1)).toBe(500);
  expect(deltaFor('cashout', 500, 1)).toBe(-500);
  expect(deltaFor('correction', 50, -1)).toBe(-50);
  expect(deltaFor('correction', 50, 1)).toBe(50);
});
