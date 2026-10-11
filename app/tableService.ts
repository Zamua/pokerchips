import type { ErrorCode } from '../domain/errors.js';
import { type LegacyRoom, importLegacy } from '../domain/legacy.js';
import type { Entry } from '../domain/ledger.js';
import { type Command, type Outcome, type Table, arrive, depart, execute, join, openTable, seatByKeyHash } from '../domain/table.js';
import { IDLE_LIFETIME_MS, LEDGER_TAIL, type SeatId, type TableCode } from '../domain/values.js';
import { type TableView, viewOf } from '../protocol/frames.js';
import type { Answer, Clock, Publisher, Secrets, TableStore } from './ports.js';

export type Seated = { ok: true; seatId: SeatId; seatKey: string } | { ok: false; code: ErrorCode | 'exists' };

/**
 * Use cases of one table. The caller is the table's actor, so calls never
 * overlap; every read-decide-write below runs without yielding.
 */
export class TableService {
  constructor(
    private readonly store: TableStore,
    private readonly publisher: Publisher,
    private readonly clock: Clock,
    private readonly secrets: Secrets,
  ) {}

  async open(code: TableCode, name: unknown, buyIn: unknown): Promise<Seated> {
    const seatKey = this.secrets.seatKey();
    const keyHash = await this.secrets.hash(seatKey);
    if (this.store.load()) return { ok: false, code: 'exists' };
    const seatId = this.secrets.seatId();
    const o = openTable({ code, name, buyIn, seatId, keyHash, now: this.clock.now() });
    return this.seat(o, seatKey);
  }

  async join(name: unknown): Promise<Seated> {
    const seatKey = this.secrets.seatKey();
    const keyHash = await this.secrets.hash(seatKey);
    const table = this.store.load();
    if (!table) return { ok: false, code: 'not-found' };
    const o = join(table, { name, keyHash, seatId: this.freshSeatId(table), now: this.clock.now() });
    const seated = this.seat(o, seatKey);
    if (seated.ok) this.publish();
    return seated;
  }

  /** A version 2 room, into a table that does not exist yet. */
  importLegacy(room: LegacyRoom): { ok: true; seats: number } | { ok: false; code: ErrorCode | 'exists'; detail?: string } {
    if (this.store.load()) return { ok: false, code: 'exists' };
    const o = importLegacy(room, this.clock.now());
    if (!o.ok) return o;
    this.store.save(o.table, o.entries);
    return { ok: true, seats: o.table.seats.length };
  }

  info(): { code: TableCode; seats: { name: string; here: boolean }[] } | null {
    const table = this.store.load();
    return table && { code: table.code, seats: table.seats.map((s) => ({ name: s.name, here: s.awaySince === null })) };
  }

  /** The seat a key holds, or null. */
  async seatFor(seatKey: string): Promise<SeatId | null> {
    const keyHash = await this.secrets.hash(seatKey);
    const table = this.store.load();
    return (table && seatByKeyHash(table, keyHash)?.id) ?? null;
  }

  /** A socket now holds the seat. Answers the view for its welcome. */
  arrived(seat: SeatId): TableView | null {
    const table = this.store.load();
    if (!table) return null;
    const next = arrive(table, seat, this.clock.now());
    this.store.save(next, []);
    this.publish();
    return this.view(next);
  }

  /** The seat's last socket closed. */
  departed(seat: SeatId): void {
    const table = this.store.load();
    if (!table) return;
    const next = depart(table, seat, this.clock.now());
    if (next === table) return;
    this.store.save(next, []);
    this.publish();
  }

  command(seat: SeatId, op: string, cmd: Command): Answer {
    const earlier = this.store.answerFor(seat, op);
    if (earlier) return earlier;
    const table = this.store.load();
    if (!table) return { t: 'nack', op, code: 'not-found' };
    const o = execute(table, seat, cmd, this.clock.now());
    const answer: Answer = o.ok ? { t: 'ack', op, seq: o.table.seq } : { t: 'nack', op, code: o.code };
    this.store.saveWithAnswer(o.ok && o.table !== table ? o.table : null, o.ok ? o.entries : [], seat, answer);
    if (o.ok && o.table !== table) this.publish();
    return answer;
  }

  history(before: number): Entry[] {
    return this.store.ledgerBefore(before, LEDGER_TAIL);
  }

  /** When the table should be deleted if nothing happens first. */
  expiresAt(): number | null {
    const table = this.store.load();
    return table && table.lastActivity + IDLE_LIFETIME_MS;
  }

  /** Deletes the table if it has been idle long enough and nobody is connected. */
  expire(openSockets: number): boolean {
    const at = this.expiresAt();
    if (at === null || openSockets > 0 || this.clock.now() < at) return false;
    this.store.wipe();
    return true;
  }

  view(table = this.store.load()): TableView | null {
    return table && viewOf(table, this.store.ledgerTail(LEDGER_TAIL));
  }

  private seat(o: Outcome, seatKey: string): Seated {
    if (!o.ok) return o;
    this.store.save(o.table, o.entries);
    return { ok: true, seatId: o.seat!, seatKey };
  }

  private publish(): void {
    const state = this.view();
    if (state) this.publisher.broadcast({ t: 'state', state });
  }

  private freshSeatId(table: Table): SeatId {
    let id = this.secrets.seatId();
    while (table.seats.some((s) => s.id === id)) id = this.secrets.seatId();
    return id;
  }
}
