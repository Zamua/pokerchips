#!/usr/bin/env node
// Post-deploy smoke: health, a table opened and joined over HTTP, and a bet,
// a refusal and a collect over WebSockets. Leaves one idle table behind,
// which expires on its own. Usage: SMOKE_BASE_URL=https://host node scripts/smoke.mjs
const base = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const origin = new URL(base).origin;
let failed = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
}

async function post(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function connect(code, seatKey) {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/tables/${code}/socket`);
  const frames = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    frames.push(JSON.parse(e.data));
    for (const w of waiters.splice(0)) w();
  });
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', seatKey })));
  const next = async (match) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const f = frames.find(match);
      if (f) return f;
      if (Date.now() > deadline) throw new Error(`timed out; saw ${JSON.stringify(frames).slice(0, 300)}`);
      await new Promise((r) => {
        waiters.push(r);
        setTimeout(r, 250);
      });
    }
  };
  return { ws, next, send: (f) => ws.send(JSON.stringify(f)) };
}

try {
  const health = await fetch(`${base}/healthz`);
  check('healthz', health.status === 200);
  const page = await fetch(`${base}/`);
  check('client served', page.status === 200 && (await page.text()).includes('<div id="root"'));
  const deep = await fetch(`${base}/abcd1234`);
  check('deep link served by the client', deep.status === 200);

  const opened = await post('/api/tables', { name: 'Smoke', buyIn: 100 });
  check('open a table', opened.status === 201 && /^[a-z0-9]{8}$/.test(opened.body?.code ?? ''), String(opened.status));
  const { code, seatKey } = opened.body;
  const joined = await post(`/api/tables/${code}/seats`, { name: 'Smoke 2' });
  check('join a seat', joined.status === 201);
  const taken = await post(`/api/tables/${code}/seats`, { name: 'smoke 2' });
  check('a name that is away is claimed, not duplicated', taken.status === 201 && taken.body.seatId === joined.body.seatId);
  const foreign = await fetch(`${base}/api/tables`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' });
  check('foreign origin refused', foreign.status === 403);

  const a = connect(code, seatKey);
  const welcome = await a.next((f) => f.t === 'welcome');
  check('welcome', welcome.state.code === code);
  a.send({ t: 'cmd', op: 'smoke1', cmd: { type: 'bet', pot: 'main', amount: 40 } });
  check('bet acked', (await a.next((f) => f.op === 'smoke1')).t === 'ack');
  a.send({ t: 'cmd', op: 'smoke2', cmd: { type: 'bet', pot: 'main', amount: 1000 } });
  const refused = await a.next((f) => f.op === 'smoke2');
  check('bet over the stack refused', refused.t === 'nack' && refused.code === 'short-stack');
  a.send({ t: 'cmd', op: 'smoke3', cmd: { type: 'collect', pot: 'main' } });
  check('collect acked', (await a.next((f) => f.op === 'smoke3')).t === 'ack');
  const state = await a.next((f) => f.t === 'state' && f.state.pots[0].amount === 0 && f.state.seats[0].stack === 100);
  check('state broadcast', Boolean(state));
  a.ws.close();
} catch (error) {
  check('smoke run', false, String(error));
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
