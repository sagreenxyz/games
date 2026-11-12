/**
 * cards.js — shared playing-card helpers for every game.
 *
 * Pure data helpers (deck, shuffle, ranks, sorting) are safe to use from
 * rules engines; cardHTML() returns a string and touches no DOM, so it can
 * be shared by every game UI. Exposes `window.Cards` (or `globalThis.Cards`
 * when loaded into a vm sandbox by the unit tests).
 *
 * A card is { r, s }: rank '2'…'10','J','Q','K','A' and suit '♠','♥','♦','♣'.
 */
(function (root) {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const RED = new Set(['♥', '♦']);
  const SUIT_NAMES = { '♠': 'Spades', '♥': 'Hearts', '♦': 'Diamonds', '♣': 'Clubs' };

  /** Rank as a number. Ace is 1, or 14 when `aceHigh`. */
  function rankValue(r, aceHigh = false) {
    if (r === 'A') return aceHigh ? 14 : 1;
    if (r === 'J') return 11;
    if (r === 'Q') return 12;
    if (r === 'K') return 13;
    return Number(r);
  }

  const key = c => c.r + c.s;
  const same = (a, b) => !!a && !!b && a.r === b.r && a.s === b.s;
  const isRed = c => RED.has(c.s);

  function shuffle(arr, rng = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** A shuffled 52-card deck. */
  function makeDeck(rng = Math.random) {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
    return shuffle(d, rng);
  }

  /** Remove the first card equal to `card` from `cards`; returns it or null. */
  function take(cards, card) {
    const i = cards.findIndex(c => same(c, card));
    return i === -1 ? null : cards.splice(i, 1)[0];
  }

  /** True if every card in `subset` can be taken from `cards` (respecting duplicates). */
  function containsAll(cards, subset) {
    const pool = cards.slice();
    return subset.every(c => take(pool, c));
  }

  /**
   * Sorted copy of `cards`. by: 'suit' (suit then rank) or 'rank' (rank then suit).
   * `suitOrder` defaults to ♠ ♥ ♣ ♦ (alternating colours).
   */
  function sortCards(cards, { by = 'suit', aceHigh = false, suitOrder = ['♠', '♥', '♣', '♦'] } = {}) {
    const sv = c => suitOrder.indexOf(c.s);
    const rv = c => rankValue(c.r, aceHigh);
    return [...cards].sort((a, b) => by === 'rank'
      ? (rv(a) - rv(b)) || (sv(a) - sv(b))
      : (sv(a) - sv(b)) || (rv(a) - rv(b)));
  }

  function parseHand(p) {
    if (!p) return [];
    try { return JSON.parse(p.handJSON) || []; } catch { return []; }
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * HTML for one card.
   * opts: faceDown, selected, playable (adds data-card attr + pointer),
   *       highlight (green outline), dim, small, title, extra (raw attrs)
   */
  function cardHTML(card, opts = {}) {
    const { faceDown = false, selected = false, playable = false, highlight = false, dim = false, small = false, title = '', extra = '' } = opts;
    const size = small ? ' small' : '';
    if (faceDown || !card) return `<div class="playing-card back${size}" ${extra}></div>`;
    const cls = ['playing-card', isRed(card) ? 'red' : 'black'];
    if (small) cls.push('small');
    if (selected) cls.push('selected');
    if (playable) cls.push('playable');
    if (highlight) cls.push('highlight');
    if (dim) cls.push('dim');
    const data = playable ? ` data-card="${esc(key(card))}" role="button" tabindex="0" aria-label="${esc(card.r + ' of ' + SUIT_NAMES[card.s])}"` : '';
    return `<div class="${cls.join(' ')}"${data}${title ? ` title="${esc(title)}"` : ''} ${extra}>
      <span class="card-rank-top">${card.r}</span>
      <span class="card-suit-mid">${card.s}</span>
      <span class="card-rank-bot">${card.r}</span>
    </div>`;
  }

  /** Parse a card key ("10♥") back into a card. */
  function fromKey(k) { return { r: k.slice(0, -1), s: k.slice(-1) }; }

  root.Cards = {
    SUITS, RANKS, SUIT_NAMES,
    rankValue, key, fromKey, same, isRed, shuffle, makeDeck, take, containsAll, sortCards, parseHand,
    cardHTML, esc,
  };
})(typeof window !== 'undefined' ? window : globalThis);
