/**
 * poker-logic.js — Texas Hold'em rules engine (no DOM, no network, no timers).
 *
 * Every function takes the game state object `gs` and mutates it in place.
 * The UI layer (poker-game.js) calls these on the host and then broadcasts
 * the result with Room.pushState(). Loaded as a classic script in the browser
 * (exposes `window.PokerLogic`) and via `vm` in the unit tests.
 *
 * State shape (host copy; guests receive a redacted copy without `deck` and
 * without other players' hands):
 *   phase: 'waiting' | 'pre-flop' | 'flop' | 'turn' | 'river' | 'showdown'
 *   round, dealer, currentPlayer, currentBet, minRaise, pot,
 *   players: { [seat]: Player }, communityCards, deck, hostSeat,
 *   streetActed: seats that acted since the street began / last full raise,
 *   showdownRevealed: true when hands were compared at showdown,
 *   lastAction, winnerInfo, actionLog
 *
 * Player: name, chips, handJSON, bet (this street), contributed (this hand),
 *         folded, allIn, active (dealt into this hand), isEmpty, disconnected
 */
(function (root) {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
  const MAX_PLAYERS = 4;
  const STARTING_CHIPS = 1000;
  const SMALL_BLIND = 10;
  const BIG_BLIND = 20;
  const BETTING_PHASES = ['pre-flop', 'flop', 'turn', 'river'];
  const PHASE_LABELS = {
    waiting: 'Waiting', 'pre-flop': 'Pre-Flop', flop: 'Flop', turn: 'Turn',
    river: 'River', showdown: 'Showdown',
  };

  const phaseLabel = p => PHASE_LABELS[p] || p;
  const parseHand = p => { try { return JSON.parse(p.handJSON) || []; } catch { return []; } };

  /* ───────────── Cards ───────────── */

  function makeDeck(rng = Math.random) {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  /* ───────────── Hand evaluation ───────────── */

  function choose(arr, k) {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const [first, ...rest] = arr;
    return [...choose(rest, k - 1).map(c => [first, ...c]), ...choose(rest, k)];
  }

  /** High card of a straight (5 for the A-2-3-4-5 wheel), or 0. */
  function straightHigh(descVals) {
    const u = [...new Set(descVals)];
    if (u.length !== 5) return 0;
    if (u[0] - u[4] === 4) return u[0];
    if (u[0] === 14 && u[1] === 5 && u[4] === 2) return 5;
    return 0;
  }

  /** Score exactly 5 cards. Higher `score` wins; equal scores split. */
  function score5(cards) {
    const vals = cards.map(c => RANK_VAL[c.r]).sort((a, b) => b - a);
    const flush = cards.every(c => c.s === cards[0].s);
    const sHigh = straightHigh(vals);

    // Group by rank: bigger groups first, then higher rank — this is the
    // order ranks are compared in (e.g. the pair before the kickers).
    const counts = {};
    for (const v of vals) counts[v] = (counts[v] || 0) + 1;
    const groups = Object.entries(counts)
      .map(([v, n]) => [Number(v), n])
      .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const shape = groups.map(g => g[1]);

    let rank, name;
    if (flush && sHigh === 14)                 { rank = 9; name = 'Royal Flush'; }
    else if (flush && sHigh)                   { rank = 8; name = 'Straight Flush'; }
    else if (shape[0] === 4)                   { rank = 7; name = 'Four of a Kind'; }
    else if (shape[0] === 3 && shape[1] === 2) { rank = 6; name = 'Full House'; }
    else if (flush)                            { rank = 5; name = 'Flush'; }
    else if (sHigh)                            { rank = 4; name = 'Straight'; }
    else if (shape[0] === 3)                   { rank = 3; name = 'Three of a Kind'; }
    else if (shape[0] === 2 && shape[1] === 2) { rank = 2; name = 'Two Pair'; }
    else if (shape[0] === 2)                   { rank = 1; name = 'One Pair'; }
    else                                       { rank = 0; name = 'High Card'; }

    const tiebreak = sHigh ? [sHigh] : groups.map(g => g[0]);
    const score = tiebreak.reduce((acc, v, i) => acc + v * Math.pow(15, 4 - i), rank * 1e10);
    return { rank, name, score, cards };
  }

  /** Best 5-card hand out of 5–7 cards. */
  function evalHand(cards) {
    if (!cards || cards.length < 5) return { rank: -1, name: '', score: -1, cards: [] };
    let best = null;
    for (const c of choose(cards, 5)) {
      const h = score5(c);
      if (!best || h.score > best.score) best = h;
    }
    return best;
  }

  /* ───────────── State construction ───────────── */

  function buildFreshRoomState(code) {
    return {
      roomCode: code,
      phase: 'waiting',
      round: 0,
      dealer: -1,
      currentPlayer: -1,
      currentBet: 0,
      minRaise: BIG_BLIND,
      pot: 0,
      players: {},
      communityCards: [],
      deck: [],
      hostSeat: 0,
      lastAction: '',
      winnerInfo: '',
      showdownRevealed: false,
      streetActed: [],
      actionLog: [],
      updatedAt: Date.now(),
    };
  }

  function freshPlayer(name) {
    return {
      name,
      chips: STARTING_CHIPS,
      handJSON: '[]',
      bet: 0,
      contributed: 0,
      folded: false,
      allIn: false,
      active: false,
      isEmpty: false,
      disconnected: false,
    };
  }

  /* ───────────── Seat helpers ───────────── */

  const seated = p => p && !p.isEmpty;
  const isLive = p => seated(p) && p.active && !p.folded;      // still contesting the pot
  const canAct = p => isLive(p) && !p.allIn;                     // can still bet

  /** Seats after `from` in clockwise order (wrapping, `from` itself last). */
  function seatsAfter(from) {
    const out = [];
    for (let i = 1; i <= MAX_PLAYERS; i++) out.push(((from + i) % MAX_PLAYERS + MAX_PLAYERS) % MAX_PLAYERS);
    return out;
  }

  function liveSeats(gs) { return seatsAfter(gs.dealer).filter(s => isLive(gs.players[s])); }
  function actorSeats(gs) { return seatsAfter(gs.dealer).filter(s => canAct(gs.players[s])); }

  function log(gs, line) { (gs.actionLog ??= []).push(line); }

  /* ───────────── Betting primitives ───────────── */

  function placeBet(gs, seat, amount) {
    const p = gs.players[seat];
    const actual = Math.max(0, Math.min(amount, p.chips));
    p.chips -= actual;
    p.bet += actual;
    p.contributed += actual;
    gs.pot += actual;
    if (p.chips === 0) p.allIn = true;
    return actual;
  }

  /**
   * The current street is over when nobody can still bet, when the only
   * player who can bet has already matched the bet, or when every player
   * who can bet has acted since the last full raise and matched the bet.
   */
  function isBettingRoundOver(gs) {
    const actors = actorSeats(gs);
    if (actors.length === 0) return true;
    if (actors.length === 1) return gs.players[actors[0]].bet >= gs.currentBet;
    const acted = gs.streetActed || [];
    return actors.every(s => acted.includes(s) && gs.players[s].bet === gs.currentBet);
  }

  /** Next seat clockwise after `from` that can still bet, or -1. */
  function nextActor(gs, from) {
    return seatsAfter(from).find(s => canAct(gs.players[s])) ?? -1;
  }

  /* ───────────── Hand lifecycle ───────────── */

  /**
   * Start a new hand: drop disconnected players, rebuy busted ones, move the
   * button, deal, post blinds. Returns false (and resets to 'waiting') when
   * fewer than two players remain.
   */
  function startHand(gs, deck = makeDeck()) {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = gs.players[i];
      if (!p) continue;
      if (p.disconnected || p.isEmpty) { delete gs.players[i]; continue; }
      if (p.chips <= 0) p.chips = STARTING_CHIPS;
      Object.assign(p, { bet: 0, contributed: 0, folded: false, allIn: false, active: true, handJSON: '[]' });
    }
    Object.assign(gs, {
      communityCards: [], deck, pot: 0, currentBet: 0, minRaise: BIG_BLIND,
      streetActed: [], winnerInfo: '', lastAction: '', showdownRevealed: false, currentPlayer: -1,
    });

    const seats = Object.keys(gs.players).map(Number);
    if (seats.length < 2) {
      for (const s of seats) gs.players[s].active = false;
      gs.phase = 'waiting';
      gs.deck = [];
      return false;
    }

    gs.dealer = seatsAfter(gs.dealer).find(s => gs.players[s]);
    gs.round = (gs.round || 0) + 1;
    gs.phase = 'pre-flop';
    if (gs.round === 1) gs.actionLog = [];
    log(gs, `--- Round ${gs.round} ---`);

    for (const s of liveSeats(gs)) {
      gs.players[s].handJSON = JSON.stringify([gs.deck.pop(), gs.deck.pop()]);
    }

    const order = liveSeats(gs); // starts left of the dealer, dealer last
    const sbSeat = order.length === 2 ? gs.dealer : order[0]; // heads-up: button posts SB
    const bbSeat = order.length === 2 ? order[0] : order[1];
    placeBet(gs, sbSeat, SMALL_BLIND);
    placeBet(gs, bbSeat, BIG_BLIND);
    gs.currentBet = Math.max(gs.players[sbSeat].bet, gs.players[bbSeat].bet);
    log(gs, `${gs.players[sbSeat].name} posts SB (${gs.players[sbSeat].bet})`);
    log(gs, `${gs.players[bbSeat].name} posts BB (${gs.players[bbSeat].bet})`);

    // Action starts left of the big blind (heads-up: the button/SB).
    gs.currentPlayer = bbSeat;
    settle(gs);
    return true;
  }

  /** Burn and deal the next street, reset street betting. */
  function dealNextStreet(gs) {
    const next = { 'pre-flop': 'flop', flop: 'turn', turn: 'river' }[gs.phase];
    for (const p of Object.values(gs.players)) if (p) p.bet = 0;
    gs.currentBet = 0;
    gs.minRaise = BIG_BLIND;
    gs.streetActed = [];
    gs.phase = next;
    gs.deck.pop(); // burn
    const n = next === 'flop' ? 3 : 1;
    for (let i = 0; i < n; i++) gs.communityCards.push(gs.deck.pop());
    log(gs, `--- ${phaseLabel(next)} ---`);
    gs.currentPlayer = gs.dealer; // first to act is left of the button
  }

  /**
   * Move the hand forward after an action or the blinds: pick the next player
   * to act, or deal the next street, or — when nobody can bet any more —
   * run out the board to showdown.
   */
  function settle(gs) {
    for (;;) {
      if (liveSeats(gs).length <= 1) { awardUncontested(gs); return; }
      if (!isBettingRoundOver(gs)) {
        gs.currentPlayer = nextActor(gs, gs.currentPlayer);
        return;
      }
      if (gs.phase === 'river') { resolveShowdown(gs); return; }
      dealNextStreet(gs);
    }
  }

  function endHand(gs, info, revealed) {
    gs.winnerInfo = info;
    log(gs, info);
    gs.pot = 0;
    gs.phase = 'showdown';
    gs.showdownRevealed = revealed;
    gs.currentPlayer = -1;
    for (const p of Object.values(gs.players)) if (p) p.bet = 0;
  }

  function awardUncontested(gs) {
    const [winner] = liveSeats(gs);
    const p = gs.players[winner];
    const won = gs.pot;
    p.chips += won;
    endHand(gs, `🏆 ${p.name} wins ${won} chips (everyone else folded)!`, false);
  }

  /**
   * Split the pot into a main pot and side pots by contribution level.
   * Returns [{ amount, eligible: seat[] }]. Chips put in by folded players
   * count toward the pots but they are never eligible.
   */
  function buildPots(gs) {
    const all = Object.keys(gs.players).map(Number).filter(s => gs.players[s]);
    const live = liveSeats(gs);
    const levels = [...new Set(live.map(s => gs.players[s].contributed))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const s of all) {
        const c = gs.players[s].contributed;
        amount += Math.min(c, level) - Math.min(c, prev);
      }
      const eligible = live.filter(s => gs.players[s].contributed >= level);
      if (amount > 0) pots.push({ amount, eligible });
      prev = level;
    }
    // Folded players who put in more than any live player: give it to the last pot.
    const over = all.reduce((acc, s) => acc + Math.max(0, gs.players[s].contributed - prev), 0);
    if (over > 0 && pots.length) pots[pots.length - 1].amount += over;
    return pots;
  }

  function resolveShowdown(gs) {
    while (gs.communityCards.length < 5 && gs.deck.length) gs.communityCards.push(gs.deck.pop());
    const hands = {};
    for (const s of liveSeats(gs)) hands[s] = evalHand([...parseHand(gs.players[s]), ...gs.communityCards]);

    const pots = buildPots(gs);
    const lines = [];
    pots.forEach((pot, i) => {
      const best = Math.max(...pot.eligible.map(s => hands[s].score));
      const winners = pot.eligible.filter(s => hands[s].score === best); // clockwise from the button
      const share = Math.floor(pot.amount / winners.length);
      const remainder = pot.amount - share * winners.length;
      winners.forEach((s, j) => { gs.players[s].chips += share + (j === 0 ? remainder : 0); });
      const names = winners.map(s => gs.players[s].name).join(' & ');
      const label = pots.length === 1 ? '' : i === 0 ? 'Main pot: ' : `Side pot${pots.length > 2 ? ` ${i}` : ''}: `;
      const verb = winners.length > 1 ? 'split' : 'wins';
      lines.push(`${label}${names} ${verb} ${pot.amount} chips with ${hands[winners[0]].name}`);
    });
    endHand(gs, `🏆 ${lines.join(' · ')}!`, true);
  }

  /* ───────────── Player actions ───────────── */

  /** What `seat` may do right now (for the UI and for validation). */
  function legalActions(gs, seat) {
    const p = gs.players[seat];
    const none = { canAct: false, canCheck: false, canCall: false, canRaise: false, toCall: 0, minRaise: 0, maxRaise: 0 };
    if (!BETTING_PHASES.includes(gs.phase) || gs.currentPlayer !== seat || !canAct(p)) return none;
    const toCall = Math.max(0, gs.currentBet - p.bet);
    const maxRaise = p.chips - toCall; // raising by this much puts you all-in
    return {
      canAct: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      canRaise: maxRaise > 0,
      toCall,
      minRaise: Math.min(gs.minRaise, maxRaise),
      maxRaise,
    };
  }

  /**
   * Apply an action from `seat`. `amount` for 'raise' is the amount *above*
   * the call. Raising by your whole remaining stack (or more) is an all-in.
   * Returns { ok: true } or { ok: false, error }. Invalid actions change nothing.
   */
  function applyAction(gs, seat, action, amount = 0) {
    const legal = legalActions(gs, seat);
    if (!legal.canAct) return { ok: false, error: 'Not your turn.' };
    const p = gs.players[seat];
    const prevBet = gs.currentBet;
    let label;

    switch (action) {
      case 'fold':
        p.folded = true;
        label = `${p.name} folds`;
        break;

      case 'check':
        if (!legal.canCheck) return { ok: false, error: 'Cannot check — there is a bet to call.' };
        label = `${p.name} checks`;
        break;

      case 'call': {
        if (!legal.canCall) return { ok: false, error: 'Nothing to call.' };
        const paid = placeBet(gs, seat, legal.toCall);
        label = p.allIn ? `${p.name} calls ${paid} (all-in)` : `${p.name} calls ${paid}`;
        break;
      }

      case 'raise':
      case 'allin': {
        if (!legal.canRaise) return { ok: false, error: 'Cannot raise.' };
        let by = action === 'allin' ? legal.maxRaise : Number(amount);
        if (!Number.isInteger(by) || by <= 0) return { ok: false, error: 'Invalid raise amount.' };
        if (by >= legal.maxRaise) by = legal.maxRaise;
        else if (by < legal.minRaise) return { ok: false, error: `Minimum raise is ${legal.minRaise}.` };
        placeBet(gs, seat, legal.toCall + by);
        label = p.allIn ? `${p.name} goes all-in (${p.bet})` : `${p.name} raises to ${p.bet}`;
        break;
      }

      default:
        return { ok: false, error: 'Unknown action.' };
    }

    if (p.bet > prevBet) {
      const raiseBy = p.bet - prevBet;
      gs.currentBet = p.bet;
      if (raiseBy >= gs.minRaise) {
        // Full raise: re-opens the betting for everyone else.
        gs.minRaise = raiseBy;
        gs.streetActed = [seat];
      } else if (!gs.streetActed.includes(seat)) {
        // Short all-in raise: others must still match it.
        gs.streetActed.push(seat);
      }
    } else if (action !== 'fold' && !gs.streetActed.includes(seat)) {
      gs.streetActed.push(seat);
    }

    gs.lastAction = label;
    log(gs, label);
    settle(gs);
    return { ok: true };
  }

  /** Whether `viewer` may see `owner`'s hole cards in this state. */
  function canSeeHand(gs, viewer, owner) {
    if (viewer === owner) return true;
    const p = gs.players[owner];
    return gs.phase === 'showdown' && gs.showdownRevealed && isLive(p);
  }

  root.PokerLogic = {
    SUITS, RANKS, RANK_VAL, MAX_PLAYERS, STARTING_CHIPS, SMALL_BLIND, BIG_BLIND, BETTING_PHASES,
    phaseLabel, makeDeck, evalHand, score5,
    buildFreshRoomState, freshPlayer,
    startHand, applyAction, legalActions, isBettingRoundOver, buildPots, canSeeHand,
    isLive, canAct,
  };
})(typeof window !== 'undefined' ? window : globalThis);
