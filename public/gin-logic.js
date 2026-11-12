/**
 * gin-logic.js — Gin Rummy rules engine (2 players). Requires cards.js and
 * rummy-core.js. Implements the shared engine interface (see room.js).
 * Exposes `window.GinLogic`.
 *
 * Rules:
 *  - 10 cards each; the next card starts the discard pile.
 *  - First turn: the non-dealer may take the upcard or pass; then the dealer
 *    may take it or pass; if both pass, the non-dealer draws from the stock.
 *  - Each turn: draw (stock or top discard), then discard. A card taken from
 *    the discard pile can't be thrown back on the same turn.
 *  - Instead of discarding normally you may knock (discard face down) when
 *    your unmatched cards (deadwood) total 10 or less. Deadwood 0 is gin;
 *    if all 11 cards meld after drawing you may go big gin without discarding.
 *  - The defender lays off deadwood onto the knocker's melds (not after gin).
 *  - Knocker scores the deadwood difference. If the defender's deadwood is
 *    equal or lower, it's an undercut: the defender scores the difference + 25.
 *    Gin scores 25 + the defender's deadwood; big gin 31 + deadwood.
 *  - If only 2 cards are left in the stock after a discard, the hand is void.
 *  - First to 100 wins the match: +100 game bonus, +25 per hand won, doubled
 *    if the loser won no hands (shutout).
 * Values: Ace 1, 2–10 face value, J/Q/K 10. Aces are low (A-2-3, not Q-K-A).
 */
