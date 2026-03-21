# Contributing Guide — Games Library

This document is the primary reference for **developers and AI coding sessions** working on this project. It covers the development environment, codebase conventions, how the code actually works, and where known issues exist.

---

## Table of Contents

- [Development Environment](#development-environment)
- [Project Conventions](#project-conventions)
- [Poker Game — Deep Dive](#poker-game--deep-dive)
- [Testing Guide](#testing-guide)
- [Known Issues](#known-issues)
- [Adding a New Game](#adding-a-new-game)
- [Decision Log](#decision-log)

---

## Development Environment

### Requirements

| Tool | Version |
|------|---------|
| Node.js | ≥ 22.12.0 (see `.nvmrc`) |
| npm | bundled with Node |
| Playwright browsers | Chromium — install with `npx playwright install chromium` |

```bash
# First-time setup
nvm use            # switch to Node 22 via .nvmrc
npm install        # installs Astro + dev deps (Playwright, peer, peerjs)
```

### Daily workflow

```bash
npm run dev        # start Astro dev server at http://localhost:4321/games/
npm test           # run Playwright E2E tests (headless Chromium)
npm run test:ui    # open the Playwright interactive UI
npm run build      # build static site into dist/
npm run preview    # serve the built site locally
```

### Key URLs (dev)

| URL | Purpose |
|-----|---------|
| `http://localhost:4321/games/` | Home / game selection |
| `http://localhost:4321/games/poker/` | Poker lobby |
| `http://localhost:4321/games/poker/?room=ABCDEF` | Pre-filled join link |

---

## Project Conventions

### TypeScript

The project uses Astro's strict TypeScript preset (`tsconfig.json`). **Astro components** (`.astro` files) use TypeScript in their frontmatter. **Game logic** lives in plain JS files under `public/` — no TypeScript, no bundler, no imports.

### Vanilla JS in `public/`

`public/poker-game.js` is served as-is to the browser. No bundler, no transpiler:
- ES2020+ syntax is fine (browsers are modern).
- Use `/** JSDoc */` comments on public/important functions.
- No `import`/`export` — everything is top-level in a single file.
- All DOM IDs come from `src/pages/poker/index.astro`; keep them in sync.

### CSS

All styling is in `src/styles/global.css` using CSS custom properties (variables). No framework. Classes: `.btn`, `.btn-primary`, `.badge`, `.badge-gold`, `.playing-card`, etc.

### No backend, no secrets

This is a **static site**. Never add:
- Environment variables that contain secrets (they end up in built JS).
- API calls that require auth.
- npm packages that pull in server-side code.

---

## Poker Game — Deep Dive

### Architecture in One Sentence

The **host browser** holds the single authoritative game state and broadcasts a full copy to every peer after every change; peers relay actions back to the host via PeerJS DataConnections.

### State Flow

```
Guest clicks "Fold"
  → playerAction('fold')
  → hostConn.send({ type:'action', seat, action:'fold' })
  → HOST: handleNewPeerConnection → conn.on('data')
  → HOST: applyAction(localState, seat, 'fold')
  → HOST: pushState(gs)          ← broadcasts to peers + re-renders host UI
  → Peers: handleHostMessage → onStateChange(gs)
```

### `pushState(gs)` — single update point

Every change to game state must go through `pushState`. It:
1. Sets `localState = gs`.
2. Calls `broadcastToPeers({ type: 'state', state: gs })` to all connected peers.
3. Calls `onStateChange(gs)` to re-render the **host's own** UI.

**Do not** call `onStateChange` separately after `pushState` — it will render twice.

### `applyAction(gs, seat, action, amount)` — the action engine

All player actions are processed here (called for both host and peer moves). After the switch statement:
1. Checks if only one active player remains → immediate pot award + showdown.
2. Checks `isBettingRoundOver(gs)` → either advances to next phase or moves to the next player.

### `isBettingRoundOver(gs)` — current implementation

Returns `true` when all active (non-folded, non-all-in) players have `bet === currentBet`:

```js
function isBettingRoundOver(gs) {
  const active = Object.keys(gs.players)
    .map(Number)
    .filter(i => gs.players[i] && gs.players[i].active
              && !gs.players[i].folded && !gs.players[i].allIn);
  if (active.length <= 1) return true;
  return active.every(i => gs.players[i].bet === gs.currentBet);
}
```

> ⚠️ **Known limitation** — see [Known Issues](#known-issues): this check can trigger too early when all bets happen to equal `currentBet` even though not all players have had a turn (e.g., first check on a new street, or BB option pre-flop).

### `nextPlayer(gs)` — current implementation

Uses `activeSeatOrder` (seats starting from dealer+1, excluding folded players) and finds the next seat after `currentPlayer`:

```js
function nextPlayer(gs) {
  const active = activeSeatOrder(gs).filter(s => !gs.players[s].folded && !gs.players[s].allIn);
  if (active.length === 0) return -1;
  const idx = active.indexOf(gs.currentPlayer);
  return active[(idx + 1) % active.length];
}
```

> ⚠️ **Known limitation**: when a player folds, they are removed from `active`, so `idx === -1`. In that case `active[0]` is returned (first player after the dealer), which may skip the player who should act next. See [Known Issues](#known-issues).

### Blind posting (`postBlinds`)

| Game size | Small Blind | Big Blind | First to act pre-flop |
|-----------|-------------|-----------|----------------------|
| 2 (heads-up) | `activeSeatOrder[1]` (dealer) | `activeSeatOrder[0]` | Dealer/SB |
| 3–4 players | `activeSeatOrder[0]` (left of dealer) | `activeSeatOrder[1]` | `activeSeatOrder[2]` (UTG) |

`activeSeatOrder` starts from `dealer + 1` and returns active non-folded seats in clockwise order.

### Dealer rotation (`startNewRound`)

Scans forward from `dealer + 1` skipping empty seats, ensuring the button always lands on an occupied seat:

```js
let next = (gs.dealer + 1) % MAX_PLAYERS;
let safety = MAX_PLAYERS;
while (!gs.players[next] && safety-- > 0) next = (next + 1) % MAX_PLAYERS;
gs.dealer = next;
```

### Showdown & split pots

```js
const share = Math.floor(gs.pot / winners.length);
for (const w of winners) gs.players[w].chips += share;
```

> ⚠️ **Known limitation**: if the pot is not evenly divisible, the remainder chip(s) are discarded. This is a minor accounting issue.

### Bet reset between streets

`nextPhase` resets `p.bet = 0` for all players and `gs.currentBet = 0` before dealing community cards. This means a fresh `isBettingRoundOver` check at the start of a new street finds all bets equal (0 = 0) and can advance prematurely. See [Known Issues](#known-issues).

### `renderGame` — one-shot full render

Called after every state change. Renders: round/phase labels, community cards, each player's opponent panel, my hand panel, and action buttons. The action buttons are **disabled in-place** (never removed from the DOM) so subsequent renders can re-enable them without null-reference errors.

### Key global variables

| Variable | Type | Purpose |
|----------|------|---------|
| `peer` | `Peer \| null` | Our PeerJS Peer instance |
| `hostConn` | `DataConnection \| null` | Guest's connection to the host |
| `peerConns` | `DataConnection[]` | Host's connections to all guests |
| `connSeatMap` | `Map<DataConnection, number>` | Maps each connection to its seat number |
| `localState` | `object \| null` | Full game state (host is authoritative; guests hold a copy) |
| `mySeat` | `number` | This browser's seat index (0–3), -1 if unset |
| `myName` | `string` | This browser's display name |
| `myRoomCode` | `string` | The 6-character room code |
| `amHost` | `boolean` | True if this browser is the host |
| `view` | `string` | Current view: `'lobby'` \| `'waiting'` \| `'game'` |

---

## Testing Guide

### Framework & approach

[Playwright](https://playwright.dev/) with a **BroadcastChannel mock** for PeerJS. Tests open multiple pages in the **same browser context** so the mock's `BroadcastChannel` connects them — no WebRTC, no network required.

### The PeerJS mock (`tests/peerjs-mock.js`)

Injected by intercepting `**/peerjs.min.js` at the network layer:

```js
await page.route('**/peerjs.min.js', async route => {
  await route.fulfill({ contentType: 'application/javascript', body: MOCK_SCRIPT });
});
```

The mock implements the same `Peer` + `DataConnection` API as PeerJS 1.x, but uses `BroadcastChannel` as the transport. Key guarantees:
- The host's `connection` event fires **before** the guest's `open` event, matching real PeerJS ordering.
- `peer-unavailable` errors fire after a 3-second timeout when no peer with that ID responds.

### Same context — critical constraint

The BroadcastChannel mock **only works between pages in the same browser context**. Using `browser.newContext()` per player creates isolated channel namespaces.

```js
// ✅ Correct — all pages share one context
test('...', async ({ context }) => {
  const host  = await context.newPage();
  const guest = await context.newPage();
  ...
});

// ❌ Wrong — different contexts isolate BroadcastChannel
const host  = await (await browser.newContext()).newPage();
const guest = await (await browser.newContext()).newPage();
```

### Useful locators for assertions

```js
// Turn indicator (contains "your turn" when it's your move)
page.locator('#turnIndicator')

// Game state displays
page.locator('#potDisplay')          // current pot value
page.locator('#currentBetDisplay')  // current bet to match
page.locator('#roundLabel')         // e.g. "Round 1"
page.locator('#phaseLabel')         // e.g. "Pre-Flop", "Flop"

// Cards
page.locator('#myCards .playing-card')        // my hole cards (count = 2)
page.locator('#communityCards .playing-card') // board cards (0, 3, 4, or 5)

// Action buttons
page.locator('#btnFold')
page.locator('#btnCheck')
page.locator('#btnCall')
page.locator('#btnRaise')

// Waiting room
page.locator('#playerSlots')    // contains all seated players
page.locator('#displayRoomCode') // the 6-char room code
page.locator('#btnStart')        // host-only start button
```

### Running tests

```bash
npm test                                      # all tests, headless
npx playwright test tests/poker.spec.js      # single file
npm run test:ui                               # interactive Playwright UI
```

The config (`playwright.config.js`) starts the Astro dev server automatically (reusing one if already running) and a local PeerJS server on port 9001 via `globalSetup`.

---

## Known Issues

These bugs exist in the current codebase and have not yet been fixed. They are documented here so future sessions can address them systematically.

### 1. BB option missing pre-flop (3+ players)

**Symptom**: With 3 or 4 players, if all players call (don't raise) before it reaches the Big Blind, the betting round ends immediately and the flop is dealt — the BB never gets their option to raise.

**Root cause**: `isBettingRoundOver` returns `true` as soon as `all bets === currentBet`. After UTG and SB call, all three players have `bet === 20 === currentBet`, so the check returns `true` before BB acts.

**Affected code**: `isBettingRoundOver` in `poker-game.js`.

**Fix direction**: Track which seats have voluntarily acted in the current street. Add a `gs.streetActed` array. Initialize it to `[]` in `postBlinds` and `nextPhase`. Append to it in `applyAction`. Reset to `[raisingSeat]` when `currentBet` increases. Modify `isBettingRoundOver` to also require `active.every(i => gs.streetActed.includes(i))`.

### 2. All-check on new street advances phase immediately

**Symptom**: On the flop, turn, or river, the first player to check causes the game to immediately advance to the next street — no other players get to act.

**Root cause**: At the start of each street, `p.bet = 0` for all players and `currentBet = 0`. The very first `check` action triggers `isBettingRoundOver`, which finds `all(0 === 0) = true` and goes to the next phase.

**Affected code**: `isBettingRoundOver` + the bet reset in `nextPhase`.

**Fix direction**: Same fix as issue #1 — `gs.streetActed` tracking ensures not all players have acted until they actually do.

### 3. Wrong next player after fold in multi-player games

**Symptom**: When a player folds, the action may skip to the wrong player (the first seat after the dealer instead of the next player in rotation).

**Root cause**: `nextPlayer` uses `activeSeatOrder(gs).indexOf(gs.currentPlayer)`. If the current player just folded, they are no longer in `activeSeatOrder` and `indexOf` returns `-1`. The formula `active[(-1 + 1) % len] = active[0]` then returns the first seat in the order, not the next one.

**Affected code**: `nextPlayer` in `poker-game.js`.

**Fix direction**: Replace the `activeSeatOrder + indexOf` approach with a simple forward scan from `currentPlayer`:
```js
for (let offset = 1; offset <= MAX_PLAYERS; offset++) {
  const s = (gs.currentPlayer + offset) % MAX_PLAYERS;
  const p = gs.players[s];
  if (p && p.active && !p.folded && !p.allIn) return s;
}
return -1;
```

### 4. Split pot remainder chips lost

**Symptom**: In a split pot where `pot % winners.length !== 0`, the leftover chips disappear. Example: pot = 31, two winners each get 15, and 1 chip vanishes.

**Affected code**: `resolveShowdown` in `poker-game.js`.

**Fix direction**: Award remainder to the lowest-numbered winner seat:
```js
const share = Math.floor(gs.pot / winners.length);
const remainder = gs.pot - share * winners.length;
for (const w of winners) gs.players[w].chips += share;
winners.sort((a, b) => a - b);
gs.players[winners[0]].chips += remainder;
```

### 5. Home page still says "AI fills empty seats"

**Symptom**: `src/pages/index.astro` has the text "AI fills empty seats automatically." AI opponents were removed; only human players are supported.

**Affected code**: The Poker card in `src/pages/index.astro` and the badge `<span class="badge badge-green">AI Opponents</span>`.

**Fix direction**: Remove the AI reference and badge, update description to "2–4 human players · no AI".

---

## Adding a New Game

1. **Page**: `src/pages/<game-name>/index.astro` — use the poker page as a template. Define all HTML structure here; no JavaScript in `.astro` files (use `is:inline` scripts to load from `public/`).

2. **Logic**: `public/<game-name>.js` — plain vanilla JS. Follow the poker pattern: globals for state, one `pushState`-style function as the single update point, one `render`-style function for all DOM output.

3. **Home card**: `src/pages/index.astro` — copy the Poker card block and update the link, emoji, title, description, and badges.

4. **Tests**: `tests/<game-name>.spec.js` — follow `tests/poker.spec.js`. Use the same mock-injection pattern if the game needs P2P. Keep pages in the same context.

5. **Assets**: Any third-party JS libraries go in `public/` as **local copies** (no CDN references). This prevents external failures from breaking the game.

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| **PeerJS instead of Gun.js** | Gun.js relay servers were unreliable and Gun's reactive model added complexity. PeerJS gives direct WebRTC DataChannels: lower latency, simpler API, no relay dependency for data (only for ICE signalling). |
| **Host = single source of truth** | Avoids conflict resolution. All clients see the same state because the host broadcasts the full object after every change. |
| **Full state on every broadcast** | Simpler than delta/patch updates. State objects are small (< 5 KB per broadcast). No merge logic needed. |
| **Vanilla JS in `public/`** | Zero build complexity for game logic. No virtual DOM overhead. The file is small enough (~1,050 lines) that a framework would add more weight than value. |
| **Local copies of PeerJS and QRCode** | CDN outages would break the game mid-session. Locally bundled libraries avoid this. |
| **BroadcastChannel mock for tests** | WebRTC in headless Chromium requires STUN/TURN servers even for localhost, which aren't available in CI. BroadcastChannel gives equivalent same-process message passing without any network. |
| **`pushState` calls `onStateChange`** | Ensures the host's own UI is always in sync after any state change. Previously `pushState` only broadcast to peers; hosts had to call `onStateChange` separately at every call site, and missing a call led to stale UI. |
| **Buttons disabled not removed** | Clearing `#actionButtons` innerHTML removes the button elements from the DOM. Subsequent renders then throw null-reference errors when trying to set `.disabled`. Buttons are now always disabled in-place. |
| **No AI opponents** | Removed to keep the codebase focused on the multiplayer infrastructure. Placeholder text on the home page ("AI fills empty seats") is a known issue to be cleaned up. |
