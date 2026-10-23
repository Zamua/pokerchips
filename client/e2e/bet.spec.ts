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
  return { drawer, readout: drawer.getByTestId('readout'), chip: (v: string) => drawer.getByRole('button', { name: `Put in a ${v} chip` }) };
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

  const felt = center((await drawer.locator('.felt').boundingBox())!);
  await drag(page, chip('500'), felt);
  await expect(readout).toHaveText('700');

  const five = center((await chip('5').boundingBox())!);
  await drag(page, chip('5'), { x: five.x + 60, y: five.y });
  await expect(readout).toHaveText('700');

  await expect(drawer.locator('.cb-layer use')).toHaveCount(3);
  await drawer.getByRole('button', { name: 'Bet 700 into main pot' }).click();
  await expect(drawer).toBeHidden();
  await expect(myStack(page)).toHaveText('300');
});

test('the tray only holds chips the stack still covers', async ({ page }) => {
  await openTable(page, 'Maya');
  const { readout, chip } = await openBet(page);
  await chip('500').click();
  await expect(chip('500')).toBeEnabled();
  await chip('500').click();
  await expect(readout).toHaveText('1,000');
  for (const v of ['5', '25', '100', '500']) await expect(chip(v)).toBeDisabled();
});

test('a typed bet puts its chips in, Reset takes them back, and typing is remembered', async ({ page }) => {
  await openTable(page, 'Maya');
  const { drawer, readout } = await openBet(page);
  await drawer.getByRole('radio', { name: 'Type' }).click();
  for (const d of '350') await drawer.getByRole('button', { name: d, exact: true }).click();
  await expect(readout).toHaveText('350');
  await expect(drawer.locator('.cb-layer use')).toHaveCount(5);
  await drawer.getByRole('button', { name: 'Reset' }).click();
  await expect(readout).toHaveText('0');
  await expect(drawer.locator('.cb-layer use')).toHaveCount(0);

  await drawer.getByRole('button', { name: 'Close' }).click();
  const again = await openBet(page);
  await expect(again.drawer.getByRole('radio', { name: 'Type' })).toHaveAttribute('aria-checked', 'true');
});

test('All-in puts the whole stack in', async ({ page }) => {
  await openTable(page, 'Maya');
  const { drawer, readout } = await openBet(page);
  await drawer.getByRole('button', { name: 'All-in' }).click();
  await expect(readout).toHaveText('1,000');
  await expect(drawer.getByRole('button', { name: 'Bet 1,000 into main pot' })).toBeEnabled();
});
