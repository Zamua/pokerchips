import { expect, type Page, test } from '@playwright/test';

const chip = (page: Page, id: string) => page.locator(`.toy use[data-chip="${id}"]`);

const spot = async (page: Page, id: string) => {
  const t = (await chip(page, id).getAttribute('transform')) ?? '';
  const [, x, y] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(t) ?? [];
  return { x: Number(x), y: Number(y) };
};

test('the landing chips topple on a tap and restack', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.toy[data-toy="ready"]')).toBeAttached();
  const restack = page.getByRole('button', { name: 'Restack the chips' });
  await expect(restack).toHaveCount(0);
  const top = await chip(page, '2.9').getAttribute('transform');

  const box = (await chip(page, '2.1').boundingBox())!;
  await page.touchscreen.tap(box.x + 6, box.y + box.height / 2);
  await expect(restack).toBeVisible();
  await expect.poll(() => chip(page, '2.9').getAttribute('transform')).not.toBe(top);

  await restack.click();
  await expect(restack).toHaveCount(0);
  await expect.poll(() => chip(page, '2.9').getAttribute('transform')).toBe(top);
});

test('a landing chip dropped over a stack settles on top of it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.toy[data-toy="ready"]')).toBeAttached();
  const from = (await chip(page, '4.2').boundingBox())!;
  const onto = (await chip(page, '0.3').boundingBox())!;
  const target = await spot(page, '0.3');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  const path = [
    [from.x + from.width / 2, onto.y - 120],
    [onto.x + onto.width / 2, onto.y - 120],
    [onto.x + onto.width / 2, onto.y - 40],
  ];
  for (const [x, y] of path) await page.mouse.move(x, y, { steps: 15 });
  // Let go only once the carried chip hangs still, so the drop is a drop and not a throw.
  let was = '';
  await expect
    .poll(async () => {
      const now = (await chip(page, '4.2').getAttribute('transform')) ?? '';
      const still = now === was;
      was = now;
      return still;
    }, { intervals: [100] })
    .toBe(true);
  await page.mouse.up();

  await expect(page.getByRole('button', { name: 'Restack the chips' })).toBeVisible();
  await expect
    .poll(async () => {
      const p = await spot(page, '4.2');
      return Math.abs(p.x - target.x) < 4 && Math.abs(p.y - (target.y - 10.8)) < 3;
    })
    .toBe(true);
});

test('the landing chips stay still under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const top = await chip(page, '2.9').getAttribute('transform');
  const box = (await chip(page, '2.1').boundingBox())!;
  await page.touchscreen.tap(box.x + 6, box.y + box.height / 2);
  await page.waitForTimeout(500);
  expect(await chip(page, '2.9').getAttribute('transform')).toBe(top);
  await expect(page.getByRole('button', { name: 'Restack the chips' })).toHaveCount(0);
  await expect(page.locator('.toy')).not.toHaveAttribute('data-toy', 'ready');
});
