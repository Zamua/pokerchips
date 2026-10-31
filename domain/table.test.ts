import { describe, expect, it } from 'vitest';
import { type Command, type Outcome, type SeatOutcome, type Table, arrive, depart, execute, hostClaimable, join, openTable } from './table.js';
import { HOST_CLAIM_AFTER_MS, MAX_SEATS, MAX_SIDE_POTS } from './values.js';

const T0 = 1_000_000;

function ok<O extends Outcome | SeatOutcome>(outcome: O): Extract<O, { ok: true }> {
  if (!outcome.ok) throw new Error(`refused: ${outcome.code}`);
  return outcome as Extract<O, { ok: true }>;
}

/** Ana hosts with a 1,000 buy-in; Ben and Cara joined; all three are here. */
function table(): Table {
  let t = ok(openTable({ code: 'abcd1234', name: 'Ana', seatId: 'ana', keyHash: 'ka', now: T0 })).table;
  t = ok(join(t, { name: 'Ben', seatId: 'ben', keyHash: 'kb', now: T0 })).table;
  t = ok(join(t, { name: 'Cara', seatId: 'cara', keyHash: 'kc', now: T0 })).table;
  for (const id of ['ana', 'ben', 'cara']) t = arrive(t, id, T0);
  return t;
}

const run = (t: Table, actor: string, cmd: Command, now = T0 + 1) => execute(t, actor, cmd, now);
const stack = (t: Table, id: string) => t.seats.find((s) => s.id === id)!.stack;
const pot = (t: Table, id = 'main') => t.pots.find((p) => p.id === id)?.amount;
/** Chips in play: every stack and pot. */
const inPlay = (t: Table) => t.seats.reduce((n, s) => n + s.stack, 0) + t.pots.reduce((n, p) => n + p.amount, 0);

describe('opening and joining', () => {
  it('seats the host with the buy-in, recorded as an adjust', () => {
    const o = ok(openTable({ code: 'abcd1234', name: ' Ana ', seatId: 'ana', keyHash: 'ka', now: T0, buyIn: 500 }));
    expect(o.table.seats).toEqual([{ id: 'ana', name: 'Ana', stack: 500, keyHash: 'ka', awaySince: T0 }]);
    expect(o.table.host).toBe('ana');
    expect(o.table.pots).toEqual([{ id: 'main', amount: 0 }]);
    expect(o.entries).toMatchObject([{ seq: 1, kind: 'adjust', seat: 'ana', delta: 500, reason: 'buyin' }]);
    expect(o.seat).toBe('ana');
  });

  it('refuses a bad name or buy-in', () => {
    const base = { code: 'abcd1234', seatId: 'a', keyHash: 'k', now: T0 };
    for (const name of ['', '   ', 'x'.repeat(21), 'a<b', 42]) {
      expect(openTable({ ...base, name })).toEqual({ ok: false, code: 'bad-name' });
    }
    for (const buyIn of [0, -1, 1.5, 1_000_001, '100']) {
      expect(openTable({ ...base, name: 'Ana', buyIn })).toEqual({ ok: false, code: 'bad-amount' });
    }
  });

  it('refuses a name that is here, ignoring case', () => {
    expect(join(table(), { name: 'BEN', seatId: 'x', keyHash: 'kx', now: T0 })).toEqual({ ok: false, code: 'name-taken' });
  });

  it('hands an away seat to whoever joins with its name, with a new key and its stack', () => {
    let t = ok(run(table(), 'ben', { type: 'bet', pot: 'main', amount: 100 })).table;
    t = depart(t, 'ben', T0 + 2);
    const o = ok(join(t, { name: 'ben', seatId: 'unused', keyHash: 'kb2', now: T0 + 3 }));
    expect(o.seat).toBe('ben');
    const ben = o.table.seats.find((s) => s.id === 'ben')!;
    expect(ben).toMatchObject({ keyHash: 'kb2', stack: 900 });
    expect(o.table.seats).toHaveLength(3);
    expect(o.entries).toMatchObject([{ kind: 'note', note: 'claimed', seat: 'ben' }]);
  });

  it(`holds at most ${MAX_SEATS} seats`, () => {
    let t = table();
    for (let i = 3; i < MAX_SEATS; i++) t = ok(join(t, { name: `p${i}`, seatId: `s${i}`, keyHash: `k${i}`, now: T0 })).table;
    expect(join(t, { name: 'late', seatId: 'z', keyHash: 'kz', now: T0 })).toEqual({ ok: false, code: 'table-full' });
  });
});

