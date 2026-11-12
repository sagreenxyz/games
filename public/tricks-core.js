/**
 * tricks-core.js — shared helpers for trick-taking games (Hearts, Spades).
 * Pure functions, no DOM. Requires cards.js. Exposes `window.TrickCore`.
 * Aces are high. A trick is an array of { seat, card } in play order.
 */
(function (root) {
  'use strict';

  const high = c => Cards.rankValue(c.r, true);

  /** Cards in `hand` that may be played to `trick` when following suit is required. */
  function followable(hand, trick) {
    if (!trick.length) return hand.slice();
    const led = trick[0].card.s;
    const same = hand.filter(c => c.s === led);
    return same.length ? same : hand.slice();
  }

  /** Winning play: highest trump if any trumps were played, else highest card of the led suit. */
  function trickWinner(trick, trump = null) {
    const led = trick[0].card.s;
    const trumps = trick.filter(p => trump && p.card.s === trump);
    const pool = trumps.length ? trumps : trick.filter(p => p.card.s === led);
    return pool.reduce((best, p) => (high(p.card) > high(best.card) ? p : best)).seat;
  }

  /** Seats 0–3 clockwise; the next seat to play after `seat`. */
  const nextSeat = seat => (seat + 1) % 4;

  /** Sort for display: suits alternating colour, high cards to the right. */
  const sortHand = hand => Cards.sortCards(hand, { aceHigh: true, suitOrder: ['♣', '♦', '♠', '♥'] });

  root.TrickCore = { high, followable, trickWinner, nextSeat, sortHand };
})(typeof window !== 'undefined' ? window : globalThis);