(function (root) {
  'use strict';

  const R = RummyCore;
  const HAND_SIZE = 10;
  const KNOCK_LIMIT = 10;
  const UNDERCUT_BONUS = 25;
  const GIN_BONUS = 25;
  const BIG_GIN_BONUS = 31;
  const BOX_BONUS = 25;
  const GAME_BONUS = 100;
  const TARGET = 100;
  const DEAD_STOCK = 2;

  const parseHand = p => Cards.parseHand(p);
  const setHand = (p, h) => { p.handJSON = JSON.stringify(h); };
  const log = (gs, line) => (gs.actionLog ??= []).push(line);
  const other = seat => (seat === 0 ? 1 : 0);
  const best = hand => R.bestMelds(hand);
  const fmt = c => c.r + c.s;

  function create(code) {
    return {
      roomCode: code, phase: 'waiting', round: 0, dealer: 1, currentPlayer: -1,
      step: null, offerPassed: [], stockOnly: false, drawnFromDiscard: null,
      stock: [], discard: [], players: {}, scores: { 0: 0, 1: 0 }, handsWon: { 0: 0, 1: 0 },
      result: null, final: null, hostSeat: 0, lastAction: '', actionLog: [], updatedAt: Date.now(),
    };
  }

  const freshPlayer = name => ({ name, handJSON: '[]', isEmpty: false, disconnected: false });

  const seats = gs => Object.keys(gs.players).map(Number).filter(s => gs.players[s] && !gs.players[s].left).sort();

  function deal(gs, rng) {
    const deck = Cards.makeDeck(rng);
    for (const s of [0, 1]) setHand(gs.players[s], deck.splice(0, HAND_SIZE));
    gs.discard = [deck.pop()];
    gs.stock = deck;
    gs.round += 1;
    gs.phase = 'playing';
    gs.step = 'offer';
    gs.offerPassed = [];
    gs.stockOnly = false;
    gs.drawnFromDiscard = null;
    gs.result = null;
    gs.currentPlayer = other(gs.dealer);
    log(gs, `--- Hand ${gs.round} — ${gs.players[gs.dealer].name} deals ---`);
  }

  /** Start a new match. Needs exactly two players in seats 0 and 1. */
  function start(gs, rng) {
    const s = seats(gs);
    if (s.length !== 2 || s[0] !== 0 || s[1] !== 1) return false;
    Object.assign(gs, { scores: { 0: 0, 1: 0 }, handsWon: { 0: 0, 1: 0 }, round: 0, final: null, actionLog: [], dealer: 1 });
    deal(gs, rng);
    return true;
  }

  /** Deal the next hand (after a hand ends and the match isn't over). */
  function nextRound(gs, rng) {
    if (gs.phase !== 'handOver') return false;
    if (!gs.result?.void) gs.dealer = other(gs.dealer);
    deal(gs, rng);
    return true;
  }

  /* ───────────── scoring ───────────── */

  function settleHand(gs, knocker, kind) {
    const defender = other(knocker);
    const kHand = parseHand(gs.players[knocker]);
    const dHand = parseHand(gs.players[defender]);
    const k = best(kHand);
    let d;
    let layoffs = [];
    if (kind === 'knock') {
      const extra = R.layoffCandidates(dHand, k.melds);
      d = R.bestMelds(dHand, { extra });
      layoffs = d.extras.flat();
    } else {
      d = best(dHand);
    }
    let winner, points, note;
    if (kind === 'bigGin') { winner = knocker; points = BIG_GIN_BONUS + d.value; note = 'Big gin'; }
    else if (kind === 'gin') { winner = knocker; points = GIN_BONUS + d.value; note = 'Gin'; }
    else if (d.value <= k.value) { winner = defender; points = k.value - d.value + UNDERCUT_BONUS; note = 'Undercut'; }
    else { winner = knocker; points = d.value - k.value; note = 'Knock'; }

    gs.scores[winner] += points;
    gs.handsWon[winner] += 1;
    gs.result = {
      void: false, kind, note, knocker, winner, points,
      hands: {
        [knocker]: { melds: k.melds, deadwood: k.deadwood, value: k.value, layoffs: [] },
        [defender]: { melds: d.melds, deadwood: d.deadwood, value: d.value, layoffs },
      },
    };
    const line = `🏆 ${note}! ${gs.players[winner].name} scores ${points}`;
    gs.lastAction = line;
    log(gs, line);
    finishHand(gs);
  }

  function finishHand(gs) {
    gs.step = null;
    gs.currentPlayer = -1;
    const leader = [0, 1].find(s => gs.scores[s] >= TARGET);
    if (leader === undefined) { gs.phase = 'handOver'; return; }
    endMatch(gs, leader, false);
  }

  function endMatch(gs, winner, forfeit) {
    const loser = other(winner);
    const box = gs.handsWon[winner] * BOX_BONUS;
    const loserBox = gs.handsWon[loser] * BOX_BONUS;
    const shutout = !forfeit && gs.handsWon[loser] === 0;
    const winnerTotal = (gs.scores[winner] + GAME_BONUS + box) * (shutout ? 2 : 1);
    gs.final = {
      winner, forfeit, shutout,
      totals: { [winner]: winnerTotal, [loser]: gs.scores[loser] + loserBox },
      box: { [winner]: box, [loser]: loserBox },
    };
    gs.phase = 'matchOver';
    gs.step = null;
    gs.currentPlayer = -1;
    log(gs, `--- Match over: ${gs.players[winner]?.name ?? 'Player'} wins${forfeit ? ' (opponent left)' : ''} ---`);
  }

  /* ───────────── actions ───────────── */

  function legalActions(gs, seat) {
    if (gs.phase !== 'playing' || gs.currentPlayer !== seat) return [];
    const top = gs.discard[gs.discard.length - 1];
    if (gs.step === 'offer') return [{ type: 'takeDiscard' }, { type: 'pass' }];
    if (gs.step === 'draw') {
      const out = [];
      if (gs.stock.length) out.push({ type: 'drawStock' });
      if (top && !gs.stockOnly) out.push({ type: 'takeDiscard' });
      return out;
    }
    const hand = parseHand(gs.players[seat]);
    const out = [];
    for (const card of hand) {
      if (Cards.same(card, gs.drawnFromDiscard)) continue;
      out.push({ type: 'discard', card });
      if (best(R.without(hand, [card])).value <= KNOCK_LIMIT) out.push({ type: 'knock', card });
    }
    if (best(hand).value === 0) out.push({ type: 'bigGin' });
    return out;
  }

  function apply(gs, seat, action) {
    if (gs.phase !== 'playing' || gs.currentPlayer !== seat) return { ok: false, error: 'Not your turn.' };
    const p = gs.players[seat];
    const hand = parseHand(p);
    const type = action?.type;

    if (gs.step === 'offer') {
      if (type === 'takeDiscard') {
        const card = gs.discard.pop();
        hand.push(card); setHand(p, hand);
        gs.drawnFromDiscard = card;
        gs.step = 'discard';
        gs.lastAction = `${p.name} takes the upcard ${fmt(card)}`;
      } else if (type === 'pass') {
        gs.offerPassed.push(seat);
        gs.lastAction = `${p.name} passes on the upcard`;
        gs.currentPlayer = other(seat);
        if (gs.offerPassed.length === 2) { gs.step = 'draw'; gs.stockOnly = true; }
      } else return { ok: false, error: 'Take the upcard or pass.' };
      log(gs, gs.lastAction);
      return { ok: true };
    }

    if (gs.step === 'draw') {
      if (type === 'drawStock') {
        if (!gs.stock.length) return { ok: false, error: 'The stock is empty.' };
        hand.push(gs.stock.pop());
        gs.drawnFromDiscard = null;
        gs.lastAction = `${p.name} draws from the stock`;
      } else if (type === 'takeDiscard') {
        if (gs.stockOnly) return { ok: false, error: 'Both players passed — draw from the stock.' };
        if (!gs.discard.length) return { ok: false, error: 'The discard pile is empty.' };
        const card = gs.discard.pop();
        hand.push(card);
        gs.drawnFromDiscard = card;
        gs.lastAction = `${p.name} takes ${fmt(card)}`;
      } else return { ok: false, error: 'Draw a card first.' };
      setHand(p, hand);
      gs.stockOnly = false;
      gs.step = 'discard';
      log(gs, gs.lastAction);
      return { ok: true };
    }

    // step === 'discard'
    if (type === 'bigGin') {
      if (best(hand).value !== 0) return { ok: false, error: 'All 11 cards must form melds for big gin.' };
      log(gs, `${p.name} goes big gin!`);
      settleHand(gs, seat, 'bigGin');
      return { ok: true };
    }
    if (type !== 'discard' && type !== 'knock') return { ok: false, error: 'Discard a card.' };
    const card = action.card;
    const rest = card && R.without(hand, [card]);
    if (!rest) return { ok: false, error: 'You do not hold that card.' };
    if (Cards.same(card, gs.drawnFromDiscard)) return { ok: false, error: "You can't discard the card you just took." };

    if (type === 'knock') {
      const v = best(rest).value;
      if (v > KNOCK_LIMIT) return { ok: false, error: `Your deadwood would be ${v} — you need 10 or less to knock.` };
      setHand(p, rest);
      gs.discard.push(card);
      log(gs, v === 0 ? `${p.name} goes gin!` : `${p.name} knocks with ${v}`);
      settleHand(gs, seat, v === 0 ? 'gin' : 'knock');
      return { ok: true };
    }

    setHand(p, rest);
    gs.discard.push(card);
    gs.drawnFromDiscard = null;
    gs.lastAction = `${p.name} discards ${fmt(card)}`;
    log(gs, gs.lastAction);
    if (gs.stock.length <= DEAD_STOCK) {
      gs.result = { void: true, note: 'Stock ran out — no score' };
      log(gs, 'Stock ran out — the hand is void');
      finishHand(gs);
      return { ok: true };
    }
    gs.currentPlayer = other(seat);
    gs.step = 'draw';
    return { ok: true };
  }

  function removePlayer(gs, seat) {
    if (gs.phase === 'playing' || gs.phase === 'handOver') endMatch(gs, other(seat), true);
  }

  const isOver = gs => gs.phase === 'handOver' || gs.phase === 'matchOver';
  const canSeeHand = (gs, viewer, owner) => viewer === owner || isOver(gs);

  function allCards(gs) {
    return [...gs.stock, ...gs.discard, ...[0, 1].flatMap(s => parseHand(gs.players[s]))];
  }

  root.GinLogic = {
    id: 'gin', minPlayers: 2, maxPlayers: 2, hiddenFields: ['stock'],
    create, freshPlayer, start, nextRound, apply, legalActions, removePlayer, isOver, canSeeHand, allCards,
    isMatchOver: gs => gs.phase === 'matchOver',
    deadwood: hand => best(hand),
    KNOCK_LIMIT, TARGET,
  };
})(typeof window !== 'undefined' ? window : globalThis);
