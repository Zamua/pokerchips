import type { ErrorCode } from '../domain/errors.js';

export const json = (body: unknown, status = 200) => Response.json(body, { status });

/** The table cell's own routes, which only the Worker calls. */
export const CELL_ROUTES = {
  open: '/open',
  info: '/info',
  seats: '/seats',
  socket: '/socket',
  import: '/import',
} as const;

export const cellUrl = (route: keyof typeof CELL_ROUTES) => `https://table${CELL_ROUTES[route]}`;

/** The status a cell answers each refusal with; 'exists' tells the Worker to open under another code. */
export const STATUS: Partial<Record<ErrorCode | 'exists', number>> = {
  'not-found': 404,
  exists: 409,
  'name-taken': 409,
  'table-full': 409,
};
