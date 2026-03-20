/**
 * Poker Game — Texas Hold'em
 * Real-time multiplayer via Gun.js (no backend required)
 *
 * Architecture:
 *  - Gun.js syncs game state across all browsers in real time
 *  - The "host" (first player) acts as the dealer:
 *      deals cards, advances phases, plays AI turns
 *  - Each player sees their own hand privately stored locally;
 *    opponents' hands are hidden until showdown
 *  - AI players fill empty / dropped seats automatically
 */

/* ─────────────────────────────────────────────
   Constants & card utilities
───────────────────────────────────────────── */
const SUITS  = ['♠', '♥', '♦', '♣'];
const RANKS  = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const RED_SUITS = new Set(['♥', '♦']);
const MAX_PLAYERS = 4;
const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

const AI_NAMES = ['Atlas', 'Beacon', 'Cipher', 'Delphi'];

/** Build and shuffle a 52-card deck */
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Render a single card as HTML */
function cardHTML(card, faceDown = false) {
  if (faceDown) return `<div class="playing-card back" title="Hidden card"></div>`;
  const cls = RED_SUITS.has(card.s) ? 'red' : 'black';
  return `<div class="playing-card ${cls}">
    <span class="card-rank-top">${card.r}</span>
    <span class="card-suit-mid">${card.s}</span>
    <span class="card-rank-bot">${card.r}</span>
  </div>`;
}

/** Generate a random 6-character room code */
function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/* ─────────────────────────────────────────────
   Hand evaluation
───────────────────────────────────────────── */
function evalHand(cards) {
  if (!cards || cards.length < 5) return { rank: 0, name: 'High Card', score: 0 };
  // Choose best 5 from up to 7 cards
  const combos = choose(cards, 5);
  let best = null;
  for (const c of combos) {
    const h = score5(c);
    if (!best || h.score > best.score) best = h;
  }
  return best;
}

function choose(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === k) return [arr.slice()];
  const [first, ...rest] = arr;
  return [
    ...choose(rest, k - 1).map(c => [first, ...c]),
    ...choose(rest, k),
  ];
}

function score5(cards) {
  const vals = cards.map(c => RANK_VAL[c.r]).sort((a, b) => b - a);
  const suits = cards.map(c => c.s);
  const flush = suits.every(s => s === suits[0]);
  const straight = isStraight(vals);
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.values(counts).sort((a, b) => b - a);
  const topVal = vals[0];

  let rank, name;
  if (flush && straight && topVal === 14) { rank = 9; name = 'Royal Flush'; }
  else if (flush && straight)             { rank = 8; name = 'Straight Flush'; }
  else if (groups[0] === 4)               { rank = 7; name = 'Four of a Kind'; }
  else if (groups[0] === 3 && groups[1] === 2) { rank = 6; name = 'Full House'; }
  else if (flush)                         { rank = 5; name = 'Flush'; }
  else if (straight)                      { rank = 4; name = 'Straight'; }
  else if (groups[0] === 3)               { rank = 3; name = 'Three of a Kind'; }
  else if (groups[0] === 2 && groups[1] === 2) { rank = 2; name = 'Two Pair'; }
  else if (groups[0] === 2)               { rank = 1; name = 'One Pair'; }
  else                                    { rank = 0; name = 'High Card'; }

  // Tiebreak score: rank * 10^10 + sum of (val * positional weight)
  const score = rank * 1e10 + vals.reduce((acc, v, i) => acc + v * Math.pow(15, 4 - i), 0);
  return { rank, name, score, cards };
}

function isStraight(sortedVals) {
  if (sortedVals[0] - sortedVals[4] === 4 && new Set(sortedVals).size === 5) return true;
  // Wheel (A-2-3-4-5)
  if (sortedVals[0] === 14) {
    const low = [...sortedVals.slice(1), 1].sort((a, b) => b - a);
    return low[0] - low[4] === 4 && new Set(low).size === 5;
  }
  return false;
}

