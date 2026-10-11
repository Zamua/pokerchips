import { type Page, expect } from '@playwright/test';

export const PHONE = { width: 390, height: 844 };

/** Opens a table through the UI and returns its code. */
export async function openTable(page: Page, name: string, buyIn = '1,000'): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a game' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('radio', { name: buyIn, exact: true }).click();
  await page.getByRole('button', { name: 'Open the table' }).click();
  await expect(page.locator('[data-you]')).toBeVisible();
  const code = new URL(page.url()).pathname.slice(1);
  expect(code).toMatch(/^[a-z0-9]{8}$/);
  return code;
}

/** Joins a table through the UI by opening its link. */
export async function joinTable(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/${code}`);
  await expect(page.getByLabel('Game code')).toHaveValue(new RegExp(code.slice(0, 4), 'i'));
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Take a seat' }).click();
  await expect(page.locator('[data-you]')).toBeVisible();
}

export const myStack = (page: Page) => page.getByTestId('my-stack');
export const pot = (page: Page, id = 'main') => page.getByTestId(`pot-${id}`);

/** Types an amount on the drawer's keypad. */
export async function keypad(page: Page, amount: number): Promise<void> {
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: 'Clear', exact: true }).click();
  for (const d of String(amount)) await drawer.getByRole('button', { name: d, exact: true }).click();
}

export async function bet(page: Page, amount: number, potLabel = 'Main pot'): Promise<void> {
  await page.getByRole('button', { name: 'Bet', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Bet' });
  await drawer.getByRole('radio', { name: new RegExp(`^${potLabel}`) }).click();
  await keypad(page, amount);
  await drawer.getByRole('button', { name: /^Bet \d/ }).click();
  await expect(drawer).toBeHidden();
}

type Frame = { t: string; op?: string; seq?: number; code?: string; seatId?: string };

/** A player held by the test itself over HTTP and a WebSocket, to fill a table. */
export interface Bot {
  code: string;
  seatId: string;
  send(cmd: Record<string, unknown>): Promise<Frame>;
  /** Drops the connection; the seat goes away. */
  close(): void;
  /** Connects again with the same seat key. */
  rejoin(): Promise<void>;
}

export async function bot(base: string, name: string, code?: string, buyIn = 1_000): Promise<Bot> {
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = code ? await post(`/api/tables/${code}/seats`, { name }) : await post('/api/tables', { name, buyIn });
  if (!res.ok) throw new Error(`seat for ${name}: ${res.status}`);
  const seat = (await res.json()) as { code?: string; seatId: string; seatKey: string };
  const tableCode = code ?? seat.code!;
  const waits = new Map<string, (f: Frame) => void>();
  let ws: WebSocket;
  let n = 0;

  const connect = () =>
    new Promise<void>((resolve, reject) => {
      ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/tables/${tableCode}/socket`);
      ws.onerror = () => reject(new Error(`socket for ${name}`));
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', seatKey: seat.seatKey }));
      ws.onmessage = (ev) => {
        const f = JSON.parse(String(ev.data)) as Frame;
        if (f.t === 'welcome') resolve();
        if (f.t === 'denied') reject(new Error(`${name} denied`));
        if ((f.t === 'ack' || f.t === 'nack') && f.op) waits.get(f.op)?.(f);
      };
    });
  await connect();

  return {
    code: tableCode,
    seatId: seat.seatId,
    send(cmd) {
      const op = `${name.replace(/\W/g, '')}${++n}`;
      return new Promise((resolve) => {
        waits.set(op, resolve);
        ws.send(JSON.stringify({ t: 'cmd', op, cmd }));
      });
    },
    close: () => ws.close(),
    rejoin: connect,
  };
}
