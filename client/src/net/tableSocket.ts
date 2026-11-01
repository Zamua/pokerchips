import type { ErrorCode } from '../../../domain/errors.js';
import type { Entry } from '../../../domain/ledger.js';
import type { Command } from '../../../domain/table.js';
import { PING, type ServerFrame, type TableView } from '../../../protocol/frames.js';
import { type Effect, type Link, type LinkEvent, type Status, next, statusOf } from './link.js';

export type Answer = { ok: true; seq: number } | { ok: false; code: ErrorCode };

export const BUFFER_LIMIT = 100;

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface TableSocketOptions {
  url: string;
  seatKey: string;
  onState(state: TableView, seatId: string): void;
  onStatus(status: Status): void;
  open?: (url: string) => SocketLike;
  random?: () => number;
  newOp?: () => string;
}

interface Held {
  op: string;
  cmd: Command;
  resolve(answer: Answer): void;
}

const OPEN = 1;
const CLOSING = 2;

/**
 * One table connection. Its lifecycle is `Link`, changed only by `next`;
 * this shell feeds it events and performs its effects. Commands are held
 * while offline and resent after the next welcome, which is safe because
 * the table answers a repeated op id without applying it.
 */
export class TableSocket {
  private link: Link = { k: 'idle' };
  private status: Status = 'connecting';
  private sock: { ws: SocketLike; gen: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private held: Held[] = [];
  private seatId = '';
  private historyWait: { promise: Promise<Entry[] | null>; resolve(entries: Entry[] | null): void } | null = null;

  constructor(private readonly o: TableSocketOptions) {}

  start(): void {
    this.dispatch({ e: 'start' });
  }

  stop(): void {
    this.dispatch({ e: 'stop' });
  }

  /** The page came back to the foreground: reconnect now if not connected. */
  resume(): void {
    this.dispatch({ e: 'resume' });
  }

  /** The device lost its network: count the link as dropped now instead of waiting for silence. */
  offline(): void {
    this.dispatch({ e: 'offline' });
  }

  command(cmd: Command): Promise<Answer> {
    return new Promise((resolve) => {
      if (this.link.k === 'stopped' || this.link.k === 'denied') {
        resolve({ ok: false, code: 'not-found' });
        return;
      }
      if (this.held.length >= BUFFER_LIMIT) {
        resolve({ ok: false, code: 'rate-limited' });
        return;
      }
      const h: Held = { op: (this.o.newOp ?? newOp)(), cmd, resolve };
      this.held.push(h);
      if (this.link.k === 'online') this.transmit(h);
    });
  }

  /**
   * Up to 50 ledger entries older than `before`; null when not connected or
   * the link drops first. One request at a time: the answer carries no id.
   */
  history(before: number): Promise<Entry[] | null> {
    if (this.historyWait) return this.historyWait.promise;
    if (this.link.k !== 'online' || this.sock?.ws.readyState !== OPEN) return Promise.resolve(null);
    let resolve!: (entries: Entry[] | null) => void;
    const promise = new Promise<Entry[] | null>((r) => (resolve = r));
    this.historyWait = { promise, resolve };
    this.sock.ws.send(JSON.stringify({ t: 'history', before }));
    return promise;
  }

  private dispatch(ev: LinkEvent): void {
    const step = next(this.link, ev, { now: Date.now(), random: (this.o.random ?? Math.random)() });
    this.link = step.link;
    for (const effect of step.effects) this.perform(effect);
    const status = statusOf(this.link);
    if (status && status !== this.status) {
      this.status = status;
      this.o.onStatus(status);
    }
  }

  private perform(effect: Effect): void {
    switch (effect.do) {
      case 'open':
        this.open(effect.gen);
        return;
      case 'close': {
        const ws = this.sock?.ws;
        this.sock = null;
        if (ws && ws.readyState < CLOSING) ws.close(effect.code, effect.reason);
        return;
      }
      case 'send':
        if (this.sock?.ws.readyState !== OPEN) return;
        this.sock.ws.send(effect.frame === 'ping' ? PING : JSON.stringify({ t: 'hello', seatKey: this.o.seatKey }));
        return;
      case 'timer':
        clearTimeout(this.timer);
        this.timer = effect.ms === null ? undefined : setTimeout(() => this.dispatch({ e: 'timer' }), effect.ms);
        return;
      case 'flush':
        for (const h of this.held) this.transmit(h);
        return;
      case 'refuse-held':
        for (const h of this.held.splice(0)) h.resolve({ ok: false, code: 'not-found' });
        return;
      case 'end-history':
        this.endHistory(null);
        return;
    }
  }

  private open(gen: number): void {
    const ws = (this.o.open ?? ((url) => new WebSocket(url) as unknown as SocketLike))(this.o.url);
    this.sock = { ws, gen };
    ws.onopen = () => this.dispatch({ e: 'opened', gen });
    ws.onmessage = (ev) => this.receive(gen, ev.data);
    ws.onclose = () => this.dispatch({ e: 'closed', gen });
    ws.onerror = () => this.dispatch({ e: 'closed', gen });
  }

  private receive(gen: number, data: unknown): void {
    if (this.sock?.gen !== gen || typeof data !== 'string') return;
    let frame: ServerFrame;
    try {
      frame = JSON.parse(data) as ServerFrame;
    } catch {
      return;
    }
    if (frame.t === 'welcome') {
      this.seatId = frame.seatId;
      this.dispatch({ e: 'welcome', gen });
      if (this.link.k === 'online') this.o.onState(frame.state, frame.seatId);
      return;
    }
    if (frame.t === 'denied') {
      this.dispatch({ e: 'denied', gen });
      return;
    }
    this.dispatch({ e: 'heard', gen });
    switch (frame.t) {
      case 'state':
        this.o.onState(frame.state, this.seatId);
        return;
      case 'history':
        this.endHistory(frame.entries);
        return;
      case 'ack':
      case 'nack': {
        const i = this.held.findIndex((h) => h.op === frame.op);
        // A nack without an op is a dropped frame (a flood); it may have been the history request.
        if (i < 0 && frame.t === 'nack' && frame.op === '') this.endHistory(null);
        if (i < 0) return;
        const [h] = this.held.splice(i, 1);
        h.resolve(frame.t === 'ack' ? { ok: true, seq: frame.seq } : { ok: false, code: frame.code });
        return;
      }
      case 'pong':
        return;
    }
  }

  private transmit(h: Held): void {
    if (this.sock?.ws.readyState !== OPEN) return;
    this.sock.ws.send(JSON.stringify({ t: 'cmd', op: h.op, cmd: h.cmd }));
  }

  private endHistory(entries: Entry[] | null): void {
    const wait = this.historyWait;
    this.historyWait = null;
    wait?.resolve(entries);
  }
}

function newOp(): string {
  return crypto.randomUUID().replaceAll('-', '');
}