/* ─────────────────────────────────────────────
   AI decision engine
───────────────────────────────────────────── */
function aiDecide(gs, seatIndex) {
  const player = gs.players[seatIndex];
  const community = gs.communityCards || [];
  const hand = player.hand || [];
  const allCards = [...hand, ...community];
  const handVal = evalHand(allCards);
  const strength = handVal.rank / 9; // 0–1

  const toCall = Math.max(0, gs.currentBet - (player.bet || 0));
  const canCheck = toCall === 0;

  // Bluff chance
  const bluff = Math.random() < 0.12;
  const aggression = 0.3 + strength * 0.6;

  if (canCheck) {
    if (strength > 0.55 || (bluff && Math.random() < aggression)) {
      const raise = Math.min(
        player.chips,
        BIG_BLIND * (2 + Math.floor(Math.random() * 4))
      );
      if (raise >= BIG_BLIND && player.chips >= raise) return { action: 'raise', amount: raise };
    }
    return { action: 'check' };
  } else {
    if (strength < 0.2 && !bluff) return { action: 'fold' };
    if (strength > 0.6 && player.chips > toCall + BIG_BLIND) {
      const raise = Math.min(player.chips, toCall + BIG_BLIND * (1 + Math.floor(Math.random() * 3)));
      return { action: 'raise', amount: raise };
    }
    if (toCall <= player.chips) return { action: 'call' };
    return { action: 'fold' };
  }
}

/* ─────────────────────────────────────────────
   Game state manager
───────────────────────────────────────────── */
let gun;
let roomRef;
let localState = null;      // full game state (only host writes this)
let myName = '';
let mySeat = -1;
let myRoomCode = '';
let amHost = false;
let hostHeartbeatInterval = null;
let aiTurnTimeout = null;

/** Current view: 'lobby' | 'waiting' | 'game' */
let view = 'lobby';

/* ─────────────────────────────────────────────
   Gun.js initialisation
───────────────────────────────────────────── */
function initGun() {
  // Gun.js public relay peers for P2P state sync.
  // These are community-maintained free relays — no credentials required.
  // If all relays are unavailable, real-time sync won't work but the UI still loads.
  // To use your own relay, set window.GUN_PEERS before this script loads.
  const peers = window.GUN_PEERS || [
    'https://gun-manhattan.herokuapp.com/gun',
    'https://gunjs.herokuapp.com/gun',
    'https://gun-us.herokuapp.com/gun',
  ];
  gun = new window.Gun({ peers });
}

/* ─────────────────────────────────────────────
   DOM helpers
───────────────────────────────────────────── */
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
function el(id)   { return document.getElementById(id); }
function setHTML(id, html) { const e = el(id); if (e) e.innerHTML = html; }
function setText(id, txt)  { const e = el(id); if (e) e.textContent = txt; }

function showView(name) {
  ['lobby', 'waitingRoom', 'gameTable'].forEach(v => {
    document.getElementById(v === 'lobby' ? 'lobby' :
      v === 'waitingRoom' ? 'waitingRoom' : 'gameTable')?.classList.add('hidden');
  });
  show(name === 'lobby' ? 'lobby' :
       name === 'waiting' ? 'waitingRoom' : 'gameTable');
  view = name;
}

/* ─────────────────────────────────────────────
   Lobby actions
───────────────────────────────────────────── */
function createRoom() {
  myName = (el('playerName')?.value || '').trim();
  if (!myName) { el('lobbyError').textContent = 'Please enter your name.'; return; }

  myRoomCode = genCode();
  mySeat = 0;
  amHost = true;

  const initState = buildFreshRoomState(myRoomCode);
  initState.players[0] = freshPlayer(myName, false);
  initState.hostSeat = 0;

  roomRef = gun.get('games-v1').get(myRoomCode);
  pushState(initState);

  subscribeToRoom();
  showView('waiting');
  el('displayRoomCode').textContent = myRoomCode;
  el('tableRoomCode').textContent = myRoomCode;
  updateWaitingRoom(initState);
}

