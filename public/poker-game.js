/**
 * Poker Game — Texas Hold'em
 * Real-time multiplayer via PeerJS / WebRTC (no backend required)
 *
 * Architecture:
 *  - PeerJS creates a direct WebRTC data-channel between browsers
 *  - The "host" (first player) acts as the dealer:
 *      deals cards, advances phases, broadcasts state
 *  - Each player sees their own hand privately stored locally;
 *    opponents' hands are hidden until showdown
 *  - 2–4 human players required; no computer players
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
   Game state manager
───────────────────────────────────────────── */
// PeerJS instances (replaced Gun.js)
let peer = null;        // Our PeerJS Peer instance
let hostConn = null;    // Non-host client's DataConnection to the host peer
let peerConns = [];     // Host's DataConnections to all joined peers
/** Maps each DataConnection → the seat number it was assigned. Using a Map
 *  (rather than attaching a property to the connection object) makes the
 *  association explicit and avoids relying on object mutation. */
const connSeatMap = new Map();

let localState = null;      // full game state (only host writes/broadcasts this)
let myName = '';
let mySeat = -1;
let myRoomCode = '';
let amHost = false;
let disconnectedPlayerTimeout = null;

/** Current view: 'lobby' | 'waiting' | 'game' */
let view = 'lobby';

/**
 * PeerJS Peer constructor options.
 * Set window.PEER_CONFIG before this script loads to override defaults, e.g.:
 *   window.PEER_CONFIG = { host: 'my-peerjs-server.example.com', port: 9000, path: '/' };
 * Supported keys: host, port, path, secure, key, debug, config (ICE servers), etc.
 * Leave unset to use the PeerJS cloud signalling server (suitable for most use-cases).
 */
function peerConfig() {
  return window.PEER_CONFIG || {};
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

  mySeat = 0;
  amHost = true;
  el('lobbyError').textContent = 'Creating room…';
  tryOpenHostPeer();
}

/** Open a PeerJS peer using a random room code as the peer ID.
 *  Retries automatically on the rare unavailable-id collision. */
function tryOpenHostPeer() {
  myRoomCode = genCode();
  peer = new Peer(myRoomCode, peerConfig());

  peer.on('open', id => {
    myRoomCode = id;
    const initState = buildFreshRoomState(id);
    initState.players[0] = freshPlayer(myName);
    initState.hostSeat = 0;
    localState = initState;

    el('lobbyError').textContent = '';
    showView('waiting');
    el('displayRoomCode').textContent = id;
    el('tableRoomCode').textContent = id;
    setInviteLink(id);
    updateWaitingRoom(initState);
  });

  peer.on('connection', handleNewPeerConnection);

  peer.on('error', err => {
    if (err.type === 'unavailable-id') {
      // Extremely rare collision — try a fresh code
      peer.destroy();
      tryOpenHostPeer();
    } else {
      el('lobbyError').textContent = `Could not create room: ${err.type}`;
      peer.destroy();
      peer = null;
      amHost = false;
      mySeat = -1;
    }
  });
}

/** Build and display the shareable invite URL and QR code */
function setInviteLink(code) {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('room', code);
  const href = url.toString();
  const linkEl = el('inviteLink');
  if (linkEl) linkEl.textContent = href;
  // Store so copy-link button can use it
  el('btnCopyLink')?.setAttribute('data-href', href);
  // Render QR code so mobile users can scan to join
  const qrContainer = el('qrCodeContainer');
  if (qrContainer && typeof QRCode !== 'undefined') {
    qrContainer.replaceChildren();
    new QRCode(qrContainer, { text: href, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M });
  }
}

