/**
 * E2E tests: Sevens — host + guest session
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const testDir   = dirname(fileURLToPath(import.meta.url));
const MOCK_SCRIPT = readFileSync(join(testDir, 'peerjs-mock.js'), 'utf8');

const SEVENS_BASE = 'http://localhost:4321/games/sevens/';

async function openPage(context, url, label = 'Player') {
  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') console.error(`  [${label}] ${msg.text()}`);
  });
  await page.route('**/peerjs.min.js', async route => {
    await route.fulfill({ contentType: 'application/javascript', body: MOCK_SCRIPT });
  });
  await page.goto(url);
  return page;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function fillName(page, name) { await page.fill('#playerName', name); }
async function clickCreate(page)    { await page.click('#btnNew'); }
async function waitForWaiting(page) {
  await expect(page.locator('#waitingRoom')).toBeVisible({ timeout: 10_000 });
}
async function waitForGame(page) {
  await expect(page.locator('#gameTable')).toBeVisible({ timeout: 20_000 });
}
async function getRoomCode(page) {
  const txt = await page.locator('#displayRoomCode').textContent({ timeout: 8_000 });
  return (txt || '').trim();
}

// Join a room via the join form (for pages where #btnJoin is visible)
async function joinRoomViaForm(page, name, code) {
  await fillName(page, name);
  await page.click('#btnJoin');
  await page.fill('#roomCode', code);
  await page.click('#btnJoinConfirm');
}

// Join a room when the join fields are already shown (guest via ?room= URL)
async function joinRoomAlreadyShown(page, name) {
  await fillName(page, name);
  await page.click('#btnJoinConfirm');
}

// ─── Sevens ───────────────────────────────────────────────────────────────────

