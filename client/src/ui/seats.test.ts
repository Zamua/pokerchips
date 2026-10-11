import { expect, it } from 'vitest';
import { othersAround } from './seats.js';

const seats = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const ids = (s: { id: string }[]) => s.map((x) => x.id).join('');

it('lists the other seats from the one after yours, around the table', () => {
  expect(ids(othersAround(seats, 'c'))).toBe('dab');
  expect(ids(othersAround(seats, 'a'))).toBe('bcd');
  expect(ids(othersAround(seats, 'd'))).toBe('abc');
});

it('lists every seat when yours is not among them', () => {
  expect(ids(othersAround(seats, 'z'))).toBe('abcd');
});