function joinRoom() {
  myName = (el('playerName')?.value || '').trim();
  const code = (el('roomCode')?.value || '').trim().toUpperCase();
  if (!myName) { el('lobbyError').textContent = 'Please enter your name.'; return; }
  if (code.length !== 6) { el('lobbyError').textContent = 'Room code must be 6 characters.'; return; }

  myRoomCode = code;
  amHost = false;
  el('lobbyError').textContent = 'Connecting…';

  // Create our own peer with a random ID, then connect to the host's peer (room code = peer ID).
  // PeerJS fires 'peer-unavailable' immediately if the host doesn't exist — no 7-second wait.
  peer = new Peer(peerConfig());

  peer.on('open', () => {
    hostConn = peer.connect(myRoomCode, { serialization: 'json', reliable: true });

    hostConn.on('open', () => {
      hostConn.send({ type: 'join', name: myName });
    });

    hostConn.on('data', handleHostMessage);

    hostConn.on('close', () => {
      if (view !== 'lobby') goToLobby();
    });

    hostConn.on('error', err => {
      el('lobbyError').textContent = `Connection error: ${err}`;
    });
  });

  peer.on('error', err => {
    if (err.type === 'peer-unavailable') {
      el('lobbyError').textContent = 'Room not found. Check the code.';
    } else {
      el('lobbyError').textContent = `Error: ${err.type}`;
    }
    peer.destroy();
    peer = null;
    myRoomCode = '';
  });
}

/* ─────────────────────────────────────────────
   State helpers
───────────────────────────────────────────── */
function buildFreshRoomState(code) {
  // Returns the full state object that is broadcast directly via PeerJS.
  return {
    roomCode: code,
    phase: 'waiting',       // waiting | pre-flop | flop | turn | river | showdown
    round: 0,
    dealer: 0,
    currentPlayer: -1,
    currentBet: 0,
    pot: 0,
    players: {},
    communityCards: [],
    deck: [],
    hostSeat: 0,
    lastAction: '',
    winnerInfo: '',
    updatedAt: Date.now(),
  };
}

function freshPlayer(name) {
  return {
    name,
    chips: STARTING_CHIPS,
    handJSON: JSON.stringify([]),
    bet: 0,
    folded: false,
    allIn: false,
    active: true,
    isEmpty: false,
    disconnected: false,
  };
}

/** Broadcast state to all connected peers (host only), update local state,
 *  and refresh the host's own UI so both paths (host action and peer action)
 *  always re-render without a separate onStateChange() call at each call-site. */
function pushState(gs) {
  localState = gs;
  if (amHost) {
    broadcastToPeers({ type: 'state', state: gs });
    onStateChange(gs);
  }
}

/* ─────────────────────────────────────────────
   PeerJS host: handle incoming peer connections
───────────────────────────────────────────── */
function handleNewPeerConnection(conn) {
  conn.on('data', msg => {
    if (msg.type === 'join') {
      if (!localState) { conn.send({ type: 'error', message: 'Room not ready.' }); conn.close(); return; }
      if (localState.phase !== 'waiting') {
        conn.send({ type: 'error', message: 'Game already in progress.' });
        conn.close(); return;
      }
      // Ignore duplicate join requests from an already-registered connection
      if (connSeatMap.has(conn)) return;
      const players = localState.players;
      // Reject if the requested name is already taken (case-insensitive)
      const nameTaken = Object.values(players).some(
        p => p && !p.isEmpty && p.name.toLowerCase() === msg.name.toLowerCase()
      );
      if (nameTaken) {
        conn.send({ type: 'error', message: `The name "${msg.name}" is already taken. Please choose a different name.` });
        conn.close(); return;
      }
      let seat = -1;
      for (let i = 0; i < MAX_PLAYERS; i++) {
        if (!players[i] || players[i].isEmpty) { seat = i; break; }
      }
      if (seat === -1) {
        conn.send({ type: 'error', message: 'Room is full (4 players).' });
        conn.close(); return;
      }
      connSeatMap.set(conn, seat);
      peerConns.push(conn);
      players[seat] = freshPlayer(msg.name);
      // Confirm seat + current state to new peer, then broadcast to existing peers
      conn.send({ type: 'joined', seat, state: localState });
      broadcastToPeers({ type: 'state', state: localState }, conn);
      onStateChange(localState);

    } else if (msg.type === 'action') {
      // Only apply the action if it comes from the peer that owns that seat
      const assignedSeat = connSeatMap.get(conn);
      if (localState && assignedSeat !== undefined && msg.seat === assignedSeat) {
        applyAction(localState, msg.seat, msg.action, msg.amount || 0);
      }

    } else if (msg.type === 'leave') {
      handlePeerDisconnect(conn);
    }
  });

  conn.on('close', () => handlePeerDisconnect(conn));
  conn.on('error', () => handlePeerDisconnect(conn));
}

