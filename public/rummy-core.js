/**
 * rummy-core.js — shared meld engine for the rummy family (Gin, Rummy,
 * Rummy 500). Pure functions, no DOM. Requires cards.js.
 * Exposes `window.RummyCore`.
 *
 * Options accepted by most functions:
 *   aceHigh  — an Ace may also sit above the King in a run (Q-K-A), but a run
 *              never wraps around (K-A-2 is not a run). Default: Ace low only.
 */
(function (root) {
  'use strict';

  const { rankValue, key, same } = Cards;

  /** Deadwood / penalty value used by Gin and Basic Rummy: A=1, 2–10 face, J/Q/K=10. */
  const pipValue = c => Math.min(10, rankValue(c.r));

  function isSet(cards) {
    if (cards.length < 3 || cards.length > 4) return false;
    return cards.every(c => c.r === cards[0].r) && new Set(cards.map(c => c.s)).size === cards.length;
  }

  /** Run values sorted ascending, trying Ace low then (if allowed) Ace high. Returns null if not a run. */
  function runValues(cards, { aceHigh = false } = {}) {
    if (cards.length < 3 || !cards.every(c => c.s === cards[0].s)) return null;
    const tries = aceHigh ? [false, true] : [false];
    for (const hi of tries) {
      const v = cards.map(c => rankValue(c.r, hi)).sort((a, b) => a - b);
      if (v.every((x, i) => i === 0 || x === v[i - 1] + 1)) return v;
    }
    return null;
  }

  const isRun = (cards, opts) => runValues(cards, opts) !== null;
  const isMeld = (cards, opts) => isSet(cards) || isRun(cards, opts);
  const meldType = (cards, opts) => (isSet(cards) ? 'set' : isRun(cards, opts) ? 'run' : null);

  /** Can `card` be added to an existing meld? */
  const canLayOff = (card, meld, opts) => isMeld([...meld, card], opts);

  /** Sort a meld for display: runs in rank order, sets by suit. */
  function sortMeld(cards, opts = {}) {
    if (isRun(cards, opts)) {
      const hi = opts.aceHigh && !isRun(cards, { aceHigh: false });
      return [...cards].sort((a, b) => rankValue(a.r, hi) - rankValue(b.r, hi));
    }
    return Cards.sortCards(cards);
  }

  /**
   * All melds that can be made from `hand`, as arrays of indexes into hand.
   * Includes every 3- and 4-card set and every run window of length ≥ 3.
   */
  function meldCandidates(hand, opts = {}) {
    const out = [];
    const byRank = {};
    hand.forEach((c, i) => (byRank[c.r] ??= []).push(i));
    for (const idx of Object.values(byRank)) {
      const uniq = idx.filter((i, j) => idx.findIndex(k => hand[k].s === hand[i].s) === j);
      if (uniq.length === 4) out.push(uniq);
      if (uniq.length >= 3) for (let skip = 0; skip < uniq.length; skip++) {
        if (uniq.length === 3 && skip > 0) break;
        out.push(uniq.length === 3 ? uniq : uniq.filter((_, j) => j !== skip));
      }
    }
    const seen = new Set();
    for (const hi of opts.aceHigh ? [false, true] : [false]) {
      const bySuit = {};
      hand.forEach((c, i) => (bySuit[c.s] ??= []).push(i));
      for (const idx of Object.values(bySuit)) {
        const sorted = [...idx].sort((a, b) => rankValue(hand[a].r, hi) - rankValue(hand[b].r, hi));
        for (let start = 0; start < sorted.length; start++) {
          const run = [sorted[start]];
          for (let j = start + 1; j < sorted.length; j++) {
            if (rankValue(hand[sorted[j]].r, hi) !== rankValue(hand[run[run.length - 1]].r, hi) + 1) break;
            run.push(sorted[j]);
            if (run.length >= 3) {
              const id = [...run].sort((a, b) => a - b).join(',');
              if (!seen.has(id)) { seen.add(id); out.push([...run]); }
            }
          }
        }
      }
    }
    return out;
  }

  /**
   * Arrange `hand` into melds leaving the least deadwood.
   * `extra` adds more candidate groups (index arrays) that count as melded —
   * used for Gin layoffs. Returns { melds: Card[][], extras: Card[][], deadwood: Card[], value }.
   */
  function bestMelds(hand, { value = pipValue, aceHigh = false, extra = [] } = {}) {
    const n = hand.length;
    const cands = [
      ...meldCandidates(hand, { aceHigh }).map(ix => ({ ix, extra: false })),
      ...extra.map(ix => ({ ix, extra: true })),
    ].map(c => ({ ...c, mask: c.ix.reduce((m, i) => m | (1 << i), 0) }));
    const byCard = Array.from({ length: n }, () => []);
    for (const c of cands) byCard[Math.min(...c.ix)].push(c);

    let best = { value: Infinity, chosen: [] };
    const chosen = [];
    (function dfs(i, used, dw) {
      if (dw >= best.value) return;
      while (i < n && (used >> i) & 1) i++;
      if (i === n) { best = { value: dw, chosen: [...chosen] }; return; }
      for (const c of byCard[i]) {
        if (c.mask & used) continue;
        chosen.push(c);
        dfs(i + 1, used | c.mask, dw);
        chosen.pop();
      }
      dfs(i + 1, used | (1 << i), dw + value(hand[i]));
    })(0, 0, 0);

    const usedIx = new Set(best.chosen.flatMap(c => c.ix));
    return {
      melds: best.chosen.filter(c => !c.extra).map(c => sortMeld(c.ix.map(i => hand[i]), { aceHigh })),
      extras: best.chosen.filter(c => c.extra).map(c => c.ix.map(i => hand[i])),
      deadwood: hand.filter((_, i) => !usedIx.has(i)),
      value: best.value,
    };
  }

  /**
   * Groups of cards from `hand` that could be laid off on `melds` (index
   * arrays into hand). Sets take their missing suit; runs take consecutive
   * cards at either end (each end separately).
   */
  function layoffCandidates(hand, melds, opts = {}) {
    const out = [];
    for (const meld of melds) {
      if (isSet(meld)) {
        if (meld.length === 3) hand.forEach((c, i) => { if (c.r === meld[0].r && !meld.some(m => m.s === c.s)) out.push([i]); });
        continue;
      }
      const vals = runValues(meld, opts);
      if (!vals) continue;
      const suit = meld[0].s;
      const find = v => hand.findIndex(c => c.s === suit && (v === 1 || v === 14 ? c.r === 'A' : rankValue(c.r) === v));
      for (const dir of [-1, 1]) {
        const group = [];
        let v = dir < 0 ? vals[0] - 1 : vals[vals.length - 1] + 1;
        for (;;) {
          if (v < 1 || v > (opts.aceHigh ? 14 : 13)) break;
          const i = find(v);
          if (i === -1) break;
          group.push(i);
          out.push([...group]);
          v += dir;
        }
      }
    }
    return out;
  }

  /** Remove `cards` from `hand` (both arrays of cards). Returns the new hand or null if any is missing. */
  function without(hand, cards) {
    const rest = hand.slice();
    for (const c of cards) {
      const i = rest.findIndex(x => same(x, c));
      if (i === -1) return null;
      rest.splice(i, 1);
    }
    return rest;
  }

  root.RummyCore = {
    pipValue, isSet, isRun, isMeld, meldType, runValues, canLayOff, sortMeld,
    meldCandidates, bestMelds, layoffCandidates, without, key,
  };
})(typeof window !== 'undefined' ? window : globalThis);