function joinRoom() {
  myName = (el('playerName')?.value || '').trim();
  const code = (el('roomCode')?.value || '').trim().toUpperCase();
  if (!myName) { el('lobbyError').textContent = 'Please enter your name.'; return; }
  if (code.length !== 6) { el('lobbyError').textContent = 'Room code must be 6 characters.'; return; }

  myRoomCode = code;
  roomRef = gun.get('games-v1').get(myRoomCode);
  el('lobbyError').textContent = 'Connecting…';

  // Read current state once to find an open seat
  roomRef.once(data => {
    if (!data || !data.phase) {
      el('lobbyError').textContent = 'Room not found. Check the code.';
      return;
    }
    if (data.phase !== 'waiting') {
      el('lobbyError').textContent = 'Game already in progress in that room.';
      return;
    }
    const players = JSON.parse(data.playersJSON || '{}');
    // Find first empty seat
    let seat = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (!players[i] || players[i].isEmpty) { seat = i; break; }
    }
    if (seat === -1) {
      el('lobbyError').textContent = 'Room is full (4 players).';
      return;
    }

    mySeat = seat;
    amHost = false;

    // Write ourselves into the seat
    players[seat] = freshPlayer(myName, false);
    data.playersJSON = JSON.stringify(players);
    roomRef.put(data);

    el('lobbyError').textContent = '';
    subscribeToRoom();
    showView('waiting');
    el('displayRoomCode').textContent = myRoomCode;
    el('tableRoomCode').textContent = myRoomCode;
  });
}

/* ─────────────────────────────────────────────
   State helpers
───────────────────────────────────────────── */
function buildFreshRoomState(code) {
  return {
    roomCode: code,
    phase: 'waiting',       // waiting | pre-flop | flop | turn | river | showdown
    round: 0,
    dealer: 0,
    currentPlayer: -1,
    currentBet: 0,
    pot: 0,
    playersJSON: JSON.stringify({}),
    communityJSON: JSON.stringify([]),
    deckJSON: JSON.stringify([]),
    hostSeat: 0,
    lastAction: '',
    winnerInfo: '',
    updatedAt: Date.now(),
  };
}

function freshPlayer(name, isAI) {
  return {
    name,
    chips: STARTING_CHIPS,
    handJSON: JSON.stringify([]),
    bet: 0,
    folded: false,
    allIn: false,
    active: true,
    isAI,
    isEmpty: false,
    disconnected: false,
  };
}

/** Push full state to Gun */
function pushState(gs) {
  if (!roomRef) return;
  localState = gs;
  const flat = {
    roomCode: gs.roomCode,
    phase: gs.phase,
    round: gs.round,
    dealer: gs.dealer,
    currentPlayer: gs.currentPlayer,
    currentBet: gs.currentBet,
    pot: gs.pot,
    playersJSON: JSON.stringify(gs.players),
    communityJSON: JSON.stringify(gs.communityCards),
    deckJSON: JSON.stringify(gs.deck),
    hostSeat: gs.hostSeat,
    lastAction: gs.lastAction || '',
    winnerInfo: gs.winnerInfo || '',
    updatedAt: Date.now(),
  };
  roomRef.put(flat);
}

/** Parse Gun flat data into usable state object */
function parseState(data) {
  if (!data) return null;
  return {
    roomCode:       data.roomCode,
    phase:          data.phase,
    round:          data.round || 0,
    dealer:         data.dealer || 0,
    currentPlayer:  data.currentPlayer,
    currentBet:     data.currentBet || 0,
    pot:            data.pot || 0,
    players:        safeParseJSON(data.playersJSON, {}),
    communityCards: safeParseJSON(data.communityJSON, []),
    deck:           safeParseJSON(data.deckJSON, []),
    hostSeat:       data.hostSeat || 0,
    lastAction:     data.lastAction || '',
    winnerInfo:     data.winnerInfo || '',
    updatedAt:      data.updatedAt || 0,
  };
}

function safeParseJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/* ─────────────────────────────────────────────
   Subscribe to room updates
───────────────────────────────────────────── */
function subscribeToRoom() {
  if (!roomRef) return;
  roomRef.on(data => {
    const gs = parseState(data);
    if (!gs) return;
    localState = gs;
    onStateChange(gs);
  });
}

function onStateChange(gs) {
  if (gs.phase === 'waiting') {
    updateWaitingRoom(gs);
    if (view !== 'waiting') showView('waiting');
  } else {
    if (view !== 'game') showView('game');
    renderGame(gs);
    // Host runs AI turns and phase transitions
    if (amHost) scheduleHostWork(gs);
  }
}

