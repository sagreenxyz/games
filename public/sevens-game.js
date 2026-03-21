/**
 * Sevens — Fan Tan card game
 * Real-time multiplayer via PeerJS / WebRTC (no backend required)
 *
 * Rules:
 *  - All 52 cards are dealt among 2–4 players
 *  - The player holding 7♦ starts (plays it automatically on their first turn)
 *  - On each turn a player must play a valid card; they may only pass if they
 *    hold no valid card at all
 *  - Valid cards: any 7 (to start that suit's column), or a card that is
 *    exactly one rank higher/lower than the current played range for a suit
 *  - Ace is low (1) and King is high (13)
 *  - First player to empty their hand wins; play continues for remaining ranks
 *
 * Architecture: same host/peer pattern as the Poker game.
 *  - Host opens Peer(roomCode); guests connect to host's peer ID
 *  - Host owns and broadcasts all game state; guests send action messages
 */

/* ─────────────────────────────────────────────
   Constants
───────────────────────────────────────────── */
const SUITS_S   = ['♦', '♣', '♥', '♠']; // ♦ first so 7♦ opens the game
const RANKS_S   = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_VAL_S = Object.fromEntries(RANKS_S.map((r, i) => [r, i + 1])); // A=1 … K=13
const RED_SUITS_S = new Set(['♥', '♦']);
const MAX_PLAYERS_S = 4;

/* ─────────────────────────────────────────────
   PeerJS instances (same pattern as poker)
───────────────────────────────────────────── */
let peer    = null;
let hostConn = null;
let peerConns = [];
const connSeatMap = new Map();

let localState = null;
let myName     = '';
let mySeat     = -1;
let myRoomCode = '';
let amHost     = false;

/** Current view: 'lobby' | 'waiting' | 'game' */
let view = 'lobby';

function peerConfig() { return window.PEER_CONFIG || {}; }

/* ─────────────────────────────────────────────
   DOM helpers
───────────────────────────────────────────── */
function show(id)           { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id)           { document.getElementById(id)?.classList.add('hidden'); }
function el(id)             { return document.getElementById(id); }
function setHTML(id, html)  { const e = el(id); if (e) e.innerHTML = html; }
function setText(id, txt)   { const e = el(id); if (e) e.textContent = txt; }

