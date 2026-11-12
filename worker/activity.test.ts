import { describe, expect, it, vi } from 'vitest';
import type { Entry } from '../domain/ledger.js';
import { type ActivityEnv, actionsOf, actorOf, record } from './activity.js';

const device = 'a'.repeat(32);
const dataset = () => ({ writeDataPoint: vi.fn() });
const env = (salt = 's'.repeat(32)): ActivityEnv & { ACTIVITY: ReturnType<typeof dataset> } => ({ ACTIVITY: dataset(), ACTIVITY_SALT: salt });
const entry = (kind: string) => ({ kind }) as Entry;

describe('the actor of a device id', () => {
  it('is 16 hex characters, stable for one id and key, and never the id', async () => {
    const actor = await actorOf(env(), device);
    expect(actor).toMatch(/^[0-9a-f]{16}$/);
    expect(await actorOf(env(), device)).toBe(actor);
    expect(device).not.toContain(actor!);
  });

  it('differs by id and by key', async () => {
    const actor = await actorOf(env(), device);
    expect(await actorOf(env(), 'b'.repeat(32))).not.toBe(actor);
    expect(await actorOf(env('t'.repeat(32)), device)).not.toBe(actor);
  });

  it('is null without an id, a key or a dataset', async () => {
    expect(await actorOf(env(), null)).toBeNull();
    expect(await actorOf({ ACTIVITY: dataset() }, device)).toBeNull();
    expect(await actorOf({ ACTIVITY_SALT: 's' }, device)).toBeNull();
    expect(await actorOf({}, device)).toBeNull();
  });
});

describe('recording an event', () => {
  it('writes the actor as the index, then app, action, an empty detail and a count of one', () => {
    const e = env();
    record(e, '0123456789abcdef', 'table_created');
    expect(e.ACTIVITY.writeDataPoint).toHaveBeenCalledExactlyOnceWith({
      indexes: ['0123456789abcdef'],
      blobs: ['pokerchips', 'table_created', ''],
      doubles: [1],
    });
  });

  it('writes nothing without an actor or a dataset, and swallows a failed write', () => {
    const e = env();
    record(e, null, 'active');
    expect(e.ACTIVITY.writeDataPoint).not.toHaveBeenCalled();
    expect(() => record({}, 'x', 'active')).not.toThrow();
    e.ACTIVITY.writeDataPoint.mockImplementation(() => {
      throw new Error('down');
    });
    expect(() => record(e, 'x', 'active')).not.toThrow();
  });
});

describe('the events of a command', () => {
  it('starts a game on the first bet at a table only', () => {
    expect(actionsOf([entry('bet')], false)).toEqual(['game_started']);
    expect(actionsOf([entry('bet')], true)).toEqual([]);
  });

  it('counts a hand for each pot awarded, by collect or split', () => {
    expect(actionsOf([entry('collect')], true)).toEqual(['hand_played']);
    expect(actionsOf([entry('split')], true)).toEqual(['hand_played']);
  });

  it('is nothing for other entries', () => {
    expect(actionsOf([entry('adjust'), entry('undo'), entry('openPot'), entry('note')], false)).toEqual([]);
  });
});
