import { DurableObject } from 'cloudflare:workers';
import type { Applied, Publisher } from '../app/ports.js';
import { TableService } from '../app/tableService.js';
import type { Entry } from '../domain/ledger.js';
import { parseTableCode } from '../domain/values.js';
import { PING, PONG, type ServerFrame, opOf, parseClientFrame, parseJoinRequest, parseOpenRequest } from '../protocol/frames.js';
import { actionsOf, actorOf, record } from './activity.js';
import type { Env } from './env.js';
import { CELL_ROUTES, MISSING, STATUS, json } from './http.js';
import { MAX_FRAME, MAX_SOCKETS } from './limits.js';
import { RateLimit } from './rateLimit.js';
import { secrets } from './secrets.js';
import { SqlTableStore } from './sqlStore.js';

interface Attachment {
  seat: string | null;
  /** The hashed actor activity events are written under; never the device id. */
  actor?: string | null;
}

/** Set once a bet has been made at the table. */
const PLAYED = 'played';

/** A table's use cases over its Durable Object's storage, on the wall clock. */
export const tableService = (storage: DurableObjectStorage, publisher: Publisher, applied?: Applied) =>
  new TableService(new SqlTableStore(storage), publisher, { now: () => Date.now() }, secrets, applied);

/** The actor that owns one table: its storage, its sockets, its expiry. */
export class TableCell extends DurableObject<Env> {
  private readonly service: TableService;
  private readonly limit = new RateLimit();
  /** The socket whose command is running, for the events of what it applies. */
  private acting: WebSocket | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const publisher: Publisher = { broadcast: (frame) => this.broadcast(frame) };
    this.service = tableService(ctx.storage, publisher, (entries) => this.note(entries));
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    // Sockets lost with an earlier instance never sent a close.
    this.service.settle(this.connected());
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === CELL_ROUTES.socket) return this.accept(request);
    if (pathname === CELL_ROUTES.info && request.method === 'GET') {
      const info = this.service.info();
      return info ? json(info) : json({ error: 'not-found' }, 404);
    }
    if (request.method !== 'POST') return json({ error: 'bad-frame' }, 405);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: 'bad-frame' }, 400);
    if (pathname === CELL_ROUTES.open) {
      const code = parseTableCode(body.code);
      if (!code.ok) return json({ error: code.code }, 400);
      const req = parseOpenRequest(body);
      if (!req.ok) return json({ error: req.code }, 400);
      const seated = await this.service.open(code.value, req.value);
      if (!seated.ok) return json({ error: seated.code }, STATUS[seated.code] ?? 400);
      await this.arm();
      return json({ code: code.value, seatId: seated.seatId, seatKey: seated.seatKey }, 201);
    }
    if (pathname === CELL_ROUTES.import) {
      const room = body.room as Record<string, unknown> | undefined;
      if (!room || (this.ctx.id.name !== undefined && room.id !== this.ctx.id.name)) return json({ error: 'bad-code' }, 400);
      const done = this.service.importLegacy(room);
      if (!done.ok) return json({ error: done.code, detail: done.detail }, STATUS[done.code] ?? 400);
      await this.arm();
      return json({ code: room.id, seats: done.seats }, 201);
    }
    if (pathname === CELL_ROUTES.seats) {
      const req = parseJoinRequest(body);
      if (!req.ok) return json({ error: req.code }, 400);
      const seated = await this.service.join(req.value);
      if (!seated.ok) return json({ error: seated.code }, STATUS[seated.code] ?? 400);
      return json({ seatId: seated.seatId, seatKey: seated.seatKey }, 201);
    }
    return json({ error: 'bad-frame' }, 404);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if ((typeof message === 'string' ? message.length : message.byteLength) > MAX_FRAME) {
      send(ws, { t: 'nack', op: '', code: 'bad-frame' });
      ws.close(1009, 'too-big');
      return;
    }
    const text = typeof message === 'string' ? message : '';
    if (!this.limit.allow(ws, Date.now())) {
      send(ws, { t: 'nack', op: opOf(text), code: 'rate-limited' });
      return;
    }
    const frame = parseClientFrame(text);
    const seat = (ws.deserializeAttachment() as Attachment | null)?.seat ?? null;
    if (!frame) {
      send(ws, { t: 'nack', op: opOf(text), code: 'bad-frame' });
      return;
    }
    switch (frame.t) {
      case 'hello': {
        const held = await this.service.seatFor(frame.seatKey);
        if (!held) {
          send(ws, { t: 'denied', code: 'not-found' });
          ws.close(4001, 'denied');
          return;
        }
        const state = this.service.arrived(held);
        const actor = await actorOf(this.env, frame.device ?? null);
        ws.serializeAttachment({ seat: held, actor } satisfies Attachment);
        if (state) send(ws, { t: 'welcome', seatId: held, state });
        record(this.env, actor, 'active');
        return;
      }
      case 'cmd':
        this.acting = ws;
        try {
          send(ws, seat ? this.service.command(seat, frame.op, frame.cmd) : { t: 'nack', op: frame.op, code: 'bad-frame' });
        } finally {
          this.acting = null;
        }
        return;
      case 'history':
        if (seat) send(ws, { t: 'history', entries: this.service.history(frame.before) });
        return;
      case 'ping':
        send(ws, { t: 'pong' });
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed by the runtime.
    }
    this.left(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.left(ws);
  }

  async alarm(): Promise<void> {
    if (this.service.expire(this.ctx.getWebSockets().length)) this.ctx.storage.kv.delete(PLAYED);
    else await this.arm();
  }

  private async arm(): Promise<void> {
    const at = this.service.nextCheck();
    if (at !== null) await this.ctx.storage.setAlarm(at);
  }

  private accept(request: Request): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'bad-frame' }, 426);
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return json({ error: 'table-full' }, 503);
    const [client, server] = Object.values(new WebSocketPair());
    if (!this.service.info()) {
      // A browser reads a refused upgrade as a network failure; a closing socket says why.
      server.accept();
      send(server, { t: 'denied', code: 'not-found' });
      server.close(4004, 'not-found');
      return new Response(null, { status: 101, webSocket: client, headers: { [MISSING]: '1' } });
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Writes the activity events of entries just applied, under the acting socket's actor. */
  private note(entries: Entry[]): void {
    const kv = this.ctx.storage.kv;
    const played = kv.get<boolean>(PLAYED) === true;
    const actor = (this.acting?.deserializeAttachment() as Attachment | null)?.actor ?? null;
    for (const action of actionsOf(entries, played)) record(this.env, actor, action);
    if (!played && entries.some((e) => e.kind === 'bet')) kv.put(PLAYED, true);
  }

  private left(ws: WebSocket): void {
    this.service.settle(this.connected(ws));
  }

  /** The seats held by an open socket other than `gone`. */
  private connected(gone?: WebSocket): Set<string> {
    const seats = new Set<string>();
    for (const s of this.ctx.getWebSockets()) {
      const seat = s !== gone && s.readyState === WebSocket.OPEN ? (s.deserializeAttachment() as Attachment | null)?.seat : null;
      if (seat) seats.add(seat);
    }
    return seats;
  }

  private broadcast(frame: ServerFrame): void {
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.seat) send(ws, frame);
    }
  }
}

function send(ws: WebSocket, frame: ServerFrame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // A socket closing under us; its close handler settles presence.
  }
}
