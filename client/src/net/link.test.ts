import { describe, expect, it } from 'vitest';
import { type At, type Link, type LinkEvent, MAX_ATTEMPTS, SILENCE_MS, WELCOME_MS, next, statusOf } from './link.js';

const at: At = { now: 1_000, random: 1 };

/** Feeds events from `link` and returns every step. */
function feed(events: LinkEvent[], link: Link = { k: 'idle' }, when = at) {
  const steps = [];
  for (const ev of events) {
    const step = next(link, ev, when);
    steps.push(step);
    link = step.link;
  }
  return { steps, link, kinds: steps.map((s) => s.link.k) };
}

const online = feed([{ e: 'start' }, { e: 'opened', gen: 1 }, { e: 'welcome', gen: 1 }]).link;

const every: LinkEvent[] = [
  { e: 'start' },
  { e: 'stop' },
  { e: 'resume' },
  { e: 'offline' },
  { e: 'opened', gen: 1 },
  { e: 'welcome', gen: 1 },
  { e: 'denied', gen: 1 },
  { e: 'heard', gen: 1 },
  { e: 'closed', gen: 1 },
  { e: 'timer' },
];

describe('the table link', () => {
  it('opens, says hello once open, and is online on the welcome', () => {
    const { steps, kinds } = feed([{ e: 'start' }, { e: 'opened', gen: 1 }, { e: 'welcome', gen: 1 }]);
    expect(kinds).toEqual(['opening', 'hello', 'online']);
    expect(steps.map((s) => s.effects)).toEqual([
      [{ do: 'open', gen: 1 }, { do: 'timer', ms: WELCOME_MS }],
      [{ do: 'send', frame: 'hello' }],
      [{ do: 'timer', ms: 25_000 }, { do: 'flush' }],
    ]);
    expect(steps.map((s) => statusOf(s.link))).toEqual(['connecting', 'connecting', 'online']);
  });

  it('ignores a welcome before the hello, a second open, and events from a socket it let go', () => {
    expect(feed([{ e: 'start' }, { e: 'welcome', gen: 1 }]).link.k).toBe('opening');
    expect(feed([{ e: 'start' }, { e: 'opened', gen: 1 }, { e: 'opened', gen: 1 }]).steps[2].effects).toEqual([]);
    const { link } = feed([{ e: 'closed', gen: 1 }, { e: 'timer' }], online);
    expect(link).toEqual({ k: 'opening', gen: 2, attempt: 1, again: true });
    for (const ev of every.filter((e) => 'gen' in e)) expect(next(link, ev, at)).toEqual({ link, effects: [] });
  });

  it('counts a missed welcome as a lost socket and backs off before trying again', () => {
    const { steps, link } = feed([{ e: 'start' }, { e: 'opened', gen: 1 }, { e: 'timer' }]);
    expect(link).toEqual({ k: 'waiting', gen: 1, attempt: 1 });
    expect(steps[2].effects).toEqual([{ do: 'close', code: 4000, reason: 'no welcome' }, { do: 'end-history' }, { do: 'timer', ms: 500 }]);
    expect(statusOf(link)).toBe('reconnecting');
  });

  it('gives up after the last attempt, and then only a resume tries again', () => {
    let link = feed([{ e: 'start' }]).link;
    for (let gen = 1; gen <= MAX_ATTEMPTS; gen++) link = feed([{ e: 'closed', gen }, { e: 'timer' }], link).link;
    expect(link).toEqual({ k: 'opening', gen: MAX_ATTEMPTS + 1, attempt: MAX_ATTEMPTS, again: true });
    link = next(link, { e: 'closed', gen: MAX_ATTEMPTS + 1 }, at).link;
    expect(link).toEqual({ k: 'offline', gen: MAX_ATTEMPTS + 1 });
    expect(feed([{ e: 'timer' }, { e: 'offline' }, { e: 'start' }], link).link).toBe(link);
    expect(next(link, { e: 'resume' }, at).link).toEqual({ k: 'opening', gen: MAX_ATTEMPTS + 2, attempt: 0, again: true });
  });

  it('pings while it hears the table, reconnects once it falls silent, and resumes only a silent link', () => {
    const beat = next(online, { e: 'timer' }, { ...at, now: at.now + 25_000 });
    expect(beat).toEqual({ link: online, effects: [{ do: 'send', frame: 'ping' }, { do: 'timer', ms: 25_000 }] });
    const late = { ...at, now: at.now + SILENCE_MS + 1 };
    expect(next(online, { e: 'timer' }, late).link).toEqual({ k: 'opening', gen: 2, attempt: 0, again: true });
    expect(next(online, { e: 'resume' }, at)).toEqual({ link: online, effects: [] });
    expect(next(online, { e: 'resume' }, late).effects[0]).toEqual({ do: 'close', code: 4000, reason: 'reconnect' });
    const heard = next(online, { e: 'heard', gen: 1 }, late).link;
    expect(next(heard, { e: 'resume' }, late).link).toBe(heard);
  });

  it('ends for good on a stop or a denial, settling held commands, and nothing moves it after', () => {
    for (const end of [{ e: 'stop' }, { e: 'denied', gen: 1 }] as LinkEvent[]) {
      const step = next(online, end, at);
      expect(step.effects).toContainEqual({ do: 'refuse-held' });
      expect(step.effects).toContainEqual({ do: 'timer', ms: null });
      for (const ev of every) expect(next(step.link, ev, at)).toEqual({ link: step.link, effects: [] });
    }
  });
});