describe('moving chips', () => {
  it('bets from a stack into a pot and collects it back, conserving chips', () => {
    let t = table();
    t = ok(run(t, 'ben', { type: 'bet', pot: 'main', amount: 300 })).table;
    expect([stack(t, 'ben'), pot(t)]).toEqual([700, 300]);
    t = ok(run(t, 'cara', { type: 'collect', pot: 'main' })).table;
    expect([stack(t, 'cara'), pot(t)]).toEqual([1300, 0]);
    expect(inPlay(t)).toBe(3000);
  });

  it('refuses a bet larger than the stack, a bad amount, or an unknown pot', () => {
    const t = table();
    expect(run(t, 'ben', { type: 'bet', pot: 'main', amount: 1001 })).toEqual({ ok: false, code: 'short-stack' });
    for (const amount of [0, -5, 2.5, Number.NaN]) {
      expect(run(t, 'ben', { type: 'bet', pot: 'main', amount })).toEqual({ ok: false, code: 'bad-amount' });
    }
    expect(run(t, 'ben', { type: 'bet', pot: 'side-1', amount: 5 })).toEqual({ ok: false, code: 'no-such-pot' });
  });

  it('lets only one of two players take the same pot', () => {
    let t = ok(run(table(), 'ana', { type: 'bet', pot: 'main', amount: 200 })).table;
    t = ok(run(t, 'ben', { type: 'collect', pot: 'main' })).table;
    expect(run(t, 'cara', { type: 'collect', pot: 'main' })).toEqual({ ok: false, code: 'short-pot' });
    expect(run(t, 'cara', { type: 'collect', pot: 'main', amount: 1 })).toEqual({ ok: false, code: 'short-pot' });
  });

  it('splits a pot evenly, odd chips to the first seats listed', () => {
    let t = ok(run(table(), 'ana', { type: 'bet', pot: 'main', amount: 101 })).table;
    const o = ok(run(t, 'ana', { type: 'split', pot: 'main', seats: ['cara', 'ben'] }));
    t = o.table;
    expect([stack(t, 'cara'), stack(t, 'ben'), pot(t)]).toEqual([1051, 1050, 0]);
    expect(o.entries[0]).toMatchObject({ kind: 'split', shares: [{ seat: 'cara', amount: 51 }, { seat: 'ben', amount: 50 }] });
    expect(run(t, 'ana', { type: 'split', pot: 'main', seats: ['ben', 'cara'] })).toEqual({ ok: false, code: 'short-pot' });
    expect(run(t, 'ana', { type: 'split', pot: 'main', seats: ['ben', 'ben'] })).toEqual({ ok: false, code: 'bad-frame' });
    expect(run(t, 'ana', { type: 'split', pot: 'main', seats: ['ben', 'nobody'] })).toEqual({ ok: false, code: 'no-such-seat' });
  });

  it('adjusts a stack with a reason; others only by the host; never below zero', () => {
    let t = ok(run(table(), 'ben', { type: 'adjust', delta: 500, reason: 'rebuy' })).table;
    expect(stack(t, 'ben')).toBe(1500);
    expect(run(t, 'ben', { type: 'adjust', seat: 'cara', delta: 5, reason: 'correction' })).toEqual({ ok: false, code: 'not-host' });
    t = ok(run(t, 'ana', { type: 'adjust', seat: 'cara', delta: -1000, reason: 'cashout' })).table;
    expect(stack(t, 'cara')).toBe(0);
    expect(run(t, 'cara', { type: 'adjust', delta: -1, reason: 'cashout' })).toEqual({ ok: false, code: 'short-stack' });
    expect(run(t, 'cara', { type: 'adjust', delta: 0, reason: 'rebuy' })).toEqual({ ok: false, code: 'bad-amount' });
    expect(run(t, 'cara', { type: 'adjust', delta: 5, reason: 'buyin' as 'rebuy' })).toEqual({ ok: false, code: 'bad-frame' });
  });
});