/* ─────────────────────────────────────────────
   Waiting room UI
───────────────────────────────────────────── */
function updateWaitingRoom(gs) {
  const players = gs.players || {};
  let html = '';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = players[i];
    if (p && !p.isEmpty) {
      const isSelf = (i === mySeat);
      const hostBadge = (i === gs.hostSeat) ? '<span class="badge badge-gold" style="margin-left:.5rem;">Host</span>' : '';
      const selfBadge = isSelf ? '<span class="badge badge-green" style="margin-left:.5rem;">You</span>' : '';
      html += `<div style="display:flex;align-items:center;gap:.5rem;background:rgba(0,0,0,.2);padding:.6rem .9rem;border-radius:8px;">
        <span>🧑 Seat ${i + 1}: <strong>${escHtml(p.name)}</strong></span>${hostBadge}${selfBadge}
      </div>`;
    } else {
      html += `<div style="display:flex;align-items:center;gap:.5rem;background:rgba(0,0,0,.1);padding:.6rem .9rem;border-radius:8px;opacity:.5;">
        <span style="color:rgba(255,255,255,.4);">Seat ${i + 1}: empty (AI will fill)</span>
      </div>`;
    }
  }
  setHTML('playerSlots', html);

  // Show start button only to host
  const humanCount = Object.values(players).filter(p => p && !p.isEmpty && !p.isAI).length;
  if (amHost && humanCount >= 1) {
    show('btnStart');
    el('btnStart').disabled = false;
  } else {
    hide('btnStart');
  }
  setText('waitingMsg', amHost
    ? 'Start whenever you\'re ready — AI fills remaining seats.'
    : 'Waiting for the host to start the game…');
}

/* ─────────────────────────────────────────────
   Game start (host only)
───────────────────────────────────────────── */
function startGame(gs) {
  if (!amHost) return;
  const players = gs.players || {};

  // Fill empty seats with AI
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!players[i] || players[i].isEmpty) {
      players[i] = freshPlayer(AI_NAMES[i], true);
    }
  }

  // Reset chips for continuing players (first game)
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!players[i].chips || players[i].chips <= 0) players[i].chips = STARTING_CHIPS;
    players[i].bet = 0;
    players[i].folded = false;
    players[i].allIn = false;
    players[i].handJSON = JSON.stringify([]);
  }

  const newGs = {
    ...gs,
    players,
    phase: 'pre-flop',
    round: (gs.round || 0) + 1,
    dealer: 0,
    communityCards: [],
    deck: makeDeck(),
    pot: 0,
    currentBet: 0,
    currentPlayer: -1,
    lastAction: '',
    winnerInfo: '',
  };

  dealHands(newGs);
  postBlinds(newGs);
  pushState(newGs);
}

function dealHands(gs) {
  // Deal 2 cards to each active player
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = gs.players[i];
    if (!p || !p.active) continue;
    const hand = [gs.deck.pop(), gs.deck.pop()];
    p.handJSON = JSON.stringify(hand);
    p.hand = hand;
  }
}

function postBlinds(gs) {
  const seats = activeSeatOrder(gs);
  if (seats.length < 2) return;
  const sbSeat = seats[1 % seats.length]; // seat after dealer
  const bbSeat = seats[2 % seats.length];

  placeBet(gs, sbSeat, SMALL_BLIND);
  placeBet(gs, bbSeat, BIG_BLIND);
  gs.currentBet = BIG_BLIND;
  // First to act after blinds
  gs.currentPlayer = seats[3 % seats.length] ?? seats[0];
}

function placeBet(gs, seat, amount) {
  const p = gs.players[seat];
  if (!p) return;
  const actual = Math.min(amount, p.chips);
  p.chips -= actual;
  p.bet = (p.bet || 0) + actual;
  gs.pot += actual;
  if (p.chips === 0) p.allIn = true;
}

