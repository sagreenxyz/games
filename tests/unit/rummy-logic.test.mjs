import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, rng } from './load.mjs';
import { play } from './harness.mjs';

const { RummyLogic } = loadScripts('cards.js', 'rummy-core.js', 'rummy-logic.js');
const B = RummyLogic.basic;
const F = RummyLogic.r500;

const cards = str => str.trim().split(/\s+/).map(t => ({ r: t.slice(0, -1), s: t.slice(-1) }));
const hand = (gs, s) => JSON.parse(gs.players[s].handJSON);

function game(L, n = 2, seed = 1) {
  const gs = L.create('TEST01');
  for (let i = 0; i < n; i++) gs.players[i] = L.freshPlayer(`P${i}`);
  assert.ok(L.start(gs, rng(seed)));
  return gs;
}

/** Seat 0 to play with a given hand, discard pile and table. */
function position(L, { mine, theirs = '2♣ 9♦ K♠', discard = '5♣', table = [], step = 'play', n = 2 }) {
  const gs = game(L, n);
  gs.players[0].handJSON = JSON.stringify(cards(mine));
  for (let s = 1; s < n; s++) gs.players[s].handJSON = JSON.stringify(cards(theirs));
  gs.discard = cards(discard);
  gs.table = table.map((t, i) => ({ id: i + 1, cards: cards(t).map(c => ({ ...c, by: 1 })) }));
  gs.nextMeldId = table.length + 1;
  gs.currentPlayer = 0; gs.step = step; gs.mustUse = null; gs.noDiscard = null; gs.turnHadMelded = false;
  return gs;
}

/** Greedy driver: meld/lay off when possible, otherwise random — finishes games quickly. */
const greedy = (gs, options, r) => {
  const pref = options.filter(([, a]) => a.type === 'meld' || a.type === 'layoff');
  const list = pref.length ? pref : options;
  return list[Math.floor(r() * list.length)];
};

describe('dealing', () => {
  test('Basic: 10 cards for 2 players, 7 for 3–4, 6 for 5–6', () => {
    for (const [n, size] of [[2, 10], [3, 7], [4, 7], [5, 6], [6, 6]]) assert.equal(hand(game(B, n), 0).length, size);
  });
  test('500: 13 cards for 2 players, 7 otherwise', () => {
    assert.equal(hand(game(F, 2), 0).length, 13);
    assert.equal(hand(game(F, 5), 0).length, 7);
  });
  test('the player left of the dealer goes first', () => {
    const gs = game(B, 3);
    assert.equal(gs.currentPlayer, (gs.dealer + 1) % 3);
  });
});

describe('Basic Rummy', () => {
  test('only the top discard can be taken, and not thrown back', () => {
    const gs = position(B, { mine: '3♥ 9♠ K♦', discard: '2♣ 7♦', step: 'draw' });
    assert.equal(B.apply(gs, 0, { type: 'takeDiscard', index: 0 }).ok, false);
    assert.ok(B.apply(gs, 0, { type: 'takeDiscard', index: 1 }).ok);
    assert.equal(B.apply(gs, 0, { type: 'discard', card: { r: '7', s: '♦' } }).ok, false);
  });

  test('aces are low only', () => {
    const gs = position(B, { mine: 'Q♣ K♣ A♣ 5♦' });
    assert.equal(B.apply(gs, 0, { type: 'meld', cards: cards('Q♣ K♣ A♣') }).ok, false);
  });

  test('meld, lay off on anyone’s meld, and go out by discarding', () => {
    const gs = position(B, { mine: '7♠ 7♥ 7♦ 4♣ 9♥', theirs: 'K♠ K♥ 2♦', table: ['5♣ 6♣ 7♣'] });
    assert.ok(B.apply(gs, 0, { type: 'meld', cards: cards('7♠ 7♥ 7♦') }).ok);
    assert.ok(B.apply(gs, 0, { type: 'layoff', card: { r: '4', s: '♣' }, meld: 1 }).ok);
    assert.equal(gs.table[0].cards.map(c => c.r).join(','), '4,5,6,7');
    assert.ok(B.apply(gs, 0, { type: 'discard', card: { r: '9', s: '♥' } }).ok);
    assert.equal(gs.phase, 'handOver');
    // Went out in one turn without melding before: rummy doubles 10+10+2.
    assert.equal(gs.result.rummy, true);
    assert.equal(gs.players[0].score, 44);
  });

  test('going out after melding on an earlier turn is not doubled', () => {
    const gs = position(B, { mine: '7♠ 7♥ 7♦ 9♥', theirs: 'K♠ K♥ 2♦' });
    gs.turnHadMelded = true;
    B.apply(gs, 0, { type: 'meld', cards: cards('7♠ 7♥ 7♦') });
    B.apply(gs, 0, { type: 'discard', card: { r: '9', s: '♥' } });
    assert.equal(gs.players[0].score, 22);
  });

  test('when the stock runs out, the discard pile becomes the new stock', () => {
    const gs = position(B, { mine: '3♥ 9♠ K♦', discard: '2♣ 7♦ 4♠', step: 'draw' });
    gs.stock = [];
    assert.ok(B.apply(gs, 0, { type: 'drawStock' }).ok);
    assert.equal(gs.discard.length, 1);
    assert.equal(gs.discard[0].r, '4');
    assert.equal(gs.stock.length, 1);
  });

  test('the pile is turned over at most twice; then the hand ends with no score', () => {
    const gs = position(B, { mine: '3♥ 9♠ K♦', discard: '2♣ 7♦ 4♠', step: 'draw' });
    gs.stock = []; gs.turnovers = 2;
    assert.equal(B.apply(gs, 0, { type: 'drawStock' }).ok, false);
    assert.ok(B.legalActions(gs, 0).some(a => a.type === 'endHand'));
    assert.ok(B.apply(gs, 0, { type: 'endHand' }).ok);
    assert.equal(gs.result.outSeat, null);
    assert.equal(gs.players[0].score + gs.players[1].score, 0);
  });

  test('first to 100 wins the match', () => {
    const gs = position(B, { mine: '7♠ 7♥ 7♦ 9♥', theirs: 'K♠ K♥ 2♦' });
    gs.players[0].score = 90;
    B.apply(gs, 0, { type: 'meld', cards: cards('7♠ 7♥ 7♦') });
    B.apply(gs, 0, { type: 'discard', card: { r: '9', s: '♥' } });
    assert.equal(gs.phase, 'matchOver');
    assert.equal(gs.final.winner, 0);
  });
});

