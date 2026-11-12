/**
 * E2E: Rummy and Rummy 500 over the BroadcastChannel PeerJS mock.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MOCK = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'peerjs-mock.js'), 'utf8');

async function open(context, slug) {
  const page = await context.newPage();
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: MOCK }));
  await page.goto(`http://localhost:4321/games/${slug}/`);
  return page;
}

async function startGame(context, slug, names) {
  const pages = [];
  for (const n of names) pages.push(await open(context, slug));
  const [host, ...guests] = pages;
  await host.fill('#playerName', names[0]); await host.click('#btnNew');
  await expect(host.locator('#waitingRoom')).toBeVisible();
  const code = (await host.locator('#displayRoomCode').textContent()).trim();
  for (const [i, g] of guests.entries()) {
    await g.fill('#playerName', names[i + 1]); await g.click('#btnJoin');
    await g.fill('#roomCode', code); await g.click('#btnJoinConfirm');
    await expect(g.locator('#waitingRoom')).toBeVisible();
  }
  await host.click('#btnStart');
  for (const p of pages) await expect(p.locator('#gameTable')).toBeVisible();
  return pages;
}

/** The page whose turn it is. */
async function current(pages) {
  for (const p of pages) {
    const seat = await p.evaluate(() => Room.mySeat);
    const cur = await p.evaluate(() => Room.state.currentPlayer);
    if (seat === cur) return p;
  }
  throw new Error('nobody to act');
}

test.describe('Rummy', () => {
  test('three players: draw, discard and the turn moves on', async ({ context }) => {
    const pages = await startGame(context, 'rummy', ['Ann', 'Ben', 'Cat']);
    for (const p of pages) await expect(p.locator('#myCards .playing-card')).toHaveCount(7);
    const first = await current(pages);
    await first.click('#btnStock');
    await expect(first.locator('#myCards .playing-card')).toHaveCount(8);
    await first.locator('#myCards .playing-card').first().click();
    await first.click('#btnDiscard');
    await expect(first.locator('#myCards .playing-card')).toHaveCount(7);
    const second = await current(pages);
    expect(second).not.toBe(first);
    await expect(second.locator('#btnStock')).toBeVisible();
    await expect(second.locator('#btnTakeTop')).toBeVisible();
  });

  test('melding from the hand puts a meld on everyone’s table', async ({ context }) => {
    const pages = await startGame(context, 'rummy', ['Ann', 'Ben']);
    const host = pages[0];
    // Give the player to act a guaranteed meld (host-side state edit for the test).
    await host.evaluate(() => Room.update(gs => {
      const s = gs.currentPlayer;
      const hand = JSON.parse(gs.players[s].handJSON);
      const all = [...hand, ...gs.stock];
      const want = [{ r: '4', s: '♠' }, { r: '5', s: '♠' }, { r: '6', s: '♠' }];
      const pool = [...all.filter(c => !want.some(w => w.r === c.r && w.s === c.s)), ...gs.discard];
      gs.players[s].handJSON = JSON.stringify([...want, ...pool.slice(0, hand.length - 3)]);
      gs.discard = [pool[hand.length - 3]];
      gs.stock = pool.slice(hand.length - 2).filter(c => !JSON.parse(gs.players[1 - s].handJSON).some(o => o.r === c.r && o.s === c.s));
    }));
    const p = await current(pages);
    await p.click('#btnStock');
    for (const r of ['4', '5', '6']) await p.locator(`#myCards [data-card="${r}♠"]`).click();
    await expect(p.locator('#btnMeld')).toBeEnabled();
    await p.click('#btnMeld');
    for (const q of pages) await expect(q.locator('#tableMelds .meld-group')).toHaveCount(1);
  });
});

test.describe('Rummy 500', () => {
  test('the whole discard pile is shown and guests never get the stock', async ({ context }) => {
    const pages = await startGame(context, 'rummy500', ['Ann', 'Ben']);
    for (const p of pages) await expect(p.locator('#myCards .playing-card')).toHaveCount(13);
    const guest = pages[1];
    const seen = await guest.evaluate(() => ({ stock: Room.state.stock, n: Room.state.stockCount }));
    expect(seen.stock).toBeUndefined();
    expect(seen.n).toBe(52 - 26 - 1);
    const first = await current(pages);
    await first.click('#btnStock');
    await first.locator('#myCards .playing-card').first().click();
    await first.click('#btnDiscard');
    for (const p of pages) await expect(p.locator('#discardPile .playing-card')).toHaveCount(2);
  });

  test('a player leaving a 2-player game ends the match', async ({ context }) => {
    const [host, guest] = await startGame(context, 'rummy500', ['Ann', 'Ben']);
    guest.once('dialog', d => d.accept());
    await guest.click('#btnLeaveGame');
    await expect(host.locator('#handModal')).toBeVisible();
    await expect(host.locator('#handTitle')).toContainText('Ann wins the match');
  });
});