/* ─────────────────────────────────────────────
   Phase advancement (host only)
───────────────────────────────────────────── */
function nextPhase(gs) {
  const order = { 'pre-flop': 'flop', flop: 'turn', turn: 'river', river: 'showdown' };
  const next = order[gs.phase];
  if (!next) return;

  // Reset bets for new street
  for (const p of Object.values(gs.players)) {
    if (p) p.bet = 0;
  }
  gs.currentBet = 0;
  gs.phase = next;

  if (next === 'flop') {
    gs.deck.pop(); // burn card (standard poker rule — discarded face-down before dealing)
    gs.communityCards.push(gs.deck.pop(), gs.deck.pop(), gs.deck.pop());
  } else if (next === 'turn' || next === 'river') {
    gs.deck.pop(); // burn card
    gs.communityCards.push(gs.deck.pop());
  } else if (next === 'showdown') {
    resolveShowdown(gs);
    return;
  }

  const active = activeSeatOrder(gs).filter(s => !gs.players[s].folded);
  gs.currentPlayer = active[0] ?? -1;
  pushState(gs);
}

function resolveShowdown(gs) {
  const active = Object.keys(gs.players)
    .map(Number)
    .filter(i => gs.players[i] && !gs.players[i].folded && gs.players[i].active);

  if (active.length === 0) { startNewRound(gs); return; }

  // Evaluate each active player
  let bestScore = -1;
  let winners = [];
  for (const seat of active) {
    const p = gs.players[seat];
    const hand = safeParseJSON(p.handJSON, []);
    const allCards = [...hand, ...gs.communityCards];
    const h = evalHand(allCards);
    if (h.score > bestScore) { bestScore = h.score; winners = [seat]; }
    else if (h.score === bestScore) winners.push(seat);
  }

  const share = Math.floor(gs.pot / winners.length);
  for (const w of winners) gs.players[w].chips += share;

  const winNames = winners.map(w => gs.players[w].name).join(' & ');
  const winHand = (() => {
    const p = gs.players[winners[0]];
    const hand = safeParseJSON(p.handJSON, []);
    return evalHand([...hand, ...gs.communityCards]).name;
  })();
  gs.winnerInfo = `🏆 ${winNames} wins ${gs.pot} chips with ${winHand}!`;
  gs.pot = 0;
  gs.phase = 'showdown';
  pushState(gs);

  // Start next round after delay
  setTimeout(() => {
    if (amHost && localState && localState.phase === 'showdown') {
      startNewRound(localState);
    }
  }, 5000);
}

function startNewRound(gs) {
  if (!amHost) return;
  // Remove busted players (replace with AI)
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = gs.players[i];
    if (!p) continue;
    if (p.chips <= 0 && !p.isAI) {
      // Give a small refill for demo purposes
      p.chips = STARTING_CHIPS;
    } else if (p.chips <= 0) {
      p.chips = STARTING_CHIPS; // refill AI
    }
    p.bet = 0;
    p.folded = false;
    p.allIn = false;
    p.handJSON = JSON.stringify([]);
  }

  gs.dealer = (gs.dealer + 1) % MAX_PLAYERS;
  gs.communityCards = [];
  gs.deck = makeDeck();
  gs.pot = 0;
  gs.currentBet = 0;
  gs.phase = 'pre-flop';
  gs.round = (gs.round || 0) + 1;
  gs.winnerInfo = '';
  gs.lastAction = '';

  dealHands(gs);
  postBlinds(gs);
  pushState(gs);
}

/* ─────────────────────────────────────────────
   Turn management
───────────────────────────────────────────── */
function activeSeatOrder(gs) {
  const seats = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const s = (gs.dealer + 1 + i) % MAX_PLAYERS;
    if (gs.players[s] && gs.players[s].active && !gs.players[s].folded) seats.push(s);
  }
  return seats;
}

/** Check if the current betting round is over */
function isBettingRoundOver(gs) {
  const active = Object.keys(gs.players)
    .map(Number)
    .filter(i => gs.players[i] && gs.players[i].active && !gs.players[i].folded && !gs.players[i].allIn);
  if (active.length <= 1) return true;
  // Everyone has matched currentBet
  return active.every(i => gs.players[i].bet === gs.currentBet);
}

function nextPlayer(gs) {
  const active = activeSeatOrder(gs).filter(s => !gs.players[s].folded && !gs.players[s].allIn);
  if (active.length === 0) return -1;
  const idx = active.indexOf(gs.currentPlayer);
  return active[(idx + 1) % active.length];
}

