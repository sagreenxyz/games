# Contributing Guide — Games Library

This document is the primary reference for **developers and AI coding sessions** working on this project. It covers the development environment, codebase conventions, how the code actually works, and where known issues exist.

---

## Table of Contents

- [Development Environment](#development-environment)
- [Project Conventions](#project-conventions)
- [Architecture](#architecture)
- [Poker Rules Engine](#poker-rules-engine)
- [Sevens Rules Engine](#sevens-rules-engine)
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
npm install        # installs Astro + dev deps (Playwright, peerjs)
npx playwright install chromium   # browser for E2E tests
```

### Daily workflow

```bash
npm run dev        # start Astro dev server at http://localhost:4321/games/
npm test           # unit tests, then Playwright E2E tests
npm run test:unit  # rules-engine unit tests only (fast, no browser)
npm run test:e2e   # Playwright E2E tests (headless Chromium)
npm run test:ui    # open the Playwright interactive UI
npm run build      # build static site into dist/
npm run preview    # serve the built site locally
```

### Key URLs (dev)

| URL | Purpose |
|-----|---------|
| `http://localhost:4321/games/` | Home / game selection |
| `http://localhost:4321/games/poker/` | Poker lobby |
| `http://localhost:4321/games/sevens/` | Sevens lobby |
| `http://localhost:4321/games/poker/?room=ABCDEF` | Pre-filled join link |

---

## Project Conventions

### TypeScript

The project uses Astro's strict TypeScript preset (`tsconfig.json`). **Astro components** (`.astro` files) use TypeScript in their frontmatter. **Game logic** lives in plain JS files under `public/` — no TypeScript, no bundler, no imports.

### Vanilla JS in `public/`

Files in `public/` are served as-is to the browser. No bundler, no transpiler:
- ES2020+ syntax is fine (browsers are modern).
- Use `/** JSDoc */` comments on public/important functions.
- No `import`/`export` — each file is a classic script wrapped in an IIFE that exposes at most one global (`Room`, `PokerLogic`, `SevensLogic`).
- `*-logic.js` files must stay free of DOM, network and timer code so they can be unit-tested in Node.
- All DOM IDs come from `src/pages/<game>/index.astro`; keep them in sync. The lobby / waiting-room IDs are shared by every game because `room.js` uses them.
- Script `src` paths in pages are built from `import.meta.env.BASE_URL`, so `BASE_PATH` works — don't hard-code `/games/`.

### CSS

All styling is in `src/styles/global.css` using CSS custom properties (variables). No framework. Classes: `.btn`, `.btn-primary`, `.badge`, `.badge-gold`, `.playing-card`, etc.

### No backend, no secrets

This is a **static site**. Never add:
- Environment variables that contain secrets (they end up in built JS).
- API calls that require auth.
- npm packages that pull in server-side code.

---

## Architecture

### In one sentence

The **host browser** holds the authoritative game state, runs every action through the game's **rules engine**, and sends each guest a **redacted copy** (no hidden piles, no other players' hands) after every change.

### Files and responsibilities

| File | Exposes | Does |
|------|---------|------|
| `public/cards.js` | `Cards` | Deck, shuffle, rank values (ace low/high), sorting, `cardHTML()` |
| `public/room.js` | `Room` | PeerJS host/guest, lobby, waiting room, applying actions through the engine, redaction, rejoin after refresh, leaving |
| `public/<game>-logic.js` | e.g. `PokerLogic` | Pure rules implementing the shared engine interface — no DOM, no network, no timers |
| `public/<game>-game.js` | — | Renders the game and calls `Room.init({ logic, render, ... })` |
| `src/components/GameRoom.astro` | — | Page shell: lobby + waiting room markup, "How to play" slot, script tags in order |
| `src/data/games.ts` | `games` | Registry that drives the home page and the header nav |
| `public/rummy-core.js` | `RummyCore` | Meld family: sets/runs, best meld arrangement (min deadwood), layoff candidates |
| `public/tricks-core.js` | `TrickCore` | Trick family: follow-suit legality, trick winner with optional trump |
| `public/trick-ui.js` + `TrickTable.astro` | `TrickUI` | Four-seat table rendering shared by Hearts and Spades |
| `RummyTable.astro` | — | Table markup shared by Rummy and Rummy 500 |

### The rules-engine interface

Every multiplayer game's logic file exposes the same shape (documented at the top of `room.js`):

```js
{
  id, minPlayers, maxPlayers, hiddenFields,   // e.g. ['deck'] — stripped before sending to guests
  create(code), freshPlayer(name),
  start(gs, rng) → boolean,                   // false if it can't start (e.g. too few players)
  legalActions(gs, seat) → action[],          // concrete moves, e.g. { type: 'play', card }
  apply(gs, seat, action) → { ok, error },    // must not change gs when it fails
  isOver(gs),                                 // this hand / game has ended
  removePlayer(gs, seat),                     // a player is gone for good
  // optional: nextRound(gs, rng), isMatchOver(gs), canSeeHand(gs, viewer, owner), allCards(gs), seatNote(seat)
}
```

Because every engine has `legalActions`, the shared harness in `tests/unit/harness.mjs` can fuzz any game: random play must never stall, every listed action must be accepted, idle seats must be refused, and (with `allCards`) no card may be lost or duplicated. Register a new engine in `tests/unit/engines.test.mjs`.

### State flow

```
Guest clicks "Fold"
  → Room.act({ type: 'fold' })
  → hostConn.send({ type: 'action', action: { type: 'fold' } })
  → HOST room.js: seat = connSeatMap.get(conn)        ← seat comes from the connection, never the message
  → logic.apply(gs, seat, action)                     ← rejects out-of-turn / illegal actions
  → Room.pushState(gs)                                ← redacts per guest, sends, re-renders host, saves session
  → Guests: render(state)
```

Host-side changes outside an action (e.g. "Next hand") go through `Room.update(gs => { ... })`.

### Disconnects and rejoining

- Each guest gets a random **rejoin token** when seated; it is kept in `sessionStorage` (survives a refresh, not closing the tab).
- A guest who drops is marked `disconnected` and keeps their seat for `rejoinGraceMs` (45 s). Reconnecting with the token restores the seat. Games should wait for, or skip, disconnected players — never treat them as gone.
- When the grace period ends, or the player clicks Leave, room.js sets `left = true` and calls `logic.removePlayer`.
- The **host** saves the full state to `sessionStorage` after every change. After a refresh it reopens the same room code, restores the state, and guests (who retry for the grace period) reconnect automatically.

### Redaction

`redactFor(gs, seat)` deep-copies the state, deletes the engine's `hiddenFields`, sets `handCount` on every player, and blanks `handJSON` for hands the viewer may not see (`canSeeHand`). Renderers use `Room.handSize(p)` for card counts.

---

## Poker Rules Engine

All in `public/poker-logic.js`.

### Hand lifecycle

- `startHand(gs, deck?)` — removes disconnected players, rebuys busted ones (back to 1,000), moves the button to the next occupied seat, deals, posts blinds, and calls `settle`. Returns `false` and switches to `'waiting'` if fewer than two players are left.
- `applyAction(gs, seat, action, amount)` — validates via `legalActions`, applies the bet, updates `streetActed`/`minRaise`, then calls `settle`.
- `settle(gs)` (internal) — loops: if one live player → award uncontested; else if the street isn't over → next actor; else if river → showdown; else deal the next street. Because it loops, an all-in with nobody left to bet runs the board out automatically.

### Betting rules

- `isBettingRoundOver`: over when nobody can bet; or the only player who can bet has matched `currentBet`; or every player who can bet is in `streetActed` and has matched.
- A **full raise** (≥ `minRaise`) resets `streetActed` to `[raiser]` and sets `minRaise` to the raise size. A **short all-in raise** raises `currentBet` but doesn't re-open betting.
- `raise` amounts are "raise **by**" (on top of the call). Anything ≥ the player's remaining stack becomes an all-in.
- Turn order is a forward scan from the current seat (`nextActor`), so folds never skip a player.

| Game size | Small Blind | Big Blind | First to act pre-flop | First to act post-flop |
|-----------|-------------|-----------|----------------------|------------------------|
| 2 (heads-up) | Button | Other player | Button/SB | Other player |
| 3–4 | Left of button | Next seat | Left of BB (UTG) | First live seat left of button |

### Showdown and side pots

Each player's `contributed` tracks chips put in this hand. `buildPots` makes one pot per distinct contribution level among live players; folded players' chips count toward pots but they're never eligible. Each pot goes to the best eligible hand; an odd chip goes to the first tied winner clockwise from the button. An uncalled bet ends up in a pot only its bettor is eligible for, so it's returned.

### Hand evaluation

`score5` groups ranks by count (then rank) so pairs/trips are compared before kickers; the wheel (A-2-3-4-5) counts as 5-high. `evalHand` picks the best 5 of up to 7 cards.

---

## Sevens Rules Engine

All in `public/sevens-logic.js`.

- `startGame(gs, deck?)` — clears out departed players, deals all 52 cards round-robin, and gives the first turn to the 7♦ holder.
- `getValidMoves(board, hand)` — 7♦ must be played first; afterwards any 7 opens its suit and other cards must extend a suit by one at either end.
- `applyAction(gs, seat, 'play' | 'pass', card)` — rejects out-of-turn moves, cards not held, illegal cards, and passing while a move exists.
- `removePlayer(gs, seat)` — a player left mid-game: their cards are dealt out to the players still holding cards (so no suit is ever blocked), and the turn moves on if it was theirs. Since every remaining card is in an active player's hand, someone always has a legal move.
- `resetToWaiting(gs)` — used by Play Again; also drops players who left.

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

### Unit tests (`tests/unit/`)

`tests/unit/load.mjs` runs files from `public/` inside a `vm` sandbox (with a stub `document`) and returns their globals, so the rules engines are tested exactly as the browser loads them. Use the seeded `rng()` helper with `makeDeck(rng(n))` for reproducible deals. Tests are run by `node --test` (no extra dependencies).

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
npm test                                      # unit + E2E
npm run test:unit                             # unit only
npx playwright test tests/poker.spec.js      # single E2E file
npm run test:ui                               # interactive Playwright UI
```

The config (`playwright.config.js`) starts the Astro dev server automatically (reusing one if already running, except in CI). CI runs both suites on every pull request and before every deploy.

---

## Known Issues

- **No host migration.** If the host leaves, the room closes and guests return to the lobby.
- **The host can see everything.** Redaction protects guests from each other, but the host's browser deals the cards.
- **Short all-in raises** don't re-open betting for players who already acted, but those players are asked to act again (and could re-raise) because their bet no longer matches. Strict rules would limit them to call or fold.
- **No TURN server** is configured by default, so some restrictive networks can't connect.

---

## Adding a New Game

1. **Registry**: add an entry to `src/data/games.ts` (slug, name, emoji, blurb, players, mode, family). The home page and nav pick it up.
2. **Rules**: `public/<slug>-logic.js` implementing the engine interface above. Reuse `Cards` and any shared family engine.
3. **Page**: `src/pages/<slug>/index.astro` using `<GameRoom slug="<slug>">`, with a `slot="rules"` fragment and your `#gameTable` markup. Pass `extra={[...]}` for shared engine scripts.
4. **UI**: `public/<slug>-game.js` — `Room.init({ logic, render, onError, onLeave })`; send moves with `Room.act({ type, ... })`.
5. **Tests**: add the engine to `tests/unit/engines.test.mjs` (free fuzz coverage), write rules tests in `tests/unit/<slug>-logic.test.mjs`, and an E2E spec `tests/<slug>.spec.js` covering a game played through and a player leaving.
6. **Docs**: rules in the README.

Solo games skip `room.js`: the page uses `Layout` directly and the UI drives the engine itself (seat 0), saving to `localStorage`. See `klondike-*.js`.

**Pick a family first.** Most new games are mostly rules on top of a shared engine:

| Family | Reuse | Examples |
|--------|-------|----------|
| Meld | `rummy-core.js`, `RummyTable.astro` | Gin Rummy, Rummy, Rummy 500 |
| Trick-taking | `tricks-core.js`, `trick-ui.js`, `TrickTable.astro` | Hearts, Spades |
| Shedding | `cards.js` only | Sevens, Crazy Eights |
| Solo | `cards.js`, no room | Klondike |

**Hidden information checklist**: anything a player shouldn't see must live either in a player's `handJSON` (blanked for others) or in a field listed in `hiddenFields`. Per-player secrets that aren't cards (e.g. Hearts' pending passes) go in a hidden field, with a public summary (e.g. `passedSeats`).

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| **PeerJS instead of Gun.js** | Gun.js relay servers were unreliable and Gun's reactive model added complexity. PeerJS gives direct WebRTC DataChannels: lower latency, simpler API, no relay dependency for data (only for ICE signalling). |
| **Host = single source of truth** | Avoids conflict resolution. All clients see the same state because the host broadcasts the full object after every change. |
| **Full (redacted) state on every broadcast** | Simpler than delta/patch updates. State objects are small (< 5 KB per broadcast). Each guest gets its own copy with hidden information removed, so devtools can't reveal other hands or the deck. |
| **Common engine interface + fuzz harness** | Every game gets stall / legality / card-conservation coverage for free, and room.js can host any game without game-specific glue. |
| **Shared `room.js`, separate `*-logic.js`** | The lobby/networking code was duplicated in every game, so fixes had to be made twice. Splitting pure rules from UI makes the rules unit-testable in Node without a browser. |
| **Node's built-in test runner for unit tests** | No extra dependencies; the logic files are loaded into a `vm` sandbox exactly as the browser would run them. |
| **Vanilla JS in `public/`** | Zero build complexity for game logic. No virtual DOM overhead. The files are small enough that a framework would add more weight than value. |
| **Local copies of PeerJS and QRCode** | CDN outages would break the game mid-session. Locally bundled libraries avoid this. `public/peerjs.min.js` is copied from the `peerjs` dev dependency with `npm run vendor:peerjs`. |
| **BroadcastChannel mock for tests** | WebRTC in headless Chromium requires STUN/TURN servers even for localhost, which aren't available in CI. BroadcastChannel gives equivalent same-process message passing without any network. |
| **`pushState` calls `onStateChange`** | Ensures the host's own UI is always in sync after any state change. Previously `pushState` only broadcast to peers; hosts had to call `onStateChange` separately at every call site, and missing a call led to stale UI. |
| **Buttons disabled not removed** | Clearing `#actionButtons` innerHTML removes the button elements from the DOM. Subsequent renders then throw null-reference errors when trying to set `.disabled`. Buttons are now always disabled in-place. |
| **No AI opponents** | Removed to keep the codebase focused on the multiplayer infrastructure. |
