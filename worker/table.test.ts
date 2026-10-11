import { SELF, env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { IDLE_LIFETIME_MS } from '../domain/values.js';
import type { ServerFrame, TableView } from '../protocol/frames.js';
import type { TableService } from '../app/tableService.js';

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
    c.send({ t: 'hello', seatKey });
    await c.next((f) => f.t === 'welcome');
    return c;
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
    const info = await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(t.code)), async (_cell, state) =>
      state.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM ledger WHERE json LIKE '%\"bet\"%'").one().n,
    );
    expect(info).toBe(1);
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
    await ana.stateWhere((s) => s.seats.every((x) => x.here));
    ben.ws.close(1000, 'bye');
    const s = await ana.stateWhere((st) => !st.seats.find((x) => x.name === 'Ben')!.here);
    expect(s.seats.find((x) => x.name === 'Ben')!.awaySince).toEqual(expect.any(Number));
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

describe('expiry', () => {
  it('deletes a table idle for the lifetime with nobody connected, and keeps a fresh one', async () => {
    const t = await openTable();
    const stub = env.TABLES.get(env.TABLES.idFromName(t.code));
    await runDurableObjectAlarm(stub);
    expect((await call(`/api/tables/${t.code}`)).status).toBe(200);
    await runInDurableObject(stub, async (_cell, state) => {
      const row = state.storage.sql.exec<{ json: string }>('SELECT json FROM state').one();
      const table = JSON.parse(row.json);
      table.lastActivity -= IDLE_LIFETIME_MS + 1;
      state.storage.sql.exec('UPDATE state SET json = ?', JSON.stringify(table));
    });
    // The cell caches the table; a fresh instance reads the aged row.
    await runInDurableObject(stub, async (cell) => {
      (cell as unknown as { service: { store: { cached?: unknown } } }).service.store.cached = undefined;
    });
    await runDurableObjectAlarm(stub);
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
  type Cell = {
    service: Pick<TableService, 'command' | 'view'> & { store: { storage: DurableObjectStorage } };
  };

  /** SQLite rows the cell's store reads while `body` runs. */
  function rowsRead(cell: Cell, body: () => void): number {
    const store = cell.service.store;
    const real = store.storage;
    const cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[] = [];
    store.storage = {
      sql: { exec: (query: string, ...args: unknown[]) => cursors[cursors.push(real.sql.exec(query, ...args)) - 1] },
      transactionSync: <T>(fn: () => T) => real.transactionSync(fn),
    } as unknown as DurableObjectStorage;
    try {
      body();
    } finally {
      store.storage = real;
    }
    return cursors.reduce((sum, c) => sum + c.rowsRead, 0);
  }

  const storedTail = (storage: DurableObjectStorage) =>
    storage.sql
      .exec<{ json: string }>('SELECT json FROM ledger ORDER BY seq DESC LIMIT 50')
      .toArray()
      .map((r) => JSON.parse(r.json))
      .reverse();

  it('reads a handful of rows per command, however long the ledger and however many answers a seat holds', async () => {
    const t = await openTable('Ana', 1_000_000);
    const b = await joinTable(t.code, 'Ben');
    const reads = await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(t.code)), async (instance, state) => {
      const cell = instance as unknown as Cell;
      const bet = (i: number, op: string) => cell.service.command(i % 2 ? t.seatId : b.seatId, op, { type: 'bet', pot: 'main', amount: 1 });
      const tenBets = (tag: string) => Array.from({ length: 10 }, (_, i) => rowsRead(cell, () => bet(i, `${tag}${i}`)));
      const early = tenBets('early');
      for (let i = 0; i < 300; i++) bet(i, `warm${i}`);
      const late = tenBets('late');
      const repeated = rowsRead(cell, () => bet(9, 'late9'));
      expect(cell.service.view()!.ledger).toEqual(storedTail(state.storage));
      return { early, late, repeated };
    });
    expect(Math.max(...reads.early)).toBeLessThanOrEqual(5);
    expect(Math.max(...reads.late)).toBeLessThanOrEqual(5);
    expect(reads.repeated).toBe(1);
  });

  it('never shows an entry whose write rolled back', async () => {
    const t = await openTable();
    await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(t.code)), async (instance, state) => {
      const cell = instance as unknown as Cell;
      const bet = (op: string) => cell.service.command(t.seatId, op, { type: 'bet', pot: 'main', amount: 1 });
      bet('a');
      const next = cell.service.view()!.seq + 1;
      state.storage.sql.exec('INSERT INTO ledger (seq, json) VALUES (?, ?)', next, '{}');
      expect(() => bet('b')).toThrow();
      state.storage.sql.exec('DELETE FROM ledger WHERE seq = ?', next);
      expect(cell.service.view()!.ledger).toEqual(storedTail(state.storage));
      expect(bet('c')).toEqual({ t: 'ack', op: 'c', seq: next });
      expect(cell.service.view()!.ledger).toEqual(storedTail(state.storage));
    });
  });
});
