import type { Answer, TableStore } from '../app/ports.js';
import type { Entry } from '../domain/ledger.js';
import type { Table } from '../domain/table.js';
import type { SeatId } from '../domain/values.js';

/** Answers kept per seat for repeated op ids; a client resends far fewer. */
const ANSWERS_KEPT = 64;

/**
 * The table in its Durable Object's SQLite: one JSON row for the table, an
 * append-only ledger, and the latest answers per seat. One command writes
 * about three rows.
 */
export class SqlTableStore implements TableStore {
  private cached: Table | null | undefined;

  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (seq INTEGER PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS answers (
        seat TEXT NOT NULL, op TEXT NOT NULL, json TEXT NOT NULL, n INTEGER NOT NULL,
        PRIMARY KEY (seat, op)
      ) WITHOUT ROWID;
    `);
  }

  load(): Table | null {
    if (this.cached === undefined) {
      const row = this.storage.sql.exec<{ json: string }>('SELECT json FROM state WHERE id = 1').toArray()[0];
      this.cached = row ? (JSON.parse(row.json) as Table) : null;
    }
    return this.cached;
  }

  save(table: Table, entries: Entry[]): void {
    this.commit(table, () => this.write(table, entries));
  }

  saveWithAnswer(table: Table | null, entries: Entry[], seat: SeatId, answer: Answer): void {
    this.commit(table, () => {
      if (table) this.write(table, entries);
      const sql = this.storage.sql;
      const n = sql.exec<{ n: number }>('SELECT coalesce(max(n), 0) + 1 AS n FROM answers WHERE seat = ?', seat).one().n;
      sql.exec('INSERT OR REPLACE INTO answers (seat, op, json, n) VALUES (?, ?, ?, ?)', seat, answer.op, JSON.stringify(answer), n);
      sql.exec('DELETE FROM answers WHERE seat = ? AND n <= ?', seat, n - ANSWERS_KEPT);
    });
  }

  answerFor(seat: SeatId, op: string): Answer | null {
    const row = this.storage.sql
      .exec<{ json: string }>('SELECT json FROM answers WHERE seat = ? AND op = ?', seat, op)
      .toArray()[0];
    return row ? (JSON.parse(row.json) as Answer) : null;
  }

  ledgerTail(limit: number): Entry[] {
    return this.entries('SELECT json FROM ledger ORDER BY seq DESC LIMIT ?', limit).reverse();
  }

  ledgerBefore(seq: number, limit: number): Entry[] {
    return this.entries('SELECT json FROM ledger WHERE seq < ? ORDER BY seq DESC LIMIT ?', seq, limit).reverse();
  }

  wipe(): void {
    this.cached = undefined;
    this.storage.sql.exec('DELETE FROM state; DELETE FROM ledger; DELETE FROM answers;');
  }

  private write(table: Table, entries: Entry[]): void {
    const sql = this.storage.sql;
    sql.exec('INSERT OR REPLACE INTO state (id, json) VALUES (1, ?)', JSON.stringify(table));
    for (const e of entries) sql.exec('INSERT INTO ledger (seq, json) VALUES (?, ?)', e.seq, JSON.stringify(e));
  }

  /** The cache follows storage only once the transaction has committed. */
  private commit(table: Table | null, body: () => void): void {
    try {
      this.storage.transactionSync(body);
    } catch (error) {
      this.cached = undefined;
      throw error;
    }
    if (table) this.cached = table;
  }

  private entries(query: string, ...args: (string | number)[]): Entry[] {
    return this.storage.sql
      .exec<{ json: string }>(query, ...args)
      .toArray()
      .map((r) => JSON.parse(r.json) as Entry);
  }
}