function showView(name) {
  ['lobby', 'waitingRoom', 'gameTable'].forEach(s => {
    el(s === 'lobby' ? 'lobby' : s === 'waitingRoom' ? 'waitingRoom' : 'gameTable')
      ?.classList.add('hidden');
  });
  show(name === 'lobby' ? 'lobby' : name === 'waiting' ? 'waitingRoom' : 'gameTable');
  view = name;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeParseJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/* ─────────────────────────────────────────────
   Card utilities
───────────────────────────────────────────── */
function makeDeck() {
  const d = [];
  for (const s of SUITS_S) for (const r of RANKS_S) d.push({ r, s });
  // Fisher-Yates shuffle
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardHTML(card, opts = {}) {
  const { clickable = false, highlight = false, faceDown = false } = opts;
  if (faceDown) return `<div class="playing-card back"></div>`;
  const cls  = RED_SUITS_S.has(card.s) ? 'red' : 'black';
  const style = highlight
    ? 'cursor:pointer;outline:3px solid #40916c;outline-offset:2px;'
    : clickable ? 'cursor:not-allowed;opacity:.5;' : '';
  const dataAttr = clickable || highlight
    ? `data-rank="${escHtml(card.r)}" data-suit="${escHtml(card.s)}"` : '';
  return `<div class="playing-card ${cls}" ${dataAttr} style="${style}">
    <span class="card-rank-top">${card.r}</span>
    <span class="card-suit-mid">${card.s}</span>
    <span class="card-rank-bot">${card.r}</span>
  </div>`;
}

function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/* ─────────────────────────────────────────────
   Game logic helpers
───────────────────────────────────────────── */
/**
 * Returns the set of valid cards a player can play given the current board.
 * board[suit] is null if no card of that suit has been played yet, or
 * { min, max } (integer rank values 1–13) otherwise.
 */
function getValidMoves(board, hand) {
  return hand.filter(card => {
    const v = RANK_VAL_S[card.r];
    const col = board[card.s];
    if (col === null) return v === 7;      // suit not started → only 7 opens it
    return v === col.max + 1 || v === col.min - 1; // extend either end
  });
}

function applyCardToBoard(board, card) {
  const v = RANK_VAL_S[card.r];
  if (board[card.s] === null) {
    board[card.s] = { min: v, max: v };
  } else {
    if (v > board[card.s].max) board[card.s].max = v;
    if (v < board[card.s].min) board[card.s].min = v;
  }
}

/* ─────────────────────────────────────────────
   State helpers
───────────────────────────────────────────── */
function buildFreshRoomState(code) {
  const board = {};
  for (const s of SUITS_S) board[s] = null;
  return {
    roomCode:      code,
    phase:         'waiting',   // waiting | playing | finished
    round:         0,
    players:       {},
    board,
    currentPlayer: -1,
    hostSeat:      0,
    lastAction:    '',
    actionLog:     [],
    finishOrder:   [],          // seats in the order they emptied their hand
    updatedAt:     Date.now(),
  };
}

function freshPlayer(name) {
  return {
    name,
    handJSON:   JSON.stringify([]),
    active:     true,
    isEmpty:    false,
    disconnected: false,
    passCount:  0,
    finished:   false,
  };
}

/* ─────────────────────────────────────────────
   PeerJS: broadcast and push
───────────────────────────────────────────── */
function broadcastToPeers(msg, excludeConn = null) {
  for (const conn of peerConns) {
    if (conn !== excludeConn) {
      try { if (conn.open) conn.send(msg); } catch (err) { console.warn('Send failed:', err); }
    }
  }
}

function pushState(gs) {
  localState = gs;
  if (amHost) {
    broadcastToPeers({ type: 'state', state: gs });
    onStateChange(gs);
  }
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
    el('tableRoomCode').textContent   = id;
    setInviteLink(id);
    updateWaitingRoom(initState);
  });

  peer.on('connection', handleNewPeerConnection);

  peer.on('error', err => {
    if (err.type === 'unavailable-id') {
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

function setInviteLink(code) {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('room', code);
  const href = url.toString();
  const linkEl = el('inviteLink');
  if (linkEl) linkEl.textContent = href;
  el('btnCopyLink')?.setAttribute('data-href', href);
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

  peer = new Peer(peerConfig());
  peer.on('open', () => {
    hostConn = peer.connect(myRoomCode, { serialization: 'json', reliable: true });
    hostConn.on('open',  () => { hostConn.send({ type: 'join', name: myName }); });
    hostConn.on('data',  handleHostMessage);
    hostConn.on('close', () => { if (view !== 'lobby') goToLobby(); });
    hostConn.on('error', err => { el('lobbyError').textContent = `Connection error: ${err}`; });
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
   PeerJS host: handle incoming connections
───────────────────────────────────────────── */
function handleNewPeerConnection(conn) {
  conn.on('data', msg => {
    if (msg.type === 'join') {
      if (!localState) { conn.send({ type: 'error', message: 'Room not ready.' }); conn.close(); return; }
      if (localState.phase !== 'waiting') {
        conn.send({ type: 'error', message: 'Game already in progress.' });
        conn.close(); return;
      }
      if (connSeatMap.has(conn)) return;

      const players = localState.players;
      const nameTaken = Object.values(players).some(
        p => p && !p.isEmpty && p.name.toLowerCase() === msg.name.toLowerCase()
      );
      if (nameTaken) {
        conn.send({ type: 'error', message: `The name "${msg.name}" is already taken.` });
        conn.close(); return;
      }
      let seat = -1;
      for (let i = 0; i < MAX_PLAYERS_S; i++) {
        if (!players[i] || players[i].isEmpty) { seat = i; break; }
      }
      if (seat === -1) {
        conn.send({ type: 'error', message: 'Room is full (4 players).' });
        conn.close(); return;
      }
      connSeatMap.set(conn, seat);
      peerConns.push(conn);
      players[seat] = freshPlayer(msg.name);
      conn.send({ type: 'joined', seat, state: localState });
      broadcastToPeers({ type: 'state', state: localState }, conn);
      onStateChange(localState);

    } else if (msg.type === 'action') {
      const assignedSeat = connSeatMap.get(conn);
      if (localState && assignedSeat !== undefined && msg.seat === assignedSeat) {
        applyAction(localState, msg.seat, msg.action, msg.card || null);
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

/* ─────────────────────────────────────────────
   PeerJS peer: handle messages from host
───────────────────────────────────────────── */
function handleHostMessage(msg) {
  if (msg.type === 'joined') {
    mySeat = msg.seat;
    localState = msg.state;
    el('lobbyError').textContent = '';
    showView('waiting');
    el('displayRoomCode').textContent = myRoomCode;
    el('tableRoomCode').textContent   = myRoomCode;
    setInviteLink(myRoomCode);
    updateWaitingRoom(localState);
  } else if (msg.type === 'state') {
    localState = msg.state;
    onStateChange(localState);
  } else if (msg.type === 'error') {
    el('lobbyError').textContent = msg.message;
    peer?.destroy();
    peer = null; hostConn = null; myRoomCode = ''; mySeat = -1;
  }
}

function playerAction(action, card = null) {
  if (!localState) return;
  if (amHost) {
    applyAction(localState, mySeat, action, card);
  } else if (hostConn && hostConn.open) {
    hostConn.send({ type: 'action', seat: mySeat, action, card });
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
    if (amHost) scheduleHostWork(gs);
  }
}

/* ─────────────────────────────────────────────
   Waiting room UI
───────────────────────────────────────────── */
function updateWaitingRoom(gs) {
  const players = gs.players || {};
  let html = '';
  for (let i = 0; i < MAX_PLAYERS_S; i++) {
    const p = players[i];
    if (p && !p.isEmpty) {
      const hostBadge = (i === gs.hostSeat) ? '<span class="badge badge-gold" style="margin-left:.5rem;">Host</span>' : '';
      const selfBadge = (i === mySeat)       ? '<span class="badge badge-green" style="margin-left:.5rem;">You</span>' : '';
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
  const seats = Object.keys(players).map(Number).filter(i => players[i] && !players[i].isEmpty);
  if (seats.length < 2) return;

  // Reset board
  const board = {};
  for (const s of SUITS_S) board[s] = null;

  // Deal cards
  const deck = makeDeck();
  for (const s of seats) {
    players[s].handJSON  = JSON.stringify([]);
    players[s].passCount = 0;
    players[s].finished  = false;
    players[s].active    = true;
  }
  let idx = 0;
  for (const card of deck) {
    players[seats[idx % seats.length]].handJSON = JSON.stringify(
      [...safeParseJSON(players[seats[idx % seats.length]].handJSON, []), card]
    );
    idx++;
  }

  // Find the player holding 7♦ — guaranteed to exist since all 52 cards are dealt.
  // startSeat falls back to seats[0] if somehow not found (defensive default).
  let startSeat = seats[0];
  for (const s of seats) {
    const hand = safeParseJSON(players[s].handJSON, []);
    if (hand.some(c => c.r === '7' && c.s === '♦')) { startSeat = s; break; }
  }

  const newGs = {
    ...gs,
    players,
    board,
    phase:         'playing',
    round:         (gs.round || 0) + 1,
    currentPlayer: startSeat,
    lastAction:    '',
    actionLog:     [`--- Round ${(gs.round || 0) + 1} ---`],
    finishOrder:   [],
    updatedAt:     Date.now(),
  };

  pushState(newGs);
}

/* ─────────────────────────────────────────────
   Action handler (host only)
───────────────────────────────────────────── */
function applyAction(gs, seat, action, card) {
  const p = gs.players[seat];
  if (!p || p.finished) return;

  gs.actionLog ??= [];
  let label = '';

  if (action === 'play' && card) {
    const hand = safeParseJSON(p.handJSON, []);
    const cardIdx = hand.findIndex(c => c.r === card.r && c.s === card.s);
    if (cardIdx === -1) return; // card not in hand — ignore
    const valid = getValidMoves(gs.board, hand);
    if (!valid.some(c => c.r === card.r && c.s === card.s)) return; // invalid move

    hand.splice(cardIdx, 1);
    p.handJSON = JSON.stringify(hand);
    applyCardToBoard(gs.board, card);
    label = `${p.name} plays ${card.r}${card.s}`;

    if (hand.length === 0) {
      p.finished = true;
      gs.finishOrder = [...(gs.finishOrder || []), seat];
      label += ' 🎉 (hand empty!)';
    }
  } else if (action === 'pass') {
    const hand = safeParseJSON(p.handJSON, []);
    const valid = getValidMoves(gs.board, hand);
    if (valid.length > 0) return; // must play if possible
    p.passCount = (p.passCount || 0) + 1;
    label = `${p.name} passes`;
  } else {
    return;
  }

  gs.lastAction = label;
  if (label) gs.actionLog.push(label);

  // Check if game is over: all non-finished players have empty hands
  const activeSeatsList = Object.keys(gs.players).map(Number)
    .filter(i => gs.players[i] && !gs.players[i].isEmpty && !gs.players[i].disconnected);
  const remaining = activeSeatsList.filter(i => !gs.players[i].finished);

  if (remaining.length <= 1) {
    // Game over — record the last finisher too
    if (remaining.length === 1) {
      gs.finishOrder = [...(gs.finishOrder || []), remaining[0]];
      gs.players[remaining[0]].finished = true;
    }
    gs.phase = 'finished';
    const resultLines = (gs.finishOrder || []).map((s, i) => {
      const medals = ['🥇', '🥈', '🥉'];
      return `${medals[i] || `${i + 1}.`} ${gs.players[s]?.name || `Seat ${s + 1}`}`;
    });
    gs.actionLog.push('--- Game Over ---');
    gs.actionLog.push(...resultLines);
    gs.lastAction = `Game over! Winner: ${gs.players[gs.finishOrder[0]]?.name}`;
    pushState(gs);
    return;
  }

  // Advance to next player
  gs.currentPlayer = nextActiveSeat(gs, seat);
  gs.updatedAt = Date.now();
  pushState(gs);
}

function nextActiveSeat(gs, fromSeat) {
  const seats = Object.keys(gs.players).map(Number)
    .filter(i => gs.players[i] && !gs.players[i].isEmpty && !gs.players[i].disconnected && !gs.players[i].finished)
    .sort((a, b) => a - b);
  if (seats.length === 0) return -1;
  const idx = seats.indexOf(fromSeat);
  return seats[(idx + 1) % seats.length];
}

/* ─────────────────────────────────────────────
   Host work scheduler (auto-pass disconnected players)
───────────────────────────────────────────── */
let disconnectedPlayerTimeout = null;

function scheduleHostWork(gs) {
  if (!amHost || gs.phase !== 'playing') return;
  const seat = gs.currentPlayer;
  if (seat === -1) return;
  const p = gs.players[seat];
  if (!p || !p.disconnected) return;

  clearTimeout(disconnectedPlayerTimeout);
  disconnectedPlayerTimeout = setTimeout(() => {
    if (!localState || localState.phase !== 'playing') return;
    if (localState.currentPlayer !== seat) return;
    applyAction(localState, seat, 'pass', null);
  }, 1500);
}

/* ─────────────────────────────────────────────
   Game over modal
───────────────────────────────────────────── */
function showGameOverModal(gs) {
  const order = gs.finishOrder || [];
  const medals = ['🥇', '🥈', '🥉', '4th'];
  let html = order.map((s, i) => {
    const p = gs.players[s];
    return `<div style="margin:.3rem 0;">${medals[i] || `${i + 1}.`} <strong>${escHtml(p?.name || '')}</strong>${p?.passCount ? ` — passed ${p.passCount}×` : ''}</div>`;
  }).join('');
  setHTML('gameOverResults', html || '<div>No results recorded.</div>');
  if (amHost) {
    show('btnPlayAgain');
    hide('gameOverGuestMsg');
  } else {
    hide('btnPlayAgain');
    show('gameOverGuestMsg');
  }
  el('gameOverModal')?.classList.remove('hidden');
}

function hideGameOverModal() {
  el('gameOverModal')?.classList.add('hidden');
}

/* ─────────────────────────────────────────────
   Render action log
───────────────────────────────────────────── */
function renderActionLog(gs) {
  const list = el('actionLogList');
  if (!list) return;
  const log = gs.actionLog || [];
  if (log.length === 0) {
    list.innerHTML = '<span style="color:rgba(255,255,255,.3);font-style:italic;">Actions will appear here</span>';
    return;
  }
  list.innerHTML = [...log].reverse().map(item => {
    const isSep     = item.startsWith('---');
    const isWinner  = item.startsWith('🥇') || item.startsWith('Game over');
    if (isSep) {
      return `<div style="text-align:center;color:rgba(255,255,255,.45);font-size:.72rem;padding:.2rem 0;border-top:1px solid rgba(255,255,255,.1);margin:.2rem 0;">${escHtml(item)}</div>`;
    }
    return `<div style="color:${isWinner ? 'var(--gold)' : 'rgba(255,255,255,.8)'};padding:.1rem 0;${isWinner ? 'font-weight:600;' : ''}">${escHtml(item)}</div>`;
  }).join('');
}

/* ─────────────────────────────────────────────
   Render board
───────────────────────────────────────────── */
function renderBoard(board) {
  const rows = SUITS_S.map(suit => {
    const col = board[suit];
    const isRed = RED_SUITS_S.has(suit);
    const colorStyle = isRed ? 'color:var(--red)' : 'color:var(--black)';

    let cells = '';
    for (const rank of RANKS_S) {
      const val = RANK_VAL_S[rank];
      const played = col !== null && val >= col.min && val <= col.max;
      const is7    = val === 7;
      const bg     = played
        ? (is7 ? 'background:var(--gold);color:var(--black);font-weight:700;' : 'background:var(--card-bg);')
        : 'background:rgba(255,255,255,.08);color:rgba(255,255,255,.3);';
      cells += `<div style="display:inline-flex;align-items:center;justify-content:center;
        width:36px;height:50px;border-radius:5px;font-size:.8rem;font-weight:600;
        border:1px solid rgba(255,255,255,.15);${bg}${played && !is7 ? colorStyle : ''}">
        ${rank}
      </div>`;
    }
    return `<div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;">
      <span style="width:1.8rem;font-size:1.2rem;${isRed ? 'color:var(--red)' : 'color:#fff'}">${suit}</span>
      <div style="display:flex;gap:.25rem;flex-wrap:wrap;">${cells}</div>
    </div>`;
  }).join('');
  setHTML('boardRows', rows);
}

/* ─────────────────────────────────────────────
   Render full game state
───────────────────────────────────────────── */
function renderGame(gs) {
  renderBoard(gs.board);

  // Round / turn indicator
  setText('roundLabel', `Round ${gs.round}`);

  const isFinished = gs.phase === 'finished';

  if (isFinished) {
    setText('turnIndicator', `Game over! Winner: ${gs.players[gs.finishOrder?.[0]]?.name || ''}`);
    if (el('gameOverModal')?.classList.contains('hidden')) {
      showGameOverModal(gs);
    }
  } else {
    hideGameOverModal();
    const cp = gs.players[gs.currentPlayer];
    const isMyTurn = gs.currentPlayer === mySeat;
    setText('turnIndicator', isMyTurn ? '🟢 Your turn!' : `Waiting for ${cp?.name || '…'}…`);
  }

  // My hand
  const me = gs.players[mySeat];
  if (me) {
    setText('myNameLabel', me.name);
    const myHand = safeParseJSON(me.handJSON, []);
    const validMoves = isFinished ? [] : getValidMoves(gs.board, myHand);
    const isMyTurn   = gs.currentPlayer === mySeat;

    // Status badge
    let badge = '';
    if (me.finished)          badge = '<span class="badge badge-gold">Finished</span>';
    else if (isMyTurn)        badge = '<span class="badge badge-green">Your Turn</span>';
    else if (me.disconnected) badge = '<span class="badge badge-gray">Disconnected</span>';
    setHTML('myStatusBadge', badge);
    setText('myCardCount', `${myHand.length} card${myHand.length !== 1 ? 's' : ''}`);

    if (myHand.length > 0) {
      setHTML('myCards', myHand.map(card => {
        const isValid = validMoves.some(v => v.r === card.r && v.s === card.s);
        const clickable = isMyTurn && !isFinished;
        return cardHTML(card, { clickable, highlight: clickable && isValid });
      }).join(''));
    } else {
      setHTML('myCards', '<span style="color:rgba(255,255,255,.3);font-style:italic;">No cards — you\'re done!</span>');
    }

    // Pass button
    const canPass   = isMyTurn && !isFinished && validMoves.length === 0;
    const mustPlay  = isMyTurn && !isFinished && validMoves.length > 0;
    el('btnPass').disabled = !canPass;
    setText('actionMessage', isFinished
      ? (gs.lastAction || '')
      : isMyTurn
        ? mustPlay ? 'Click a highlighted card to play it.' : 'No valid moves — click Pass.'
        : (gs.players[gs.currentPlayer]
          ? `Waiting for ${escHtml(gs.players[gs.currentPlayer].name)}…`
          : ''));
  }

  // Opponents
  let oppHTML = '';
  for (let i = 0; i < MAX_PLAYERS_S; i++) {
    if (i === mySeat) continue;
    const p = gs.players[i];
    if (!p || p.isEmpty) continue;
    const hand      = safeParseJSON(p.handJSON, []);
    const isTurn    = (i === gs.currentPlayer);
    const border    = isTurn ? '2px solid var(--gold)' : '2px solid transparent';
    const isActive  = !p.disconnected && !p.finished;

    let statusBadge = '';
    if (p.finished)    statusBadge = '<span class="badge badge-gold" style="font-size:.7rem;">Finished</span>';
    if (p.disconnected) statusBadge += '<span class="badge badge-gray" style="font-size:.7rem;margin-left:.25rem;">Disconnected</span>';
    if (isTurn)        statusBadge += '<span class="badge badge-green" style="font-size:.7rem;margin-left:.25rem;">Turn</span>';

    oppHTML += `<div style="background:rgba(0,0,0,.3);border-radius:var(--radius);padding:.9rem;border:${border};opacity:${isActive ? 1 : 0.6};">
      <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem;flex-wrap:wrap;">
        <strong>${escHtml(p.name)}</strong>${statusBadge}
        <span style="margin-left:auto;font-size:.85rem;color:rgba(255,255,255,.6);">${hand.length} 🃏</span>
      </div>
      <div style="display:flex;gap:.3rem;flex-wrap:wrap;min-height:30px;align-items:center;">
        ${hand.map(() => cardHTML(null, { faceDown: true })).slice(0, 5).join('')}
        ${hand.length > 5 ? `<span style="color:rgba(255,255,255,.4);font-size:.8rem;">+${hand.length - 5}</span>` : ''}
      </div>
      ${p.passCount ? `<div style="font-size:.75rem;color:rgba(255,255,255,.4);margin-top:.3rem;">Passed: ${p.passCount}×</div>` : ''}
    </div>`;
  }
  setHTML('opponentsRow', oppHTML);

  renderActionLog(gs);
}

/* ─────────────────────────────────────────────
   Leave / go to lobby
───────────────────────────────────────────── */
function leaveGame() {
  if (localState && mySeat !== -1 && localState.players[mySeat]) {
    if (amHost) {
      broadcastToPeers({ type: 'state', state: localState });
    } else if (hostConn?.open) {
      hostConn.send({ type: 'leave' });
    }
  }
  goToLobby();
}

function goToLobby() {
  clearTimeout(disconnectedPlayerTimeout);
  hideGameOverModal();
  const p = peer;
  peer = null; hostConn = null; peerConns = []; connSeatMap.clear();
  mySeat = -1; myRoomCode = ''; amHost = false; localState = null;
  p?.destroy();
  // Restore full lobby UI (in case we hid elements for a ?room= direct link)
  show('btnNew');
  show('btnJoin');
  el('joinFields')?.classList.add('hidden');
  if (el('lobbyError')) el('lobbyError').textContent = '';
  if (window.location.search) {
    history.replaceState({}, '', window.location.pathname);
  }
  showView('lobby');
}

/* ─────────────────────────────────────────────
   Wire up DOM events
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Lobby
  el('btnNew')?.addEventListener('click', createRoom);
  el('btnJoin')?.addEventListener('click', () => { el('joinFields')?.classList.toggle('hidden'); });
  el('btnJoinConfirm')?.addEventListener('click', joinRoom);
  el('roomCode')?.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  el('playerName')?.addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });

  // Waiting room
  el('btnStart')?.addEventListener('click', () => { if (localState) startGame(localState); });
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

  // Card clicks (play a card from hand)
  el('myCards')?.addEventListener('click', e => {
    const card = e.target.closest('[data-rank][data-suit]');
    if (!card) return;
    if (!localState || localState.currentPlayer !== mySeat) return;
    const c = { r: card.dataset.rank, s: card.dataset.suit };
    const hand  = safeParseJSON(localState.players[mySeat]?.handJSON, []);
    const valid = getValidMoves(localState.board, hand);
    if (!valid.some(v => v.r === c.r && v.s === c.s)) return;
    playerAction('play', c);
  });

  // Pass
  el('btnPass')?.addEventListener('click', () => { playerAction('pass', null); });

  // Leave game
  el('btnLeaveGame')?.addEventListener('click', () => {
    if (confirm('Leave the game?')) leaveGame();
  });

  // Game over modal
  el('btnPlayAgain')?.addEventListener('click', () => {
    if (!amHost || !localState) return;
    hideGameOverModal();
    // Reset to waiting phase so host can start a new game
    const gs = { ...localState, phase: 'waiting' };
    // Clear hands and reset player state
    for (const seat of Object.keys(gs.players).map(Number)) {
      if (gs.players[seat] && !gs.players[seat].isEmpty) {
        gs.players[seat].handJSON  = JSON.stringify([]);
        gs.players[seat].finished  = false;
        gs.players[seat].passCount = 0;
        gs.players[seat].active    = true;
      }
    }
    const board = {};
    for (const s of SUITS_S) board[s] = null;
    gs.board        = board;
    gs.finishOrder  = [];
    gs.lastAction   = '';
    gs.actionLog    = [];
    gs.currentPlayer = -1;
    pushState(gs);
  });
  el('btnLeaveAfterGame')?.addEventListener('click', () => { hideGameOverModal(); leaveGame(); });

  // Check URL for room code
  const params  = new URLSearchParams(window.location.search);
  const urlCode = params.get('room');
  if (urlCode && urlCode.length === 6) {
    const rc = el('roomCode');
    if (rc) {
      rc.value = urlCode.toUpperCase();
      el('joinFields')?.classList.remove('hidden');
      hide('btnNew');
      hide('btnJoin');
    }
  }
});