/* ─────────────────────────────────────────────
   Player action handler
───────────────────────────────────────────── */
function applyAction(gs, seat, action, amount = 0) {
  const p = gs.players[seat];
  if (!p) return;
  let label = '';

  switch (action) {
    case 'fold':
      p.folded = true;
      label = `${p.name} folds`;
      break;

    case 'check':
      label = `${p.name} checks`;
      break;

    case 'call': {
      const toCall = Math.max(0, gs.currentBet - p.bet);
      placeBet(gs, seat, toCall);
      label = `${p.name} calls ${toCall}`;
      break;
    }

    case 'raise': {
      const toCall = Math.max(0, gs.currentBet - p.bet);
      const total = toCall + amount;
      placeBet(gs, seat, total);
      gs.currentBet = p.bet;
      label = `${p.name} raises to ${gs.currentBet}`;
      // Other players' bets are already less than the new currentBet,
      // so isBettingRoundOver() will correctly require them to act again.
      break;
    }

    case 'allin': {
      const toCall = Math.max(0, gs.currentBet - p.bet);
      placeBet(gs, seat, p.chips);
      if (p.bet > gs.currentBet) gs.currentBet = p.bet;
      label = `${p.name} goes all-in!`;
      break;
    }
  }

  gs.lastAction = label;

  // Check if only one player remains
  const remaining = Object.keys(gs.players)
    .map(Number)
    .filter(i => gs.players[i] && gs.players[i].active && !gs.players[i].folded);

  if (remaining.length === 1) {
    // This player wins by default
    gs.players[remaining[0]].chips += gs.pot;
    gs.winnerInfo = `🏆 ${gs.players[remaining[0]].name} wins ${gs.pot} chips (everyone else folded)!`;
    gs.pot = 0;
    gs.phase = 'showdown';
    pushState(gs);
    setTimeout(() => {
      if (amHost && localState && localState.phase === 'showdown') startNewRound(localState);
    }, 4000);
    return;
  }

  // Advance to next player or next phase
  if (isBettingRoundOver(gs)) {
    if (gs.phase === 'river') {
      resolveShowdown(gs);
    } else {
      nextPhase(gs);
    }
  } else {
    gs.currentPlayer = nextPlayer(gs);
    pushState(gs);
  }
}

/* ─────────────────────────────────────────────
   Host work scheduler (AI turns, phase checks)
───────────────────────────────────────────── */
function scheduleHostWork(gs) {
  if (!amHost) return;
  if (gs.phase === 'waiting' || gs.phase === 'showdown') return;

  const seat = gs.currentPlayer;
  if (seat === -1) return;
  const p = gs.players[seat];
  if (!p) return;

  // If it's an AI or disconnected player's turn, handle it
  if (p.isAI || p.disconnected) {
    clearTimeout(aiTurnTimeout);
    aiTurnTimeout = setTimeout(() => {
      if (!localState || localState.phase === 'waiting' || localState.phase === 'showdown') return;
      if (localState.currentPlayer !== seat) return; // state changed
      const decision = aiDecide(localState, seat);
      applyAction(localState, seat, decision.action, decision.amount || 0);
    }, 1200 + Math.random() * 1000);
  }
}

