/**
 * E2E: Spades with four players in two teams.
 */
import { test, expect } from '@playwright/test';
import { startRoom, actor } from './trick-helpers.js';

test.describe('Spades', () => {
  test('waiting room shows the teams; bid round then play', async ({ context }) => {
    const pages = await startRoom(context, 'spades', ['Ann', 'Ben', 'Cat', 'Dan']);
    for (const p of pages) await expect(p.locator('#myCards .playing-card')).toHaveCount(13);
    for (let i = 0; i < 4; i++) {
      const p = await actor(pages);
      await expect(p.locator('#bidPanel')).toBeVisible();
      await p.locator('#bidGrid [data-bid="3"]').click();
      await expect(p.locator('#bidPanel')).toBeHidden();
    }
    await expect(pages[0].locator('#scoreboard')).toContainText('3 + 3');
    const lead = await actor(pages);
    const playable = lead.locator('#myCards .playing-card.highlight');
    expect(await playable.count()).toBeGreaterThan(0);
    // Spades can't be led yet (unless the leader holds nothing else).
    const keys = await playable.evaluateAll(els => els.map(e => e.dataset.card));
    const onlySpades = await lead.evaluate(() => JSON.parse(Room.state.players[Room.mySeat].handJSON).every(c => c.s === '♠'));
    if (!onlySpades) expect(keys.every(k => !k.endsWith('♠'))).toBe(true);
    await playable.first().click();
    for (const p of pages) await expect(p.locator('#trickArea .playing-card')).toHaveCount(1);
  });

  test('the waiting room labels each seat with its team', async ({ context }) => {
    const { openGame } = await import('./trick-helpers.js');
    const host = await openGame(context, 'spades');
    await host.fill('#playerName', 'Ann'); await host.click('#btnNew');
    await expect(host.locator('#playerSlots .seat-row').nth(0)).toContainText('Team A');
    await expect(host.locator('#playerSlots .seat-row').nth(1)).toContainText('Team B');
    await expect(host.locator('#waitingMsg')).toContainText('exactly 4 players');
  });
});
