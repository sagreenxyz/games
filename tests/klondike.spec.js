/**
 * E2E: Klondike solitaire (solo, no networking).
 */
import { test, expect } from '@playwright/test';

const URL_ = 'http://localhost:4321/games/klondike/';

test.describe('Klondike', () => {
  test('deals a game, draws, undoes and survives a reload', async ({ page }) => {
    page.on('pageerror', e => console.error('[pageerror]', e.message));
    await page.goto(URL_);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('#kTableau .k-col')).toHaveCount(7);
    await expect(page.locator('#kTableau .playing-card')).toHaveCount(28);
    await expect(page.locator('#kTableau .playing-card.back')).toHaveCount(21);

    await page.click('#kStock');
    await expect(page.locator('#kWaste .playing-card')).toHaveCount(1);
    await expect(page.locator('#kStats')).toContainText('Moves 1');

    await page.click('#kUndo');
    await expect(page.locator('#kWaste .playing-card')).toHaveCount(0);

    await page.click('#kStock');
    const waste = await page.locator('#kWaste [data-card]').getAttribute('data-card');
    await page.reload();
    await expect(page.locator('#kWaste [data-card]')).toHaveAttribute('data-card', waste);
  });

  test('a hint is always available on a fresh deal', async ({ page }) => {
    await page.goto(URL_);
    await page.click('#kHint');
    await expect(page.locator('#kMsg')).toContainText(/Try/);
  });

  test('switching to draw 3 on a fresh game redeals with draw 3', async ({ page }) => {
    await page.goto(URL_);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.selectOption('#kDraw', '3');
    await page.click('#kStock');
    await expect(page.locator('#kWaste .playing-card')).toHaveCount(3);
  });
});
