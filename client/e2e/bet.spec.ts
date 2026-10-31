import { expect, type Locator, type Page, test } from '@playwright/test';
import { myStack, openTable } from './helpers.js';

const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function drag(page: Page, from: Locator, to: { x: number; y: number }): Promise<void> {
  const a = center((await from.boundingBox())!);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function openBet(page: Page) {
  await page.getByRole('button', { name: 'Bet', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Bet' });
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return { drawer, readout: drawer.getByTestId('readout'), chip: (v: string) => drawer.getByRole('button', { name: new RegExp(`^Put in a ${v} chip`) }) };
}

test('a bet made with chips: tapped, dragged in, undone, then confirmed', async ({ page }) => {
  await openTable(page, 'Maya');
  const { drawer, readout, chip } = await openBet(page);
  await chip('100').click();
  await chip('100').click();
  await chip('25').click();
  await expect(readout).toHaveText('225');
  await drawer.getByRole('button', { name: 'Undo' }).click();
  await expect(readout).toHaveText('200');

  const felt = center((await drawer.getByTestId('felt').boundingBox())!);
  await drag(page, chip('500'), felt);
  await expect(readout).toHaveText('700');

  const five = center((await chip('5').boundingBox())!);
  await drag(page, chip('5'), { x: five.x + 60, y: five.y });
  await expect(readout).toHaveText('700');

  await expect(drawer.getByTestId('felt-chip')).toHaveCount(3);
  await drawer.getByRole('button', { name: 'Bet 700 into main pot' }).click();
  await expect(drawer).toBeHidden();
  await expect(myStack(page)).toHaveText('300');
});

test('the tray is the stack in chips, and a used-up value gets change from a larger chip', async ({ page }) => {
  await openTable(page, 'Maya');
  const { drawer, readout, chip } = await openBet(page);
  const left = (v: string, n: number) => expect(drawer.getByRole('button', { name: `Put in a ${v} chip, ${n} left` })).toBeVisible();
  await left('5', 10);
  await left('25', 6);
  await left('100', 3);
  await left('500', 1);
  for (let i = 0; i < 3; i++) await chip('100').click();
  await expect(readout).toHaveText('300');
  await left('100', 5);
  await expect(chip('500')).toBeDisabled();
  for (let i = 0; i < 5; i++) await chip('100').click();
  await expect(readout).toHaveText('800');
  await expect(chip('100')).toBeDisabled();
  // Sampled as the tap lands: the shake lasts a fifth of a second.
  await chip('100').evaluate((el) => {
    (window as unknown as { shook: Promise<boolean> }).shook = new Promise((resolve) =>
      addEventListener('click', () => resolve(el.getAnimations().length > 0), { once: true }),
    );
  });
  await chip('100').click({ force: true });
  expect(await page.evaluate(() => (window as unknown as { shook: Promise<boolean> }).shook)).toBe(true);
  await expect(readout).toHaveText('800');
  await drawer.getByRole('button', { name: 'Reset' }).click();
  await left('100', 3);
  await left('500', 1);
});

test('the drawer keeps its size as chips go in and come back', async ({ page }) => {
  await openTable(page, 'Maya');
  const { drawer, chip } = await openBet(page);
  const before = await drawer.boundingBox();
  await chip('5').click();
  await chip('25').click();
  expect(await drawer.boundingBox()).toEqual(before);
  await drawer.getByRole('button', { name: 'Reset' }).click();
  expect(await drawer.boundingBox()).toEqual(before);
});

test('a typed bet puts its chips in, Reset takes them back, and typing is remembered', async ({ page }) => {
  await openTable(page, 'Maya');
  const { drawer, readout } = await openBet(page);
  await drawer.getByRole('radio', { name: 'Type' }).click();
  for (const d of '350') await drawer.getByRole('button', { name: d, exact: true }).click();
  await expect(readout).toHaveText('350');
  await expect(drawer.getByTestId('felt-chip')).toHaveCount(5);
  await drawer.getByRole('button', { name: 'Reset' }).click();
  await expect(readout).toHaveText('0');
  await expect(drawer.getByTestId('felt-chip')).toHaveCount(0);

  await drawer.getByRole('button', { name: 'Close' }).click();
  const again = await openBet(page);
  await expect(again.drawer.getByRole('radio', { name: 'Type' })).toHaveAttribute('aria-checked', 'true');
});

test('All-in puts the whole stack in', async ({ page }) => {
  await openTable(page, 'Maya');
  const { drawer, readout, chip } = await openBet(page);
  await drawer.getByRole('button', { name: 'All-in' }).click();
  await expect(readout).toHaveText('1,000');
  await expect(drawer.getByRole('button', { name: 'Bet 1,000 into main pot' })).toBeEnabled();
  for (const v of ['5', '25', '100', '500']) await expect(chip(v)).toBeDisabled();
  const allIn = drawer.getByRole('button', { name: 'All-in' });
  await allIn.click();
  expect(await allIn.evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0);
  await expect(readout).toHaveText('1,000');
});

test('a drawer closes with a swipe down from anywhere in it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch moves are sent over the Chrome DevTools Protocol');
  await openTable(page, 'Maya');
  const { drawer } = await openBet(page);
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (from: { x: number; y: number }, by: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + (by * i) / 8 }] });
    await page.waitForTimeout(250);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const felt = center((await drawer.getByTestId('felt').boundingBox())!);
  await swipe(felt, 40);
  await page.waitForTimeout(300);
  await expect(drawer).toBeVisible();
  await swipe(felt, 320);
  await expect(drawer).toBeHidden();
});
