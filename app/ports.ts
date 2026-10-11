import type { Entry } from '../domain/ledger.js';
import type { Table } from '../domain/table.js';
import type { SeatId } from '../domain/values.js';
import type { ServerFrame } from '../protocol/frames.js';

export type Answer = { t: 'ack'; op: string; seq: number } | Extract<ServerFrame, { t: 'nack' }>;

/** The table's own storage. Synchronous, so a command never yields mid-way. */
export interface TableStore {
  load(): Table | null;
  /** Writes the table and appends its new entries, all or nothing. */
  save(table: Table, entries: Entry[]): void;
  ledgerTail(limit: number): Entry[];
  ledgerBefore(seq: number, limit: number): Entry[];
  answerFor(seat: SeatId, op: string): Answer | null;
  /** Saves the table (null when unchanged), its entries and the answer to op in one transaction. */
  saveWithAnswer(table: Table | null, entries: Entry[], seat: SeatId, answer: Answer): void;
  wipe(): void;
}

export interface Publisher {
  /** Every open socket of the table. */
  broadcast(frame: ServerFrame): void;
}

export interface Clock {
  now(): number;
}

export interface Secrets {
  /** 16 hex characters. */
  seatId(): string;
  /** 32 hex characters. */
  seatKey(): string;
  hash(seatKey: string): Promise<string>;
}
