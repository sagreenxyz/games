/**
 * E2E: Crazy Eights over the BroadcastChannel PeerJS mock.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MOCK = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'peerjs-mock.js'), 'utf8');

async function open(context) {
  const page = await context.newPage();
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: MOCK }));
  await page.goto('http://localhost:4321/games/crazy-eights/');
  return page;
}

async function start(context) {
  const host = await open(context), guest = await open(context);
  await host.fill('#playerName', 'Ann'); await host.click('#btnNew');
  await expect(host.locator('#waitingRoom')).toBeVisible();
  const code = (await host.locator('#displayRoomCode').textContent()).trim();
  await guest.fill('#playerName', 'Ben'); await guest.click('#btnJoin');
  await guest.fill('#roomCode', code); await guest.click('#btnJoinConfirm');
  await expect(host.locator('#btnStart')).toBeVisible();
  await host.click('#btnStart');
  await expect(guest.locator('#myCards .playing-card')).toHaveCount(7);
  return { host, guest };
}

test.describe('Crazy Eights', () => {
  test('playing an 8 asks for a suit and everyone sees it', async ({ context }) => {
    const { host, guest } = await start(context);
    // Make sure the player to act (seat after the dealer) holds an 8 and nothing else playable.
    await host.evaluate(() => Room.update(gs => {
      const s = gs.currentPlayer;
      const all = [...JSON.parse(gs.players[s].handJSON), ...gs.stock];
      const top = gs.discard[gs.discard.length - 1];
      const eight = all.find(c => c.r === '8');
      const dull = all.filter(c => c.r !== '8' && c.s !== top.s && c.r !== top.r).slice(0, 6);
      const rest = all.filter(c => c !== eight && !dull.includes(c));
      gs.players[s].handJSON = JSON.stringify([eight, ...dull]);
      gs.stock = rest;
    }));
    const pages = [host, guest];
    const seats = await Promise.all(pages.map(p => p.evaluate(() => Room.mySeat)));
    const cur = await host.evaluate(() => Room.state.currentPlayer);
    const actor = pages[seats.indexOf(cur)], other = pages[1 - seats.indexOf(cur)];
    await actor.locator('#myCards .playing-card.highlight').click();
    await expect(actor.locator('#suitPicker')).toBeVisible();
    await actor.click('#suitPicker [data-suit="♥"]');
    await expect(other.locator('#followLabel')).toContainText('♥');
    await expect(actor.locator('#myCards .playing-card')).toHaveCount(6);
  });

  test("a player with no playable card must draw", async ({ context }) => {
    const { host, guest } = await start(context);
    await host.evaluate(() => Room.update(gs => {
      const s = gs.currentPlayer;
      const all = [...JSON.parse(gs.players[s].handJSON), ...gs.stock];
      const top = gs.discard[gs.discard.length - 1];
      const dull = all.filter(c => c.r !== '8' && c.s !== top.s && c.r !== top.r);
      gs.players[s].handJSON = JSON.stringify(dull.slice(0, 7));
      gs.stock = all.filter(c => !dull.slice(0, 7).includes(c));
    }));
    const pages = [host, guest];
    const seats = await Promise.all(pages.map(p => p.evaluate(() => Room.mySeat)));
    const actor = pages[seats.indexOf(await host.evaluate(() => Room.state.currentPlayer))];
    await expect(actor.locator('#btnDraw')).toBeVisible();
    await expect(actor.locator('#myCards .playing-card.highlight')).toHaveCount(0);
    await actor.click('#btnDraw');
    await expect(actor.locator('#myCards .playing-card')).toHaveCount(8);
  });
});
