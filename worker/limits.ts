/** Caps on what one client may send or hold, far above any real table. */
export const MAX_BODY = 4_096;
export const MAX_FRAME = 4_096;
export const MAX_SOCKETS = 64;

/** What one source network may do in a window: open tables, and look up tables that do not exist. */
export const CAPS = { creations: 30, misses: 120 } as const;
export type Bucket = keyof typeof CAPS;
export const SOURCE_WINDOW_MS = 60 * 60_000;