/* ─────────────────────────────────────────────
   Render game state to DOM
───────────────────────────────────────────── */
function renderGame(gs) {
  const phase = gs.phase;
  const phaseLabels = {
    'pre-flop': 'Pre-Flop', flop: 'Flop', turn: 'Turn',
    river: 'River', showdown: 'Showdown'
  };

  setText('roundLabel', `Round ${gs.round}`);
  setText('phaseLabel', phaseLabels[phase] || phase);
  setText('potDisplay', gs.pot);
  setText('currentBetDisplay', gs.currentBet);

  // Community cards
  const cc = gs.communityCards || [];
  if (cc.length > 0) {
    setHTML('communityCards', cc.map(c => cardHTML(c)).join(''));
  } else {
    setHTML('communityCards', '<span style="color:rgba(255,255,255,.3);font-style:italic;">Cards will appear here</span>');
  }

  // My hand
  const me = gs.players[mySeat];
  if (me) {
    setText('myNameLabel', me.name + (me.isAI ? ' 🤖' : ''));
    setText('myChipsLabel', me.chips);
    const myHand = safeParseJSON(me.handJSON, []);
    if (myHand.length > 0) {
      setHTML('myCards', myHand.map(c => cardHTML(c)).join(''));
      // Show hand rank if we have community cards
      if (cc.length > 0) {
        const rank = evalHand([...myHand, ...cc]);
        setText('handRankDisplay', `Your hand: ${rank.name}`);
      }
    } else {
      setHTML('myCards', '<span style="color:rgba(255,255,255,.3);font-style:italic;">Your cards will appear here</span>');
    }

    // My status badge
    let badge = '';
    if (me.folded) badge = '<span class="badge badge-gray">Folded</span>';
    else if (me.allIn) badge = '<span class="badge badge-gold">All-In</span>';
    else if (gs.currentPlayer === mySeat) badge = '<span class="badge badge-green">Your Turn</span>';
    setHTML('myStatusBadge', badge);
  }

  // Opponents
  let oppHTML = '';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (i === mySeat) continue;
    const p = gs.players[i];
    if (!p) continue;
    const isActive = !p.folded && !p.disconnected;
    const isTurn = (i === gs.currentPlayer);
    const border = isTurn ? '2px solid var(--gold)' : '2px solid transparent';
    const hand = safeParseJSON(p.handJSON, []);
    const showCards = (phase === 'showdown' && !p.folded && hand.length > 0);

    let statusBadge = '';
    if (!p.active) statusBadge = '<span class="badge badge-gray" style="font-size:.7rem;">Out</span>';
    else if (p.isAI) statusBadge = '<span class="badge badge-gray" style="font-size:.7rem;">AI</span>';
    else if (p.disconnected) statusBadge = '<span class="badge badge-gray" style="font-size:.7rem;">AI (was ' + escHtml(p.name) + ')</span>';
    if (p.folded) statusBadge += '<span class="badge badge-gray" style="font-size:.7rem;margin-left:.25rem;">Folded</span>';
    if (isTurn) statusBadge += '<span class="badge badge-green" style="font-size:.7rem;margin-left:.25rem;">Turn</span>';

    const cardArea = showCards
      ? hand.map(c => cardHTML(c)).join('')
      : hand.length > 0 ? hand.map(() => cardHTML(null, true)).join('') : '';

    oppHTML += `<div style="background:rgba(0,0,0,.3);border-radius:var(--radius);padding:.9rem;border:${border};opacity:${isActive ? 1 : 0.5};">
      <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem;flex-wrap:wrap;">
        <strong>${escHtml(p.name)}</strong>
        ${statusBadge}
        <span class="chips" style="margin-left:auto;font-size:.85rem;">${p.chips}</span>
      </div>
      <div style="display:flex;gap:.3rem;flex-wrap:wrap;min-height:60px;align-items:center;">
        ${cardArea || '<span style="color:rgba(255,255,255,.2);font-size:.8rem;">—</span>'}
      </div>
      ${p.bet > 0 ? `<div style="font-size:.75rem;color:rgba(255,255,255,.5);margin-top:.3rem;">Bet: ${p.bet}</div>` : ''}
    </div>`;
  }
  setHTML('opponentsRow', oppHTML);

  // Action panel
  const isMyTurn = (gs.currentPlayer === mySeat);
  const myPlayer = gs.players[mySeat];
  const myFolded = myPlayer?.folded;
  const myAllIn = myPlayer?.allIn;

  if (gs.phase === 'showdown') {
    setHTML('turnIndicator', gs.winnerInfo
      ? `<span style="color:var(--gold);">${escHtml(gs.winnerInfo)}</span><br/><span style="font-size:.8rem;color:rgba(255,255,255,.4);">Next round starting soon…</span>`
      : '');
    setHTML('actionButtons', '');
  } else if (isMyTurn && !myFolded && !myAllIn) {
    const toCall = Math.max(0, gs.currentBet - (myPlayer?.bet || 0));
    const canCheck = toCall === 0;
    el('btnFold').disabled = false;
    el('btnCheck').disabled = !canCheck;
    el('btnCall').disabled = canCheck;
    el('btnRaise').disabled = false;
    el('btnCall').textContent = `Call ${toCall}`;
    const raiseMin = toCall + BIG_BLIND;
    el('raiseAmount').min = raiseMin;
    el('raiseAmount').value = raiseMin;
    setText('turnIndicator', '🟢 Your turn — choose an action');
  } else {
    el('btnFold').disabled = true;
    el('btnCheck').disabled = true;
    el('btnCall').disabled = true;
    el('btnRaise').disabled = true;
    if (myFolded) {
      setText('turnIndicator', 'You folded. Waiting for the round to end…');
    } else if (myAllIn) {
      setText('turnIndicator', 'You are all-in. Waiting for the hand to resolve…');
    } else {
      const cp = gs.players[gs.currentPlayer];
      setText('turnIndicator', cp ? `Waiting for ${cp.name}…` : 'Waiting…');
    }
  }

  setText('gameMessage', gs.lastAction || '');
}

