import { DurableObject } from 'cloudflare:workers';
import type { Publisher } from '../app/ports.js';
import { TableService } from '../app/tableService.js';
import { parseTableCode } from '../domain/values.js';
import { PING, PONG, type ServerFrame, opOf, parseClientFrame, parseJoinRequest, parseOpenRequest } from '../protocol/frames.js';
import type { Env } from './env.js';
import { CELL_ROUTES, STATUS, json } from './http.js';
import { RateLimit } from './rateLimit.js';
import { secrets } from './secrets.js';
import { SqlTableStore } from './sqlStore.js';

interface Attachment {
  seat: string | null;
}

/** The actor that owns one table: its storage, its sockets, its expiry. */
export class TableCell extends DurableObject<Env> {
  private readonly service: TableService;
  private readonly limit = new RateLimit();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const publisher: Publisher = { broadcast: (frame) => this.broadcast(frame) };
    this.service = new TableService(new SqlTableStore(ctx.storage), publisher, { now: () => Date.now() }, secrets);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
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
        ws.serializeAttachment({ seat: held } satisfies Attachment);
        if (state) send(ws, { t: 'welcome', seatId: held, state });
        return;
      }
      case 'cmd':
        send(ws, seat ? this.service.command(seat, frame.op, frame.cmd) : { t: 'nack', op: frame.op, code: 'bad-frame' });
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
    if (!this.service.expire(this.ctx.getWebSockets().length)) await this.arm();
  }

  private async arm(): Promise<void> {
    const at = this.service.nextCheck();
    if (at !== null) await this.ctx.storage.setAlarm(at);
  }

  private accept(request: Request): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'bad-frame' }, 426);
    const [client, server] = Object.values(new WebSocketPair());
    if (!this.service.info()) {
      // A browser reads a refused upgrade as a network failure; a closing socket says why.
      server.accept();
      send(server, { t: 'denied', code: 'not-found' });
      server.close(4004, 'not-found');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A seat departs when its last socket goes. */
  private left(ws: WebSocket): void {
    const seat = (ws.deserializeAttachment() as Attachment | null)?.seat;
    if (!seat) return;
    const others = this.ctx
      .getWebSockets()
      .filter((s) => s !== ws && s.readyState === WebSocket.OPEN)
      .some((s) => (s.deserializeAttachment() as Attachment | null)?.seat === seat);
    if (!others) this.service.departed(seat);
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
