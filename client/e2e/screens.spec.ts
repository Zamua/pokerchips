import { expect, test } from '@playwright/test';
import { type Bot, PHONE, bot, keypad } from './helpers.js';

/** Screenshots of the real screens for a visual check; runs only when SCREENSHOTS_DIR is set. */
const dir = process.env.SCREENSHOTS_DIR;

test.skip(!dir, 'set SCREENSHOTS_DIR to take screenshots');

test('screens', async ({ page, baseURL }, info) => {
  const shot = (name: string) => page.screenshot({ path: `${dir}/${info.project.name === 'chromium' ? '' : `${info.project.name}-`}${name}.png` });
  const ana = await bot(baseURL!, 'Ana');
  const code = ana.code;
  const bots: Bot[] = [ana];
  for (const name of ['Ben', 'Cara', 'Dev', 'Eli']) bots.push(await bot(baseURL!, name, code));
  const [, ben, cara, dev, eli] = bots;

  await page.goto(`/${code}`);
  await page.getByLabel('Your name').fill('Maya');
  await page.getByRole('button', { name: 'Take a seat' }).click();
  await expect(page.locator('[data-you]')).toBeVisible();

  await ana.send({ type: 'openPot' });
  await ana.send({ type: 'bet', pot: 'main', amount: 315 });
  await cara.send({ type: 'collect', pot: 'main', amount: 315 });
  await cara.send({ type: 'adjust', delta: 265, reason: 'rebuy' });
  await dev.send({ type: 'bet', pot: 'side-1', amount: 100 });
  await ben.send({ type: 'bet', pot: 'side-1', amount: 50 });
  await ben.send({ type: 'adjust', delta: 155, reason: 'rebuy' });
  await dev.send({ type: 'bet', pot: 'main', amount: 500 });
  await dev.send({ type: 'collect', pot: 'main', amount: 240 });
  await eli.send({ type: 'bet', pot: 'main', amount: 50 });
  await eli.send({ type: 'adjust', delta: -470, reason: 'cashout' });
  await ben.send({ type: 'bet', pot: 'main', amount: 50 });
  dev.close();

  await expect(page.getByText('Ben bet 50 into the main pot')).toBeVisible();
  await page.waitForTimeout(600);
  await shot('table');

  await page.getByRole('button', { name: 'Bet', exact: true }).click();
  await keypad(page, 125);
  await page.waitForTimeout(400);
  await shot('bet');
  await page.getByRole('button', { name: 'Bet 125 into main pot' }).click();
  await expect(page.getByTestId('flying-chip')).toHaveCount(1);
  await shot('motion');

  await page.getByRole('button', { name: 'Win', exact: true }).click();
  await page.waitForTimeout(400);
  await shot('win');
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Maya/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Cara/ }).click();
  await page.waitForTimeout(300);
  await shot('win-split');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'More' }).click();
  await page.waitForTimeout(400);
  await shot('more');
  await page.getByRole('button', { name: /^Players/ }).click();
  await page.waitForTimeout(400);
  await shot('players');
  await page.getByRole('button', { name: 'Close' }).click();

  // WebKit has the Web Share API, whose sheet never answers headless; Chromium falls back to a toast.
  if (info.project.name === 'chromium') {
    await page.getByRole('button', { name: /^Share table code/ }).click();
    await expect(page.getByRole('status').getByText(/^(Link copied|Tell them the code)/)).toBeVisible();
    await shot('toast');
  }

  await page.goto(`/join?code=${code}`);
  await expect(page.getByRole('button', { name: "I'm Dev" })).toBeVisible();
  await shot('join');

  await page.evaluate(() =>
    localStorage.setItem('pokerChipsRecentRooms', JSON.stringify([{ roomId: 'c81e5b60', playerName: 'Maya', lastVisited: Date.now() - 20 * 86_400_000 }])),
  );
  await page.goto('/');
  await page.waitForTimeout(400);
  await shot('landing');

  await page.getByRole('button', { name: 'Create a game' }).click();
  await page.waitForTimeout(300);
  await shot('open');

  for (const b of bots) b.close();
});