/* ─────────────────────────────────────────────
   Leave / drop out
───────────────────────────────────────────── */
function leaveGame() {
  if (!localState || mySeat === -1) { goToLobby(); return; }
  const gs = localState;

  if (gs.phase === 'waiting') {
    // Remove from players list
    if (gs.players[mySeat]) {
      gs.players[mySeat] = { ...gs.players[mySeat], isEmpty: true, active: false };
      gs.playersJSON = JSON.stringify(gs.players);
      pushState(gs);
    }
  } else {
    // Mark as disconnected — AI takes over
    if (gs.players[mySeat]) {
      gs.players[mySeat].disconnected = true;
      gs.players[mySeat].isAI = true;
      pushState(gs);
    }
    // If we were host, transfer host to next human player
    if (amHost) transferHost(gs);
  }
  goToLobby();
}

function transferHost(gs) {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (i !== mySeat && gs.players[i] && !gs.players[i].isAI && !gs.players[i].disconnected) {
      gs.hostSeat = i;
      pushState(gs);
      return;
    }
  }
}

function goToLobby() {
  roomRef?.off();
  clearTimeout(aiTurnTimeout);
  clearInterval(hostHeartbeatInterval);
  mySeat = -1; myRoomCode = ''; amHost = false; localState = null; roomRef = null;
  showView('lobby');
}

/* ─────────────────────────────────────────────
   Utility
───────────────────────────────────────────── */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─────────────────────────────────────────────
   Wire up DOM events
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initGun();

  // Lobby
  el('btnNew')?.addEventListener('click', createRoom);
  el('btnJoin')?.addEventListener('click', () => {
    el('joinFields')?.classList.toggle('hidden');
  });
  el('btnJoinConfirm')?.addEventListener('click', joinRoom);
  el('roomCode')?.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  el('playerName')?.addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });

  // Waiting room
  el('btnStart')?.addEventListener('click', () => {
    if (localState) startGame(localState);
  });
  el('btnLeaveWaiting')?.addEventListener('click', leaveGame);
  el('btnCopyCode')?.addEventListener('click', () => {
    navigator.clipboard.writeText(myRoomCode).catch(() => {});
    el('btnCopyCode').textContent = '✅ Copied';
    setTimeout(() => { el('btnCopyCode').textContent = '📋 Copy'; }, 2000);
  });

  // Game actions
  el('btnFold')?.addEventListener('click', () => {
    if (localState) applyAction(localState, mySeat, 'fold');
  });
  el('btnCheck')?.addEventListener('click', () => {
    if (localState) applyAction(localState, mySeat, 'check');
  });
  el('btnCall')?.addEventListener('click', () => {
    if (localState) applyAction(localState, mySeat, 'call');
  });
  el('btnRaise')?.addEventListener('click', () => {
    if (!localState) return;
    const amt = parseInt(el('raiseAmount')?.value || '0', 10);
    if (isNaN(amt) || amt <= 0) return;
    applyAction(localState, mySeat, 'raise', amt);
  });
  el('btnLeaveGame')?.addEventListener('click', () => {
    if (confirm('Drop out? The computer will take over your seat.')) leaveGame();
  });

  // Check URL for room code (so users can share direct links)
  const params = new URLSearchParams(window.location.search);
  const urlCode = params.get('room');
  if (urlCode && urlCode.length === 6) {
    const rc = el('roomCode');
    if (rc) {
      rc.value = urlCode.toUpperCase();
      el('joinFields')?.classList.remove('hidden');
    }
  }
});
