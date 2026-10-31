import { type Page, expect, test } from '@playwright/test';
import { PHONE, bet, bot, joinTable, myStack, openTable, pot } from './helpers.js';

const live = (page: Page) => page.getByTestId('connection').getByText('Live');

test('two players through a hand: bet, undo, win, split, a host action, a reconnect', async ({ page: host, browser, baseURL, browserName }) => {
  const guestContext = await browser.newContext({ baseURL, viewport: PHONE, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const guest = await guestContext.newPage();
  const errors: string[] = [];
  for (const p of [host, guest]) {
    p.on('dialog', (d) => void d.accept());
    p.on('pageerror', (e) => errors.push(e.message));
  }

  const code = await openTable(host, 'Ana');
  await expect(myStack(host)).toHaveText('1,000');
  await joinTable(guest, code, 'Ben');
  await expect(host.locator('[data-seat]', { hasText: 'Ben' })).toBeVisible();
  await expect(guest.locator('[data-seat]', { hasText: 'Ana' })).toContainText('HOST');

  // A bet moves chips from the stack into the pot, for everyone.
  await bet(guest, 100);
  await expect(myStack(guest)).toHaveText('900');
  await expect(pot(host)).toHaveText('100');

  // Its author can undo it.
  const row = guest.locator('[data-seq]', { hasText: 'You bet 100 into the main pot' });
  await row.getByRole('button', { name: 'Undo' }).click();
  await expect(pot(host)).toHaveText('0');
  await expect(myStack(guest)).toHaveText('1,000');

  // Win takes the whole pot.
  await bet(guest, 100);
  await bet(host, 50);
  await expect(pot(guest)).toHaveText('150');
  await host.getByRole('button', { name: 'Win', exact: true }).click();
  await host.getByRole('dialog', { name: 'Win' }).getByRole('button', { name: 'Take all 150' }).click();
  await expect(myStack(host)).toHaveText('1,100');
  await expect(pot(guest)).toHaveText('0');

  // Split divides a pot; the odd chip goes to the first seat in table order.
  await bet(guest, 101);
  await expect(pot(host)).toHaveText('101');
  await host.getByRole('button', { name: 'Win', exact: true }).click();
  const win = host.getByRole('dialog', { name: 'Win' });
  await win.getByRole('tab', { name: 'Split' }).click();
  await win.getByRole('button', { name: /^Ana/ }).click();
  await win.getByRole('button', { name: /^Ben/ }).click();
  await win.getByRole('button', { name: 'Split between 2' }).click();
  await expect(myStack(host)).toHaveText('1,151');
  await expect(myStack(guest)).toHaveText('849');

  // The host opens a side pot, a player bets into it, and the host closes it into the main pot.
  await host.getByRole('button', { name: 'More' }).click();
  await host.getByRole('button', { name: /^Pots/ }).click();
  await host.getByRole('button', { name: 'Open a side pot' }).click();
  await host.getByRole('dialog', { name: 'Pots' }).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(pot(guest, 'side-1')).toHaveText('0');
  await bet(guest, 49, 'Side pot 1');
  await expect(pot(host, 'side-1')).toHaveText('49');
  await host.getByRole('button', { name: 'More' }).click();
  await host.getByRole('button', { name: /^Pots/ }).click();
  await host.getByRole('button', { name: 'Close side pot 1' }).click();
  await host.getByRole('dialog', { name: 'Pots' }).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(pot(guest, 'side-1')).toHaveCount(0);
  await expect(pot(guest)).toHaveText('49');

  // A bet made while offline is held and goes through after the reconnect.
  await guestContext.setOffline(true);
  await expect(guest.getByTestId('connection')).toHaveText(/Reconnecting|Offline/, { timeout: 15_000 });
  await bet(guest, 25);
  // WebKit's emulated offline does not block new WebSockets, so there the bet can land before the network returns.
  if (browserName === 'chromium') await expect(pot(host)).toHaveText('49');
  await guestContext.setOffline(false);
  await expect(live(guest)).toBeVisible({ timeout: 15_000 });
  await expect(pot(host)).toHaveText('74');
  await expect(myStack(guest)).toHaveText('775');

  expect(errors).toEqual([]);
  await guestContext.close();
});

test('a refused command says why, and a seat claimed elsewhere goes back to the join screen', async ({ page, browser, baseURL }) => {
  const code = await openTable(page, 'Cara', '500');
  const dev = await bot(baseURL!, 'Dev', code);
  dev.close();
  await expect(page.locator('[data-seat]', { hasText: 'Dev' })).toContainText('AWAY');

  // Dev comes back while the host confirms removing him: the table refuses, in words.
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /^Players/ }).click();
  page.once('dialog', async (d) => {
    await dev.rejoin();
    await d.accept();
  });
  await page.locator('[data-player="Dev"]').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('status').getByText('Only a player who is away can be removed.')).toBeVisible();
  await page.getByRole('dialog', { name: 'Players' }).getByRole('button', { name: 'Close', exact: true }).click();

  // Cara's seat is claimed by name on another phone while this one is away from the table.
  await page.goto('/');
  const other = await browser.newContext({ baseURL, viewport: PHONE });
  const phone = await other.newPage();
  await phone.goto(`/join?code=${code}`);
  await phone.getByRole('button', { name: "I'm Cara" }).click();
  await expect(myStack(phone)).toHaveText('500');

  await page.goto(`/${code}`);
  await expect(page.getByRole('status').getByText('This seat is now held on another device')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Join a table' })).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue('Cara');
  dev.close();
  await other.close();
});

test('a version 2 recent room claims its seat by name, or explains why not', async ({ page, baseURL }) => {
  const maya = await bot(baseURL!, 'Maya');
  maya.close();
  const zed = await bot(baseURL!, 'Zed');
  await page.goto('/');
  await page.evaluate(
    ([a, b]) =>
      localStorage.setItem(
        'pokerChipsRecentRooms',
        JSON.stringify([
          { roomId: a, playerName: 'Maya', lastVisited: Date.now() },
          { roomId: b, playerName: 'Zed', lastVisited: Date.now() - 1000 },
        ]),
      ),
    [maya.code, zed.code],
  );
  await page.reload();

  await page.getByRole('button', { name: /Back to your seat as Maya/ }).click();
  await expect(myStack(page)).toHaveText('1,000');
  await expect(page.locator('[data-you]')).toContainText('HOST');
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem('pokerChipsRecentRooms') ?? '[]') as { roomId: string }[]);
  expect(left.map((r) => r.roomId)).toEqual([zed.code]);

  // Zed is still here on another device: the join screen, filled in, says why.
  await page.goto('/');
  await page.getByRole('button', { name: /Back to your seat as Zed/ }).click();
  await expect(page.getByRole('heading', { name: 'Join a table' })).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue('Zed');
  await expect(page.getByRole('alert')).toHaveText('Someone at the table already has that name.');
  zed.close();
});

test('a table that no longer exists sends you to the join screen, saying so', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('pokerchips.tables', JSON.stringify([{ code: 'zz00zz00', name: 'Maya', seatKey: '0'.repeat(32), openedAt: Date.now() }])),
  );
  await page.goto('/zz00zz00');
  await expect(page.getByRole('status').getByText('That table does not exist any more.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Join a table' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pokerchips.tables'))).toBe('[]');
});
