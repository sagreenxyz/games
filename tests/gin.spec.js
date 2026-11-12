/**
 * E2E: Gin Rummy — two players over the BroadcastChannel PeerJS mock.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MOCK = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'peerjs-mock.js'), 'utf8');
const URL_ = 'http://localhost:4321/games/gin/';

async function open(context) {
  const page = await context.newPage();
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: MOCK }));
  await page.goto(URL_);
  return page;
}

async function startMatch(context) {
  const host = await open(context), guest = await open(context);
  await host.fill('#playerName', 'Ann'); await host.click('#btnNew');
  await expect(host.locator('#waitingRoom')).toBeVisible();
  const code = (await host.locator('#displayRoomCode').textContent()).trim();
  await guest.fill('#playerName', 'Ben'); await guest.click('#btnJoin');
  await guest.fill('#roomCode', code); await guest.click('#btnJoinConfirm');
  await expect(host.locator('#btnStart')).toBeVisible();
  await host.click('#btnStart');
  await expect(guest.locator('#gameTable')).toBeVisible();
  await expect(guest.locator('#myCards .playing-card')).toHaveCount(10);
  return { host, guest };
}

test.describe('Gin Rummy', () => {
  test('upcard offer, draw and discard pass the turn', async ({ context }) => {
    const { host, guest } = await startMatch(context);
    // Host (non-dealer) is offered the upcard first.
    await expect(host.locator('#btnPass')).toBeVisible();
    await host.click('#btnPass');
    await expect(guest.locator('#btnPass')).toBeVisible();
    await guest.click('#btnPass');
    // Both passed: host must draw from the stock.
    await expect(host.locator('#btnStock')).toBeVisible();
    await expect(host.locator('#btnTake')).toBeHidden();
    await host.click('#btnStock');
    await expect(host.locator('#myCards .playing-card')).toHaveCount(11);
    await host.locator('#myCards .playing-card').first().click();
    await host.click('#btnDiscard');
    await expect(host.locator('#myCards .playing-card')).toHaveCount(10);
    await expect(guest.locator('#btnStock')).toBeVisible();
    await expect(guest.locator('#stockCount')).toHaveText('Stock: 30');
  });

  test('guests never receive the stock or the other hand', async ({ context }) => {
    const { guest } = await startMatch(context);
    const seen = await guest.evaluate(() => ({ stock: Room.state.stock, stockCount: Room.state.stockCount, opp: Room.state.players[0].handJSON }));
    expect(seen.stock).toBeUndefined();
    expect(seen.stockCount).toBe(31);
    expect(seen.opp).toBe('[]');
  });

  test('if a player leaves, the other wins the match', async ({ context }) => {
    const { host, guest } = await startMatch(context);
    guest.once('dialog', d => d.accept());
    await guest.click('#btnLeaveGame');
    await expect(host.locator('#handModal')).toBeVisible();
    await expect(host.locator('#handTitle')).toContainText('Ann wins the match');
  });
});