test.describe('Sevens — host + guest integration', () => {

  test('host creates room, guest joins, and they play a game', async ({ context }) => {
    const hostPage  = await openPage(context, SEVENS_BASE, 'Host');
    const guestPage = await openPage(context, SEVENS_BASE, 'Guest');

    // ── 1. Host creates a room ──────────────────────────────────────────────
    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);

    const roomCode = await getRoomCode(hostPage);
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
    console.log(`  [test] Sevens room code: ${roomCode}`);

    // ── 2. Guest joins via the form ─────────────────────────────────────────
    await joinRoomViaForm(guestPage, 'Bob', roomCode);
    await waitForWaiting(guestPage);

    // Both players visible in both waiting rooms
    await expect(hostPage.locator('#playerSlots')).toContainText('Alice');
    await expect(hostPage.locator('#playerSlots')).toContainText('Bob');
    await expect(guestPage.locator('#playerSlots')).toContainText('Alice');
    await expect(guestPage.locator('#playerSlots')).toContainText('Bob');

    // Only host sees Start button
    await expect(hostPage.locator('#btnStart')).toBeVisible();
    await expect(guestPage.locator('#btnStart')).toBeHidden();

    // ── 3. Host starts the game ─────────────────────────────────────────────
    await hostPage.click('#btnStart');
    await waitForGame(hostPage);
    await waitForGame(guestPage);

    // ── 4. Board is rendered with 4 suit rows ──────────────────────────────
    await expect(hostPage.locator('#boardRows')).toBeVisible();
    await expect(guestPage.locator('#boardRows')).toBeVisible();

    // The board shows all 13 ranks for each suit
    const boardText = await hostPage.locator('#boardRows').textContent();
    expect(boardText).toContain('7');

    // ── 5. Each player has cards ────────────────────────────────────────────
    await expect(hostPage.locator('#myCards')).not.toContainText('Your cards will appear here');
    await expect(guestPage.locator('#myCards')).not.toContainText('Your cards will appear here');

    // ── 6. Exactly one player has "Your Turn" ───────────────────────────────
    const isHostTurn  = await hostPage.locator('#myStatusBadge').textContent().then(t => /your turn/i.test(t || ''));
    const isGuestTurn = await guestPage.locator('#myStatusBadge').textContent().then(t => /your turn/i.test(t || ''));
    expect(isHostTurn || isGuestTurn).toBe(true);
    expect(isHostTurn && isGuestTurn).toBe(false);

    console.log('  [test] Sevens game started, turn distributed correctly ✅');
  });

  test('Sevens: opening with ?room= hides New Room button', async ({ context }) => {
    const hostPage = await openPage(context, SEVENS_BASE, 'Host');
    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);
    const roomCode = await getRoomCode(hostPage);

    const guestPage = await openPage(context, `${SEVENS_BASE}?room=${roomCode}`, 'Guest');
    await expect(guestPage.locator('#btnNew')).toBeHidden();
    await expect(guestPage.locator('#btnJoin')).toBeHidden();
    await expect(guestPage.locator('#joinFields')).toBeVisible();
    await expect(guestPage.locator('#roomCode')).toHaveValue(roomCode.toUpperCase());

    // Guest can still join using the pre-filled form
    await joinRoomAlreadyShown(guestPage, 'Bob');
    await waitForWaiting(guestPage);
    await expect(guestPage.locator('#playerSlots')).toContainText('Bob');

    console.log('  [test] Sevens direct-link hides New Room button ✅');
  });

  test('Sevens: duplicate player name is rejected', async ({ context }) => {
    const hostPage  = await openPage(context, SEVENS_BASE, 'Host');
    const guestPage = await openPage(context, SEVENS_BASE, 'Guest');

    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);
    const roomCode = await getRoomCode(hostPage);

    await joinRoomViaForm(guestPage, 'Alice', roomCode);
    await expect(guestPage.locator('#lobbyError')).toContainText('already taken', { timeout: 10_000 });
    await expect(guestPage.locator('#lobby')).toBeVisible();
  });

  test('Sevens: action log sidebar is visible during game', async ({ context }) => {
    const hostPage  = await openPage(context, SEVENS_BASE, 'Host');
    const guestPage = await openPage(context, SEVENS_BASE, 'Guest');

    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);
    const roomCode = await getRoomCode(hostPage);
    await joinRoomViaForm(guestPage, 'Bob', roomCode);
    await waitForWaiting(guestPage);
    await hostPage.click('#btnStart');
    await waitForGame(hostPage);
    await waitForGame(guestPage);

    await expect(hostPage.locator('#actionLogPanel')).toBeVisible();
    await expect(guestPage.locator('#actionLogPanel')).toBeVisible();
    // Action log should contain at least a round separator
    await expect(hostPage.locator('#actionLogList')).not.toContainText('Actions will appear here');

    console.log('  [test] Sevens action log visible ✅');
  });

  test('Sevens: a guest leaving mid-game ends a 2-player game on the host', async ({ context }) => {
    const hostPage  = await openPage(context, SEVENS_BASE, 'Host');
    const guestPage = await openPage(context, SEVENS_BASE, 'Guest');

    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);
    const roomCode = await getRoomCode(hostPage);
    await joinRoomViaForm(guestPage, 'Bob', roomCode);
    await waitForWaiting(guestPage);
    await hostPage.click('#btnStart');
    await waitForGame(hostPage);
    await waitForGame(guestPage);

    guestPage.once('dialog', d => d.accept());
    await guestPage.click('#btnLeaveGame');
    await expect(guestPage.locator('#lobby')).toBeVisible({ timeout: 5_000 });

    // Host is not stuck: the game ends with the host as the only player left
    await expect(hostPage.locator('#gameOverModal')).toBeVisible({ timeout: 8_000 });
    await expect(hostPage.locator('#actionLogList')).toContainText('Bob left');

    // Play Again returns to the waiting room without the departed player
    await hostPage.click('#btnPlayAgain');
    await waitForWaiting(hostPage);
    await expect(hostPage.locator('#playerSlots')).not.toContainText('Bob');
  });

  test('Sevens: guests only receive their own hand', async ({ context }) => {
    const hostPage  = await openPage(context, SEVENS_BASE, 'Host');
    const guestPage = await openPage(context, SEVENS_BASE, 'Guest');

    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);
    const roomCode = await getRoomCode(hostPage);
    await joinRoomViaForm(guestPage, 'Bob', roomCode);
    await waitForWaiting(guestPage);
    await hostPage.click('#btnStart');
    await waitForGame(guestPage);

    const seen = await guestPage.evaluate(() => ({
      host: JSON.parse(Room.state.players[0].handJSON).length,
      hostCount: Room.state.players[0].handCount,
      mine: JSON.parse(Room.state.players[Room.mySeat].handJSON).length,
    }));
    expect(seen.host).toBe(0);
    expect(seen.hostCount).toBe(26);
    expect(seen.mine).toBe(26);
  });

});
