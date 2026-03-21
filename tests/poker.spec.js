/**
 * E2E test: Poker — host + guest session
 *
 * Uses two pages within the same browser context and intercepts the PeerJS
 * library request to inject a BroadcastChannel-based mock. This avoids WebRTC
 * / external network dependencies while still exercising all game code paths.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const testDir = dirname(fileURLToPath(import.meta.url));
const MOCK_SCRIPT = readFileSync(join(testDir, 'peerjs-mock.js'), 'utf8');

const BASE = 'http://localhost:4321/games/poker/';

/**
 * Open the poker page with the PeerJS library intercepted by our mock so
 * no WebRTC or external server is needed.
 */
async function openPokerPage(context, label = 'Player') {
  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error(`  [${label}] ${msg.text()}`);
    }
  });
  // Intercept the PeerJS library and serve our mock instead
  await page.route('**/peerjs.min.js', async route => {
    await route.fulfill({ contentType: 'application/javascript', body: MOCK_SCRIPT });
  });
  await page.goto(BASE);
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
async function joinRoom(page, name, code) {
  await fillName(page, name);
  await page.click('#btnJoin');
  await page.fill('#roomCode', code);
  await page.click('#btnJoinConfirm');
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('Poker — host + guest integration', () => {

  /**
   * Both pages share the SAME browser context so that BroadcastChannel (used
   * by the mock Peer) can relay messages between them.
   */
  test('host creates room, guest joins, and they play one round', async ({ context }) => {
    const hostPage  = await openPokerPage(context, 'Host');
    const guestPage = await openPokerPage(context, 'Guest');

    // ── 1. Host creates a room ──────────────────────────────────────────────
    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);

    const roomCode = await getRoomCode(hostPage);
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
    console.log(`  [test] Room code: ${roomCode}`);

    // ── 2. Guest joins ──────────────────────────────────────────────────────
    await joinRoom(guestPage, 'Bob', roomCode);
    await waitForWaiting(guestPage);

    // Both players visible on both pages
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

    // ── 4. Both players see their hole cards ────────────────────────────────
    await expect(hostPage.locator('#myCards .playing-card')).toHaveCount(2, { timeout: 8_000 });
    await expect(guestPage.locator('#myCards .playing-card')).toHaveCount(2, { timeout: 8_000 });

    // ── 5. Correct blind structure: heads-up pot = SB(10)+BB(20) = 30 ───────
    await expect(hostPage.locator('#potDisplay')).toHaveText('30', { timeout: 8_000 });
    await expect(guestPage.locator('#potDisplay')).toHaveText('30');
    await expect(hostPage.locator('#currentBetDisplay')).toHaveText('20');
    await expect(guestPage.locator('#currentBetDisplay')).toHaveText('20');

    // ── 6. Exactly one player should see "Your Turn" ────────────────────────
    const hostHasTurn = await hostPage.locator('#turnIndicator').textContent().then(t => /your turn/i.test(t || ''));
    const guestHasTurn = await guestPage.locator('#turnIndicator').textContent().then(t => /your turn/i.test(t || ''));
    expect(hostHasTurn || guestHasTurn).toBe(true);   // at least one has turn
    expect(hostHasTurn && guestHasTurn).toBe(false);  // but not both

    // ── 7. Active player's buttons are enabled; waiting player's disabled ───
    const activePage  = hostHasTurn ? hostPage  : guestPage;
    const waitingPage = hostHasTurn ? guestPage : hostPage;

    await expect(activePage.locator('#btnFold')).toBeEnabled();
    await expect(activePage.locator('#btnCall')).toBeEnabled();
    await expect(activePage.locator('#btnRaise')).toBeEnabled();
    await expect(waitingPage.locator('#btnFold')).toBeDisabled();
    await expect(waitingPage.locator('#btnCall')).toBeDisabled();

    // ── 8. Active player folds; the other player wins ───────────────────────
    await activePage.click('#btnFold');

    await expect(hostPage.locator('#turnIndicator')).toContainText(/wins|folds/, { timeout: 10_000 });
    await expect(guestPage.locator('#turnIndicator')).toContainText(/wins|folds/, { timeout: 10_000 });

    // ── 9. Game auto-advances to round 2 ────────────────────────────────────
    await expect(hostPage.locator('#roundLabel')).toHaveText('Round 2', { timeout: 12_000 });
    await expect(guestPage.locator('#roundLabel')).toHaveText('Round 2', { timeout: 12_000 });

    console.log('  [test] Full host+guest round completed ✅');
  });

  test('duplicate player name is rejected', async ({ context }) => {
    const hostPage  = await openPokerPage(context, 'Host');
    const guestPage = await openPokerPage(context, 'Guest');

    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);
    const roomCode = await getRoomCode(hostPage);

    // Guest attempts to join with the same name
    await joinRoom(guestPage, 'Alice', roomCode);
    await expect(guestPage.locator('#lobbyError')).toContainText('already taken', { timeout: 10_000 });
    await expect(guestPage.locator('#lobby')).toBeVisible();
  });

  test('guest sees error for non-existent room', async ({ context }) => {
    const guestPage = await openPokerPage(context, 'Guest');
    await joinRoom(guestPage, 'Bob', 'XXXXXX');
    await expect(guestPage.locator('#lobbyError')).toContainText(
      /not found|unavailable|error/i, { timeout: 8_000 }
    );
  });

});
