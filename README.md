# 🎮 Games Library

A **multiplayer browser games library** built with [Astro](https://astro.build) and hosted on [GitHub Pages](https://pages.github.com/). No login, no account, no downloads — open a browser and play.

**Live site:** https://sagreenxyz.github.io/games/

---

## Table of Contents

- [Games Available](#-games-available)
- [How to Play — Poker](#-how-to-play--texas-holdem-poker)
- [How to Play — Sevens](#-how-to-play--sevens)
- [Technical Architecture](#-technical-architecture)
- [Local Development](#️-local-development)
- [Testing](#-testing)
- [Deployment](#-deployment-github-pages)
- [Adding a New Game](#-adding-a-new-game)
- [Limitations & Notes](#️-limitations--notes)

---

## 🃏 Games Available

### Texas Hold'em Poker

Classic Texas Hold'em for **2–4 human players**. No computer opponents — you need real people. One player creates a room and shares the code or invite link; others join and the host starts the game.

### Sevens (Fan Tan)

A shedding card game for **2–4 human players**: build each suit outward from its 7 and be the first to empty your hand. Rooms, invites and joining work exactly like Poker.

---

## 🎯 How to Play — Texas Hold'em Poker

### Starting a Room

1. Go to the **[Poker page](https://sagreenxyz.github.io/games/poker/)**.
2. Enter your **display name** (up to 20 characters).
3. Click **✨ New Room**.
4. A unique **6-character room code** is generated (e.g., `A3FZ7K`).
5. Share the room code or scan the **QR code** with your friends.
6. Once at least one more player joins, click **🃏 Start Game**.

### Joining a Room

1. Go to the **Poker page**.
2. Enter your display name.
3. Click **🔗 Join Room**, enter the 6-character code, and click **Join →**.
4. Wait in the lobby until the host starts the game.

> **Direct link:** The host can also share a URL like  
> `https://sagreenxyz.github.io/games/poker/?room=A3FZ7K`  
> which pre-fills the room code so guests only need to enter their name.

### During the Game

| Action | When available |
|--------|----------------|
| **Fold** | Always on your turn — discard your hand and forfeit any chips bet |
| **Check** | Only when the current bet is 0 (no one has bet yet this street) |
| **Call** | Match the highest bet on the table |
| **Raise by** | Enter how much to raise **on top of the call** and click *Raise by*. The minimum is the big blind (20) or the size of the last raise this street, whichever is bigger. Raising by your whole stack is an all-in. |
| **Drop Out** | Any time — you are removed from the hand; the game continues |

- Buttons are **enabled only on your turn**.
- Other players' cards are hidden until Showdown.
- Your **hand rank** is shown live once community cards are dealt.

### Hand Flow

| Phase | What happens |
|-------|--------------|
| **Pre-Flop** | Each player gets 2 private hole cards. Blinds posted. Betting starts with the player left of the big blind (UTG). The Big Blind always gets their option to raise even if everyone else called. |
| **Flop** | 3 community cards revealed. Betting starts with the first active player left of the dealer. |
| **Turn** | 1 more community card revealed. Another betting round. |
| **River** | Final community card. Last betting round. |
| **Showdown** | Remaining players reveal hands. Best 5-card hand from any combination of hole cards + community cards wins. |

A new round begins automatically 10 seconds after the hand ends, or straight away when the host clicks **Play Again**.

When every player still in the hand is all-in (or only one player can still bet), the remaining community cards are dealt out automatically and the hand goes to showdown.

### Blind Structure

| | Amount |
|-|--------|
| Small Blind | 10 chips |
| Big Blind | 20 chips |
| Starting chips | 1,000 per player |
| Minimum raise | 20 chips (Big Blind), or the size of the previous raise on the same street |

If a player runs out of chips they are refilled to 1,000 at the start of the next round.

### Hand Rankings (highest → lowest)

| Rank | Hand | Example |
|------|------|---------|
| 9 | **Royal Flush** | A♠ K♠ Q♠ J♠ 10♠ |
| 8 | **Straight Flush** | 9♥ 8♥ 7♥ 6♥ 5♥ |
| 7 | **Four of a Kind** | K♠ K♥ K♦ K♣ 2♠ |
| 6 | **Full House** | Q♠ Q♥ Q♦ 8♠ 8♥ |
| 5 | **Flush** | A♣ J♣ 8♣ 4♣ 2♣ |
| 4 | **Straight** | 10♠ 9♥ 8♦ 7♣ 6♠ |
| 3 | **Three of a Kind** | 7♠ 7♥ 7♦ K♠ 3♦ |
| 2 | **Two Pair** | A♠ A♦ 6♥ 6♦ Q♠ |
| 1 | **One Pair** | J♠ J♥ 5♦ 3♣ 2♠ |
| 0 | **High Card** | A♠ Q♦ 9♣ 5♥ 2♦ |

- Best **5-card hand** from any combination of the 2 hole cards + 5 community cards wins.
- Ties are broken by the ranks that make the hand first (e.g. the pair), then the kickers. The A-2-3-4-5 straight ("wheel") is the lowest straight.
- **Side pots**: a player who is all-in can only win as much from each opponent as they put in themselves. Any extra goes into side pots contested by the players who covered it; an uncalled bet goes back to the player who made it.
- **Split pots**: tied players share the pot equally; an odd chip goes to the first tied player clockwise from the button.

---

## 7️⃣ How to Play — Sevens

1. All 52 cards are dealt out among the players (some players may get one more card than others).
2. The player holding **7♦** goes first and must play it.
3. On your turn, play one card onto the board. A card is playable if it is:
   - a **7** (starts that suit's row), or
   - **one rank above or below** the cards already played in its suit (Ace is low, King is high).
4. If you have a playable card you **must** play it. You may only **Pass** when you have none.
5. Players finish in the order they empty their hands; the game ends when one player is left holding cards.
6. Click **💡 Hint** on your turn to highlight the cards you can play.

If a player leaves mid-game, their cards are dealt out to the players still holding cards, so the game can always be finished.

---

## 🏗 Technical Architecture

### Stack

| Layer | Technology |
|-------|------------|
| Site builder | [Astro 6](https://astro.build) — 100% static output |
| Hosting | GitHub Pages |
| Real-time P2P | [PeerJS 1.5.5](https://peerjs.com/) (WebRTC DataChannels) |
| Signalling | PeerJS cloud (default) — no server to run |
| Game logic | Vanilla JavaScript in `public/`: shared `room.js` + per-game `*-logic.js` (rules) and `*-game.js` (UI) |
| Styling | Custom CSS with CSS variables (`src/styles/global.css`) |
| QR codes | `qrcode.min.js` (local copy, no CDN) |
| Testing | Node's built-in test runner (rules engines) + [Playwright](https://playwright.dev/) with a BroadcastChannel-based PeerJS mock (E2E) |
| CI/CD | GitHub Actions |

### How Real-Time Multiplayer Works

The site is **100% static** — there is no application server. All real-time communication uses **WebRTC DataChannels** brokered by PeerJS.

```
Player A (host)           PeerJS signalling           Player B / C / D
Peer(roomCode)  ←── ICE offer/answer via WS ──→  peer.connect(roomCode)
       ↕                                                   ↕
  DataConnection ←────────── WebRTC DataChannel ──────────→ DataConnection
  (authoritative state)      (direct, no server)           (read-only)
```

1. **Host** calls `new Peer(roomCode, ...)` — the room code becomes their PeerJS peer ID.
2. **Guests** call `new Peer(randomId)` then `peer.connect(roomCode)` to reach the host.
3. The host maintains the single authoritative **game state object**. After each change it sends every guest **their own copy** with the deck and other players' hands removed (hands still in at a poker showdown are revealed).
4. Guests send **action messages** (e.g. `fold`, `check`, `call`, `raise`, or a Sevens `play`/`pass`) to the host. The host works out the sender's seat from the connection and rejects anything illegal — out of turn, wrong phase, bad amounts, cards the player doesn't hold.

### PeerJS Configuration

By default the game uses the PeerJS cloud signalling server. To override (e.g. for a self-hosted relay):

```html
<!-- Insert before room.js loads -->
<script>
  window.PEER_CONFIG = {
    host: 'my-peerjs-server.example.com',
    port: 443,
    path: '/peerjs',
    secure: true,
  };
</script>
```

All options from the [PeerJS Options API](https://peerjs.com/docs/#peer-options) are supported.

### Game State Object

The host is the single source of truth. This is the host's copy; guests receive it with `deck` removed and other players' `handJSON` set to `"[]"` (each player gets a `handCount` instead):

```js
{
  roomCode:      string,         // 6-char room code = host PeerJS peer ID
  phase:         'waiting'       // lobby phase
               | 'pre-flop'
               | 'flop'
               | 'turn'
               | 'river'
               | 'showdown',
  round:         number,         // increments each new hand
  dealer:        number,         // seat index 0–3 of the current dealer/button
  currentPlayer: number,         // seat index whose turn it is (-1 = none)
  currentBet:    number,         // highest bet this street
  minRaise:      number,         // smallest legal raise increment right now
  pot:           number,         // total chips in the pot
  communityCards: Card[],        // 0–5 cards
  deck:          Card[],         // remaining deck — host only, never sent
  hostSeat:      number,         // seat index of the host player
  lastAction:    string,         // human-readable description of last action
  winnerInfo:    string,         // populated when the hand ends
  showdownRevealed: boolean,     // true if hands were compared (not a fold-win)
  streetActed:   number[],       // seats that acted since the street began / last full raise
  actionLog:     string[],       // sidebar history
  players: {
    [seat: 0|1|2|3]: {
      name:        string,
      chips:       number,
      handJSON:    string,       // JSON-encoded Card[] — "[]" in other players' copies
      handCount:   number,       // set on copies sent to guests
      bet:         number,       // amount bet this street
      contributed: number,       // amount put in this hand (for side pots)
      folded:      boolean,
      allIn:       boolean,
      active:      boolean,      // dealt into the current hand
      isEmpty:     boolean,
      disconnected: boolean,     // true after a peer drops mid-game
    }
  }
}
```

`Card` shape: `{ r: string, s: string }` — rank (`'2'`–`'A'`) and suit (`'♠'`, `'♥'`, `'♦'`, `'♣'`).

### Host Responsibilities

The host browser is the authoritative dealer. It:

- Generates and shuffles the deck.
- Posts blinds and deals hole cards.
- Applies all player actions (even remote ones relayed via DataConnection).
- Advances game phases (Pre-Flop → Flop → Turn → River → Showdown).
- Validates every action (turn, phase, legal amount) and ignores anything else.
- Resolves showdowns and awards the main pot and any side pots.
- Starts new rounds after a delay.
- Auto-folds disconnected players (1.5-second timeout then fold).
- Sends each guest a redacted copy of the state after every change via `Room.pushState()`.

If the host disconnects, the peer connections to other players close. There is currently no host-migration feature — guests see the lobby and must create a new room.

### Seat Assignment

Seats are assigned sequentially in join order:
- Host → Seat 0
- First guest to join → Seat 1
- Second guest → Seat 2
- Third guest → Seat 3

The room holds up to 4 seats. After a player leaves and a new player joins the same code, they take the vacated seat.

### Blind Rotation & Action Order

**Dealer button** rotates clockwise by one occupied seat each round.

| Players | Pre-flop action starts at |
|---------|---------------------------|
| 2 (heads-up) | Dealer/SB (acts before BB) |
| 3–4 | UTG = first seat left of BB |

Post-flop action always starts with the first active player left of the dealer.

### Key Source Files

```
games/
├── README.md                        ← this file
├── CONTRIBUTING.md                  ← developer & AI guide
├── astro.config.mjs                 ← base URL, output mode
├── package.json                     ← scripts: dev / build / test
├── playwright.config.js             ← E2E test runner config
├── tsconfig.json                    ← strict Astro TS preset
├── .nvmrc                           ← Node 22 version pin
│
├── public/
│   ├── favicon.svg
│   ├── peerjs.min.js                ← PeerJS 1.5.5 (local copy — `npm run vendor:peerjs`)
│   ├── qrcode.min.js                ← QRCode.js (local copy — no CDN)
│   ├── room.js                      ← shared: PeerJS host/guest, lobby, waiting room, redaction
│   ├── poker-logic.js               ← Hold'em rules engine (no DOM) — PokerLogic
│   ├── poker-game.js                ← Poker UI + host orchestration
│   ├── sevens-logic.js              ← Sevens rules engine (no DOM) — SevensLogic
│   └── sevens-game.js               ← Sevens UI + host orchestration
│
├── src/
│   ├── layouts/
│   │   └── Layout.astro             ← shared HTML shell, header, footer
│   ├── pages/
│   │   ├── index.astro              ← home / game-selection page
│   │   ├── poker/
│   │   │   └── index.astro          ← poker page: lobby + waiting room + table HTML
│   │   └── sevens/
│   │       └── index.astro          ← sevens page
│   └── styles/
│       └── global.css               ← CSS variables, buttons, cards, badges
│
├── tests/
│   ├── unit/                        ← Node unit tests for room.js and the rules engines
│   ├── peerjs-mock.js               ← BroadcastChannel-based PeerJS mock (no WebRTC)
│   ├── poker.spec.js                ← Playwright E2E tests — Poker
│   └── sevens.spec.js               ← Playwright E2E tests — Sevens
│
└── .github/
    └── workflows/
        └── deploy.yml               ← tests on every PR/push; build + deploy on main
```

### How the Code Is Split

Each game page loads five classic scripts in order: `peerjs.min.js`, `qrcode.min.js`, `room.js`, `<game>-logic.js`, `<game>-game.js`.

| File | Global | Responsibility |
|------|--------|----------------|
| `room.js` | `Room` | Everything shared by all games: creating/joining rooms, seat assignment, name checks, the waiting room, invite link + QR, sending each guest a redacted state, leaving. Games plug in with `Room.init(config)`. |
| `poker-logic.js` | `PokerLogic` | Pure Hold'em rules: deck, hand evaluation, blinds, betting rounds, action validation, side pots. No DOM, no timers — unit-tested in Node. |
| `poker-game.js` | — | Renders the table; on the host, applies actions via `PokerLogic`, schedules the next round and auto-folds disconnected players. |
| `sevens-logic.js` | `SevensLogic` | Pure Sevens rules: dealing, valid moves, turn order, finishing, redistributing a leaver's cards. |
| `sevens-game.js` | — | Renders the board and hand; host-side action handling. |

---

## 🛠️ Local Development

### Prerequisites

- **Node.js ≥ 22.12.0** — required by Astro 6 ([nvm](https://github.com/nvm-sh/nvm) recommended)
- **npm** — bundled with Node.js

```bash
# If using nvm:
nvm use       # reads .nvmrc and switches to Node 22
```

### Setup

```bash
git clone https://github.com/sagreenxyz/games.git
cd games
npm install
npm run dev
```

The dev server starts at **`http://localhost:4321/games/`** (note the `/games` base path).

### Build

```bash
npm run build    # outputs static files to dist/
npm run preview  # preview the build locally
```

### Environment Variables (build time)

| Variable | Default | Purpose |
|----------|---------|---------|
| `SITE_URL` | `https://sagreenxyz.github.io` | Canonical site URL for Astro |
| `BASE_PATH` | `/games` | URL base path (affects all links and asset URLs) |

```bash
SITE_URL=https://myfork.github.io BASE_PATH=/my-games npm run build
```

---

## 🧪 Testing

### Running Tests

```bash
npm test               # unit tests, then Playwright E2E tests
npm run test:unit      # rules-engine unit tests only (fast, no browser)
npm run test:e2e       # Playwright E2E tests (headless Chromium)
npm run test:ui        # open the Playwright interactive UI
npx playwright install chromium   # first time only
```

### Test Infrastructure

**Unit tests** (`tests/unit/*.test.mjs`, Node's built-in `node:test`) load the browser scripts into a `vm` sandbox and exercise the rules directly: hand rankings, blinds, betting order, action validation, all-in run-outs, side pots, Sevens move rules and players leaving. Each engine also has a seeded fuzz test that plays hundreds of random games and checks chips/cards are conserved and the game never stalls.

**E2E tests** use **Playwright** with a lightweight **BroadcastChannel-based PeerJS mock** that replaces WebRTC entirely. This makes tests deterministic and offline-capable.

```
tests/
├── unit/                # Node unit tests (rules engines + room redaction)
├── peerjs-mock.js       # Replaces window.Peer — BroadcastChannel as transport
├── poker.spec.js        # Playwright tests — Poker
└── sevens.spec.js       # Playwright tests — Sevens
```

**How the mock works:**  
Each test uses multiple pages within the **same browser context**. The mock intercepts `/games/peerjs.min.js` and serves a `window.Peer` replacement that uses `BroadcastChannel` to relay messages between pages in the same context — no network, no WebRTC. Ordering guarantees are preserved: the host's `connection` event fires before the guest's `open` event, matching real PeerJS behaviour.

**PEER_CONFIG override:**  
`room.js` reads `window.PEER_CONFIG` for PeerJS constructor options. Tests can set this before the page loads (via `page.addInitScript`) to point at a signalling server or override ICE servers.

### Writing New Tests

Follow the pattern in `tests/poker.spec.js`:
1. Use `context.newPage()` (not `browser.newContext()`) so pages share the same BroadcastChannel namespace.
2. Route `**/peerjs.min.js` to inject the mock script.
3. Use `page.locator('#turnIndicator')` to detect whose turn it is.
4. Inspect `page.locator('#potDisplay')`, `#currentBetDisplay`, `#roundLabel`, etc. to assert game state.

---

## 🚢 Deployment — GitHub Pages

Deployment is **automatic** via GitHub Actions (`.github/workflows/deploy.yml`).

Every pull request runs the unit and E2E tests. Every push to `main`:
1. **Test** — unit tests + Playwright E2E tests. Deployment stops here if anything fails.
2. **Build** — `npm ci && npm run build` → static files in `dist/`.
3. **Deploy** — uploads `dist/` to GitHub Pages.

### First-Time Setup

1. Repository Settings → **Pages** → Source: **GitHub Actions**.
2. Push to `main` — the workflow handles the rest.
3. Site appears at `https://<username>.github.io/<repo>/`.

---

## ➕ Adding a New Game

The project is designed to be extended with new games:

1. **Create the page** at `src/pages/<game-name>/index.astro` — copy `sevens/index.astro` (keep the lobby / waiting room element IDs that `room.js` uses).
2. **Write the rules** in `public/<game-name>-logic.js` — pure functions on a state object, no DOM. Return `{ ok, error }` from the action handler and reject anything illegal.
3. **Write the UI** in `public/<game-name>-game.js` and call `Room.init({...})` — see the config list at the top of `room.js`.
4. **Add a card** on `src/pages/index.astro` and a link in `src/layouts/Layout.astro`.
5. **Add tests**: unit tests in `tests/unit/` and an E2E spec in `tests/`.

---

## ⚠️ Limitations & Notes

| Topic | Note |
|-------|------|
| **No AI opponents** | The games require 2–4 real human players. If a player drops out of Poker they are folded and removed at the next hand; in Sevens their cards are dealt to the remaining players. |
| **Host-only authority** | All game logic runs in the host's browser. If the host disconnects, the session ends and players must create a new room. |
| **Trust model** | Guests only receive their own cards, and the host rejects illegal actions, so a guest can't peek or cheat from devtools. The **host's** browser deals and holds everything, though, so the host could. This is a casual game among friends — not suitable for real-money play. |
| **Restrictive networks** | No TURN relay is configured, so players behind strict NATs or some mobile/corporate networks may fail to connect. Add TURN servers via `window.PEER_CONFIG.config.iceServers` if needed. |
| **Mobile support** | The UI is responsive but best enjoyed on a tablet or desktop screen. |
| **Browser compatibility** | Requires a modern browser with WebRTC support (Chrome, Firefox, Edge, Safari 15+). |
| **PeerJS signalling** | If the PeerJS cloud is down, rooms cannot be created or joined. Self-host a PeerJS server and set `window.PEER_CONFIG` to work around this. |
| **Room persistence** | Rooms exist only while the host's browser is open. Closing the host tab ends the session. |

---

## 📄 License

MIT — free to use, modify, and share.
