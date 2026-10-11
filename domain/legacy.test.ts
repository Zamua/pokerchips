import { describe, expect, it } from 'vitest';
import { type LegacyRoom, cleanName, importLegacy, seatIdOf } from './legacy.js';
import { arrive, execute, join } from './table.js';

const NOW = 2_000_000_000_000;
const uuid = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;

/** A version 2 room in the shape its file store wrote. */
function room(over: Partial<LegacyRoom> = {}): LegacyRoom {
  return {
    id: 'q7x2k9m4',
    createdAt: NOW - 5_000,
    creator: 'Ana',
    creatorId: uuid(1),
    settings: { startingChips: 500 },
    players: [
      { id: uuid(1), name: 'Ana', chips: 420, disconnected: true, disconnectedAt: NOW - 100 },
      { id: uuid(2), name: 'Ben', chips: 380, disconnected: true, disconnectedAt: NOW - 100 },
    ],
    pots: [
      { id: 'main', amount: 150 },
      { id: 'side-2', amount: 50 },
    ],
    sidePotCounter: 2,
    activityLog: [
      { message: 'Ana created the room', actionType: 'join-action', createdAt: NOW - 5_000 },
      { message: 'Ben added $50 to pot', actionType: 'pot-action', createdAt: NOW - 4_000 },
    ],
    musicPlayerId: null,
    lastActivityAt: NOW - 3_000,
    ...over,
  } as LegacyRoom;
}

function imported(r = room()) {
  const o = importLegacy(r, NOW);
  if (!o.ok) throw new Error(`${o.code}: ${o.detail}`);
  return o;
}

describe('importing a version 2 room', () => {
  it('keeps the code, stacks, pots, host and buy-in, with every seat away and keyless', () => {
    const { table } = imported();
    expect(table.code).toBe('q7x2k9m4');
    expect(table.buyIn).toBe(500);
    expect(table.seats).toEqual([
      { id: seatIdOf(uuid(1)), name: 'Ana', stack: 420, keyHash: '', awaySince: NOW },
      { id: seatIdOf(uuid(2)), name: 'Ben', stack: 380, keyHash: '', awaySince: NOW },
    ]);
    expect(table.host).toBe(seatIdOf(uuid(1)));
    expect(table.pots).toEqual([
      { id: 'main', amount: 150 },
      { id: 'side-2', amount: 50 },
    ]);
    expect(table.nextSidePot).toBe(3);
    expect(table.lastActivity).toBe(NOW - 3_000);
  });

  it('carries the activity as notes, then one saying the table moved', () => {
    const { table, entries } = imported();
    expect(entries.map((e) => (e.kind === 'note' ? e.text : ''))).toEqual([
      'Ana created the room',
      'Ben added $50 to pot',
      'Moved from the old pokerchips',
    ]);
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(table.seq).toBe(3);
  });

  it('lets a player claim their seat by name and play on', () => {
    let { table } = imported();
    const claim = join(table, { name: 'ben', seatId: 'unused', keyHash: 'kb', now: NOW + 1 });
    if (!claim.ok) throw new Error(claim.code);
    expect(claim.seat).toBe(seatIdOf(uuid(2)));
    table = arrive(claim.table, claim.seat!, NOW + 1);
    const bet = execute(table, claim.seat!, { type: 'bet', pot: 'side-2', amount: 80 }, NOW + 2);
    expect(bet.ok && bet.table.pots.find((p) => p.id === 'side-2')!.amount).toBe(130);
  });

  it('reads the oldest shape: one pot as a number, no counter', () => {
    const { table } = imported(room({ pots: undefined, pot: 75, sidePotCounter: undefined }));
    expect(table.pots).toEqual([{ id: 'main', amount: 75 }]);
    expect(table.nextSidePot).toBe(1);
  });

  it('cleans names version 3 does not allow and keeps them unique ignoring case', () => {
    expect(cleanName('  Big\tAl!!  ', 1)).toBe('Big Al');
    expect(cleanName('***', 3)).toBe('Player 3');
    expect(cleanName('x'.repeat(30), 1)).toBe('x'.repeat(20));
    const { table } = imported(
      room({
        players: [
          { id: uuid(1), name: 'ben', chips: 1 },
          { id: uuid(2), name: 'Ben', chips: 2 },
          { id: uuid(3), name: 'BEN', chips: 3 },
        ],
      }),
    );
    expect(table.seats.map((s) => s.name)).toEqual(['ben', 'Ben 2', 'BEN 3']);
  });

  it('falls back to the first seat as host when the creator is gone', () => {
    expect(imported(room({ creatorId: uuid(9) })).table.host).toBe(seatIdOf(uuid(1)));
  });

  it('refuses a room it cannot read rather than guess at chips', () => {
    expect(importLegacy(room({ id: 'BAD' }), NOW)).toMatchObject({ ok: false, code: 'bad-code' });
    expect(importLegacy(room({ players: [] }), NOW)).toMatchObject({ ok: false, code: 'no-such-seat' });
    expect(importLegacy(room({ players: [{ id: uuid(1), name: 'Ana', chips: -5 }] }), NOW)).toMatchObject({ ok: false, code: 'bad-amount' });
    expect(importLegacy(room({ pots: [{ id: 'weird', amount: 5 }] }), NOW)).toMatchObject({ ok: false, code: 'no-such-pot' });
  });
});
