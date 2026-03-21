# 🎮 Games Library

A **multiplayer browser games library** built with [Astro](https://astro.build) and hosted on [GitHub Pages](https://pages.github.com/). No login, no account, no downloads — open a browser and play.

**Live site:** https://sagreenxyz.github.io/games/

---

## Table of Contents

- [Games Available](#-games-available)
- [How to Play — Poker](#-how-to-play--texas-holdem-poker)
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
| **Raise** | Enter an amount ≥ 20 (the big blind) and click Raise |
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

A new round begins automatically ~5 seconds after showdown (4 seconds if someone wins by all others folding).

### Blind Structure

| | Amount |
|-|--------|
| Small Blind | 10 chips |
| Big Blind | 20 chips |
| Starting chips | 1,000 per player |
| Minimum raise | 20 chips (Big Blind) |

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
- **Split pots**: when two or more players tie, the pot is divided equally (any indivisible remainder chip is not awarded — a known minor limitation).

---

## 🏗 Technical Architecture

### Stack

| Layer | Technology |
|-------|------------|
| Site builder | [Astro 6](https://astro.build) — 100% static output |
| Hosting | GitHub Pages |
| Real-time P2P | [PeerJS 1.5.5](https://peerjs.com/) (WebRTC DataChannels) |
| Signalling | PeerJS cloud (default) — no server to run |
| Game logic | Vanilla JavaScript (`public/poker-game.js`, ~1,050 lines) |
| Styling | Custom CSS with CSS variables (`src/styles/global.css`) |
| QR codes | `qrcode.min.js` (local copy, no CDN) |
| Testing | [Playwright](https://playwright.dev/) + BroadcastChannel-based PeerJS mock |
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
3. The host maintains the single authoritative **game state object** and broadcasts a full copy to every peer after each action.
4. Guests send **action messages** (`fold`, `check`, `call`, `raise`, `allin`) to the host; the host validates and applies them.

### PeerJS Configuration

By default the game uses the PeerJS cloud signalling server. To override (e.g. for a self-hosted relay):

```html
<!-- Insert before poker-game.js loads -->
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

The host is the single source of truth. Every state change is broadcast in full to all peers:

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
  pot:           number,         // total chips in the pot
  communityCards: Card[],        // 0–5 cards; only host sends opponents full deck
  deck:          Card[],         // remaining deck (only host uses this)
  hostSeat:      number,         // seat index of the host player
  lastAction:    string,         // human-readable description of last action
  winnerInfo:    string,         // populated at showdown
  streetActed:   number[],       // seats that have voluntarily acted this street
  bbSeat:        number,         // big blind seat for current hand
  players: {
    [seat: 0|1|2|3]: {
      name:        string,
      chips:       number,
      handJSON:    string,       // JSON-encoded Card[] — private to each player
      bet:         number,       // amount bet this street
      folded:      boolean,
      allIn:       boolean,
      active:      boolean,      // false only if seat was vacated during waiting
      isEmpty:     boolean,      // true for empty/vacated seats
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
- Resolves showdowns and awards pots.
- Starts new rounds after a delay.
- Auto-folds disconnected players (1.5-second timeout then fold).
- Broadcasts full state to all peers after every change via `pushState()`.

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
│   ├── peerjs.min.js                ← PeerJS 1.5.5 (local copy — no CDN)
│   ├── qrcode.min.js                ← QRCode.js (local copy — no CDN)
│   └── poker-game.js                ← ALL poker game logic (~1,050 lines)
│
├── src/
│   ├── layouts/
│   │   └── Layout.astro             ← shared HTML shell, header, footer
│   ├── pages/
│   │   ├── index.astro              ← home / game-selection page
│   │   └── poker/
│   │       └── index.astro          ← poker page: lobby + waiting room + table HTML
│   └── styles/
│       └── global.css               ← CSS variables, buttons, cards, badges
│
├── tests/
│   ├── global-setup.js              ← starts local PeerJS server on port 9001
│   ├── global-teardown.js           ← shuts down local PeerJS server
│   ├── peerjs-mock.js               ← BroadcastChannel-based PeerJS mock (no WebRTC)
│   └── poker.spec.js                ← Playwright E2E tests (2-player scenarios)
│
└── .github/
    └── workflows/
        └── deploy.yml               ← build + deploy to GitHub Pages on push to main
```

### poker-game.js — Module Map

All game code is in a single vanilla-JS file, organised into clearly labelled sections:

| Section | Key symbols | Purpose |
|---------|-------------|---------|
| Constants & cards | `makeDeck`, `cardHTML` | Deck, card rendering |
| Hand evaluation | `evalHand`, `score5`, `isStraight` | Best-5-from-7 evaluator |
| State manager globals | `peer`, `hostConn`, `peerConns`, `connSeatMap`, `localState`, `mySeat`, `amHost` | Runtime state |
| DOM helpers | `show`, `hide`, `el`, `setHTML`, `setText`, `showView` | DOM manipulation |
| Lobby | `createRoom`, `joinRoom`, `tryOpenHostPeer` | Room creation and joining |
| State helpers | `buildFreshRoomState`, `freshPlayer`, `pushState` | Object factories |
| Host P2P | `handleNewPeerConnection`, `handlePeerDisconnect`, `broadcastToPeers` | Host-side peer management |
| Guest P2P | `handleHostMessage`, `playerAction` | Guest-side message handling |
| State change | `onStateChange` | Routes state updates to UI |
| Waiting room UI | `updateWaitingRoom` | Lobby player slot render |
| Game start | `startGame`, `dealHands`, `postBlinds`, `placeBet` | Hand setup |
| Phase control | `nextPhase`, `resolveShowdown`, `startNewRound` | Street & round lifecycle |
| Turn management | `activeSeatOrder`, `isBettingRoundOver`, `nextPlayer` | Action routing |
| Action handler | `applyAction` | Applies fold/check/call/raise/allin |
| Host scheduler | `scheduleHostWork` | Auto-folds disconnected players |
| Render | `renderGame` | Full game table DOM render |
| Leave/lobby | `leaveGame`, `goToLobby` | Clean disconnect |
| Utility | `safeParseJSON`, `escHtml` | Helpers |
| DOM events | `DOMContentLoaded` | Button wiring |

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
npm test          # run all Playwright E2E tests (headless Chromium)
npm run test:ui   # open the Playwright interactive UI
```

### Test Infrastructure

Tests use **Playwright** with a lightweight **BroadcastChannel-based PeerJS mock** that replaces WebRTC entirely. This makes tests deterministic and offline-capable.

```
tests/
├── global-setup.js      # Starts a local PeerJS server (port 9001) before tests
├── global-teardown.js   # Shuts it down after
├── peerjs-mock.js       # Replaces window.Peer — BroadcastChannel as transport
└── poker.spec.js        # Playwright tests
```

**How the mock works:**  
Each test uses multiple pages within the **same browser context**. The mock intercepts `/games/peerjs.min.js` and serves a `window.Peer` replacement that uses `BroadcastChannel` to relay messages between pages in the same context — no network, no WebRTC. Ordering guarantees are preserved: the host's `connection` event fires before the guest's `open` event, matching real PeerJS behaviour.

**PEER_CONFIG override:**  
`poker-game.js` reads `window.PEER_CONFIG` for PeerJS constructor options. Tests can set this before the page loads (via `page.addInitScript`) to point at the local signalling server or override ICE servers.

### Writing New Tests

Follow the pattern in `tests/poker.spec.js`:
1. Use `context.newPage()` (not `browser.newContext()`) so pages share the same BroadcastChannel namespace.
2. Route `**/peerjs.min.js` to inject the mock script.
3. Use `page.locator('#turnIndicator')` to detect whose turn it is.
4. Inspect `page.locator('#potDisplay')`, `#currentBetDisplay`, `#roundLabel`, etc. to assert game state.

---

## 🚢 Deployment — GitHub Pages

Deployment is **automatic** via GitHub Actions (`.github/workflows/deploy.yml`).

Every push to `main`:
1. **Build** — `npm ci && npm run build` → static files in `dist/`.
2. **Deploy** — uploads `dist/` to GitHub Pages.

### First-Time Setup

1. Repository Settings → **Pages** → Source: **GitHub Actions**.
2. Push to `main` — the workflow handles the rest.
3. Site appears at `https://<username>.github.io/<repo>/`.

---

## ➕ Adding a New Game

The project is designed to be extended with new games:

1. **Create the page** at `src/pages/<game-name>/index.astro` — use `poker/index.astro` as a template.
2. **Add game logic** to `public/<game-name>.js` (vanilla JS, no build step required).
3. **Add a card** on `src/pages/index.astro` — copy the existing Poker card block.
4. If your game needs real-time state: use PeerJS DataConnections following the same host-broadcasts-full-state pattern in `poker-game.js`.

---

## ⚠️ Limitations & Notes

| Topic | Note |
|-------|------|
| **No AI opponents** | The game requires 2–4 real human players. If a player drops out, their seat is vacated and the hand plays out with fewer players. |
| **Host-only authority** | All game logic runs in the host's browser. If the host disconnects, the session ends and players must create a new room. |
| **Trust model** | Because there is no backend, a player who inspects browser memory can see the full game state (including opponents' cards). This is a casual/demo game — not suitable for real-money play. |
| **Mobile support** | The UI is responsive but best enjoyed on a tablet or desktop screen. |
| **Browser compatibility** | Requires a modern browser with WebRTC support (Chrome, Firefox, Edge, Safari 15+). |
| **PeerJS signalling** | If the PeerJS cloud is down, rooms cannot be created or joined. Self-host a PeerJS server and set `window.PEER_CONFIG` to work around this. |
| **Room persistence** | Rooms exist only while the host's browser is open. Closing the host tab ends the session. |

---

## 📄 License

MIT — free to use, modify, and share.
