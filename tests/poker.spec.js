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
async function openPokerPage(context, label = 'Player', query = '') {
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
  await page.goto(BASE + query);
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

/** Host (Alice) creates a room, guest (Bob) joins, host starts a hand. */
async function startHeadsUp(context) {
  const hostPage  = await openPokerPage(context, 'Host');
  const guestPage = await openPokerPage(context, 'Guest');
  await fillName(hostPage, 'Alice');
  await clickCreate(hostPage);
  await waitForWaiting(hostPage);
  const roomCode = await getRoomCode(hostPage);
  await joinRoom(guestPage, 'Bob', roomCode);
  await waitForWaiting(guestPage);
  await hostPage.click('#btnStart');
  await waitForGame(hostPage);
  await waitForGame(guestPage);
  await expect(guestPage.locator('#myCards .playing-card')).toHaveCount(2, { timeout: 8_000 });
  return { hostPage, guestPage };
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

  test('turn returns to the other player after first flop action (regression)', async ({ context }) => {
    // Regression test for: after the guest played their turn, focus never returned
    // to the host because isBettingRoundOver() was true the moment bets reset to 0
    // on a new street, so the second player never got to act.
    const hostPage  = await openPokerPage(context, 'Host');
    const guestPage = await openPokerPage(context, 'Guest');

    // ── Setup ──────────────────────────────────────────────────────────────────
    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);
    const roomCode = await getRoomCode(hostPage);
    await joinRoom(guestPage, 'Bob', roomCode);
    await waitForWaiting(guestPage);
    await hostPage.click('#btnStart');
    await waitForGame(hostPage);
    await waitForGame(guestPage);
    await expect(hostPage.locator('#myCards .playing-card')).toHaveCount(2, { timeout: 8_000 });

    // ── Pre-flop: both players act (call then check) to advance to the flop ───
    const hostHasTurnPreflop = await hostPage.locator('#turnIndicator').textContent()
      .then(t => /your turn/i.test(t || ''));
    const preflopFirst  = hostHasTurnPreflop ? hostPage  : guestPage;
    const preflopSecond = hostHasTurnPreflop ? guestPage : hostPage;

    // First pre-flop actor calls (matches the big blind)
    await expect(preflopFirst.locator('#btnCall')).toBeEnabled({ timeout: 5_000 });
    await preflopFirst.click('#btnCall');

    // Second pre-flop actor checks (BB option — no raise needed)
    await expect(preflopSecond.locator('#btnCheck')).toBeEnabled({ timeout: 5_000 });
    await preflopSecond.click('#btnCheck');

    // ── Both players should now be on the Flop ────────────────────────────────
    await expect(hostPage.locator('#phaseLabel')).toHaveText('Flop', { timeout: 8_000 });
    await expect(guestPage.locator('#phaseLabel')).toHaveText('Flop', { timeout: 8_000 });

    // ── Flop: first actor checks; second actor MUST then get their turn ───────
    const hostHasTurnFlop = await hostPage.locator('#turnIndicator').textContent()
      .then(t => /your turn/i.test(t || ''));
    const flopFirst  = hostHasTurnFlop ? hostPage  : guestPage;
    const flopSecond = hostHasTurnFlop ? guestPage : hostPage;

    await expect(flopFirst.locator('#btnCheck')).toBeEnabled({ timeout: 5_000 });
    await flopFirst.click('#btnCheck');

    // Before the fix, isBettingRoundOver() returned true immediately (all bets = 0
    // = currentBet), skipping the second player's flop turn entirely.
    await expect(flopSecond.locator('#turnIndicator')).toContainText(/your turn/i, { timeout: 8_000 });
    await expect(flopSecond.locator('#btnCheck')).toBeEnabled();
    await expect(flopFirst.locator('#btnFold')).toBeDisabled();

    console.log('  [test] Turn correctly returns to second player on flop ✅');
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

  test('action log sidebar shows played steps', async ({ context }) => {
    const hostPage  = await openPokerPage(context, 'Host');
    const guestPage = await openPokerPage(context, 'Guest');

    // Setup
    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);
    const roomCode = await getRoomCode(hostPage);
    await joinRoom(guestPage, 'Bob', roomCode);
    await waitForWaiting(guestPage);
    await hostPage.click('#btnStart');
    await waitForGame(hostPage);
    await waitForGame(guestPage);
    await expect(hostPage.locator('#myCards .playing-card')).toHaveCount(2, { timeout: 8_000 });

    // Sidebar panel is visible
    await expect(hostPage.locator('#actionLogPanel')).toBeVisible();
    await expect(guestPage.locator('#actionLogPanel')).toBeVisible();

    // Sidebar should show blind postings from Round 1
    await expect(hostPage.locator('#actionLogList')).toContainText('posts SB', { timeout: 5_000 });
    await expect(hostPage.locator('#actionLogList')).toContainText('posts BB');

    // Active player folds — action should appear in sidebar
    const activePage = await hostPage.locator('#turnIndicator').textContent()
      .then(t => /your turn/i.test(t || '') ? hostPage : guestPage);
    await expect(activePage.locator('#btnFold')).toBeEnabled({ timeout: 5_000 });
    await activePage.click('#btnFold');

    // Both pages should show a "folds" entry in the action log
    await expect(hostPage.locator('#actionLogList')).toContainText('folds', { timeout: 8_000 });
    await expect(guestPage.locator('#actionLogList')).toContainText('folds', { timeout: 8_000 });

    // Winner info (🏆) should appear in the sidebar
    await expect(hostPage.locator('#actionLogList')).toContainText('🏆', { timeout: 8_000 });

    console.log('  [test] Action log sidebar shows played steps ✅');
  });

  test('round-over modal appears after hand ends and host can play again', async ({ context }) => {
    const hostPage  = await openPokerPage(context, 'Host');
    const guestPage = await openPokerPage(context, 'Guest');

    // Setup
    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);
    const roomCode = await getRoomCode(hostPage);
    await joinRoom(guestPage, 'Bob', roomCode);
    await waitForWaiting(guestPage);
    await hostPage.click('#btnStart');
    await waitForGame(hostPage);
    await waitForGame(guestPage);
    await expect(hostPage.locator('#myCards .playing-card')).toHaveCount(2, { timeout: 8_000 });

    // Active player folds to end the round
    const activePage = await hostPage.locator('#turnIndicator').textContent()
      .then(t => /your turn/i.test(t || '') ? hostPage : guestPage);
    await expect(activePage.locator('#btnFold')).toBeEnabled({ timeout: 5_000 });
    await activePage.click('#btnFold');

    // Round-over modal appears on both pages
    await expect(hostPage.locator('#roundOverModal')).toBeVisible({ timeout: 8_000 });
    await expect(guestPage.locator('#roundOverModal')).toBeVisible({ timeout: 8_000 });

    // Modal shows winner info
    await expect(hostPage.locator('#roundOverWinner')).toContainText('🏆', { timeout: 5_000 });

    // Host sees "Play Again" button; guest sees waiting message
    await expect(hostPage.locator('#roundOverHostControls')).toBeVisible();
    await expect(guestPage.locator('#roundOverGuestMsg')).toBeVisible();

    // Host clicks "Play Again" → modal closes and Round 2 starts
    await hostPage.click('#btnPlayAgain');
    await expect(hostPage.locator('#roundOverModal')).toBeHidden({ timeout: 5_000 });
    await expect(hostPage.locator('#roundLabel')).toHaveText('Round 2', { timeout: 10_000 });
    await expect(guestPage.locator('#roundLabel')).toHaveText('Round 2', { timeout: 10_000 });
    // Modal should also be hidden on guest side after round 2 begins
    await expect(guestPage.locator('#roundOverModal')).toBeHidden({ timeout: 5_000 });

    console.log('  [test] Round-over modal and Play Again ✅');
  });

  test('opening poker with ?room= hides the "New Room" button', async ({ context }) => {
    const hostPage = await openPokerPage(context, 'Host');
    await fillName(hostPage, 'Alice');
    await clickCreate(hostPage);
    await waitForWaiting(hostPage);
    const roomCode = await getRoomCode(hostPage);

    // Guest opens the invite URL directly
    const guestPage = await openPokerPage(context, 'Guest', `?room=${roomCode}`);
    await expect(guestPage.locator('#btnNew')).toBeHidden();
    await expect(guestPage.locator('#btnJoin')).toBeHidden();
    await expect(guestPage.locator('#joinFields')).toBeVisible();
    await expect(guestPage.locator('#roomCode')).toHaveValue(roomCode.toUpperCase());
  });

  test('leaving the game restores full poker lobby UI', async ({ context }) => {
    const { hostPage, guestPage } = await startHeadsUp(context);

    guestPage.once('dialog', d => d.accept());
    await guestPage.click('#btnLeaveGame');
    await expect(guestPage.locator('#lobby')).toBeVisible({ timeout: 5_000 });
    await expect(guestPage.locator('#btnNew')).toBeVisible();
    await expect(guestPage.locator('#btnJoin')).toBeVisible();
    await expect(hostPage.locator('#opponentsRow')).toContainText('Left', { timeout: 5_000 });
    // Leaving folds them out, so the host wins the hand
    await expect(hostPage.locator('#roundOverModal')).toBeVisible({ timeout: 5_000 });
  });

  test('guests never receive other hands or the deck', async ({ context }) => {
    const { guestPage } = await startHeadsUp(context);
    const seen = await guestPage.evaluate(() => ({
      deck: Room.state.deck,
      host: JSON.parse(Room.state.players[0].handJSON).length,
      hostCount: Room.state.players[0].handCount,
      mine: JSON.parse(Room.state.players[Room.mySeat].handJSON).length,
    }));
    expect(seen.deck).toBeUndefined();
    expect(seen.host).toBe(0);
    expect(seen.hostCount).toBe(2);
    expect(seen.mine).toBe(2);
    await expect(guestPage.locator('#opponentsRow .playing-card.back')).toHaveCount(2);
  });

  test('host leaving sends guests back to the lobby with a message', async ({ context }) => {
    const { hostPage, guestPage } = await startHeadsUp(context);
    hostPage.once('dialog', d => d.accept());
    await hostPage.click('#btnLeaveGame');
    await expect(guestPage.locator('#lobby')).toBeVisible({ timeout: 8_000 });
    await expect(guestPage.locator('#lobbyError')).toContainText('host closed the room');
  });

  test('host rejects an out-of-turn action sent by a guest', async ({ context }) => {
    const { hostPage, guestPage } = await startHeadsUp(context);
    // Heads-up: the host (button) acts first, so the guest is out of turn.
    await expect(hostPage.locator('#turnIndicator')).toContainText(/your turn/i);
    await guestPage.evaluate(() => Room.act({ type: 'raise', amount: -500 }));
    await guestPage.evaluate(() => Room.act({ type: 'fold' }));
    await hostPage.waitForTimeout(500);
    await expect(hostPage.locator('#potDisplay')).toHaveText('30');
    await expect(hostPage.locator('#turnIndicator')).toContainText(/your turn/i);
  });

  test('raise uses the "raise by" amount on top of the call', async ({ context }) => {
    const { hostPage, guestPage } = await startHeadsUp(context);
    // Host is the button/SB: 10 to call, minimum raise 20 → raises to 40
    await expect(hostPage.locator('#raiseAmount')).toHaveValue('20');
    await hostPage.click('#btnRaise');
    await expect(guestPage.locator('#currentBetDisplay')).toHaveText('40');
    await expect(guestPage.locator('#potDisplay')).toHaveText('60');
    await expect(guestPage.locator('#btnCall')).toHaveText('Call 20');
  });

  test('a guest who refreshes gets their seat and cards back', async ({ context }) => {
    const { hostPage, guestPage } = await startHeadsUp(context);
    const before = await guestPage.evaluate(() => Room.state.players[Room.mySeat].handJSON);
    await guestPage.reload();
    await waitForGame(guestPage);
    await expect(guestPage.locator('#myCards .playing-card')).toHaveCount(2, { timeout: 10_000 });
    const after = await guestPage.evaluate(() => Room.state.players[Room.mySeat].handJSON);
    expect(after).toBe(before);
    await expect(hostPage.locator('#opponentsRow')).not.toContainText('Reconnecting', { timeout: 10_000 });
    // The hand carries on: host (button) can still act
    await expect(hostPage.locator('#btnCall')).toBeEnabled();
  });

  test('when the host refreshes, the room reopens and guests reconnect', async ({ context }) => {
    const { hostPage, guestPage } = await startHeadsUp(context);
    const pot = await hostPage.locator('#potDisplay').textContent();
    await hostPage.reload();
    await waitForGame(hostPage);
    await expect(hostPage.locator('#potDisplay')).toHaveText(pot, { timeout: 10_000 });
    await expect(hostPage.locator('#opponentsRow')).not.toContainText('Reconnecting', { timeout: 15_000 });
    await expect(guestPage.locator('#gameTable')).toBeVisible();
    await hostPage.click('#btnCall');
    await expect(guestPage.locator('#btnCheck')).toBeEnabled({ timeout: 10_000 });
  });

});
