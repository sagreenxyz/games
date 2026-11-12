/**
 * rummy-logic.js — Basic Rummy and Rummy 500 (2–6 players), one engine with
 * two variants. Requires cards.js and rummy-core.js. Implements the shared
 * engine interface (see room.js). Exposes `window.RummyLogic` with
 * `.basic` and `.r500` engines.
 *
 * Shared turn: draw (stock or discard pile), then any number of melds and
 * lay-offs onto any meld on the table, then discard one card. Emptying your
 * hand — by melding or discarding your last card — goes out.
 *
 * Basic Rummy:
 *  - Deal 10 cards each for 2 players, 7 for 3–4, 6 for 5–6. Aces are low.
 *  - Only the top discard may be taken, and not thrown back the same turn
 *    (unless it is the last card in your hand).
 *  - When the stock runs out the discard pile (except its top card) is turned
 *    over to form a new stock — at most twice per hand. If the stock runs out
 *    again, the hand ends with no score (it could otherwise go on forever).
 *  - The player who goes out scores the value of everyone else's cards
 *    (A=1, 2–10 face value, J/Q/K=10), doubled if they went out in one turn
 *    without having melded before ("rummy"). First to 100 wins.
 *
 * Rummy 500:
 *  - Deal 13 cards each for 2 players, 7 for 3–6. Aces may be low (A-2-3) or
 *    high (Q-K-A), never both.
 *  - You may take any card from the discard pile, together with every card
 *    above it. If you take more than the top card, the deepest card you took
 *    must be melded (or laid off) this turn, before anything else.
 *  - When the stock is empty, a player who doesn't want the discard pile may
 *    end the hand.
 *  - At the end of a hand everyone scores the cards they melded or laid off
 *    minus the cards left in their hand: Ace 15 (1 in a low run), 10/J/Q/K 10,
 *    2–9 5. First to 500 wins (highest score if several pass 500 together).
 */