describe('undo', () => {
  it('reverses the latest chip entry, by its author or the host, once', () => {
    let t = ok(run(table(), 'ben', { type: 'bet', pot: 'main', amount: 250 })).table;
    const seq = t.seq;
    expect(t.undoable?.seq).toBe(seq);
    expect(run(t, 'cara', { type: 'undo', seq })).toEqual({ ok: false, code: 'not-host' });
    const o = ok(run(t, 'ana', { type: 'undo', seq }));
    expect([stack(o.table, 'ben'), pot(o.table)]).toEqual([1000, 0]);
    expect(o.entries).toMatchObject([{ kind: 'undo', of: seq }]);
    expect(o.table.undoable).toBeNull();
    expect(run(o.table, 'ben', { type: 'undo', seq })).toEqual({ ok: false, code: 'not-undoable' });
  });

  it('closes the window once a later chip entry exists, but not for a pot opening', () => {
    let t = ok(run(table(), 'ben', { type: 'bet', pot: 'main', amount: 10 })).table;
    const first = t.seq;
    t = ok(run(t, 'ana', { type: 'openPot' })).table;
    expect(t.undoable?.seq).toBe(first);
    t = ok(run(t, 'cara', { type: 'bet', pot: 'main', amount: 10 })).table;
    expect(run(t, 'ben', { type: 'undo', seq: first })).toEqual({ ok: false, code: 'not-undoable' });
  });

  it('never offers a buy-in, and a pot closing ends the window', () => {
    expect(table().undoable).toBeNull();
    let t = ok(run(table(), 'ana', { type: 'openPot' })).table;
    t = ok(run(t, 'ben', { type: 'bet', pot: 'side-1', amount: 40 })).table;
    t = ok(run(t, 'ana', { type: 'closePot', pot: 'side-1' })).table;
    expect(t.undoable).toBeNull();
  });
});

describe('pots', () => {
  it('opens side pots from a counter that only grows, up to the limit', () => {
    let t = table();
    t = ok(run(t, 'ana', { type: 'openPot' })).table;
    t = ok(run(t, 'ana', { type: 'openPot' })).table;
    t = ok(run(t, 'ana', { type: 'closePot', pot: 'side-1' })).table;
    t = ok(run(t, 'ana', { type: 'openPot' })).table;
    expect(t.pots.map((p) => p.id)).toEqual(['main', 'side-2', 'side-3']);
    for (let i = 2; i < MAX_SIDE_POTS; i++) t = ok(run(t, 'ana', { type: 'openPot' })).table;
    expect(run(t, 'ana', { type: 'openPot' })).toEqual({ ok: false, code: 'too-many-pots' });
  });

  it('moves a closed pot into the main pot', () => {
    let t = ok(run(table(), 'ana', { type: 'openPot' })).table;
    t = ok(run(t, 'ben', { type: 'bet', pot: 'side-1', amount: 70 })).table;
    const o = ok(run(t, 'ana', { type: 'closePot', pot: 'side-1' }));
    expect(o.table.pots).toEqual([{ id: 'main', amount: 70 }]);
    expect(o.entries).toMatchObject([{ kind: 'closePot', pot: 'side-1', moved: 70 }]);
    expect(run(o.table, 'ana', { type: 'closePot', pot: 'main' })).toEqual({ ok: false, code: 'main-pot' });
  });

  it('leaves pot management and clearing to the host; clearing takes chips out of play', () => {
    let t = ok(run(table(), 'ben', { type: 'bet', pot: 'main', amount: 90 })).table;
    for (const cmd of [{ type: 'openPot' }, { type: 'closePot', pot: 'side-1' }, { type: 'clear' }] as Command[]) {
      expect(run(t, 'ben', cmd)).toEqual({ ok: false, code: 'not-host' });
    }
    const o = ok(run(t, 'ana', { type: 'clear' }));
    expect(pot(o.table)).toBe(0);
    expect(inPlay(o.table)).toBe(2910);
    expect(o.entries).toMatchObject([{ kind: 'clear', pots: [{ pot: 'main', amount: 90 }] }]);
    expect(ok(run(o.table, 'ana', { type: 'clear' })).entries).toEqual([]);
  });
});

