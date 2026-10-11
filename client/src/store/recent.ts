/** Tables this device has a seat at. Device-local and best-effort: storage can be missing or full. */
export interface RecentTable {
  code: string;
  name: string;
  seatKey: string;
  openedAt: number;
  stack?: number;
  buyIn?: number;
  /** The host's name and the seat count when last seen, for the Recent list. */
  hostName?: string;
  players?: number;
}

const KEY = 'pokerchips.tables';
const LIMIT = 12;

function read(): RecentTable[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? (v as RecentTable[]).filter((t) => typeof t?.code === 'string' && typeof t?.seatKey === 'string') : [];
  } catch {
    return [];
  }
}

function write(tables: RecentTable[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(tables.slice(0, LIMIT)));
  } catch {
    // Private mode or full storage: the table still works, it just is not remembered.
  }
}

export const recent = {
  list: (): RecentTable[] => read().sort((a, b) => b.openedAt - a.openedAt),
  get: (code: string): RecentTable | undefined => read().find((t) => t.code === code),
  remember(entry: RecentTable): void {
    write([entry, ...read().filter((t) => t.code !== entry.code)]);
  },
  update(code: string, patch: Partial<RecentTable>): void {
    write(read().map((t) => (t.code === code ? { ...t, ...patch } : t)));
  },
  forget(code: string): void {
    write(read().filter((t) => t.code !== code));
  },
};
