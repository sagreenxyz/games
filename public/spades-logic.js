/**
 * spades-logic.js — Spades for 4 players in two partnerships (seats 1 & 3
 * vs 2 & 4 — internally 0 & 2 vs 1 & 3). Requires cards.js and
 * tricks-core.js. Implements the shared engine interface (see room.js).
 * Exposes `window.SpadesLogic`.
 *
 * Rules:
 *  - 13 cards each. Starting left of the dealer, everyone bids how many
 *    tricks they expect to take (0–13). A bid of 0 is "nil".
 *  - The player left of the dealer leads. Follow suit if you can. Spades
 *    are trumps and can't be led until one has been played ("broken"),
 *    unless you hold only spades.
 *  - A team's contract is the sum of its non-nil bids. Making it scores
 *    10 × contract plus 1 per extra trick ("bag"); missing it scores
 *    −10 × contract. Every 10 bags accumulated costs 100 points.
 *  - Nil: +100 if that player takes no tricks, −100 otherwise. A nil
 *    bidder's tricks don't help the partner's contract; they count as bags.
 *  - First team to 500 wins (the higher score if both pass 500 together).
 */
(function (root) {
  'use strict';

  const T = TrickCore;
  const TARGET = 500;
  const parseHand = p => Cards.parseHand(p);
  const setHand = (p, h) => { p.handJSON = JSON.stringify(h); };
  const log = (gs, line) => (gs.actionLog ??= []).push(line);
  const fmt = c => c.r + c.s;
  const teamOf = seat => seat % 2;
  const TEAM_NAMES = ['Team A', 'Team B'];

  const create = code => ({
    roomCode: code, phase: 'waiting', round: 0, dealer: 3, currentPlayer: -1,
    trick: [], lastTrick: null, spadesBroken: false, tricksPlayed: 0, taken: [],
    teams: [{ score: 0, bags: 0 }, { score: 0, bags: 0 }],
    players: {}, result: null, final: null, hostSeat: 0, lastAction: '', actionLog: [], updatedAt: Date.now(),
  });
  const freshPlayer = name => ({ name, handJSON: '[]', bid: null, tricks: 0, isEmpty: false, disconnected: false });
  const seats = gs => [0, 1, 2, 3].filter(s => gs.players[s] && !gs.players[s].isEmpty && !gs.players[s].left);

  function deal(gs, rng) {
    const deck = Cards.makeDeck(rng);
    for (const s of [0, 1, 2, 3]) {
      Object.assign(gs.players[s], { bid: null, tricks: 0 });
      setHand(gs.players[s], deck.splice(0, 13));
    }
    gs.round += 1;
    gs.dealer = T.nextSeat(gs.dealer);
    Object.assign(gs, { trick: [], lastTrick: null, spadesBroken: false, tricksPlayed: 0, taken: [], result: null });
    gs.phase = 'bidding';
    gs.currentPlayer = T.nextSeat(gs.dealer);
    log(gs, `--- Hand ${gs.round} — ${gs.players[gs.dealer].name} deals ---`);
  }

  function start(gs, rng = Math.random) {
    if (seats(gs).length !== 4) return false;
    Object.assign(gs, { round: 0, final: null, actionLog: [], dealer: 3, teams: [{ score: 0, bags: 0 }, { score: 0, bags: 0 }] });
    deal(gs, rng);
    return true;
  }

  function nextRound(gs, rng = Math.random) {
    if (gs.phase !== 'handOver') return false;
    deal(gs, rng);
    return true;
  }

  function playableCards(gs, seat) {
    const hand = parseHand(gs.players[seat]);
    if (gs.trick.length) return T.followable(hand, gs.trick);
    const nonSpades = hand.filter(c => c.s !== '♠');
    return gs.spadesBroken || !nonSpades.length ? hand : nonSpades;
  }

  function legalActions(gs, seat) {
    if (gs.currentPlayer !== seat) return [];
    if (gs.phase === 'bidding') return Array.from({ length: 14 }, (_, value) => ({ type: 'bid', value }));
    if (gs.phase !== 'playing') return [];
    return playableCards(gs, seat).map(card => ({ type: 'play', card }));
  }

  function apply(gs, seat, action) {
    const p = gs.players[seat];
    if (!p || gs.currentPlayer !== seat) return { ok: false, error: 'Not your turn.' };

    if (gs.phase === 'bidding') {
      const v = Number(action?.value);
      if (action?.type !== 'bid' || !Number.isInteger(v) || v < 0 || v > 13) return { ok: false, error: 'Bid 0 (nil) to 13.' };
      p.bid = v;
      gs.lastAction = `${p.name} bids ${v === 0 ? 'nil' : v}`;
      log(gs, gs.lastAction);
      gs.currentPlayer = T.nextSeat(seat);
      if ([0, 1, 2, 3].every(s => gs.players[s].bid !== null)) {
        gs.phase = 'playing';
        gs.currentPlayer = T.nextSeat(gs.dealer);
      }
      return { ok: true };
    }

    if (gs.phase !== 'playing') return { ok: false, error: 'Not your turn.' };
    if (action?.type !== 'play' || !action.card) return { ok: false, error: 'Play a card.' };
    const card = { r: action.card.r, s: action.card.s };
    const hand = parseHand(p);
    if (!hand.some(c => Cards.same(c, card))) return { ok: false, error: 'You do not hold that card.' };
    if (!playableCards(gs, seat).some(c => Cards.same(c, card))) {
      return { ok: false, error: gs.trick.length ? `You must follow suit (${gs.trick[0].card.s}).` : "Spades haven't been broken yet." };
    }
    Cards.take(hand, card);
    setHand(p, hand);
    gs.trick.push({ seat, card });
    if (card.s === '♠' && !gs.spadesBroken) { gs.spadesBroken = true; log(gs, 'Spades are broken'); }
    gs.lastAction = `${p.name} plays ${fmt(card)}`;
    if (gs.trick.length < 4) { gs.currentPlayer = T.nextSeat(seat); return { ok: true }; }

    const winner = T.trickWinner(gs.trick, '♠');
    gs.players[winner].tricks += 1;
    gs.lastTrick = { plays: gs.trick, winner };
    gs.taken.push(...gs.trick.map(t => t.card));
    log(gs, `${gs.players[winner].name} takes the trick`);
    gs.trick = [];
    gs.tricksPlayed += 1;
    gs.currentPlayer = winner;
    if (gs.tricksPlayed === 13) endHand(gs);
    return { ok: true };
  }

  /** Score one team's hand. Returns { contract, tricks, nil: [...], bags, points }. */
  function scoreTeam(gs, team) {
    const members = [team, team + 2];
    const contract = members.reduce((a, s) => a + (gs.players[s].bid || 0), 0);
    const tricks = members.filter(s => gs.players[s].bid !== 0).reduce((a, s) => a + gs.players[s].tricks, 0);
    let points = 0, bags = 0;
    if (contract > 0) {
      if (tricks >= contract) { points += 10 * contract + (tricks - contract); bags += tricks - contract; }
      else points -= 10 * contract;
    } else {
      bags += tricks; points += tricks;
    }
    const nil = members.filter(s => gs.players[s].bid === 0).map(s => {
      const made = gs.players[s].tricks === 0;
      points += made ? 100 : -100;
      bags += gs.players[s].tricks;
      points += gs.players[s].tricks;
      return { seat: s, made };
    });
    return { contract, tricks, nil, bags, points };
  }

  function endHand(gs) {
    const rows = [0, 1].map(t => scoreTeam(gs, t));
    rows.forEach((r, t) => {
      const team = gs.teams[t];
      team.score += r.points;
      team.bags += r.bags;
      r.bagPenalty = 0;
      while (team.bags >= 10) { team.bags -= 10; team.score -= 100; r.bagPenalty -= 100; }
    });
    gs.result = { rows };
    log(gs, `🏁 Hand over — ${TEAM_NAMES[0]} ${rows[0].points + rows[0].bagPenalty >= 0 ? '+' : ''}${rows[0].points + rows[0].bagPenalty}, ${TEAM_NAMES[1]} ${rows[1].points + rows[1].bagPenalty >= 0 ? '+' : ''}${rows[1].points + rows[1].bagPenalty}`);
    gs.currentPlayer = -1;
    const [a, b] = gs.teams.map(t => t.score);
    if ((a >= TARGET || b >= TARGET) && a !== b) finish(gs, a > b ? 0 : 1, false);
    else gs.phase = 'handOver';
  }

  function finish(gs, team, abandoned) {
    gs.phase = 'matchOver';
    gs.final = { team, abandoned };
    gs.currentPlayer = -1;
    log(gs, abandoned ? '--- Game ended: a player left ---' : `--- Match over: ${TEAM_NAMES[team]} wins ---`);
  }

  /** Spades needs four players: if one leaves for good, the game ends. */
  function removePlayer(gs, seat) {
    if (!gs.players[seat]) return;
    gs.players[seat].left = true;
    if (gs.phase === 'matchOver' || gs.phase === 'waiting') return;
    finish(gs, 1 - teamOf(seat), true);
  }

  const isOver = gs => gs.phase === 'handOver' || gs.phase === 'matchOver';

  root.SpadesLogic = {
    id: 'spades', minPlayers: 4, maxPlayers: 4, hiddenFields: [],
    create, freshPlayer, start, nextRound, apply, legalActions, removePlayer, isOver,
    isMatchOver: gs => gs.phase === 'matchOver',
    canSeeHand: (gs, viewer, owner) => viewer === owner,
    seatNote: seat => (teamOf(seat) === 0 ? 'Team A' : 'Team B'),
    allCards: gs => [...gs.trick.map(t => t.card), ...gs.taken, ...Object.values(gs.players).flatMap(p => (p ? parseHand(p) : []))],
    playableCards, scoreTeam, teamOf, TEAM_NAMES, TARGET,
  };
})(typeof window !== 'undefined' ? window : globalThis);
