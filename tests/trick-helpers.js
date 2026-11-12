/**
 * Shared E2E helpers for 4-player games over the BroadcastChannel PeerJS mock.
 */
import { expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MOCK = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'peerjs-mock.js'), 'utf8');

export async function openGame(context, slug) {
  const page = await context.newPage();
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: MOCK }));
  await page.goto(`http://localhost:4321/games/${slug}/`);
  return page;
}

/** Host + guests join one room and the host starts. Returns pages in seat order. */
export async function startRoom(context, slug, names) {
  const pages = [];
  for (const _ of names) pages.push(await openGame(context, slug));
  const [host, ...guests] = pages;
  await host.fill('#playerName', names[0]); await host.click('#btnNew');
  await expect(host.locator('#waitingRoom')).toBeVisible();
  const code = (await host.locator('#displayRoomCode').textContent()).trim();
  for (const [i, g] of guests.entries()) {
    await g.fill('#playerName', names[i + 1]); await g.click('#btnJoin');
    await g.fill('#roomCode', code); await g.click('#btnJoinConfirm');
    await expect(g.locator('#waitingRoom')).toBeVisible();
  }
  await expect(host.locator('#btnStart')).toBeVisible();
  await host.click('#btnStart');
  for (const p of pages) await expect(p.locator('#gameTable')).toBeVisible();
  return pages;
}

/** The page whose seat is to act. */
export async function actor(pages) {
  const cur = await pages[0].evaluate(() => Room.state.currentPlayer);
  for (const p of pages) if (await p.evaluate(() => Room.mySeat) === cur) return p;
  throw new Error('no actor');
}