function handlePeerDisconnect(conn) {
  peerConns = peerConns.filter(c => c !== conn);
  const seat = connSeatMap.get(conn);
  connSeatMap.delete(conn);
  if (!localState || seat === undefined) return;
  if (localState.phase === 'waiting') {
    delete localState.players[seat];
  } else if (localState.players[seat]) {
    localState.players[seat].disconnected = true;
  }
  broadcastToPeers({ type: 'state', state: localState });
  onStateChange(localState);
}

/** Send a message to all connected peers, optionally excluding one connection */
function broadcastToPeers(msg, excludeConn = null) {
  for (const conn of peerConns) {
    if (conn !== excludeConn) {
      try {
        if (conn.open) conn.send(msg);
      } catch (err) {
        console.warn('Failed to send to peer:', err);
      }
    }
  }
}

/* ─────────────────────────────────────────────
   PeerJS peer: handle messages from the host
───────────────────────────────────────────── */
function handleHostMessage(msg) {
  if (msg.type === 'joined') {
    mySeat = msg.seat;
    localState = msg.state;
    el('lobbyError').textContent = '';
    showView('waiting');
    el('displayRoomCode').textContent = myRoomCode;
    el('tableRoomCode').textContent = myRoomCode;
    setInviteLink(myRoomCode);
    updateWaitingRoom(localState);
  } else if (msg.type === 'state') {
    localState = msg.state;
    onStateChange(localState);
  } else if (msg.type === 'error') {
    el('lobbyError').textContent = msg.message;
    peer?.destroy();
    peer = null;
    hostConn = null;
    myRoomCode = '';
    mySeat = -1;
  }
}

/** Route player action: host applies directly; peer sends to host */
function playerAction(action, amount = 0) {
  if (!localState) return;
  if (amHost) {
    applyAction(localState, mySeat, action, amount);
    // The host's UI is refreshed inside pushState(), which applyAction() calls
    // for every code path, so no separate onStateChange() call is needed here.
  } else if (hostConn && hostConn.open) {
    hostConn.send({ type: 'action', seat: mySeat, action, amount });
  }
}

