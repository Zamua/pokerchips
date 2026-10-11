import type { ErrorCode } from '../../../domain/errors.js';
import type { Entry } from '../../../domain/ledger.js';
import type { Command } from '../../../domain/table.js';
import { PING, type ServerFrame, type TableView } from '../../../protocol/frames.js';

export type Status = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'denied';
export type Answer = { ok: true; seq: number } | { ok: false; code: ErrorCode };

export const HEARTBEAT_MS = 25_000;
/** A socket that has heard nothing for this long is presumed dead. */
export const SILENCE_MS = 2 * HEARTBEAT_MS + 5_000;
export const BACKOFF_START_MS = 500;
export const BACKOFF_CAP_MS = 30_000;
export const MAX_ATTEMPTS = 15;
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

interface Pending {
  op: string;
  cmd: Command;
  resolve(answer: Answer): void;
}

const OPEN = 1;

/**
 * One table connection: hello on every open, a ping every 25 s, reconnects
 * with backoff and jitter, an immediate reconnect when the page returns, and
 * commands held while offline and resent after the next welcome. Resending
 * is safe because the table answers a repeated op id without applying it.
 */
export class TableSocket {
  private ws: SocketLike | null = null;
  private status: Status = 'connecting';
  private welcomed = false;
  private attempts = 0;
  private stopped = false;
  private pending: Pending[] = [];
  private seatId = '';
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private lastHeard = 0;
  private historyWait: { promise: Promise<Entry[] | null>; resolve(entries: Entry[] | null): void } | null = null;

  constructor(private readonly o: TableSocketOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.ws?.close(1000, 'leave');
    this.ws = null;
    this.endHistory(null);
  }

  /** The page came back to the foreground: reconnect now if not connected. */
  resume(): void {
    if (this.stopped || this.status === 'denied') return;
    if (this.ws?.readyState === OPEN && this.welcomed && Date.now() - this.lastHeard < SILENCE_MS) return;
    this.attempts = 0;
    this.reconnectNow();
  }

  /** The device lost its network: count the link as dropped now instead of waiting for silence. */
  offline(): void {
    const ws = this.ws;
    if (this.stopped || this.status === 'denied' || !ws) return;
    ws.close(4000, 'offline');
    this.dropped(ws);
  }

  command(cmd: Command): Promise<Answer> {
    return new Promise((resolve) => {
      if (this.pending.length >= BUFFER_LIMIT) {
        resolve({ ok: false, code: 'rate-limited' });
        return;
      }
      const p: Pending = { op: (this.o.newOp ?? newOp)(), cmd, resolve };
      this.pending.push(p);
      if (this.welcomed) this.transmit(p);
    });
  }

  /**
   * Up to 50 ledger entries older than `before`; null when not connected or
   * the link drops first. One request at a time: the answer carries no id.
   */
  history(before: number): Promise<Entry[] | null> {
    if (this.historyWait) return this.historyWait.promise;
    if (!this.welcomed || this.ws?.readyState !== OPEN) return Promise.resolve(null);
    let resolve!: (entries: Entry[] | null) => void;
    const promise = new Promise<Entry[] | null>((r) => (resolve = r));
    this.historyWait = { promise, resolve };
    this.ws.send(JSON.stringify({ t: 'history', before }));
    return promise;
  }

  private endHistory(entries: Entry[] | null): void {
    const wait = this.historyWait;
    this.historyWait = null;
    wait?.resolve(entries);
  }

  private connect(): void {
    if (this.stopped) return;
    this.welcomed = false;
    const ws = (this.o.open ?? ((url) => new WebSocket(url) as unknown as SocketLike))(this.o.url);
    this.ws = ws;
    ws.onopen = () => {
      this.lastHeard = Date.now();
      ws.send(JSON.stringify({ t: 'hello', seatKey: this.o.seatKey }));
    };
    ws.onmessage = (ev) => this.receive(ws, ev.data);
    ws.onclose = () => this.dropped(ws);
    ws.onerror = () => this.dropped(ws);
  }

  private receive(ws: SocketLike, data: unknown): void {
    if (ws !== this.ws || typeof data !== 'string') return;
    this.lastHeard = Date.now();
    let frame: ServerFrame;
    try {
      frame = JSON.parse(data) as ServerFrame;
    } catch {
      return;
    }
    switch (frame.t) {
      case 'welcome':
        this.welcomed = true;
        this.attempts = 0;
        this.seatId = frame.seatId;
        this.setStatus('online');
        this.startHeartbeat();
        this.o.onState(frame.state, frame.seatId);
        for (const p of this.pending) this.transmit(p);
        break;
      case 'state':
        this.o.onState(frame.state, this.seatId);
        break;
      case 'history':
        this.endHistory(frame.entries);
        break;
      case 'ack':
      case 'nack': {
        const i = this.pending.findIndex((p) => p.op === frame.op);
        // A nack without an op is a dropped frame (a flood); it may have been the history request.
        if (i < 0 && frame.t === 'nack' && frame.op === '') this.endHistory(null);
        if (i < 0) break;
        const [p] = this.pending.splice(i, 1);
        p.resolve(frame.t === 'ack' ? { ok: true, seq: frame.seq } : { ok: false, code: frame.code });
        break;
      }
      case 'denied':
        this.setStatus('denied');
        this.stop();
        for (const p of this.pending.splice(0)) p.resolve({ ok: false, code: 'not-found' });
        break;
      default:
        break;
    }
  }

  private transmit(p: Pending): void {
    if (this.ws?.readyState !== OPEN) return;
    this.ws.send(JSON.stringify({ t: 'cmd', op: p.op, cmd: p.cmd }));
  }

  private startHeartbeat(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastHeard > SILENCE_MS) {
        this.reconnectNow();
        return;
      }
      if (this.ws?.readyState === OPEN) this.ws.send(PING);
    }, HEARTBEAT_MS);
  }

  private dropped(ws: SocketLike): void {
    if (ws !== this.ws || this.stopped) return;
    this.ws = null;
    this.welcomed = false;
    clearInterval(this.heartbeat);
    this.endHistory(null);
    if (this.attempts >= MAX_ATTEMPTS) {
      this.setStatus('offline');
      return;
    }
    this.setStatus('reconnecting');
    const base = Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * 2 ** this.attempts);
    const jittered = base * (0.5 + 0.5 * (this.o.random ?? Math.random)());
    this.attempts++;
    this.retry = setTimeout(() => this.connect(), jittered);
  }

  private reconnectNow(): void {
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    const old = this.ws;
    this.ws = null;
    old?.close(4000, 'reconnect');
    this.endHistory(null);
    this.setStatus('reconnecting');
    this.connect();
  }

  private setStatus(status: Status): void {
    if (status === this.status) return;
    this.status = status;
    this.o.onStatus(status);
  }
}

function newOp(): string {
  return crypto.randomUUID().replaceAll('-', '');
}