(function (root) {
  'use strict';

  const R = RummyCore;
  const parseHand = p => Cards.parseHand(p);
  const setHand = (p, h) => { p.handJSON = JSON.stringify(h); };
  const log = (gs, line) => (gs.actionLog ??= []).push(line);
  const fmt = c => c.r + c.s;
  const strip = c => ({ r: c.r, s: c.s });

  const MAX_TURNOVERS = 2;
  const v500 = c => (c.r === 'A' ? 15 : ['10', 'J', 'Q', 'K'].includes(c.r) ? 10 : 5);

  const VARIANTS = {
    basic: {
      id: 'rummy', name: 'Rummy', aceHigh: false, target: 100,
      dealSize: n => (n === 2 ? 10 : n <= 4 ? 7 : 6),
      takeAnyDiscard: false, reshuffle: true, cardValue: R.pipValue,
    },
    r500: {
      id: 'rummy500', name: 'Rummy 500', aceHigh: true, target: 500,
      dealSize: n => (n === 2 ? 13 : 7),
      takeAnyDiscard: true, reshuffle: false, cardValue: v500,
    },
  };

  function makeEngine(V) {
    const opts = { aceHigh: V.aceHigh };

    const create = code => ({
      roomCode: code, variant: V.id, phase: 'waiting', round: 0, dealer: -1, currentPlayer: -1,
      step: null, stock: [], discard: [], table: [], nextMeldId: 1, turnovers: 0,
      mustUse: null, noDiscard: null, turnHadMelded: false,
      players: {}, result: null, final: null, hostSeat: 0, lastAction: '', actionLog: [], updatedAt: Date.now(),
    });

    const freshPlayer = name => ({ name, handJSON: '[]', score: 0, hasMelded: false, isEmpty: false, disconnected: false });

    const seatsInPlay = gs => Object.keys(gs.players).map(Number).sort((a, b) => a - b)
      .filter(s => gs.players[s] && !gs.players[s].isEmpty && !gs.players[s].left);
    const nextSeat = (gs, from) => { const s = seatsInPlay(gs); return s.find(x => x > from) ?? s[0]; };

    function deal(gs, rng) {
      const seats = seatsInPlay(gs);
      const deck = Cards.makeDeck(rng);
      const n = V.dealSize(seats.length);
      gs.dealer = seats.includes(gs.dealer) ? nextSeat(gs, gs.dealer) : seats[seats.length - 1];
      for (const s of seats) {
        setHand(gs.players[s], deck.splice(0, n));
        gs.players[s].hasMelded = false;
      }
      gs.discard = [deck.pop()];
      gs.stock = deck;
      gs.table = [];
      gs.turnovers = 0;
      gs.round += 1;
      gs.phase = 'playing';
      gs.result = null;
      beginTurn(gs, nextSeat(gs, gs.dealer));
      log(gs, `--- Hand ${gs.round} — ${gs.players[gs.dealer].name} deals ---`);
    }

    function beginTurn(gs, seat) {
      gs.currentPlayer = seat;
      gs.step = 'draw';
      gs.mustUse = null;
      gs.noDiscard = null;
      gs.turnHadMelded = !!gs.players[seat].hasMelded;
    }

    function start(gs, rng) {
      const seats = seatsInPlay(gs);
      if (seats.length < 2 || seats.length > 6) return false;
      for (const s of seats) gs.players[s].score = 0;
      Object.assign(gs, { round: 0, final: null, actionLog: [], dealer: -1, nextMeldId: 1 });
      deal(gs, rng);
      return true;
    }

    function nextRound(gs, rng) {
      if (gs.phase !== 'handOver') return false;
      deal(gs, rng);
      return true;
    }

    /* ───────────── helpers ───────────── */

    /** Could `card` be melded from `hand` (which contains it) or laid off on the table? */
    function canUse(card, hand, table) {
      if (table.some(m => R.canLayOff(card, m.cards, opts))) return true;
      const i = hand.findIndex(c => Cards.same(c, card));
      return R.meldCandidates(hand, opts).some(ix => ix.includes(i));
    }

    const canTurnOver = gs => V.reshuffle && gs.discard.length > 1 && (gs.turnovers || 0) < MAX_TURNOVERS;
    // Guests see a redacted state with stockCount instead of stock.
    const stockLen = gs => (gs.stock ? gs.stock.length : gs.stockCount || 0);
    const canDrawStock = gs => stockLen(gs) > 0 || canTurnOver(gs);

    function canTakeDiscard(gs, hand, index) {
      if (index < 0 || index >= gs.discard.length) return false;
      if (!V.takeAnyDiscard && index !== gs.discard.length - 1) return false;
      if (index === gs.discard.length - 1) return true;
      const taken = gs.discard.slice(index);
      return canUse(gs.discard[index], [...hand, ...taken], gs.table);
    }

    /** Points a meld is worth to the player(s) who put cards in it (Rummy 500). */
    function meldCardValue(meld, card) {
      if (card.r === 'A' && R.isRun(meld.cards, { aceHigh: false })) return 1; // low run
      return V.cardValue(card);
    }

    /* ───────────── end of hand ───────────── */

    function endHand(gs, outSeat) {
      const seats = seatsInPlay(gs);
      const rows = {};
      for (const s of Object.keys(gs.players).map(Number)) {
        const p = gs.players[s];
        if (!p) continue;
        const hand = parseHand(p);
        const melded = gs.table.reduce((a, m) => a + m.cards.filter(c => c.by === s).reduce((b, c) => b + meldCardValue(m, c), 0), 0);
        rows[s] = { inHand: hand.reduce((a, c) => a + V.cardValue(c), 0), melded, points: 0 };
      }
      let rummy = false;
      if (V.id === 'rummy') {
        if (outSeat !== null) {
          const total = seats.filter(s => s !== outSeat).reduce((a, s) => a + rows[s].inHand, 0);
          rummy = !gs.turnHadMelded;
          rows[outSeat].points = total * (rummy ? 2 : 1);
        }
      } else {
        for (const s of seats) rows[s].points = rows[s].melded - rows[s].inHand;
      }
      for (const s of seats) gs.players[s].score += rows[s].points;
      gs.result = { outSeat, rummy, rows };
      const line = outSeat !== null
        ? `🏆 ${gs.players[outSeat].name} goes out${rummy ? ' — rummy!' : ''}`
        : '🏁 The stock ran out — hand over';
      gs.lastAction = line;
      log(gs, line);
      gs.step = null;
      gs.currentPlayer = -1;
      gs.mustUse = null;
      gs.noDiscard = null;

      const scores = seats.map(s => gs.players[s].score);
      const top = Math.max(...scores);
      const leaders = seats.filter(s => gs.players[s].score === top);
      if (top >= V.target && leaders.length === 1) finishMatch(gs, leaders[0], false);
      else gs.phase = 'handOver';
    }

    function finishMatch(gs, winner, forfeit) {
      gs.phase = 'matchOver';
      gs.final = { winner, forfeit };
      gs.step = null;
      gs.currentPlayer = -1;
      log(gs, `--- Match over: ${gs.players[winner].name} wins${forfeit ? ' (everyone else left)' : ''} ---`);
    }

    /* ───────────── actions ───────────── */

    function legalActions(gs, seat) {
      if (gs.phase !== 'playing' || gs.currentPlayer !== seat) return [];
      const hand = parseHand(gs.players[seat]);
      const out = [];
      if (gs.step === 'draw') {
        if (canDrawStock(gs)) out.push({ type: 'drawStock' });
        for (let i = 0; i < gs.discard.length; i++) if (canTakeDiscard(gs, hand, i)) out.push({ type: 'takeDiscard', index: i });
        if (!canDrawStock(gs)) out.push({ type: 'endHand' });
        return out;
      }
      const mu = gs.mustUse;
      for (const ix of R.meldCandidates(hand, opts)) {
        const cards = ix.map(i => hand[i]);
        if (mu && !cards.some(c => Cards.same(c, mu))) continue;
        out.push({ type: 'meld', cards });
      }
      for (const card of hand) {
        if (mu && !Cards.same(card, mu)) continue;
        for (const m of gs.table) if (R.canLayOff(card, m.cards, opts)) out.push({ type: 'layoff', card, meld: m.id });
      }
      // The card just taken can't be thrown back — unless it's your last card.
      if (!mu) for (const card of hand) if (hand.length === 1 || !Cards.same(card, gs.noDiscard)) out.push({ type: 'discard', card });
      return out;
    }

    function apply(gs, seat, action) {
      if (gs.phase !== 'playing' || gs.currentPlayer !== seat) return { ok: false, error: 'Not your turn.' };
      const p = gs.players[seat];
      const hand = parseHand(p);
      const type = action?.type;

      if (gs.step === 'draw') {
        if (type === 'drawStock') {
          if (!gs.stock.length) {
            if (!canTurnOver(gs)) return { ok: false, error: 'The stock is empty.' };
            const top = gs.discard.pop();
            gs.stock = gs.discard.reverse();
            gs.discard = [top];
            gs.turnovers = (gs.turnovers || 0) + 1;
            log(gs, 'The discard pile is turned over to make a new stock');
          }
          hand.push(gs.stock.pop());
          gs.lastAction = `${p.name} draws from the stock`;
        } else if (type === 'takeDiscard') {
          const index = Number(action.index);
          if (!Number.isInteger(index) || !canTakeDiscard(gs, hand, index)) {
            return { ok: false, error: V.takeAnyDiscard ? "You can only take a card you can meld this turn." : 'You can only take the top discard.' };
          }
          const taken = gs.discard.splice(index);
          hand.push(...taken);
          if (taken.length === 1) gs.noDiscard = taken[0];
          else gs.mustUse = taken[0];
          gs.lastAction = taken.length === 1 ? `${p.name} takes ${fmt(taken[0])}` : `${p.name} takes ${taken.length} cards from the discard pile`;
        } else if (type === 'endHand') {
          if (canDrawStock(gs)) return { ok: false, error: 'There are still cards to draw.' };
          endHand(gs, null);
          return { ok: true };
        } else return { ok: false, error: 'Draw a card first.' };
        setHand(p, hand);
        gs.step = 'play';
        log(gs, gs.lastAction);
        return { ok: true };
      }

      // step === 'play'
      if (type === 'meld') {
        const cards = Array.isArray(action.cards) ? action.cards.map(strip) : [];
        const rest = R.without(hand, cards);
        if (!rest || !R.isMeld(cards, opts)) return { ok: false, error: 'Those cards are not a valid set or run.' };
        if (gs.mustUse && !cards.some(c => Cards.same(c, gs.mustUse))) return { ok: false, error: `Meld ${fmt(gs.mustUse)} first — you took it from the discard pile.` };
        gs.table.push({ id: gs.nextMeldId++, cards: R.sortMeld(cards, opts).map(c => ({ ...c, by: seat })) });
        afterMeld(gs, p, rest, cards);
        gs.lastAction = `${p.name} melds ${cards.map(fmt).join(' ')}`;
        log(gs, gs.lastAction);
        if (rest.length === 0) endHand(gs, seat);
        return { ok: true };
      }
      if (type === 'layoff') {
        const card = action.card && strip(action.card);
        const meld = gs.table.find(m => m.id === action.meld);
        const rest = card && R.without(hand, [card]);
        if (!rest || !meld || !R.canLayOff(card, meld.cards, opts)) return { ok: false, error: "That card doesn't fit there." };
        if (gs.mustUse && !Cards.same(card, gs.mustUse)) return { ok: false, error: `Meld ${fmt(gs.mustUse)} first — you took it from the discard pile.` };
        meld.cards = R.sortMeld([...meld.cards, { ...card, by: seat }], opts).map(c => ({ ...c, by: c.by ?? seat }));
        afterMeld(gs, p, rest, [card]);
        gs.lastAction = `${p.name} lays off ${fmt(card)}`;
        log(gs, gs.lastAction);
        if (rest.length === 0) endHand(gs, seat);
        return { ok: true };
      }
      if (type === 'discard') {
        const card = action.card && strip(action.card);
        const rest = card && R.without(hand, [card]);
        if (!rest) return { ok: false, error: 'You do not hold that card.' };
        if (gs.mustUse) return { ok: false, error: `You must meld ${fmt(gs.mustUse)} before discarding.` };
        if (hand.length > 1 && Cards.same(card, gs.noDiscard)) return { ok: false, error: "You can't discard the card you just took." };
        setHand(p, rest);
        gs.discard.push(card);
        gs.lastAction = `${p.name} discards ${fmt(card)}`;
        log(gs, gs.lastAction);
        if (rest.length === 0) endHand(gs, seat);
        else beginTurn(gs, nextSeat(gs, seat));
        return { ok: true };
      }
      return { ok: false, error: 'Meld, lay off or discard.' };
    }

    function afterMeld(gs, p, rest, used) {
      setHand(p, rest);
      p.hasMelded = true;
      if (gs.mustUse && used.some(c => Cards.same(c, gs.mustUse))) gs.mustUse = null;
      if (used.some(c => Cards.same(c, gs.noDiscard))) gs.noDiscard = null;
    }

    function removePlayer(gs, seat) {
      const p = gs.players[seat];
      if (!p) return;
      p.left = true;
      if (gs.phase === 'waiting' || gs.phase === 'matchOver') return;
      // Their cards go to the bottom of the stock so nothing is lost.
      gs.stock.unshift(...parseHand(p));
      setHand(p, []);
      log(gs, `${p.name} left the game`);
      const seats = seatsInPlay(gs);
      if (seats.length < 2) { finishMatch(gs, seats[0], true); return; }
      if (gs.phase === 'playing' && gs.currentPlayer === seat) {
        // Undo anything half-done this turn isn't possible; just move on.
        beginTurn(gs, nextSeat(gs, seat));
      }
    }

    const isOver = gs => gs.phase === 'handOver' || gs.phase === 'matchOver';

    return {
      id: V.id, name: V.name, minPlayers: 2, maxPlayers: 6, hiddenFields: ['stock'],
      variant: V,
      create, freshPlayer, start, nextRound, apply, legalActions, removePlayer, isOver,
      isMatchOver: gs => gs.phase === 'matchOver',
      canSeeHand: (gs, viewer, owner) => viewer === owner || isOver(gs),
      allCards: gs => [...gs.stock, ...gs.discard, ...gs.table.flatMap(m => m.cards.map(strip)),
        ...Object.values(gs.players).flatMap(p => (p ? parseHand(p) : []))],
      canLayOff: (card, meld) => R.canLayOff(card, meld.cards, opts),
      isMeld: cards => R.isMeld(cards, opts),
      canTakeDiscard: (gs, hand, i) => canTakeDiscard(gs, hand, i),
    };
  }

  root.RummyLogic = { basic: makeEngine(VARIANTS.basic), r500: makeEngine(VARIANTS.r500) };
})(typeof window !== 'undefined' ? window : globalThis);
