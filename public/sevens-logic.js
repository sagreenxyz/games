/**
 * sevens-logic.js — Sevens (Fan Tan) rules engine (no DOM, no network).
 *
 * Rules:
 *  - All 52 cards are dealt among 2–4 players.
 *  - The player holding 7♦ goes first and must open with it.
 *  - A card is playable if it is a 7 (opening that suit) or one rank above /
 *    below the cards already played in its suit. Ace is low, King is high.
 *  - You must play if you can; you may only pass when you have no playable card.
 *  - Players finish in the order they empty their hands; the game ends when
 *    one player is left holding cards.
 *  - If a player leaves mid-game their cards are dealt out to the players
 *    still holding cards, so the game can always be completed.
 *
 * Exposes `window.SevensLogic` in the browser; loaded via `vm` in unit tests.
 */
(function (root) {
  'use strict';

  const SUITS = ['♦', '♣', '♥', '♠'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 1])); // A=1 … K=13
  const MAX_PLAYERS = 4;
  const OPENING_CARD = { r: '7', s: '♦' };

  const parseHand = p => { try { return JSON.parse(p.handJSON) || []; } catch { return []; } };
  const sameCard = (a, b) => a && b && a.r === b.r && a.s === b.s;
  const log = (gs, line) => (gs.actionLog ??= []).push(line);

  function makeDeck(rng = Math.random) {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function emptyBoard() {
    const board = {};
    for (const s of SUITS) board[s] = null;
    return board;
  }

  /** Cards in `hand` that can legally be played on `board`. */
  function getValidMoves(board, hand) {
    // Until 7♦ is down, it is the only legal opening card.
    if (board['♦'] === null && hand.some(c => sameCard(c, OPENING_CARD))) {
      return hand.filter(c => sameCard(c, OPENING_CARD));
    }
    return hand.filter(card => {
      const v = RANK_VAL[card.r];
      const col = board[card.s];
      if (col === null) return v === 7 && board['♦'] !== null;
      return v === col.max + 1 || v === col.min - 1;
    });
  }

  function applyCardToBoard(board, card) {
    const v = RANK_VAL[card.r];
    const col = board[card.s];
    if (col === null) board[card.s] = { min: v, max: v };
    else { col.max = Math.max(col.max, v); col.min = Math.min(col.min, v); }
  }

  function buildFreshRoomState(code) {
    return {
      roomCode: code,
      phase: 'waiting',          // waiting | playing | finished
      round: 0,
      players: {},
      board: emptyBoard(),
      currentPlayer: -1,
      hostSeat: 0,
      lastAction: '',
      actionLog: [],
      finishOrder: [],
      updatedAt: Date.now(),
    };
  }

  function freshPlayer(name) {
    return { name, handJSON: '[]', isEmpty: false, disconnected: false, passCount: 0, finished: false };
  }

  /** Seats still holding cards and connected, in seat order. */
  function inPlaySeats(gs) {
    return Object.keys(gs.players).map(Number).sort((a, b) => a - b)
      .filter(s => { const p = gs.players[s]; return p && !p.isEmpty && !p.disconnected && !p.finished; });
  }

  function nextInPlaySeat(gs, fromSeat) {
    const seats = inPlaySeats(gs);
    if (seats.length === 0) return -1;
    return seats.find(s => s > fromSeat) ?? seats[0];
  }

  /** Remove players who left and clear per-game fields, back to the waiting room. */
  function resetToWaiting(gs) {
    for (const key of Object.keys(gs.players)) {
      const p = gs.players[key];
      if (!p || p.isEmpty || p.disconnected) { delete gs.players[key]; continue; }
      Object.assign(p, { handJSON: '[]', finished: false, passCount: 0 });
    }
    Object.assign(gs, {
      phase: 'waiting', board: emptyBoard(), finishOrder: [], lastAction: '', actionLog: [], currentPlayer: -1,
    });
  }

  /** Deal and start a game. Returns false if fewer than two players. */
  function startGame(gs, deck = makeDeck()) {
    resetToWaiting(gs);
    const seats = inPlaySeats(gs);
    if (seats.length < 2) return false;
    const hands = Object.fromEntries(seats.map(s => [s, []]));
    deck.forEach((card, i) => hands[seats[i % seats.length]].push(card));
    for (const s of seats) gs.players[s].handJSON = JSON.stringify(hands[s]);

    gs.phase = 'playing';
    gs.round = (gs.round || 0) + 1;
    gs.currentPlayer = seats.find(s => hands[s].some(c => sameCard(c, OPENING_CARD))) ?? seats[0];
    gs.actionLog = [`--- Round ${gs.round} ---`];
    return true;
  }

  /** End the game if at most one player still holds cards. Returns true if it ended. */
  function checkGameOver(gs) {
    const remaining = inPlaySeats(gs);
    if (remaining.length > 1) return false;
    if (remaining.length === 1) {
      gs.players[remaining[0]].finished = true;
      gs.finishOrder.push(remaining[0]);
    }
    gs.phase = 'finished';
    gs.currentPlayer = -1;
    const medals = ['🥇', '🥈', '🥉'];
    log(gs, '--- Game Over ---');
    gs.finishOrder.forEach((s, i) => log(gs, `${medals[i] || `${i + 1}.`} ${gs.players[s]?.name || `Seat ${s + 1}`}`));
    gs.lastAction = `Game over! Winner: ${gs.players[gs.finishOrder[0]]?.name ?? '—'}`;
    return true;
  }

  /**
   * Apply 'play' (with `card`) or 'pass' from `seat`.
   * Returns { ok: true } or { ok: false, error }. Invalid actions change nothing.
   */
  function applyAction(gs, seat, action, card) {
    const p = gs.players[seat];
    if (gs.phase !== 'playing' || gs.currentPlayer !== seat || !p || p.finished) {
      return { ok: false, error: 'Not your turn.' };
    }
    const hand = parseHand(p);
    const valid = getValidMoves(gs.board, hand);
    let label;

    if (action === 'play') {
      if (!card || typeof card !== 'object') return { ok: false, error: 'No card given.' };
      const idx = hand.findIndex(c => sameCard(c, card));
      if (idx === -1) return { ok: false, error: 'You do not hold that card.' };
      if (!valid.some(c => sameCard(c, card))) return { ok: false, error: 'That card cannot be played yet.' };
      const played = hand.splice(idx, 1)[0];
      p.handJSON = JSON.stringify(hand);
      applyCardToBoard(gs.board, played);
      label = `${p.name} plays ${played.r}${played.s}`;
      if (hand.length === 0) {
        p.finished = true;
        gs.finishOrder.push(seat);
        label += ' 🎉 (hand empty!)';
      }
    } else if (action === 'pass') {
      if (valid.length > 0) return { ok: false, error: 'You have a playable card — you must play it.' };
      p.passCount = (p.passCount || 0) + 1;
      label = `${p.name} passes`;
    } else {
      return { ok: false, error: 'Unknown action.' };
    }

    gs.lastAction = label;
    log(gs, label);
    if (!checkGameOver(gs)) gs.currentPlayer = nextInPlaySeat(gs, seat);
    return { ok: true };
  }

  /**
   * A player left mid-game (already marked `disconnected`). Deal their cards
   * out to the remaining players so no suit is blocked, then move the turn on
   * if it was theirs.
   */
  function removePlayer(gs, seat) {
    const p = gs.players[seat];
    if (!p || gs.phase !== 'playing') return;
    const cards = parseHand(p);
    p.handJSON = '[]';
    const seats = inPlaySeats(gs);
    if (seats.length > 0 && cards.length > 0) {
      // Start with the player after the leaver so extra cards spread fairly.
      const start = Math.max(0, seats.findIndex(s => s > seat));
      const hands = Object.fromEntries(seats.map(s => [s, parseHand(gs.players[s])]));
      cards.forEach((c, i) => hands[seats[(start + i) % seats.length]].push(c));
      for (const s of seats) gs.players[s].handJSON = JSON.stringify(hands[s]);
    }
    log(gs, `${p.name} left — their ${cards.length} card${cards.length === 1 ? '' : 's'} were dealt to the others`);
    if (!checkGameOver(gs) && gs.currentPlayer === seat) gs.currentPlayer = nextInPlaySeat(gs, seat);
  }

  root.SevensLogic = {
    SUITS, RANKS, RANK_VAL, MAX_PLAYERS, OPENING_CARD,
    makeDeck, emptyBoard, getValidMoves, applyCardToBoard,
    buildFreshRoomState, freshPlayer, startGame, resetToWaiting, applyAction, removePlayer,
  };
})(typeof window !== 'undefined' ? window : globalThis);
