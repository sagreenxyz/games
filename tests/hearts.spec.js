/**
 * E2E: Hearts with four players.
 */
import { test, expect } from '@playwright/test';
import { startRoom, actor } from './trick-helpers.js';

test.describe('Hearts', () => {
  test('pass three cards, then the 2♣ leads and everyone sees the trick', async ({ context }) => {
    const pages = await startRoom(context, 'hearts', ['Ann', 'Ben', 'Cat', 'Dan']);
    for (const p of pages) await expect(p.locator('#myCards .playing-card')).toHaveCount(13);

    // Nobody can see what anyone else is passing.
    const leaked = await pages[1].evaluate(() => ({ passes: Room.state.passes, other: Room.state.players[0].handJSON }));
    expect(leaked.passes).toBeUndefined();
    expect(leaked.other).toBe('[]');

    for (const p of pages) {
      await expect(p.locator('#btnPass')).toBeVisible();
      for (let i = 0; i < 3; i++) await p.locator('#myCards .playing-card').nth(i).click();
      await p.click('#btnPass');
    }
    for (const p of pages) await expect(p.locator('#myCards .playing-card.recv')).toHaveCount(3);

    const lead = await actor(pages);
    await expect(lead.locator('#myCards .playing-card.highlight')).toHaveCount(1);
    await lead.locator('#myCards [data-card="2♣"]').click();
    for (const p of pages) await expect(p.locator('#trickArea .playing-card')).toHaveCount(1);
    const next = await actor(pages);
    expect(next).not.toBe(lead);
  });

  test('a player leaving ends the game for everyone', async ({ context }) => {
    const pages = await startRoom(context, 'hearts', ['Ann', 'Ben', 'Cat', 'Dan']);
    pages[2].once('dialog', d => d.accept());
    await pages[2].click('#btnLeaveGame');
    await expect(pages[0].locator('#handTitle')).toContainText('a player left');
  });
});