test('a crowded table', async ({ page, baseURL }, info) => {
  const shot = (name: string) => page.screenshot({ path: `${dir}/${info.project.name === 'chromium' ? '' : `${info.project.name}-`}crowded-${name}.png` });
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a game' }).click();
  await page.getByLabel('Your name').fill('Maximiliana Long');
  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.getByLabel('Custom buy-in').fill('250000');
  await page.getByRole('button', { name: 'Open the table' }).click();
  await expect(page.locator('[data-you]')).toBeVisible();
  const code = new URL(page.url()).pathname.slice(1);

  const names = ['Ana', 'Bartholomew Jones', 'Cara', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kit', 'Lu', 'Mo', 'Ned', 'Ola', 'Pia', 'Quin', 'Rae', 'Sol', 'Tex', 'Uma', 'Vic', 'Wes'];
  const bots: Bot[] = [];
  for (const name of names) bots.push(await bot(baseURL!, name, code));

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /^Pots/ }).click();
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Open a side pot' }).click();
  await expect(page.getByRole('button', { name: 'Open a side pot' })).toBeDisabled();
  await shot('pots');
  await page.getByRole('dialog', { name: 'Pots' }).getByRole('button', { name: 'Close', exact: true }).click();

  for (const [i, b] of bots.entries()) {
    await b.send({ type: 'bet', pot: i % 3 === 0 ? 'main' : `side-${(i % 8) + 1}`, amount: 1_250 * (i + 1) + 7 });
  }
  await bots[1].send({ type: 'adjust', delta: 9_000_000, reason: 'rebuy' });
  for (const b of bots.slice(18)) b.close();
  await expect(page.getByRole('button', { name: /, away, / })).toHaveCount(5);
  await page.waitForTimeout(500);
  await shot('table');
  await page.getByRole('main').evaluate((el) => el.scrollTo(0, 700));
  await page.waitForTimeout(200);
  await shot('table-2');
  await page.getByRole('main').evaluate((el) => el.scrollTo(0, 99_999));
  await page.waitForTimeout(200);
  await shot('table-3');

  await page.getByRole('button', { name: 'Bet', exact: true }).click();
  await page.getByRole('dialog', { name: 'Bet' }).getByRole('button', { name: 'All-in' }).click();
  await page.waitForTimeout(300);
  await shot('bet');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /^Players/ }).click();
  await page.waitForTimeout(300);
  await shot('players');
  await page.locator('[data-player="Bartholomew Jones"]').getByRole('button', { name: 'Adjust' }).click();
  await page.waitForTimeout(300);
  await shot('adjust');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'See all' }).click();
  await page.waitForTimeout(300);
  await shot('history');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Win', exact: true }).click();
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.waitForTimeout(300);
  await shot('split');
  for (const b of bots) b.close();
});

test('a small phone', async ({ page, baseURL }, info) => {
  const shot = (name: string) => page.screenshot({ path: `${dir}/${info.project.name === 'chromium' ? '' : `${info.project.name}-`}small-${name}.png` });
  await page.setViewportSize({ width: 375, height: 667 });
  const ana = await bot(baseURL!, 'Ana');
  const ben = await bot(baseURL!, 'Ben', ana.code);
  await ana.send({ type: 'openPot' });
  await ben.send({ type: 'bet', pot: 'side-1', amount: 75 });
  await page.goto(`/${ana.code}`);
  await page.getByLabel('Your name').fill('Maya');
  await page.getByRole('button', { name: 'Take a seat' }).click();
  await expect(page.locator('[data-you]')).toBeVisible();
  await page.waitForTimeout(400);
  await shot('table');
  await page.context().setOffline(true);
  await expect(page.getByTestId('connection')).toHaveText('Reconnecting');
  await shot('reconnecting');
  await page.context().setOffline(false);
  await expect(page.getByTestId('connection')).toHaveText('Live');
  await page.getByRole('button', { name: 'Bet', exact: true }).click();
  await keypad(page, 40);
  await page.waitForTimeout(300);
  await shot('bet');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Win', exact: true }).click();
  await page.getByRole('tab', { name: 'Some' }).click();
  await page.waitForTimeout(300);
  await shot('win-some');
  await page.goto('/');
  await page.waitForTimeout(300);
  await shot('landing');
  ana.close();
  ben.close();
});
