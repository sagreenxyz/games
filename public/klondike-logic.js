/**
 * klondike-logic.js — Klondike solitaire rules engine (one player).
 * Requires cards.js. Uses the shared engine interface with seat 0 so the
 * same test harness can drive it. Exposes `window.KlondikeLogic`.
 *
 * Rules:
 *  - 28 cards dealt into 7 tableau piles (1–7 cards, top card face up);
 *    the rest form the stock.
 *  - Draw 1 or 3 cards from the stock to the waste. When the stock is empty
 *    the waste is turned back over (unlimited passes).
 *  - Tableau: build down in alternating colours (red 6 on black 7). Any
 *    face-up run can be moved together. Only a King (or a run starting with
 *    one) can fill an empty pile. A face-down card is turned up when uncovered.
 *  - Foundations: one per suit, built up from Ace to King. Win when all four
 *    are complete.
 */
(function (root) {
  'use strict';

  const SUITS = Cards.SUITS;
  const val = c => Cards.rankValue(c.r);
  const red = c => Cards.isRed(c);

  function create() {
    return {
      phase: 'waiting', drawCount: 1, stock: [], waste: [],
      foundations: Object.fromEntries(SUITS.map(s => [s, []])),
      tableau: Array.from({ length: 7 }, () => []),
      moves: 0, passes: 0, startedAt: 0, wonAt: 0, players: {},
    };
  }

  function start(gs, rng, { drawCount } = {}) {
    const deck = Cards.makeDeck(rng);
    const fresh = create();
    fresh.players = gs.players || {};
    fresh.drawCount = drawCount === 3 ? 3 : drawCount === 1 ? 1 : gs.drawCount || 1;
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j <= i; j++) fresh.tableau[i].push({ ...deck.pop(), up: j === i });
    }
    fresh.stock = deck.map(c => ({ ...c, up: false }));
    fresh.phase = 'playing';
    fresh.startedAt = Date.now();
    Object.keys(gs).forEach(k => delete gs[k]);
    Object.assign(gs, fresh);
    return true;
  }

  const top = arr => arr[arr.length - 1];

  function canStackOnTableau(card, pile) {
    const t = top(pile);
    if (!t) return val(card) === 13;
    return t.up && red(t) !== red(card) && val(t) === val(card) + 1;
  }

  function canGoToFoundation(card, gs) {
    const f = gs.foundations[card.s];
    return val(card) === f.length + 1;
  }

  /** Cards that would move for a `from` spec, or null if it isn't a movable selection. */
  function movingCards(gs, from) {
    if (!from) return null;
    if (from.pile === 'waste') return gs.waste.length ? [top(gs.waste)] : null;
    if (from.pile === 'foundation') { const f = gs.foundations[from.suit]; return f?.length ? [top(f)] : null; }
    if (from.pile === 'tableau') {
      const pile = gs.tableau[from.index];
      if (!pile) return null;
      const i = from.cardIndex ?? pile.length - 1;
      if (i < 0 || i >= pile.length || !pile[i].up) return null;
      const run = pile.slice(i);
      // A moving run must itself be a valid descending alternating sequence.
      for (let k = 1; k < run.length; k++) if (red(run[k]) === red(run[k - 1]) || val(run[k]) !== val(run[k - 1]) - 1) return null;
      return run;
    }
    return null;
  }

  function isLegalMove(gs, from, to) {
    const cards = movingCards(gs, from);
    if (!cards || !to) return false;
    if (to.pile === 'foundation') {
      return cards.length === 1 && from.pile !== 'foundation' && canGoToFoundation(cards[0], gs);
    }
    if (to.pile === 'tableau') {
      if (from.pile === 'tableau' && from.index === to.index) return false;
      const pile = gs.tableau[to.index];
      return !!pile && canStackOnTableau(cards[0], pile);
    }
    return false;
  }

  function legalActions(gs, seat = 0) {
    if (gs.phase !== 'playing' || seat !== 0) return [];
    const out = [];
    if (gs.stock.length || gs.waste.length) out.push({ type: 'draw' });
    const froms = [{ pile: 'waste' }];
    for (const s of SUITS) froms.push({ pile: 'foundation', suit: s });
    gs.tableau.forEach((pile, index) => pile.forEach((c, cardIndex) => { if (c.up) froms.push({ pile: 'tableau', index, cardIndex }); }));
    const tos = [{ pile: 'foundation' }, ...gs.tableau.map((_, index) => ({ pile: 'tableau', index }))];
    for (const from of froms) for (const to of tos) if (isLegalMove(gs, from, to)) out.push({ type: 'move', from, to });
    return out;
  }

  function apply(gs, seat, action) {
    if (gs.phase !== 'playing' || seat !== 0) return { ok: false, error: 'No game in progress.' };
    if (action?.type === 'draw') {
      if (gs.stock.length) {
        const n = Math.min(gs.drawCount, gs.stock.length);
        for (let i = 0; i < n; i++) gs.waste.push({ ...gs.stock.pop(), up: true });
      } else if (gs.waste.length) {
        gs.stock = gs.waste.reverse().map(c => ({ ...c, up: false }));
        gs.waste = [];
        gs.passes += 1;
      } else return { ok: false, error: 'The stock and waste are empty.' };
      gs.moves += 1;
      return { ok: true };
    }
    if (action?.type !== 'move') return { ok: false, error: 'Unknown action.' };
    const { from, to } = action;
    if (!isLegalMove(gs, from, to)) return { ok: false, error: "That move isn't allowed." };
    let cards;
    if (from.pile === 'waste') cards = [gs.waste.pop()];
    else if (from.pile === 'foundation') cards = [gs.foundations[from.suit].pop()];
    else {
      const pile = gs.tableau[from.index];
      const i = from.cardIndex ?? pile.length - 1;
      cards = pile.splice(i);
      const t = top(pile);
      if (t && !t.up) t.up = true;
    }
    if (to.pile === 'foundation') gs.foundations[cards[0].s].push(cards[0]);
    else gs.tableau[to.index].push(...cards);
    gs.moves += 1;
    if (SUITS.every(s => gs.foundations[s].length === 13)) { gs.phase = 'won'; gs.wonAt = Date.now(); }
    return { ok: true };
  }

  /** A move that sends a card to a foundation, preferring the waste then low cards. */
  function foundationMove(gs) {
    const cands = legalActions(gs).filter(a => a.type === 'move' && a.to.pile === 'foundation');
    return cands.sort((a, b) => val(movingCards(gs, a.from)[0]) - val(movingCards(gs, b.from)[0]))[0] || null;
  }

  /** Every card is face up and the stock/waste are empty: the game can finish itself. */
  const canAutoFinish = gs => gs.phase === 'playing' && !gs.stock.length && !gs.waste.length && gs.tableau.every(p => p.every(c => c.up));

  /** A reasonable suggestion: foundation, then a move that uncovers a card, then any useful move, then draw. */
  function hint(gs) {
    const acts = legalActions(gs);
    const f = foundationMove(gs);
    if (f) return f;
    const reveals = acts.find(a => a.type === 'move' && a.from.pile === 'tableau' && a.from.cardIndex > 0 && !gs.tableau[a.from.index][a.from.cardIndex - 1].up);
    if (reveals) return reveals;
    const fromWaste = acts.find(a => a.type === 'move' && a.from.pile === 'waste');
    if (fromWaste) return fromWaste;
    return acts.find(a => a.type === 'draw') || null;
  }

  function allCards(gs) {
    return [...gs.stock, ...gs.waste, ...SUITS.flatMap(s => gs.foundations[s]), ...gs.tableau.flat()].map(c => ({ r: c.r, s: c.s }));
  }

  root.KlondikeLogic = {
    id: 'klondike', minPlayers: 1, maxPlayers: 1, hiddenFields: [],
    create, freshPlayer: name => ({ name }), start, apply, legalActions, allCards,
    removePlayer() {}, isOver: gs => gs.phase === 'won',
    isLegalMove, movingCards, foundationMove, canAutoFinish, hint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
