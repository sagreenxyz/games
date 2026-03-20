# 🎮 Games Library

A **multiplayer browser games library** built with [Astro.build](https://astro.build) and hosted on [GitHub Pages](https://pages.github.com/). No login, no account, no downloads — just open a browser and play.

**Live site:** https://sagreenxyz.github.io/games/

---

## 🃏 Games Available

### Poker — Texas Hold'em

Classic Texas Hold'em poker for **2–4 human players**. AI opponents automatically fill any empty seats so the game always has 4 players at the table.

---

## ✨ Features at a Glance

| Feature | Details |
|---|---|
| **No login required** | Open to everyone — enter a display name and go |
| **Real-time multiplayer** | Powered by [Gun.js](https://gun.eco/) (P2P, no backend server needed) |
| **AI opponents** | Fill empty seats; take over if a player drops out mid-game |
| **Up to 4 players** | Any mix of humans + AI |
| **Shareable room codes** | 6-character code lets friends join from any device |
| **Drop out any time** | Computer takes your seat and keeps the game going |
| **First player is host** | Controls game-start and breaks any ties |
| **Chip management** | Each player starts with 1,000 chips; refill on bust |

---

## 🚀 How to Play

### Starting a Room

1. Navigate to **[Games Library → Poker](https://sagreenxyz.github.io/games/poker)**.
2. Enter your **display name** (up to 20 characters).
3. Click **✨ New Room**.
4. A 6-character **room code** is generated (e.g., `A3FZ7K`).
5. Share the room code with friends — they enter it on the same Poker page and click **🔗 Join Room**.
6. The host (first player) clicks **🃏 Start Game** when ready.

### Joining a Room

1. Go to the **Poker** page.
2. Enter your display name.
3. Click **🔗 Join Room** and enter the 6-character code.
4. Wait in the lobby until the host starts the game.

### During the Game

- **Fold** — discard your hand and sit out this round.
- **Check** — pass the action (only when no one has bet yet).
- **Call** — match the current bet.
- **Raise** — increase the bet (enter an amount in the input field).
- Buttons are enabled **only on your turn**.
- Other players' cards are hidden until **Showdown**.

### Dropping Out

Click **Drop Out** at any time. The computer will take over your seat and play on your behalf for the rest of the game. Your chips carry over to the AI.

### AI Players

- Empty seats at game-start are filled by AI (named *Atlas*, *Beacon*, *Cipher*, *Delphi*).
- The AI uses a **strength-based strategy** with a small bluffing probability.
- If you drop out, your seat becomes an AI seat immediately.
- The AI acts **1–2 seconds** after it becomes their turn (feels natural).

---

## ♠ Poker Rules (Texas Hold'em)

### Setup
- **4 players** per table (AI fills empty seats).
- Each player starts with **1,000 chips**.
- Blinds: Small blind **10**, Big blind **20**.

### Hand Flow

| Phase | Action |
|---|---|
| **Pre-Flop** | Each player is dealt 2 private cards. Blinds are posted. Betting begins. |
| **Flop** | 3 community cards are revealed face-up. Betting round. |
| **Turn** | 1 more community card revealed. Betting round. |
| **River** | Final community card revealed. Last betting round. |
| **Showdown** | Remaining players reveal hands. Best 5-card hand wins the pot. |

### Hand Rankings (highest → lowest)

1. **Royal Flush** — A K Q J 10 of the same suit
2. **Straight Flush** — Five sequential cards, same suit
3. **Four of a Kind** — Four cards of the same rank
4. **Full House** — Three of a kind + a pair
5. **Flush** — Five cards of the same suit (any order)
6. **Straight** — Five sequential cards (mixed suits)
7. **Three of a Kind** — Three cards of the same rank
8. **Two Pair** — Two different pairs
9. **One Pair** — Two cards of the same rank
10. **High Card** — None of the above; highest card wins

### Betting Actions

- **Fold** — forfeit your hand; lose any chips already in the pot.
- **Check** — pass (only allowed when the current bet is 0).
- **Call** — match the highest current bet.
- **Raise** — increase the bet by an amount ≥ the big blind (20).
- **All-In** — when you call or raise with all remaining chips.

### Winner Determination

- The player with the **best 5-card hand** (using any combo of their 2 hole cards + 5 community cards) wins the pot.
- In case of a **tie**, the pot is split equally.
- If all but one player folds, the remaining player wins without a showdown.

---

## 🏗️ Technical Architecture

### Stack

| Layer | Technology |
|---|---|
| **Site builder** | [Astro 6](https://astro.build) — static output |
| **Hosting** | GitHub Pages |
| **Real-time sync** | [Gun.js](https://gun.eco/) (P2P graph database via CDN) |
| **Game logic** | Vanilla JavaScript (`public/poker-game.js`) |
| **Styling** | Custom CSS (CSS variables, no framework) |
| **CI/CD** | GitHub Actions |

### How Real-Time Multiplayer Works

This app is **100% static** — no backend server. Real-time sync is provided by **Gun.js**, a decentralized, open-source graph database that works through public peer relays.

```
Browser A  ←──── Gun.js relay ────→  Browser B
   (host)        (public peer)        (player 2)
```

- When the host creates a room, the game state is written to Gun.js under a unique room code key.
- All players in the room subscribe to that key and receive updates in real time.
- The **host browser** is the authoritative dealer: it shuffles cards, deals hands, runs AI turns, and advances game phases.
- Each player's private hole cards are stored locally in Gun.js — opponents see face-down placeholders until showdown.

### Data Model

```
gun.get('games-v1').get('<ROOM_CODE>') → {
  phase:         'waiting' | 'pre-flop' | 'flop' | 'turn' | 'river' | 'showdown'
  round:         number
  dealer:        seat index (0–3)
  currentPlayer: seat index
  currentBet:    number
  pot:           number
  playersJSON:   JSON string of { [seat]: Player }
  communityJSON: JSON string of Card[]
  deckJSON:      JSON string of Card[]
  hostSeat:      seat index
  lastAction:    string (display message)
  winnerInfo:    string (showdown result)
}
```

### Host Responsibilities

- The **first player to create a room** is the host (tracked in `hostSeat`).
- The host's browser:
  - Shuffles and deals cards.
  - Posts blinds.
  - Executes AI player actions.
  - Advances game phases (flop, turn, river, showdown).
  - Starts new rounds after a 5-second delay.
- If the host drops out, the **next available human player** becomes host automatically.
- If no human players remain, AI controls itself (no synchronization needed as all AI logic runs in the last active browser).

### AI Strategy

The AI uses a simple heuristic:

1. **Hand strength** is computed from the current hand evaluation score (0 = high card, 9 = royal flush), normalized to 0–1.
2. **Bluff probability**: 12% chance of aggressive play regardless of hand strength.
3. **Decision rules**:
   - If can check and hand strength > 0.55 (or bluffing): raise.
   - If can check otherwise: check.
   - If must call and hand strength < 0.2 (not bluffing): fold.
   - If must call and hand strength > 0.6 and chips allow: raise.
   - Otherwise: call.

### File Structure

```
games/
├── astro.config.mjs          # Astro config (base: /games, output: static)
├── package.json
├── tsconfig.json
├── public/
│   ├── favicon.svg
│   └── poker-game.js         # All poker game logic (vanilla JS)
├── src/
│   ├── layouts/
│   │   └── Layout.astro      # Shared HTML shell + global CSS
│   ├── pages/
│   │   ├── index.astro       # Home — game selection
│   │   └── poker/
│   │       └── index.astro   # Poker page (lobby + game table HTML)
│   └── styles/
│       └── global.css        # CSS variables + component styles
└── .github/
    └── workflows/
        └── deploy.yml        # GitHub Actions: build + deploy to Pages
```

---

## 🛠️ Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm

### Setup

```bash
git clone https://github.com/sagreenxyz/games.git
cd games
npm install
npm run dev
```

The dev server starts at `http://localhost:4321/games/`.

### Build

```bash
npm run build
```

Output goes to `dist/`. Preview with:

```bash
npm run preview
```

---

## 🚢 Deployment (GitHub Pages)

Deployment is **automatic** via GitHub Actions (`.github/workflows/deploy.yml`).

Every push to `main` triggers:
1. **Build** — `npm run build` generates static files in `dist/`.
2. **Deploy** — `actions/deploy-pages` uploads the `dist/` folder to GitHub Pages.

### First-Time Setup

1. In your repository settings → **Pages** → set source to **GitHub Actions**.
2. Push to `main` — the workflow handles the rest.
3. The site becomes available at `https://<username>.github.io/<repo>/`.

### Configuring Gun.js Peers (optional)

By default, the app uses public Gun.js relay servers. To use your own relay, add a script **before** `poker-game.js` loads:

```html
<script>window.GUN_PEERS = ['https://your-gun-relay.example.com/gun'];</script>
```

Or set `SITE_URL` and `BASE_PATH` environment variables at build time to customise the deployment target:

```bash
SITE_URL=https://myfork.github.io BASE_PATH=/my-games npm run build
```

---

The architecture is designed to be extensible:

1. Create a new page at `src/pages/<game-name>/index.astro`.
2. Add the game card to `src/pages/index.astro`.
3. Write game logic in `public/<game-name>.js` (or as an Astro component with client JS).
4. Use Gun.js for real-time state if multiplayer is needed.

---

## ⚠️ Limitations & Notes

- **Trust-based system**: Because there is no backend, a technically savvy player could inspect the Gun.js data and see all card data. This is a demo/recreational game — not suitable for real-money play.
- **Relay server availability**: Gun.js uses public relay servers. If all relays are down, real-time sync won't work. The game falls back gracefully (players can still see their own local state).
- **Room persistence**: Game rooms persist in Gun.js relay storage for a period determined by the relay operators. Old room codes may eventually be reusable.
- **Mobile**: The game is responsive but best enjoyed on a tablet or desktop screen.

---

## 📄 License

MIT — free to use, modify, and share.
