import type { TableCell } from './TableCell.js';

export interface Env {
  TABLES: DurableObjectNamespace<TableCell>;
  ASSETS: Fetcher;
  /** Comma-separated origins allowed besides the Worker's own. */
  ALLOWED_ORIGINS: string;
}