/* ─────────────────────────────────────────────
   State change handler
───────────────────────────────────────────── */

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
        <span style="color:rgba(255,255,255,.4);">Seat ${i + 1}: empty — waiting for a player to join</span>
      </div>`;
    }
  }
  setHTML('playerSlots', html);

  // Show start button only to host when at least 2 human players are present
  const humanCount = Object.values(players).filter(p => p && !p.isEmpty).length;
  if (amHost && humanCount >= 2) {
    show('btnStart');
    el('btnStart').disabled = false;
  } else {
    hide('btnStart');
  }
  setText('waitingMsg', amHost
    ? 'Need at least 2 players to start — share the invite link!'
    : 'Waiting for the host to start the game…');
}

/* ─────────────────────────────────────────────
   Game start (host only)
───────────────────────────────────────────── */
function startGame(gs) {
  if (!amHost) return;
  const players = gs.players || {};

  // Reset chips and bets for all seated human players
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!players[i] || players[i].isEmpty) continue;
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
  // onStateChange is triggered by pushState() above
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

  let sbSeat, bbSeat;
  if (seats.length === 2) {
    // Heads-up: dealer/button = SB (last in activeSeatOrder) and acts first pre-flop
    sbSeat = seats[1];
    bbSeat = seats[0];
  } else {
    // 3+ players: SB = first seat after dealer, BB = second seat after dealer
    sbSeat = seats[0];
    bbSeat = seats[1];
  }

  placeBet(gs, sbSeat, SMALL_BLIND);
  placeBet(gs, bbSeat, BIG_BLIND);
  gs.currentBet = BIG_BLIND;
  // Pre-flop: first to act is seat after BB (or SB for heads-up)
  if (seats.length === 2) {
    gs.currentPlayer = seats[1]; // SB/dealer acts first heads-up
  } else {
    gs.currentPlayer = seats[2 % seats.length]; // UTG: player after BB
  }
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
  // Remove disconnected players; refill chips for busted players
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = gs.players[i];
    if (!p) continue;
    if (p.disconnected) {
      delete gs.players[i];
      continue;
    }
    if (p.chips <= 0) p.chips = STARTING_CHIPS;
    p.bet = 0;
    p.folded = false;
    p.allIn = false;
    p.handJSON = JSON.stringify([]);
  }

  // Advance dealer to the next occupied seat
  let nextDealer = (gs.dealer + 1) % MAX_PLAYERS;
  let safety = MAX_PLAYERS;
  while (!gs.players[nextDealer] && safety-- > 0) {
    nextDealer = (nextDealer + 1) % MAX_PLAYERS;
  }
  gs.dealer = nextDealer;
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
   Host work scheduler (disconnected-player auto-fold)
───────────────────────────────────────────── */
function scheduleHostWork(gs) {
  if (!amHost) return;
  if (gs.phase === 'waiting' || gs.phase === 'showdown') return;

  const seat = gs.currentPlayer;
  if (seat === -1) return;
  const p = gs.players[seat];
  if (!p) return;

  // Auto-fold a disconnected player so the game can continue
  if (p.disconnected) {
    clearTimeout(disconnectedPlayerTimeout);
    disconnectedPlayerTimeout = setTimeout(() => {
      if (!localState || localState.phase === 'waiting' || localState.phase === 'showdown') return;
      if (localState.currentPlayer !== seat) return;
      applyAction(localState, seat, 'fold', 0);
    }, 1500);
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
    setText('myNameLabel', me.name);
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
    else if (p.disconnected) statusBadge = '<span class="badge badge-gray" style="font-size:.7rem;">Disconnected</span>';
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
    // Disable (but do not remove) the action buttons so they remain in the DOM
    // and can be re-enabled when the next round begins.
    ['btnFold', 'btnCheck', 'btnCall', 'btnRaise'].forEach(id => {
      const btn = el(id);
      if (btn) btn.disabled = true;
    });
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
    }
  } else {
    // Mark as disconnected so the host auto-folds this seat
    if (gs.players[mySeat]) {
      gs.players[mySeat].disconnected = true;
    }
  }

  if (amHost) {
    // Let peers know about the updated state before we disconnect
    broadcastToPeers({ type: 'state', state: gs });
  } else if (hostConn && hostConn.open) {
    hostConn.send({ type: 'leave' });
  }
  goToLobby();
}

function goToLobby() {
  clearTimeout(disconnectedPlayerTimeout);
  // Nullify state before destroying so async close-handlers are no-ops
  const p = peer;
  peer = null;
  hostConn = null;
  peerConns = [];
  connSeatMap.clear();
  mySeat = -1; myRoomCode = ''; amHost = false; localState = null;
  p?.destroy();
  showView('lobby');
}

/* ─────────────────────────────────────────────
   Utility
───────────────────────────────────────────── */
function safeParseJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─────────────────────────────────────────────
   Wire up DOM events
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
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
    setTimeout(() => { el('btnCopyCode').textContent = '📋 Copy code'; }, 2000);
  });
  el('btnCopyLink')?.addEventListener('click', () => {
    const href = el('btnCopyLink')?.getAttribute('data-href') || window.location.href;
    navigator.clipboard.writeText(href).catch(() => {});
    el('btnCopyLink').textContent = '✅ Copied';
    setTimeout(() => { el('btnCopyLink').textContent = '🔗 Copy link'; }, 2000);
  });

  // Game actions — routed via playerAction() so non-host peers send to host
  el('btnFold')?.addEventListener('click', () => playerAction('fold'));
  el('btnCheck')?.addEventListener('click', () => playerAction('check'));
  el('btnCall')?.addEventListener('click', () => playerAction('call'));
  el('btnRaise')?.addEventListener('click', () => {
    const amt = parseInt(el('raiseAmount')?.value || '0', 10);
    if (isNaN(amt) || amt <= 0) return;
    playerAction('raise', amt);
  });
  el('btnLeaveGame')?.addEventListener('click', () => {
    if (confirm('Drop out? You will be folded out of the current hand.')) leaveGame();
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
