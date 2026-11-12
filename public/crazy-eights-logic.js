/**
 * crazy-eights-logic.js — Crazy Eights (2–6 players). Requires cards.js.
 * Implements the shared engine interface (see room.js).
 * Exposes `window.CrazyEightsLogic`.
 *
 * Rules:
 *  - Deal 7 cards each for 2 players, 5 for 3–6. The next card starts the
 *    discard pile (an 8 is buried in the stock and another card turned).
 *  - On your turn play a card of the same suit or rank as the top card.
 *    Eights are wild: play one any time and name the suit to follow.
 *  - If you can't play, draw one card. If it can be played you may play it;
 *    otherwise your turn ends. When the stock runs out the discard pile
 *    (except its top card) is reshuffled into a new stock.
 *  - First to empty their hand scores the cards left in everyone else's
 *    hands: 8 = 50, J/Q/K = 10, A = 1, others face value.
 *  - If nobody can play or draw (blocked), the player with the lowest hand
 *    wins and scores the difference from each other player.
 *  - First to 100 wins the match.
 */
(function (root) {
  'use strict';

  const TARGET = 100;
  const parseHand = p => Cards.parseHand(p);
  const setHand = (p, h) => { p.handJSON = JSON.stringify(h); };
  const log = (gs, line) => (gs.actionLog ??= []).push(line);
  const fmt = c => c.r + c.s;
  const value = c => (c.r === '8' ? 50 : ['J', 'Q', 'K'].includes(c.r) ? 10 : Cards.rankValue(c.r));
  const handValue = h => h.reduce((a, c) => a + value(c), 0);

  /** Seeded PRNG kept in the state so reshuffles are reproducible (mulberry32). */
  function rand(gs) {
    let t = (gs.seed = (gs.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const create = code => ({
    roomCode: code, phase: 'waiting', round: 0, dealer: -1, currentPlayer: -1,
    stock: [], discard: [], declaredSuit: null, drawnCard: null, passesInRow: 0, seed: 1,
    players: {}, result: null, final: null, hostSeat: 0, lastAction: '', actionLog: [], updatedAt: Date.now(),
  });
  const freshPlayer = name => ({ name, handJSON: '[]', score: 0, isEmpty: false, disconnected: false });

  const seatsInPlay = gs => Object.keys(gs.players).map(Number).sort((a, b) => a - b)
    .filter(s => gs.players[s] && !gs.players[s].isEmpty && !gs.players[s].left);
  const nextSeat = (gs, from) => { const s = seatsInPlay(gs); return s.find(x => x > from) ?? s[0]; };
  const top = gs => gs.discard[gs.discard.length - 1];
  const stockLen = gs => (gs.stock ? gs.stock.length : gs.stockCount || 0);
  const canDraw = gs => stockLen(gs) > 0 || gs.discard.length > 1;

  /** Suit that must be followed: the named suit after an 8, otherwise the top card's suit. */
  const suitToFollow = gs => gs.declaredSuit || top(gs)?.s;
  const playable = (gs, card) => card.r === '8' || card.s === suitToFollow(gs) || card.r === top(gs)?.r;

  function deal(gs, rng) {
    const seats = seatsInPlay(gs);
    const deck = Cards.makeDeck(rng);
    gs.seed = Math.floor(rng() * 2 ** 31);
    const n = seats.length === 2 ? 7 : 5;
    gs.dealer = seats.includes(gs.dealer) ? nextSeat(gs, gs.dealer) : seats[seats.length - 1];
    for (const s of seats) setHand(gs.players[s], deck.splice(0, n));
    let starter = deck.pop();
    while (starter.r === '8') { deck.splice(Math.floor(deck.length / 2), 0, starter); starter = deck.pop(); }
    Object.assign(gs, {
      discard: [starter], stock: deck, declaredSuit: null, drawnCard: null, passesInRow: 0,
      phase: 'playing', result: null,
    });
    gs.round += 1;
    gs.currentPlayer = nextSeat(gs, gs.dealer);
    log(gs, `--- Hand ${gs.round} — ${gs.players[gs.dealer].name} deals, ${fmt(starter)} starts ---`);
  }

  function start(gs, rng = Math.random) {
    const seats = seatsInPlay(gs);
    if (seats.length < 2 || seats.length > 6) return false;
    for (const s of seats) gs.players[s].score = 0;
    Object.assign(gs, { round: 0, final: null, actionLog: [], dealer: -1 });
    deal(gs, rng);
    return true;
  }

  function nextRound(gs, rng = Math.random) {
    if (gs.phase !== 'handOver') return false;
    deal(gs, rng);
    return true;
  }

  function reshuffle(gs) {
    const t = gs.discard.pop();
    gs.stock = Cards.shuffle(gs.discard, () => rand(gs));
    gs.discard = [t];
    log(gs, 'The discard pile is shuffled into a new stock');
  }

  function endHand(gs, winner, blocked) {
    const seats = seatsInPlay(gs);
    const rows = {};
    for (const s of seats) rows[s] = { inHand: handValue(parseHand(gs.players[s])), points: 0 };
    if (blocked) {
      const low = Math.min(...seats.map(s => rows[s].inHand));
      winner = seats.find(s => rows[s].inHand === low);
      rows[winner].points = seats.filter(s => s !== winner).reduce((a, s) => a + rows[s].inHand - low, 0);
    } else {
      rows[winner].points = seats.filter(s => s !== winner).reduce((a, s) => a + rows[s].inHand, 0);
    }
    gs.players[winner].score += rows[winner].points;
    gs.result = { winner, blocked, rows };
    const line = `🏆 ${gs.players[winner].name} ${blocked ? 'has the lowest hand (blocked)' : 'goes out'} and scores ${rows[winner].points}`;
    gs.lastAction = line;
    log(gs, line);
    gs.currentPlayer = -1;
    gs.drawnCard = null;
    const best = Math.max(...seats.map(s => gs.players[s].score));
    const leaders = seats.filter(s => gs.players[s].score === best);
    if (best >= TARGET && leaders.length === 1) finishMatch(gs, leaders[0], false);
    else gs.phase = 'handOver';
  }

  function finishMatch(gs, winner, forfeit) {
    gs.phase = 'matchOver';
    gs.final = { winner, forfeit };
    gs.currentPlayer = -1;
    log(gs, `--- Match over: ${gs.players[winner].name} wins${forfeit ? ' (everyone else left)' : ''} ---`);
  }

  function endTurn(gs, seat, passed) {
    gs.drawnCard = null;
    gs.passesInRow = passed ? gs.passesInRow + 1 : 0;
    if (passed && gs.passesInRow >= seatsInPlay(gs).length && !canDraw(gs)) { endHand(gs, null, true); return; }
    gs.currentPlayer = nextSeat(gs, seat);
  }

  function playActions(card) {
    return card.r === '8' ? Cards.SUITS.map(suit => ({ type: 'play', card, suit })) : [{ type: 'play', card }];
  }

  function legalActions(gs, seat) {
    if (gs.phase !== 'playing' || gs.currentPlayer !== seat) return [];
    if (gs.drawnCard) return [...playActions(gs.drawnCard), { type: 'pass' }];
    const plays = parseHand(gs.players[seat]).filter(c => playable(gs, c)).flatMap(playActions);
    if (plays.length) return plays;
    return [canDraw(gs) ? { type: 'draw' } : { type: 'pass' }];
  }

  function apply(gs, seat, action) {
    if (gs.phase !== 'playing' || gs.currentPlayer !== seat) return { ok: false, error: 'Not your turn.' };
    const p = gs.players[seat];
    const hand = parseHand(p);
    const type = action?.type;

    if (type === 'play') {
      const card = action.card && { r: action.card.r, s: action.card.s };
      const i = card ? hand.findIndex(c => Cards.same(c, card)) : -1;
      if (i === -1) return { ok: false, error: 'You do not hold that card.' };
      if (gs.drawnCard && !Cards.same(card, gs.drawnCard)) return { ok: false, error: 'You can only play the card you just drew.' };
      if (!playable(gs, card)) return { ok: false, error: `Play a ${Cards.SUIT_NAMES[suitToFollow(gs)].toLowerCase().slice(0, -1)}, a ${top(gs).r}, or an 8.` };
      if (card.r === '8' && !Cards.SUITS.includes(action.suit)) return { ok: false, error: 'Name a suit for your 8.' };
      hand.splice(i, 1);
      setHand(p, hand);
      gs.discard.push(card);
      gs.declaredSuit = card.r === '8' ? action.suit : null;
      gs.lastAction = card.r === '8' ? `${p.name} plays ${fmt(card)} and names ${Cards.SUIT_NAMES[action.suit]}` : `${p.name} plays ${fmt(card)}`;
      log(gs, gs.lastAction);
      if (!hand.length) { endHand(gs, seat, false); return { ok: true }; }
      endTurn(gs, seat, false);
      return { ok: true };
    }

    if (type === 'draw') {
      if (gs.drawnCard) return { ok: false, error: 'You already drew this turn.' };
      if (hand.some(c => playable(gs, c))) return { ok: false, error: 'You have a card you can play.' };
      if (!canDraw(gs)) return { ok: false, error: 'There are no cards left to draw — pass.' };
      if (!gs.stock.length) reshuffle(gs);
      const card = gs.stock.pop();
      hand.push(card);
      setHand(p, hand);
      if (playable(gs, card)) {
        gs.drawnCard = card;
        gs.lastAction = `${p.name} draws a card`;
        log(gs, gs.lastAction);
      } else {
        gs.lastAction = `${p.name} draws and passes`;
        log(gs, gs.lastAction);
        endTurn(gs, seat, true);
      }
      return { ok: true };
    }

    if (type === 'pass') {
      if (!gs.drawnCard && (hand.some(c => playable(gs, c)) || canDraw(gs))) return { ok: false, error: 'Play a card or draw.' };
      gs.lastAction = `${p.name} passes`;
      log(gs, gs.lastAction);
      endTurn(gs, seat, true);
      return { ok: true };
    }
    return { ok: false, error: 'Unknown action.' };
  }

  function removePlayer(gs, seat) {
    const p = gs.players[seat];
    if (!p) return;
    p.left = true;
    if (gs.phase !== 'playing' && gs.phase !== 'handOver') return;
    gs.stock.unshift(...parseHand(p));
    setHand(p, []);
    log(gs, `${p.name} left the game`);
    const seats = seatsInPlay(gs);
    if (seats.length < 2) { finishMatch(gs, seats[0], true); return; }
    if (gs.phase === 'playing' && gs.currentPlayer === seat) { gs.drawnCard = null; gs.currentPlayer = nextSeat(gs, seat); }
  }

  const isOver = gs => gs.phase === 'handOver' || gs.phase === 'matchOver';

  root.CrazyEightsLogic = {
    id: 'crazy-eights', minPlayers: 2, maxPlayers: 6, hiddenFields: ['stock'],
    create, freshPlayer, start, nextRound, apply, legalActions, removePlayer, isOver,
    isMatchOver: gs => gs.phase === 'matchOver',
    canSeeHand: (gs, viewer, owner) => viewer === owner || isOver(gs),
    allCards: gs => [...gs.stock, ...gs.discard, ...Object.values(gs.players).flatMap(p => (p ? parseHand(p) : []))],
    playable, suitToFollow, value, TARGET,
  };
})(typeof window !== 'undefined' ? window : globalThis);