describe('Rummy 500', () => {
  test('aces can be high or low but runs do not wrap', () => {
    const gs = position(F, { mine: 'Q♣ K♣ A♣ A♦ 2♦ 3♦ K♥ A♥ 2♥ 9♠' });
    assert.ok(F.apply(gs, 0, { type: 'meld', cards: cards('Q♣ K♣ A♣') }).ok);
    assert.ok(F.apply(gs, 0, { type: 'meld', cards: cards('A♦ 2♦ 3♦') }).ok);
    assert.equal(F.apply(gs, 0, { type: 'meld', cards: cards('K♥ A♥ 2♥') }).ok, false);
  });

  test('taking deep in the discard pile requires melding that card first', () => {
    const gs = position(F, { mine: '8♠ 9♠ 3♦ K♣', discard: '2♣ 10♠ 5♥ J♦', step: 'draw' });
    // 2♣ can't be used → not allowed to take from index 0.
    assert.equal(F.apply(gs, 0, { type: 'takeDiscard', index: 0 }).ok, false);
    assert.ok(F.apply(gs, 0, { type: 'takeDiscard', index: 1 }).ok);
    assert.equal(hand(gs, 0).length, 7);
    assert.deepEqual(gs.mustUse, { r: '10', s: '♠' });
    assert.equal(F.apply(gs, 0, { type: 'discard', card: { r: 'K', s: '♣' } }).ok, false);
    assert.equal(F.apply(gs, 0, { type: 'meld', cards: cards('3♦ 5♥ J♦') }).ok, false);
    assert.ok(F.apply(gs, 0, { type: 'meld', cards: cards('8♠ 9♠ 10♠') }).ok);
    assert.equal(gs.mustUse, null);
    assert.ok(F.apply(gs, 0, { type: 'discard', card: { r: 'K', s: '♣' } }).ok);
  });

  test('a deep discard can be taken to lay off on the table', () => {
    const gs = position(F, { mine: '3♦ K♣', discard: '9♥ 2♠', table: ['6♥ 7♥ 8♥'], step: 'draw' });
    assert.ok(F.apply(gs, 0, { type: 'takeDiscard', index: 0 }).ok);
    assert.ok(F.apply(gs, 0, { type: 'layoff', card: { r: '9', s: '♥' }, meld: 1 }).ok);
  });

  test('scoring: melded cards minus cards in hand, ace 1 in a low run', () => {
    const gs = position(F, { mine: 'A♦ 2♦ 3♦ A♣ A♠ A♥ 9♠', theirs: 'K♠ 4♥ A♣', table: [] });
    gs.players[1].handJSON = JSON.stringify(cards('K♠ 4♥ 5♣'));
    F.apply(gs, 0, { type: 'meld', cards: cards('A♦ 2♦ 3♦') });   // 1 + 5 + 5 = 11
    F.apply(gs, 0, { type: 'meld', cards: cards('A♣ A♠ A♥') });   // 45
    F.apply(gs, 0, { type: 'discard', card: { r: '9', s: '♠' } }); // goes out
    assert.equal(gs.result.rows[0].points, 56);
    assert.equal(gs.result.rows[1].points, -(10 + 5 + 5));
  });

  test('cards laid off score for the player who laid them off', () => {
    const gs = position(F, { mine: '9♥ 4♣ 8♦', table: ['6♥ 7♥ 8♥'] });
    F.apply(gs, 0, { type: 'layoff', card: { r: '9', s: '♥' }, meld: 1 });
    gs.stock = [];
    F.apply(gs, 0, { type: 'discard', card: { r: '4', s: '♣' } });
    // seat 1 now: stock empty → may end the hand
    assert.ok(F.legalActions(gs, 1).some(a => a.type === 'endHand'));
    F.apply(gs, 1, { type: 'endHand' });
    assert.equal(gs.result.rows[0].melded, 5);
    assert.equal(gs.result.rows[1].melded, 15);
  });
});

describe('players leaving', () => {
  test('their cards return to the stock and play moves on', () => {
    const gs = game(F, 3);
    const cur = gs.currentPlayer;
    const before = F.allCards(gs).length;
    gs.players[cur].left = true;
    F.removePlayer(gs, cur);
    assert.notEqual(gs.currentPlayer, cur);
    assert.equal(F.allCards(gs).length, before);
  });
  test('the last player left wins', () => {
    const gs = game(B, 2);
    B.removePlayer(gs, 1);
    assert.equal(gs.phase, 'matchOver');
    assert.equal(gs.final.winner, 0);
  });
});

describe('fuzz with a greedy player', () => {
  for (const [L, label] of [[B, 'Basic'], [F, '500']]) {
    for (const n of [2, 4, 6]) {
      test(`${label}: ${n}-player matches finish without losing cards`, () => {
        for (let seed = 1; seed <= 15; seed++) play(L, { players: n, seed, rounds: 40, pick: greedy, maxSteps: 20000 });
      });
    }
  }
});
