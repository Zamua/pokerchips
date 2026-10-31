import { parseTableCode } from '../domain/values.js';
import { parseJoinRequest, parseOpenRequest } from '../protocol/frames.js';
import type { Env } from './env.js';
import { STATUS, cellUrl, json } from './http.js';
import { tableCode } from './secrets.js';

export { TableCell } from './TableCell.js';

const MAX_BODY = 4_096;
const OPEN_ATTEMPTS = 5;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return new Response('ok\n');
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!originAllowed(request, url, env)) return json({ error: 'bad-frame' }, 403);
    return api(request, url, env);
  },
} satisfies ExportedHandler<Env>;

async function api(request: Request, url: URL, env: Env): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean); // api, tables, <code>, <rest>
  if (parts[1] !== 'tables' || parts.length > 4) return json({ error: 'not-found' }, 404);

  if (parts.length === 2) {
    if (request.method !== 'POST') return json({ error: 'bad-frame' }, 405);
    const req = parseOpenRequest(await readJson(request));
    if (!req.ok) return json({ error: req.code }, 400);
    for (let i = 0; i < OPEN_ATTEMPTS; i++) {
      const code = tableCode();
      const res = await table(env, code).fetch(cellUrl('open'), {
        method: 'POST',
        body: JSON.stringify({ code, ...req.value }),
      });
      if (res.status !== STATUS.exists) return res;
    }
    return json({ error: 'bad-code' }, 503);
  }

  const code = parseTableCode(parts[2]);
  if (!code.ok) return json({ error: code.code }, 400);
  const stub = table(env, code.value);
  switch (`${request.method} ${parts[3] ?? ''}`) {
    case 'GET ':
      return stub.fetch(cellUrl('info'));
    case 'POST seats': {
      const req = parseJoinRequest(await readJson(request));
      if (!req.ok) return json({ error: req.code }, 400);
      return stub.fetch(cellUrl('seats'), { method: 'POST', body: JSON.stringify(req.value) });
    }
    case 'GET socket':
      return stub.fetch(new Request(cellUrl('socket'), request));
    default:
      return json({ error: 'not-found' }, 404);
  }
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
