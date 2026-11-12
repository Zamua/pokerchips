import { parseTableCode } from '../domain/values.js';
import { DEVICE_HEADER, parseDevice, parseJoinRequest, parseOpenRequest } from '../protocol/frames.js';
import { actorOf, record, skipped } from './activity.js';
import type { Env } from './env.js';
import { MISSING, STATUS, cellUrl, json } from './http.js';
import { MAX_BODY } from './limits.js';
import { tableCode } from './secrets.js';
import { type SourceLimits, sourceLimits } from './sourceLimits.js';

export { CreationLimiter } from './CreationLimiter.js';
export { TableCell } from './TableCell.js';

const OPEN_ATTEMPTS = 5;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return new Response('ok\n');
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!originAllowed(request, url, env)) return json({ error: 'bad-frame' }, 403);
    return api(request, url, env, ctx);
  },
} satisfies ExportedHandler<Env>;

async function api(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean); // api, tables, <code>, <rest>
  if (parts[1] !== 'tables' || parts.length > 4) return json({ error: 'not-found' }, 404);

  if (parts.length === 2) {
    if (request.method !== 'POST') return json({ error: 'bad-frame' }, 405);
    const req = parseOpenRequest(await readJson(request));
    if (!req.ok) return json({ error: req.code }, 400);
    if (!(await sourceLimits(env, request).mayOpen())) return json({ error: 'rate-limited' }, 429);
    for (let i = 0; i < OPEN_ATTEMPTS; i++) {
      const code = tableCode();
      const res = await table(env, code).fetch(cellUrl('open'), {
        method: 'POST',
        body: JSON.stringify({ code, ...req.value }),
      });
      if (res.status === STATUS.exists) continue;
      if (res.status === 201 && !skipped(request)) {
        const device = parseDevice(request.headers.get(DEVICE_HEADER));
        ctx.waitUntil(actorOf(env, device).then((actor) => record(env, actor, 'table_created')));
      }
      return res;
    }
    return json({ error: 'bad-code' }, 503);
  }

  const code = parseTableCode(parts[2]);
  if (!code.ok) return json({ error: code.code }, 400);
  const stub = table(env, code.value);
  const limits = sourceLimits(env, request);
  switch (`${request.method} ${parts[3] ?? ''}`) {
    case 'GET ':
      return reachCell(limits, () => stub.fetch(cellUrl('info')));
    case 'POST seats': {
      const req = parseJoinRequest(await readJson(request));
      if (!req.ok) return json({ error: req.code }, 400);
      return reachCell(limits, () => stub.fetch(cellUrl('seats'), { method: 'POST', body: JSON.stringify(req.value) }));
    }
    case 'GET socket':
      return reachCell(limits, () => stub.fetch(new Request(cellUrl('socket'), request)));
    default:
      return json({ error: 'not-found' }, 404);
  }
}

/** Calls a table's cell unless the source has looked up too many tables that do not exist; a lookup that finds none counts against it. */
async function reachCell(limits: SourceLimits, call: () => Promise<Response>): Promise<Response> {
  if (!(await limits.mayLookUp())) return json({ error: 'rate-limited' }, 429);
  const res = await call();
  if (res.status === 404 || res.headers.has(MISSING)) await limits.missed();
  return res;
}

function table(env: Env, code: string) {
  return env.TABLES.get(env.TABLES.idFromName(code), { locationHint: 'enam' });
}

/** A browser's request must come from this Worker's origin or a listed one. */
function originAllowed(request: Request, url: URL, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (origin === null || origin === url.origin) return true;
  return env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).includes(origin);
}

/** The body as JSON, or undefined when it is too large or not JSON; the request parsers refuse undefined. */
async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