describe('host', () => {
  it('hands the role over', () => {
    const t = ok(run(table(), 'ana', { type: 'handOver', seat: 'cara' })).table;
    expect(t.host).toBe('cara');
    expect(run(t, 'ana', { type: 'openPot' })).toEqual({ ok: false, code: 'not-host' });
  });

  it('can be claimed only after the host has been away long enough', () => {
    const t = depart(table(), 'ana', T0);
    expect(run(t, 'ben', { type: 'claimHost' }, T0 + HOST_CLAIM_AFTER_MS - 1)).toEqual({ ok: false, code: 'host-here' });
    expect(ok(run(t, 'ben', { type: 'claimHost' }, T0 + HOST_CLAIM_AFTER_MS)).table.host).toBe('ben');
    expect(run(table(), 'ben', { type: 'claimHost' })).toEqual({ ok: false, code: 'host-here' });
  });

  it('is claimable from a view of the table by the same rule', () => {
    const view = { host: 'ana', seats: [{ id: 'ana', awaySince: T0 }] };
    expect(hostClaimable(view, T0 + HOST_CLAIM_AFTER_MS - 1)).toBe(false);
    expect(hostClaimable(view, T0 + HOST_CLAIM_AFTER_MS)).toBe(true);
    expect(hostClaimable({ host: 'gone', seats: [] }, T0)).toBe(true);
  });

  it('removes an away seat, cashing out its stack first', () => {
    expect(run(table(), 'ana', { type: 'remove', seat: 'ben' })).toEqual({ ok: false, code: 'not-away' });
    const o = ok(run(depart(table(), 'ben', T0), 'ana', { type: 'remove', seat: 'ben' }));
    expect(o.table.seats.map((s) => s.id)).toEqual(['ana', 'cara']);
    expect(o.entries).toMatchObject([
      { kind: 'adjust', seat: 'ben', delta: -1000, reason: 'cashout' },
      { kind: 'note', note: 'removed', seat: 'ben' },
    ]);
    expect(o.table.undoable).toBeNull();
  });
});

it('records presence without a ledger entry', () => {
  const t = depart(table(), 'cara', T0 + 5);
  expect(t.seats.find((s) => s.id === 'cara')!.awaySince).toBe(T0 + 5);
  expect(t.seq).toBe(table().seq);
  expect(arrive(t, 'cara', T0 + 6).seats.find((s) => s.id === 'cara')!.awaySince).toBeNull();
});

it('numbers entries in order and never lets a stack or pot go negative', () => {
  let t = table();
  const before = t.seq;
  const cmds: [string, Command][] = [
    ['ben', { type: 'bet', pot: 'main', amount: 400 }],
    ['cara', { type: 'bet', pot: 'main', amount: 400 }],
    ['ana', { type: 'split', pot: 'main', seats: ['ana', 'ben', 'cara'] }],
    ['ben', { type: 'adjust', delta: -100, reason: 'cashout' }],
  ];
  const seqs: number[] = [];
  for (const [actor, cmd] of cmds) {
    const o = ok(run(t, actor, cmd));
    seqs.push(...o.entries.map((e) => e.seq));
    t = o.table;
    expect(t.seats.every((s) => s.stack >= 0) && t.pots.every((p) => p.amount >= 0)).toBe(true);
  }
  expect(seqs).toEqual([before + 1, before + 2, before + 3, before + 4]);
  expect(inPlay(t)).toBe(2900);
});
