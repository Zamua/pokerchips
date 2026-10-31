import { describe as group, expect, it } from 'vitest';
import type { Entry } from '../../../domain/ledger.js';
import { CODE_LENGTH, MAX_SEATS, MAX_SIDE_POTS, NAME_MAX, sidePotId } from '../../../domain/values.js';
import { ago, describe, emphasize, initial, potName, quickChips, sentence, showCode, when } from './text.js';

const base = { seq: 1, at: 0, by: 'ben', byName: 'Ben' } as const;

group('ledger lines', () => {
  it('reads from the viewer\'s side', () => {
    const bet = { ...base, kind: 'bet', pot: 'main', amount: 1250 } as Entry;
    expect(describe(bet, 'ana')).toBe('Ben bet 1,250 into the main pot');
    expect(describe(bet, 'ben')).toBe('You bet 1,250 into the main pot');
    const split = { ...base, kind: 'split', pot: 'side-2', shares: [{ seat: 'ana', name: 'Ana', amount: 51 }, { seat: 'ben', name: 'Ben', amount: 50 }] } as Entry;
    expect(describe(split, 'ana')).toBe('Ben split the side pot 2: you 51, Ben 50');
  });

  it('names whose stack an adjust touched', () => {
    const own = { ...base, kind: 'adjust', seat: 'ben', name: 'Ben', delta: 500, reason: 'rebuy' } as Entry;
    expect(describe(own, 'ana')).toBe('Ben added 500 to their stack');
    expect(describe(own, 'ben')).toBe('You added 500 to your stack');
    const host = { ...base, kind: 'adjust', seat: 'cara', name: 'Cara', delta: -300, reason: 'cashout' } as Entry;
    expect(describe(host, 'ana')).toBe("Ben cashed out 300 from Cara's stack");
    expect(describe(host, 'cara')).toBe('Ben cashed out 300 from your stack');
    const buyin = { ...base, kind: 'adjust', seat: 'ben', name: 'Ben', delta: 1000, reason: 'buyin' } as Entry;
    expect(describe(buyin, 'ana')).toBe('Ben bought in for 1,000');
  });
});

it('picks four quick chips from the buy-in', () => {
  expect(quickChips(1000)).toEqual([5, 25, 100, 500]);
  expect(quickChips(500)).toEqual([1, 5, 25, 100]);
  expect(quickChips(10_000)).toEqual([100, 500, 1_000, 5_000]);
  expect(quickChips(1)).toEqual([1]);
});

it('groups a table code for reading', () => {
  expect(showCode('7b2e41c9')).toBe('7B2E 41C9');
});

it('takes an avatar letter from the name', () => {
  expect(initial('maya')).toBe('M');
  expect(initial("'Dev")).toBe('D');
  expect(initial('...')).toBe('?');
});

it('says how long ago, compactly', () => {
  const now = 10_000_000;
  expect(ago(now - 10_000, now)).toBe('now');
  expect(ago(now - 4 * 60_000, now)).toBe('4m');
  expect(ago(now - 2 * 3_600_000, now)).toBe('2h');
  expect(ago(now - 3 * 86_400_000, now)).toBe('3d');
});

it('names the day a table was last open', () => {
  const now = new Date(2026, 9, 10, 21, 0).getTime();
  expect(when(new Date(2026, 9, 10, 20, 0).getTime(), now)).toBe('tonight');
  expect(when(new Date(2026, 9, 10, 9, 0).getTime(), now)).toBe('today');
  expect(when(new Date(2026, 9, 9, 23, 0).getTime(), now)).toBe('yesterday');
  expect(when(new Date(2026, 8, 27, 20, 0).getTime(), now)).toBe('on Sep 27');
  expect(when(new Date(2025, 8, 27, 20, 0).getTime(), now)).toBe('on Sep 27, 2025');
});

it('marks the actor and the amounts in a ledger line', () => {
  expect(emphasize('Ben bet 1,250 into the main pot', 'Ben')).toEqual([
    { text: 'Ben', kind: 'name' },
    { text: ' bet ', kind: 'plain' },
    { text: '1,250', kind: 'num' },
    { text: ' into the main pot', kind: 'plain' },
  ]);
  expect(emphasize('You won 50 from the side pot 2', 'Ana')[0]).toEqual({ text: 'You', kind: 'name' });
  expect(emphasize('Bennett joined', 'Ben')[0]).toEqual({ text: 'Bennett joined', kind: 'plain' });
});

group('limits and pots', () => {
  it('states the limits the domain enforces', () => {
    expect(sentence('bad-name')).toContain(`1 to ${NAME_MAX}`);
    expect(sentence('bad-code')).toContain(`${CODE_LENGTH} letters`);
    expect(sentence('table-full')).toContain(`${MAX_SEATS} seats`);
    expect(sentence('too-many-pots')).toContain(`${MAX_SIDE_POTS} side pots`);
  });

  it('names pots by the domain\'s ids', () => {
    expect(potName('main')).toBe('main pot');
    expect(potName(sidePotId(3))).toBe('side pot 3');
  });
});
