import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableView } from '../../../protocol/frames.js';
import { BACKOFF_CAP_MS, HEARTBEAT_MS, MAX_ATTEMPTS, SILENCE_MS, type SocketLike, type Status, TableSocket, WELCOME_MS } from './tableSocket.js';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

const view = { seq: 1 } as TableView;

function harness() {
  const sockets: FakeSocket[] = [];
  const statuses: Status[] = [];
  const states: TableView[] = [];
  let n = 0;
  const ts = new TableSocket({
    url: 'wss://x/api/tables/abcd1234/socket',
    seatKey: 'k'.repeat(32),
    onState: (s) => states.push(s),
    onStatus: (s) => statuses.push(s),
    open: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    random: () => 1,
    newOp: () => `op${++n}`,
  });
  const last = () => sockets[sockets.length - 1];
  const welcome = () => {
    last().open();
    last().receive({ t: 'welcome', seatId: 'me', state: view });
  };
  return { ts, sockets, statuses, states, last, welcome };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TableSocket', () => {
  it('says hello with the seat key on every open and hands over each state', () => {
    const h = harness();
    h.ts.start();
    h.last().open();
    expect(h.last().sent).toEqual([{ t: 'hello', seatKey: 'k'.repeat(32) }]);
    h.last().receive({ t: 'welcome', seatId: 'me', state: view });
    h.last().receive({ t: 'state', state: { seq: 2 } });
    expect(h.states.map((s) => s.seq)).toEqual([1, 2]);
    expect(h.statuses).toEqual(['online']);
  });

  it('holds commands until welcome, then resolves each by its op', async () => {
    const h = harness();
    h.ts.start();
    const answer = h.ts.command({ type: 'bet', pot: 'main', amount: 5 });
    h.welcome();
    expect(h.last().sent).toContainEqual({ t: 'cmd', op: 'op1', cmd: { type: 'bet', pot: 'main', amount: 5 } });
    h.last().receive({ t: 'nack', op: 'op1', code: 'short-stack' });
    await expect(answer).resolves.toEqual({ ok: false, code: 'short-stack' });
  });

  it('resends unanswered commands with the same op after a reconnect', async () => {
    const h = harness();
    h.ts.start();
    h.welcome();
    const answer = h.ts.command({ type: 'collect', pot: 'main' });
    h.last().drop();
    vi.advanceTimersByTime(500);
    h.welcome();
    expect(h.last().sent).toContainEqual({ t: 'cmd', op: 'op1', cmd: { type: 'collect', pot: 'main' } });
    h.last().receive({ t: 'ack', op: 'op1', seq: 9 });
    await expect(answer).resolves.toEqual({ ok: true, seq: 9 });
  });

  it('backs off exponentially to a cap, then gives up as offline', () => {
    const h = harness();
    h.ts.start();
    const delays: number[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const before = h.sockets.length;
      h.last().drop();
      let waited = 0;
      while (h.sockets.length === before) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      delays.push(waited);
    }
    expect(delays.slice(0, 4)).toEqual([500, 1000, 2000, 4000]);
    expect(Math.max(...delays)).toBe(BACKOFF_CAP_MS);
    h.last().drop();
    expect(h.statuses.at(-1)).toBe('offline');
  });

  it('pings while connected and reconnects when the socket goes silent', () => {
    const h = harness();
    h.ts.start();
    h.welcome();
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(h.last().sent).toContainEqual({ t: 'ping' });
    const before = h.sockets.length;
    vi.advanceTimersByTime(SILENCE_MS);
    expect(h.sockets.length).toBe(before + 1);
    expect(h.sockets[before - 1].closed).toBe(true);
  });

  it('drops a socket that is not welcomed in time, whether or not it opened', () => {
    const h = harness();
    h.ts.start();
    vi.advanceTimersByTime(WELCOME_MS);
    expect(h.sockets[0].closed).toBe(true);
    expect(h.statuses).toEqual(['reconnecting']);
    vi.advanceTimersByTime(500);
    h.last().open();
    vi.advanceTimersByTime(WELCOME_MS);
    expect(h.sockets[1].closed).toBe(true);
    vi.advanceTimersByTime(1000);
    h.welcome();
    vi.advanceTimersByTime(WELCOME_MS);
    expect(h.last().closed).toBe(false);
    expect(h.statuses.at(-1)).toBe('online');
  });

  it('reconnects at once when the page returns, and not when the link is healthy', () => {
    const h = harness();
    h.ts.start();
    h.welcome();
    h.ts.resume();
    expect(h.sockets).toHaveLength(1);
    h.last().drop();
    h.ts.resume();
    expect(h.sockets).toHaveLength(2);
  });

  it('stops for good when the seat key is denied', async () => {
    const h = harness();
    h.ts.start();
    const answer = h.ts.command({ type: 'openPot' });
    h.last().open();
    h.last().receive({ t: 'denied', code: 'not-found' });
    expect(h.statuses).toEqual(['denied']);
    await expect(answer).resolves.toEqual({ ok: false, code: 'not-found' });
    vi.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('asks for older ledger entries and hands back the answer', async () => {
    const h = harness();
    h.ts.start();
    await expect(h.ts.history(40)).resolves.toBeNull();
    h.welcome();
    const page = h.ts.history(40);
    expect(h.ts.history(40)).toBe(page);
    expect(h.last().sent.filter((f) => (f as { t: string }).t === 'history')).toEqual([{ t: 'history', before: 40 }]);
    h.last().receive({ t: 'history', entries: [{ seq: 39 }] });
    await expect(page).resolves.toEqual([{ seq: 39 }]);
  });

  it('gives up on a history request when the link drops or the frame is dropped', async () => {
    const h = harness();
    h.ts.start();
    h.welcome();
    const dropped = h.ts.history(40);
    h.last().drop();
    await expect(dropped).resolves.toBeNull();
    vi.advanceTimersByTime(500);
    h.welcome();
    const flooded = h.ts.history(40);
    h.last().receive({ t: 'nack', op: '', code: 'rate-limited' });
    await expect(flooded).resolves.toBeNull();
  });

  it('counts the link as dropped when the device goes offline, and reconnects when it is back', () => {
    const h = harness();
    h.ts.start();
    h.welcome();
    h.ts.offline();
    expect(h.sockets[0].closed).toBe(true);
    expect(h.statuses.at(-1)).toBe('reconnecting');
    h.ts.resume();
    expect(h.sockets).toHaveLength(2);
    h.welcome();
    expect(h.statuses.at(-1)).toBe('online');
  });
});
