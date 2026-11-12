import type { CreationLimiter } from './CreationLimiter.js';
import type { TableCell } from './TableCell.js';

export interface Env {
  TABLES: DurableObjectNamespace<TableCell>;
  CREATIONS: DurableObjectNamespace<CreationLimiter>;
  ASSETS: Fetcher;
  /** Where activity events go; optional, with ACTIVITY_SALT keying the actor hash. */
  ACTIVITY?: AnalyticsEngineDataset;
  ACTIVITY_SALT?: string;
  /** Comma-separated origins allowed besides the Worker's own. */
  ALLOWED_ORIGINS: string;
}
