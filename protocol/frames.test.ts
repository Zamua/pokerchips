import { describe, expect, it } from 'vitest';
import { BUY_IN_DEFAULT } from '../domain/values.js';
import { parseClientFrame, parseJoinRequest, parseOpenRequest } from './frames.js';

describe('HTTP request bodies', () => {
  it('turns an open body into a trimmed name and a buy-in, defaulting the buy-in', () => {
    expect(parseOpenRequest({ name: ' Ana ', buyIn: 500 })).toEqual({ ok: true, value: { name: 'Ana', buyIn: 500 } });
    expect(parseOpenRequest({ name: 'Ana' })).toEqual({ ok: true, value: { name: 'Ana', buyIn: BUY_IN_DEFAULT } });
  });

  it('refuses a bad name, then a bad buy-in, then anything not an object', () => {
    for (const name of ['', '   ', 'x'.repeat(21), 'a<b', 42]) {
      expect(parseOpenRequest({ name, buyIn: 0 })).toEqual({ ok: false, code: 'bad-name' });
      expect(parseJoinRequest({ name })).toEqual({ ok: false, code: 'bad-name' });
    }
    for (const buyIn of [0, -1, 1.5, 1_000_001, '100']) {
      expect(parseOpenRequest({ name: 'Ana', buyIn })).toEqual({ ok: false, code: 'bad-amount' });
    }
    for (const body of [undefined, null, 'Ana', ['Ana']]) {
      expect(parseOpenRequest(body)).toEqual({ ok: false, code: 'bad-frame' });
      expect(parseJoinRequest(body)).toEqual({ ok: false, code: 'bad-frame' });
    }
  });
});

describe('client frames', () => {
  it('refuses an adjust whose reason a player cannot give', () => {
    const adjust = (reason: string) => JSON.stringify({ t: 'cmd', op: 'a', cmd: { type: 'adjust', delta: 5, reason } });
    expect(parseClientFrame(adjust('rebuy'))).toMatchObject({ cmd: { reason: 'rebuy' } });
    expect(parseClientFrame(adjust('buyin'))).toBeNull();
  });

  it('refuses a split without a list of seat ids', () => {
    const split = (seats: unknown) => JSON.stringify({ t: 'cmd', op: 's', cmd: { type: 'split', pot: 'main', seats } });
    expect(parseClientFrame(split(['a', 'b']))).toMatchObject({ cmd: { seats: ['a', 'b'] } });
    expect(parseClientFrame(split('a'))).toBeNull();
    expect(parseClientFrame(split([1, 2]))).toBeNull();
  });
});
