import { SELF, env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { IDLE_LIFETIME_MS, MAX_SEATS } from '../domain/values.js';
import type { ServerFrame, TableView } from '../protocol/frames.js';
import { CAPS, MAX_FRAME, MAX_SOCKETS, SOURCE_WINDOW_MS } from './limits.js';
import { tableService } from './TableCell.js';
import worker from './worker.js';

const BASE = 'https://pokerchips.test';

async function call(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> };
}

async function openTable(name = 'Ana', buyIn = 1000) {
  const res = await call('/api/tables', { name, buyIn });
  expect(res.status).toBe(201);
  return res.body as { code: string; seatId: string; seatKey: string };
}

async function joinTable(code: string, name: string) {
  const res = await call(`/api/tables/${code}/seats`, { name });
  expect(res.status).toBe(201);
  return res.body as { seatId: string; seatKey: string };
}

/** A socket that queues every frame and waits for one that matches. */
class Client {
  frames: ServerFrame[] = [];
  private waiters: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      this.frames.push(JSON.parse(e.data as string));
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static async connect(code: string): Promise<Client> {
    const res = await SELF.fetch(`${BASE}/api/tables/${code}/socket`, { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    return new Client(ws);
  }

  static async seated(code: string, seatKey: string): Promise<Client> {
    const c = await Client.connect(code);
    await c.hello(seatKey);
    return c;
  }

  async hello(seatKey: string) {
    this.send({ t: 'hello', seatKey });
    return this.next<Extract<ServerFrame, { t: 'welcome' }>>((f) => f.t === 'welcome');
  }

  send(frame: unknown) {
    this.ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  async next<T extends ServerFrame>(match: (f: ServerFrame) => boolean, after = 0): Promise<T> {
    for (;;) {
      const found = this.frames.slice(after).find(match);
      if (found) return found as T;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no matching frame in ${JSON.stringify(this.frames)}`)), 2_000);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async answer(op: string) {
    return this.next<Extract<ServerFrame, { t: 'ack' | 'nack' }>>((f) => (f.t === 'ack' || f.t === 'nack') && f.op === op);
  }

  async stateWhere(match: (s: TableView) => boolean) {
    return (await this.next<Extract<ServerFrame, { t: 'state' }>>((f) => f.t === 'state' && match(f.state))).state;
  }
}

const stackOf = (s: TableView, name: string) => s.seats.find((x) => x.name === name)!.stack;

describe('a table over HTTP', () => {
  it('opens, lists its seats, and refuses a taken name', async () => {
    const t = await openTable('Ana', 500);
    expect(t.code).toMatch(/^[a-z0-9]{8}$/);
    expect(t.seatKey).toMatch(/^[0-9a-f]{32}$/);
    await joinTable(t.code, 'Ben');
    expect((await call(`/api/tables/${t.code}`)).body).toEqual({
      code: t.code,
      seats: [
        { name: 'Ana', here: false },
        { name: 'Ben', here: false },
      ],
    });
    const ana = await Client.seated(t.code, t.seatKey);
    expect((await call(`/api/tables/${t.code}/seats`, { name: 'ana' })).body).toEqual({ error: 'name-taken' });
    ana.ws.close();
  });

  it('answers 404 for an unknown table and 400 for a bad code', async () => {
    expect((await call('/api/tables/zzzzzzzz')).status).toBe(404);
    expect((await call('/api/tables/zzzzzzzz/seats', { name: 'Ben' })).status).toBe(404);
    expect((await call('/api/tables/NOT-A-CODE')).status).toBe(400);
  });

  it('refuses a bad name or buy-in', async () => {
    expect((await call('/api/tables', { name: '', buyIn: 10 })).body).toEqual({ error: 'bad-name' });
    expect((await call('/api/tables', { name: 'Ana', buyIn: 0 })).body).toEqual({ error: 'bad-amount' });
  });

  it('refuses a browser from another origin', async () => {
    expect((await call('/api/tables', { name: 'Ana' }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('/api/tables', { name: 'Ana' }, { Origin: BASE })).status).toBe(201);
  });
});

describe('a table over WebSockets', () => {
  it('welcomes a seat key, sends every change to every seat, and acks the command', async () => {
    const t = await openTable();
    const b = await joinTable(t.code, 'Ben');
    const ana = await Client.seated(t.code, t.seatKey);
    const ben = await Client.seated(t.code, b.seatKey);
    const mark = ana.frames.length;
    ben.send({ t: 'cmd', op: 'op1', cmd: { type: 'bet', pot: 'main', amount: 200 } });
    expect(await ben.answer('op1')).toMatchObject({ t: 'ack' });
    const seen = await ana.stateWhere((s) => s.pots[0].amount === 200);
    expect(stackOf(seen, 'Ben')).toBe(800);
    expect(seen.undoable).toBe(seen.seq);
    expect(ana.frames.length).toBeGreaterThan(mark);
    expect(JSON.stringify(ana.frames)).not.toContain(t.seatKey);
  });

  it('applies a repeated op once and answers it the same way', async () => {
    const t = await openTable();
    const ana = await Client.seated(t.code, t.seatKey);
    ana.send({ t: 'cmd', op: 'same', cmd: { type: 'bet', pot: 'main', amount: 100 } });
    const first = await ana.answer('same');
    const count = ana.frames.length;
    ana.send({ t: 'cmd', op: 'same', cmd: { type: 'bet', pot: 'main', amount: 100 } });
    await ana.next((f) => (f.t === 'ack' || f.t === 'nack') && f.op === 'same', count);
    expect(ana.frames.filter((f) => f.t === 'ack' && f.op === 'same')).toEqual([first, first]);
    const { state } = await (await Client.connect(t.code)).hello(t.seatKey);
    expect(stackOf(state, 'Ana')).toBe(900);
    expect(state.ledger.filter((e) => e.kind === 'bet')).toHaveLength(1);
  });

  it('gives a contested pot to exactly one collector', async () => {
    const t = await openTable();
    const b = await joinTable(t.code, 'Ben');
    const ana = await Client.seated(t.code, t.seatKey);
    const ben = await Client.seated(t.code, b.seatKey);
    ana.send({ t: 'cmd', op: 'bet', cmd: { type: 'bet', pot: 'main', amount: 300 } });
    await ana.answer('bet');
    ana.send({ t: 'cmd', op: 'a', cmd: { type: 'collect', pot: 'main' } });
    ben.send({ t: 'cmd', op: 'b', cmd: { type: 'collect', pot: 'main' } });
    const answers = [await ana.answer('a'), await ben.answer('b')];
    expect(answers.filter((a) => a.t === 'ack')).toHaveLength(1);
    expect(answers.find((a) => a.t === 'nack')).toMatchObject({ code: 'short-pot' });
  });

  it('denies an unknown key, and revokes a key when an away seat is claimed by name', async () => {
    const t = await openTable();
    const stranger = await Client.connect(t.code);
    stranger.send({ t: 'hello', seatKey: '0'.repeat(32) });
    expect(await stranger.next((f) => f.t === 'denied')).toEqual({ t: 'denied', code: 'not-found' });

    const b = await joinTable(t.code, 'Ben');
    const claimed = await joinTable(t.code, 'BEN');
    expect(claimed.seatId).toBe(b.seatId);
    const old = await Client.connect(t.code);
    old.send({ t: 'hello', seatKey: b.seatKey });
    expect(await old.next((f) => f.t === 'denied')).toMatchObject({ t: 'denied' });
    await Client.seated(t.code, claimed.seatKey);
  });

  it('marks a seat away when its last socket closes', async () => {
    const t = await openTable();
    const b = await joinTable(t.code, 'Ben');
    const ana = await Client.seated(t.code, t.seatKey);
    const ben = await Client.seated(t.code, b.seatKey);
    await ana.stateWhere((s) => s.seats.every((x) => x.awaySince === null));
    ben.ws.close(1000, 'bye');
    const s = await ana.stateWhere((st) => st.seats.find((x) => x.name === 'Ben')!.awaySince !== null);
    expect(s.seats.find((x) => x.name === 'Ben')!.awaySince).toEqual(expect.any(Number));
  });

  it('counts a seat away whose socket was lost with its instance, so its name can be claimed', async () => {
    const t = await openTable();
    const b = await joinTable(t.code, 'Ben');
    const ben = await Client.seated(t.code, b.seatKey);
    const closed = new Promise<void>((resolve) => ben.ws.addEventListener('close', () => resolve()));
    const stub = env.TABLES.get(env.TABLES.idFromName(t.code));
    await runInDurableObject(stub, (_cell, state) => state.abort('restart')).catch(() => {});
    await closed;
    expect((await call(`/api/tables/${t.code}`)).body.seats).toEqual([
      { name: 'Ana', here: false },
      { name: 'Ben', here: false },
    ]);
    expect((await joinTable(t.code, 'Ben')).seatId).toBe(b.seatId);
  });

  it('refuses commands before hello, junk frames, and floods', async () => {
    const t = await openTable();
    const c = await Client.connect(t.code);
    c.send({ t: 'cmd', op: 'early', cmd: { type: 'openPot' } });
    expect(await c.answer('early')).toEqual({ t: 'nack', op: 'early', code: 'bad-frame' });
    c.send('not json');
    await c.next((f) => f.t === 'nack' && f.code === 'bad-frame' && f.op === '');
    for (let i = 0; i < 12; i++) c.send({ t: 'history', before: 1 });
    await c.next((f) => f.t === 'nack' && f.code === 'rate-limited');
  });

  it('names the op of a refused frame when it can read one', async () => {
    const t = await openTable();
    const c = await Client.seated(t.code, t.seatKey);
    c.send({ t: 'cmd', op: 'odd', cmd: { type: 'bet', pot: 'nowhere', amount: 5 } });
    expect(await c.answer('odd')).toEqual({ t: 'nack', op: 'odd', code: 'bad-frame' });
    for (let i = 0; i < 11; i++) c.send({ t: 'cmd', op: `flood${i}`, cmd: { type: 'openPot' } });
    expect(await c.answer('flood10')).toMatchObject({ code: 'rate-limited' });
  });

  it('says a table does not exist over the socket itself', async () => {
    const c = await Client.connect('n0tthere');
    expect(await c.next((f) => f.t === 'denied')).toEqual({ t: 'denied', code: 'not-found' });
  });

  it('answers ping with pong', async () => {
    const t = await openTable();
    const c = await Client.connect(t.code);
    c.send({ t: 'ping' });
    await c.next((f) => f.t === 'pong');
  });
});

describe('abuse limits', () => {
  const closing = (c: Client) => new Promise<CloseEvent>((resolve) => c.ws.addEventListener('close', resolve));
  const hostFrom = (ip: string) => ({ 'CF-Connecting-IP': ip });
  const openFrom = (ip: string) => call('/api/tables', { name: 'Ana', buyIn: 1000 }, hostFrom(ip));

  it('keeps the largest real frame under the frame cap', () => {
    const op = 'a'.repeat(64);
    const seats = Array.from({ length: MAX_SEATS }, () => 'f'.repeat(16));
    const widest = JSON.stringify({ t: 'cmd', op, cmd: { type: 'split', pot: 'side-8', seats } });
    expect(widest.length).toBeLessThan(MAX_FRAME / 4);
  });

  it('answers a frame past the cap with a nack and closes the socket, parsing nothing', async () => {
    const t = await openTable();
    const c = await Client.seated(t.code, t.seatKey);
    const closed = closing(c);
    c.send(JSON.stringify({ t: 'cmd', op: 'big', cmd: { type: 'openPot' }, pad: 'x'.repeat(MAX_FRAME) }));
    expect(await c.next((f) => f.t === 'nack')).toEqual({ t: 'nack', op: '', code: 'bad-frame' });
    expect((await closed).code).toBe(1009);
  });

  it('closes on a binary frame past the cap too', async () => {
    const t = await openTable();
    const c = await Client.connect(t.code);
    const closed = closing(c);
    c.ws.send(new Uint8Array(MAX_FRAME + 1));
    expect((await closed).code).toBe(1009);
  });

  it('serves a frame at the cap', async () => {
    const t = await openTable();
    const c = await Client.seated(t.code, t.seatKey);
    const frame = JSON.stringify({ t: 'history', before: 1 });
    c.send(frame + ' '.repeat(MAX_FRAME - frame.length));
    await c.next((f) => f.t === 'history');
  });

  it('refuses a socket past the per-table cap, and serves one again once one closes', async () => {
    const t = await openTable();
    const held: Client[] = [];
    for (let i = 0; i < MAX_SOCKETS; i++) held.push(await Client.connect(t.code));
    const refused = await SELF.fetch(`${BASE}/api/tables/${t.code}/socket`, { headers: { Upgrade: 'websocket' } });
    expect(refused.status).toBe(503);
    held[0]!.ws.close(1000, 'bye');
    await vi.waitFor(async () => {
      const res = await SELF.fetch(`${BASE}/api/tables/${t.code}/socket`, { headers: { Upgrade: 'websocket' } });
      expect(res.status).toBe(101);
    });
  });

  it('caps table creations per source network, not globally', async () => {
    for (let i = 0; i < CAPS.creations; i++) expect((await openFrom(`198.51.100.${i}`)).status).toBe(201);
    const over = await openFrom('198.51.100.200');
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: 'rate-limited' });
    expect((await openFrom('198.51.101.1')).status).toBe(201);
    expect((await openFrom('2001:db8:aaaa:1::1')).status).toBe(201);
    expect((await call('/api/tables', { name: 'Ana', buyIn: 1000 })).status).toBe(201);
  });

  it('counts an IPv6 network by its /64', async () => {
    for (let i = 0; i < CAPS.creations; i++) expect((await openFrom(`2001:db8:bbbb:1::${i + 1}`)).status).toBe(201);
    expect((await openFrom('2001:db8:bbbb:1:ffff::9')).status).toBe(429);
    expect((await openFrom('2001:db8:bbbb:2::1')).status).toBe(201);
  });

  it('does not count a refused request against the cap', async () => {
    for (let i = 0; i < CAPS.creations + 5; i++) {
      expect((await call('/api/tables', { name: '', buyIn: 1000 }, hostFrom('198.51.102.1'))).status).toBe(400);
    }
    expect((await openFrom('198.51.102.1')).status).toBe(201);
  });

  it('forgets a source when its window ends, and keeps no address while it lasts', async () => {
    const stub = env.CREATIONS.get(env.CREATIONS.idFromName('creations'));
    for (let i = 0; i < CAPS.creations; i++) await openFrom('198.51.103.1');
    expect((await openFrom('198.51.103.1')).status).toBe(429);
    const stored = await runInDurableObject(stub, (_i, state) => JSON.stringify([...state.storage.kv.list()]));
    expect(stored).not.toContain('198.51.103');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + SOURCE_WINDOW_MS + 1);
      await runDurableObjectAlarm(stub);
      expect(await runInDurableObject(stub, (_i, state) => [...state.storage.kv.list()])).toEqual([]);
      expect((await openFrom('198.51.103.1')).status).toBe(201);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('lookup limits', () => {
  const from = (ip: string) => ({ 'CF-Connecting-IP': ip });
  const unknown = (i: number) => `q${String(i).padStart(7, '0')}`;
  const lookup = (code: string, ip: string) => call(`/api/tables/${code}`, undefined, from(ip));
  const missOut = async (ip: string) => {
    for (let i = 0; i < CAPS.misses; i++) expect((await lookup(unknown(i), ip)).status).toBe(404);
  };

  it('refuses a malformed code on every route before any table is reached', async () => {
    for (const bad of ['short', 'toolongcode', 'UPPER!!!', 'abc def1']) {
      expect((await call(`/api/tables/${bad}`)).status, bad).toBe(400);
      expect((await call(`/api/tables/${bad}/seats`, { name: 'Ana' })).status, bad).toBe(400);
      expect((await SELF.fetch(`${BASE}/api/tables/${bad}/socket`, { headers: { Upgrade: 'websocket' } })).status, bad).toBe(400);
    }
  });

  it('refuses a source that has looked up too many tables that do not exist, and only that source', async () => {
    await missOut('10.20.1.10');
    const over = await lookup(unknown(999), '10.20.1.10');
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: 'rate-limited' });
    expect((await lookup(unknown(999), '10.20.1.200')).status).toBe(429);
    expect((await lookup(unknown(999), '10.20.2.10')).status).toBe(404);
    expect((await lookup(unknown(999), '2001:db8:cccc::1')).status).toBe(404);
  });

  it('counts a join or a socket to a missing table as a miss too', async () => {
    const ip = '10.20.3.1';
    for (let i = 0; i < CAPS.misses / 2; i++) {
      expect((await call(`/api/tables/${unknown(i)}/seats`, { name: 'Ana' }, from(ip))).status).toBe(404);
      const res = await SELF.fetch(`${BASE}/api/tables/${unknown(i)}/socket`, { headers: { Upgrade: 'websocket', ...from(ip) } });
      expect(res.status).toBe(101);
    }
    expect((await lookup(unknown(999), ip)).status).toBe(429);
    expect((await call(`/api/tables/${unknown(998)}/seats`, { name: 'Ana' }, from(ip))).status).toBe(429);
    const socket = await SELF.fetch(`${BASE}/api/tables/${unknown(997)}/socket`, { headers: { Upgrade: 'websocket', ...from(ip) } });
    expect(socket.status).toBe(429);
  });

  it('does not count a lookup of a table that exists, however many', async () => {
    const t = await openTable();
    const ip = '10.20.4.1';
    for (let i = 0; i < CAPS.misses + 10; i++) expect((await lookup(t.code, ip)).status).toBe(200);
    expect((await lookup(unknown(1), ip)).status).toBe(404);
  });

  it('keeps misses and creations apart', async () => {
    const ip = '10.20.5.1';
    await missOut(ip);
    expect((await call('/api/tables', { name: 'Ana', buyIn: 1000 }, from(ip))).status).toBe(201);
    const other = '10.20.6.1';
    for (let i = 0; i < CAPS.creations; i++) await call('/api/tables', { name: 'Ana', buyIn: 1000 }, from(other));
    expect((await lookup(unknown(1), other)).status).toBe(404);
  });

  it('lets a request through when the limiter is down', async () => {
    const down = async () => {
      throw new Error('overloaded');
    };
    const broken = { ...env, CREATIONS: { idFromName: () => 'x', get: () => ({ take: down, reached: down }) } } as unknown as typeof env;
    const send = (path: string, body?: unknown) =>
      worker.fetch!(
        new Request(`${BASE}${path}`, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: from('10.20.7.1') }),
        broken,
        { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
      );
    expect((await send('/api/tables', { name: 'Ana', buyIn: 1000 })).status).toBe(201);
    expect((await send(`/api/tables/${unknown(1)}`)).status).toBe(404);
  });

  it('keeps no address in clear or hashed past the window', async () => {
    const stub = env.CREATIONS.get(env.CREATIONS.idFromName('creations'));
    await lookup(unknown(1), '10.20.8.1');
    const stored = await runInDurableObject(stub, (_i, state) => JSON.stringify([...state.storage.kv.list()]));
    expect(stored).not.toContain('10.20.8');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + SOURCE_WINDOW_MS + 1);
      await runDurableObjectAlarm(stub);
      expect(await runInDurableObject(stub, (_i, state) => [...state.storage.kv.list()])).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a device id', () => {
  it('changes nothing a client sees, whether it is sent, missing or malformed', async () => {
    for (const device of ['d'.repeat(32), 'not-an-id', '']) {
      const res = await call('/api/tables', { name: 'Ana', buyIn: 1000 }, { 'X-Device': device });
      expect(res.status, device).toBe(201);
      const c = await Client.connect(res.body.code);
      c.send({ t: 'hello', seatKey: res.body.seatKey, device });
      await c.next((f) => f.t === 'welcome');
      c.send({ t: 'cmd', op: 'b', cmd: { type: 'bet', pot: 'main', amount: 5 } });
      expect(await c.answer('b')).toMatchObject({ t: 'ack' });
      c.send({ t: 'cmd', op: 'w', cmd: { type: 'collect', pot: 'main' } });
      expect(await c.answer('w')).toMatchObject({ t: 'ack' });
    }
  });

  it('is kept nowhere in the table storage', async () => {
    const device = 'e'.repeat(32);
    const t = await openTable();
    const c = await Client.connect(t.code);
    c.send({ t: 'hello', seatKey: t.seatKey, device });
    await c.next((f) => f.t === 'welcome');
    c.send({ t: 'cmd', op: 'b', cmd: { type: 'bet', pot: 'main', amount: 5 } });
    await c.answer('b');
    const stored = await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(t.code)), (_cell, state) =>
      JSON.stringify([
        [...state.storage.kv.list()],
        state.storage.sql.exec('SELECT json FROM state').toArray(),
        state.storage.sql.exec('SELECT json FROM ledger').toArray(),
      ]),
    );
    expect(stored).not.toContain(device);
  });
});

describe('expiry', () => {
  it('deletes a table idle for the lifetime with nobody connected, and keeps a fresh one', async () => {
    const t = await openTable();
    const stub = env.TABLES.get(env.TABLES.idFromName(t.code));
    await runDurableObjectAlarm(stub);
    expect((await call(`/api/tables/${t.code}`)).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + IDLE_LIFETIME_MS + 1);
      await runDurableObjectAlarm(stub);
    } finally {
      vi.useRealTimers();
    }
    expect((await call(`/api/tables/${t.code}`)).status).toBe(404);
  });
});

describe('moving a version 2 room in', () => {
  const room = (id: string) => ({
    id,
    createdAt: Date.now() - 10_000,
    creatorId: '00000001-aaaa-4bbb-8ccc-dddddddddddd',
    settings: { startingChips: 1000 },
    players: [
      { id: '00000001-aaaa-4bbb-8ccc-dddddddddddd', name: 'Ana', chips: 900 },
      { id: '00000002-aaaa-4bbb-8ccc-dddddddddddd', name: 'Ben', chips: 1100 },
    ],
    pots: [{ id: 'main', amount: 0 }],
    sidePotCounter: 0,
    activityLog: [{ message: 'Ana created the room', createdAt: Date.now() - 10_000 }],
    lastActivityAt: Date.now() - 5_000,
  });

  it('imports through the binding only, once, and the seats are claimed by name', async () => {
    const code = 'm1gr4t3d';
    expect((await call(`/api/tables/${code}/import`, { room: room(code) })).status).toBe(404);
    const stub = env.TABLES.get(env.TABLES.idFromName(code));
    const post = (body: unknown) => stub.fetch('https://table/import', { method: 'POST', body: JSON.stringify(body) });
    expect((await post({ room: room('0therc0d') })).status).toBe(400);
    const first = await post({ room: room(code) });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ code, seats: 2 });
    expect((await post({ room: room(code) })).status).toBe(409);
    expect((await call(`/api/tables/${code}`)).body).toEqual({ code, seats: [{ name: 'Ana', here: false }, { name: 'Ben', here: false }] });
    const ben = await joinTable(code, 'Ben');
    const c = await Client.seated(code, ben.seatKey);
    const welcome = c.frames.find((f) => f.t === 'welcome') as Extract<ServerFrame, { t: 'welcome' }>;
    expect(stackOf(welcome.state, 'Ben')).toBe(1100);
  });
});

describe('storage cost', () => {
  /** Storage that tallies the SQLite rows read through it while `body` runs. */
  function counting(real: DurableObjectStorage) {
    const cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[] = [];
    const storage = {
      sql: { exec: (query: string, ...args: unknown[]) => cursors[cursors.push(real.sql.exec(query, ...args)) - 1] },
      transactionSync: <T>(fn: () => T) => real.transactionSync(fn),
    } as unknown as DurableObjectStorage;
    const rowsRead = (body: () => void) => {
      const from = cursors.length;
      body();
      return cursors.slice(from).reduce((sum, c) => sum + c.rowsRead, 0);
    };
    return { storage, rowsRead };
  }

  const quiet = { broadcast: () => {} };

  const storedTail = (storage: DurableObjectStorage) =>
    storage.sql
      .exec<{ json: string }>('SELECT json FROM ledger ORDER BY seq DESC LIMIT 50')
      .toArray()
      .map((r) => JSON.parse(r.json))
      .reverse();

  it('reads a handful of rows per command, however long the ledger and however many answers a seat holds', async () => {
    const t = await openTable('Ana', 1_000_000);
    const b = await joinTable(t.code, 'Ben');
    const reads = await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(t.code)), async (_cell, state) => {
      const { storage, rowsRead } = counting(state.storage);
      const service = tableService(storage, quiet);
      service.view(); // a running cell holds the table and its ledger tail in memory
      const bet = (i: number, op: string) => service.command(i % 2 ? t.seatId : b.seatId, op, { type: 'bet', pot: 'main', amount: 1 });
      const tenBets = (tag: string) => Array.from({ length: 10 }, (_, i) => rowsRead(() => bet(i, `${tag}${i}`)));
      const early = tenBets('early');
      for (let i = 0; i < 300; i++) bet(i, `warm${i}`);
      const late = tenBets('late');
      const repeated = rowsRead(() => bet(9, 'late9'));
      expect(service.view()!.ledger).toEqual(storedTail(state.storage));
      return { early, late, repeated };
    });
    expect(Math.max(...reads.early)).toBeLessThanOrEqual(5);
    expect(Math.max(...reads.late)).toBeLessThanOrEqual(5);
    expect(reads.repeated).toBe(1);
  });

  it('never shows an entry whose write rolled back', async () => {
    const t = await openTable();
    await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(t.code)), async (_cell, state) => {
      const service = tableService(state.storage, quiet);
      const bet = (op: string) => service.command(t.seatId, op, { type: 'bet', pot: 'main', amount: 1 });
      bet('a');
      const next = service.view()!.seq + 1;
      state.storage.sql.exec('INSERT INTO ledger (seq, json) VALUES (?, ?)', next, '{}');
      expect(() => bet('b')).toThrow();
      state.storage.sql.exec('DELETE FROM ledger WHERE seq = ?', next);
      expect(service.view()!.ledger).toEqual(storedTail(state.storage));
      expect(bet('c')).toEqual({ t: 'ack', op: 'c', seq: next });
      expect(service.view()!.ledger).toEqual(storedTail(state.storage));
    });
  });
});
