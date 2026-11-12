/**
 * hearts-logic.js — Hearts for exactly 4 players. Requires cards.js and
 * tricks-core.js. Implements the shared engine interface (see room.js).
 * Exposes `window.HeartsLogic`.
 *
 * Rules:
 *  - 13 cards each. Before play everyone passes 3 cards: to the left, then
 *    right, then across, then no pass, repeating.
 *  - The holder of 2♣ leads it to the first trick. Follow suit if you can;
 *    otherwise play anything. Highest card of the suit led wins the trick
 *    (no trumps) and leads next.
 *  - No hearts or Q♠ on the first trick unless you have nothing else.
 *  - Hearts can't be led until a heart has been played ("broken"), unless
 *    you hold only hearts.
 *  - Each heart taken is 1 point, Q♠ is 13. Taking all 26 ("shooting the
 *    moon") scores 0 for you and 26 for everyone else.
 *  - When someone reaches 100, the lowest score wins.
 */
(function (root) {
  'use strict';

  const T = TrickCore;
  const TARGET = 100;
  const PASS_DIRS = ['left', 'right', 'across', 'hold'];
  const PASS_OFFSET = { left: 1, right: 3, across: 2 };
  const parseHand = p => Cards.parseHand(p);
  const setHand = (p, h) => { p.handJSON = JSON.stringify(h); };
  const log = (gs, line) => (gs.actionLog ??= []).push(line);
  const fmt = c => c.r + c.s;
  const isQS = c => c.r === 'Q' && c.s === '♠';
  const points = c => (c.s === '♥' ? 1 : isQS(c) ? 13 : 0);
  const TWO_CLUBS = { r: '2', s: '♣' };

  const create = code => ({
    roomCode: code, phase: 'waiting', round: 0, passDir: 'left', passes: {}, passedSeats: [], taken: [],
    currentPlayer: -1, trick: [], lastTrick: null, heartsBroken: false, tricksPlayed: 0,
    players: {}, result: null, final: null, hostSeat: 0, lastAction: '', actionLog: [], updatedAt: Date.now(),
  });
  const freshPlayer = name => ({ name, handJSON: '[]', score: 0, handPoints: 0, tricks: 0, isEmpty: false, disconnected: false });

  const seats = gs => [0, 1, 2, 3].filter(s => gs.players[s] && !gs.players[s].isEmpty && !gs.players[s].left);

  function deal(gs, rng) {
    const deck = Cards.makeDeck(rng);
    for (const s of [0, 1, 2, 3]) {
      Object.assign(gs.players[s], { handPoints: 0, tricks: 0 });
      setHand(gs.players[s], deck.splice(0, 13));
    }
    gs.round += 1;
    gs.passDir = PASS_DIRS[(gs.round - 1) % 4];
    gs.passes = {};
    gs.passedSeats = [];
    gs.taken = [];
    gs.trick = [];
    gs.lastTrick = null;
    gs.heartsBroken = false;
    gs.tricksPlayed = 0;
    gs.result = null;
    log(gs, `--- Hand ${gs.round}${gs.passDir === 'hold' ? ' — no passing' : ` — pass ${gs.passDir}`} ---`);
    if (gs.passDir === 'hold') beginPlay(gs);
    else { gs.phase = 'passing'; gs.currentPlayer = -1; }
  }

  function beginPlay(gs) {
    gs.phase = 'playing';
    gs.currentPlayer = [0, 1, 2, 3].find(s => parseHand(gs.players[s]).some(c => Cards.same(c, TWO_CLUBS)));
  }

  function start(gs, rng = Math.random) {
    if (seats(gs).length !== 4) return false;
    for (const s of [0, 1, 2, 3]) gs.players[s].score = 0;
    Object.assign(gs, { round: 0, final: null, actionLog: [] });
    deal(gs, rng);
    return true;
  }

  function nextRound(gs, rng = Math.random) {
    if (gs.phase !== 'handOver') return false;
    deal(gs, rng);
    return true;
  }

  /** Cards `seat` may legally play right now. */
  function playableCards(gs, seat) {
    const hand = parseHand(gs.players[seat]);
    if (!gs.trick.length) {
      if (gs.tricksPlayed === 0) return hand.filter(c => Cards.same(c, TWO_CLUBS));
      const nonHearts = hand.filter(c => c.s !== '♥');
      return gs.heartsBroken || !nonHearts.length ? hand : nonHearts;
    }
    let options = T.followable(hand, gs.trick);
    if (gs.tricksPlayed === 0 && options[0]?.s !== gs.trick[0].card.s) {
      const clean = options.filter(c => !points(c));
      if (clean.length) options = clean;
    }
    return options;
  }

  function legalActions(gs, seat) {
    if (gs.phase === 'passing') {
      if (gs.passes[seat] || !gs.players[seat]) return [];
      const hand = T.sortHand(parseHand(gs.players[seat]));
      const picks = [[0, 1, 2], [10, 11, 12], [0, 6, 12], [3, 7, 11]];
      return picks.map(ix => ({ type: 'pass', cards: ix.map(i => hand[i]) }));
    }
    if (gs.phase !== 'playing' || gs.currentPlayer !== seat) return [];
    return playableCards(gs, seat).map(card => ({ type: 'play', card }));
  }

  function exchange(gs) {
    const off = PASS_OFFSET[gs.passDir];
    const hands = [0, 1, 2, 3].map(s => Cards.parseHand(gs.players[s]));
    for (const s of [0, 1, 2, 3]) {
      const to = (s + off) % 4;
      for (const c of gs.passes[s]) Cards.take(hands[s], c);
      // `recv` marks the cards a player was passed; it lives in their private hand.
      hands[to].push(...gs.passes[s].map(c => ({ ...c, recv: true })));
    }
    for (const s of [0, 1, 2, 3]) setHand(gs.players[s], hands[s]);
    log(gs, `Cards passed ${gs.passDir}`);
    gs.passes = {};
    gs.passedSeats = [];
    beginPlay(gs);
  }

  function apply(gs, seat, action) {
    const p = gs.players[seat];
    if (!p) return { ok: false, error: 'No such seat.' };

    if (gs.phase === 'passing') {
      if (action?.type !== 'pass') return { ok: false, error: 'Choose 3 cards to pass.' };
      if (gs.passes[seat]) return { ok: false, error: 'You already passed.' };
      const cards = Array.isArray(action.cards) ? action.cards.map(c => ({ r: c.r, s: c.s })) : [];
      if (cards.length !== 3 || new Set(cards.map(Cards.key)).size !== 3 || !Cards.containsAll(parseHand(p), cards)) {
        return { ok: false, error: 'Choose exactly 3 of your cards.' };
      }
      gs.passes[seat] = cards;
      gs.passedSeats.push(seat);
      gs.lastAction = `${p.name} has passed`;
      if (Object.keys(gs.passes).length === 4) exchange(gs);
      return { ok: true };
    }

    if (gs.phase !== 'playing' || gs.currentPlayer !== seat) return { ok: false, error: 'Not your turn.' };
    if (action?.type !== 'play' || !action.card) return { ok: false, error: 'Play a card.' };
    const card = { r: action.card.r, s: action.card.s };
    if (!playableCards(gs, seat).some(c => Cards.same(c, card))) {
      const hand = parseHand(p);
      if (!hand.some(c => Cards.same(c, card))) return { ok: false, error: 'You do not hold that card.' };
      if (gs.tricksPlayed === 0 && !gs.trick.length) return { ok: false, error: 'The 2♣ leads the first trick.' };
      if (gs.trick.length && hand.some(c => c.s === gs.trick[0].card.s)) return { ok: false, error: `You must follow suit (${gs.trick[0].card.s}).` };
      if (!gs.trick.length) return { ok: false, error: "Hearts haven't been broken yet." };
      return { ok: false, error: 'No points on the first trick.' };
    }
    const hand = parseHand(p).map(c => ({ r: c.r, s: c.s })); // playing clears the "received" marks
    Cards.take(hand, card);
    setHand(p, hand);
    gs.trick.push({ seat, card });
    if (card.s === '♥' && !gs.heartsBroken) { gs.heartsBroken = true; log(gs, 'Hearts are broken'); }
    gs.lastAction = `${p.name} plays ${fmt(card)}`;

    if (gs.trick.length < 4) { gs.currentPlayer = T.nextSeat(seat); return { ok: true }; }

    const winner = T.trickWinner(gs.trick);
    const pts = gs.trick.reduce((a, t) => a + points(t.card), 0);
    gs.players[winner].handPoints += pts;
    gs.players[winner].tricks += 1;
    gs.lastTrick = { plays: gs.trick, winner };
    gs.taken.push(...gs.trick.map(t => t.card));
    log(gs, `${gs.players[winner].name} takes the trick${pts ? ` (${pts} pt${pts > 1 ? 's' : ''})` : ''}`);
    gs.trick = [];
    gs.tricksPlayed += 1;
    gs.currentPlayer = winner;
    if (gs.tricksPlayed === 13) endHand(gs);
    return { ok: true };
  }

  function endHand(gs) {
    const shooter = [0, 1, 2, 3].find(s => gs.players[s].handPoints === 26);
    const delta = {};
    for (const s of [0, 1, 2, 3]) delta[s] = shooter === undefined ? gs.players[s].handPoints : (s === shooter ? 0 : 26);
    for (const s of [0, 1, 2, 3]) gs.players[s].score += delta[s];
    gs.result = { shooter: shooter ?? null, delta };
    const line = shooter !== undefined ? `🌙 ${gs.players[shooter].name} shoots the moon!` : '🏁 Hand over';
    log(gs, line);
    gs.lastAction = line;
    gs.currentPlayer = -1;
    const scores = [0, 1, 2, 3].map(s => gs.players[s].score);
    const low = Math.min(...scores);
    const lows = [0, 1, 2, 3].filter(s => gs.players[s].score === low);
    if (Math.max(...scores) >= TARGET && lows.length === 1) finish(gs, lows[0], false);
    else gs.phase = 'handOver';
  }

  function finish(gs, winner, abandoned) {
    gs.phase = 'matchOver';
    gs.final = { winner, abandoned };
    gs.currentPlayer = -1;
    log(gs, abandoned ? '--- Game ended: a player left ---' : `--- Match over: ${gs.players[winner].name} wins with the lowest score ---`);
  }

  /** Hearts needs four players: if one leaves for good, the game ends. */
  function removePlayer(gs, seat) {
    if (!gs.players[seat]) return;
    gs.players[seat].left = true;
    if (gs.phase === 'matchOver' || gs.phase === 'waiting') return;
    const rest = seats(gs);
    const low = Math.min(...rest.map(s => gs.players[s].score));
    finish(gs, rest.find(s => gs.players[s].score === low), true);
  }

  const isOver = gs => gs.phase === 'handOver' || gs.phase === 'matchOver';

  root.HeartsLogic = {
    id: 'hearts', minPlayers: 4, maxPlayers: 4, hiddenFields: ['passes'],
    create, freshPlayer, start, nextRound, apply, legalActions, removePlayer, isOver,
    isMatchOver: gs => gs.phase === 'matchOver',
    canSeeHand: (gs, viewer, owner) => viewer === owner,
    allCards: gs => [...gs.trick.map(t => t.card), ...gs.taken,
      ...Object.values(gs.players).flatMap(p => (p ? parseHand(p) : []))].map(c => ({ r: c.r, s: c.s })),
    playableCards, points, TARGET,
  };
})(typeof window !== 'undefined' ? window : globalThis);
