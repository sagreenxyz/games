import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, rng } from './load.mjs';

const C = loadScripts('cards.js', 'crazy-eights-logic.js').CrazyEightsLogic;
const cards = str => str.trim().split(/\s+/).map(t => ({ r: t.slice(0, -1), s: t.slice(-1) }));
const hand = (gs, s) => JSON.parse(gs.players[s].handJSON);
const plain = x => JSON.parse(JSON.stringify(x));

function game(n = 2, seed = 1) {
  const gs = C.create('TEST01');
  for (let i = 0; i < n; i++) gs.players[i] = C.freshPlayer(`P${i}`);
  assert.ok(C.start(gs, rng(seed)));
  return gs;
}
function position({ mine, theirs = 'K♠ 2♦', topCard = '9♥', stock = '4♣ 5♣ 6♣', n = 2 }) {
  const gs = game(n);
  gs.players[0].handJSON = JSON.stringify(cards(mine));
  for (let s = 1; s < n; s++) gs.players[s].handJSON = JSON.stringify(cards(theirs));
  gs.discard = cards(topCard);
  gs.stock = stock ? cards(stock) : [];
  gs.currentPlayer = 0; gs.declaredSuit = null; gs.drawnCard = null; gs.passesInRow = 0;
  return gs;
}

describe('dealing', () => {
  test('7 cards each for 2 players, 5 for more; the starter is never an 8', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g2 = game(2, seed), g4 = game(4, seed);
      assert.equal(hand(g2, 0).length, 7);
      assert.equal(hand(g4, 3).length, 5);
      assert.notEqual(g2.discard[0].r, '8');
    }
  });
});

describe('playing', () => {
  test('match the suit or the rank', () => {
    const gs = position({ mine: '3♥ 9♣ K♦ 2♠' });
    assert.deepEqual(plain(C.legalActions(gs, 0).map(a => a.card.r + a.card.s).sort()), ['3♥', '9♣']);
    assert.equal(C.apply(gs, 0, { type: 'play', card: { r: 'K', s: '♦' } }).ok, false);
    assert.ok(C.apply(gs, 0, { type: 'play', card: { r: '9', s: '♣' } }).ok);
    assert.equal(gs.currentPlayer, 1);
  });

  test('an 8 is wild and sets the suit to follow', () => {
    const gs = position({ mine: '8♠ K♦ 2♠', theirs: '3♦ 3♥' });
    assert.equal(C.apply(gs, 0, { type: 'play', card: { r: '8', s: '♠' } }).ok, false, 'needs a suit');
    assert.ok(C.apply(gs, 0, { type: 'play', card: { r: '8', s: '♠' }, suit: '♦' }).ok);
    assert.equal(C.suitToFollow(gs), '♦');
    assert.deepEqual(plain(C.legalActions(gs, 1).map(a => a.card.s)), ['♦']);
  });

  test("you can only draw when you can't play", () => {
    const gs = position({ mine: '3♥ 2♠' });
    assert.equal(C.apply(gs, 0, { type: 'draw' }).ok, false);
  });

  test('a drawn card that fits may be played; otherwise the turn ends', () => {
    let gs = position({ mine: '2♠ K♦', stock: '4♣ 7♥' });
    assert.deepEqual(plain(C.legalActions(gs, 0)), [{ type: 'draw' }]);
    assert.ok(C.apply(gs, 0, { type: 'draw' }).ok);
    assert.deepEqual(plain(gs.drawnCard), { r: '7', s: '♥' });
    assert.equal(C.apply(gs, 0, { type: 'play', card: { r: '2', s: '♠' } }).ok, false);
    assert.ok(C.apply(gs, 0, { type: 'play', card: { r: '7', s: '♥' } }).ok);

    gs = position({ mine: '2♠ K♦', stock: '4♥ 5♣' });
    assert.ok(C.apply(gs, 0, { type: 'draw' }).ok);
    assert.equal(gs.currentPlayer, 1, 'unplayable draw passes the turn');
  });

  test('an empty stock is rebuilt from the discard pile', () => {
    const gs = position({ mine: '2♠ K♦', stock: '' });
    gs.discard = cards('4♣ 5♣ 9♥');
    assert.ok(C.apply(gs, 0, { type: 'draw' }).ok);
    assert.equal(gs.discard.length, 1);
    assert.equal(gs.discard[0].r, '9');
  });
});

describe('scoring', () => {
  test('going out scores the other hands: 8 = 50, faces 10, ace 1', () => {
    const gs = position({ mine: '9♣', theirs: '8♦ K♠ A♥ 4♣' });
    assert.ok(C.apply(gs, 0, { type: 'play', card: { r: '9', s: '♣' } }).ok);
    assert.equal(gs.phase, 'handOver');
    assert.equal(gs.players[0].score, 50 + 10 + 1 + 4);
  });

  test('a blocked hand goes to the lowest hand, scoring the differences', () => {
    const gs = position({ mine: '2♠ 3♠', theirs: 'K♦ Q♦', stock: '' });
    gs.discard = cards('9♥');
    assert.ok(C.apply(gs, 0, { type: 'pass' }).ok);
    assert.ok(C.apply(gs, 1, { type: 'pass' }).ok);
    assert.equal(gs.phase, 'handOver');
    assert.equal(gs.result.blocked, true);
    assert.equal(gs.result.winner, 0);
    assert.equal(gs.players[0].score, 20 - 5);
  });

  test('first to 100 wins the match', () => {
    const gs = position({ mine: '9♣', theirs: '8♦ 8♠' });
    gs.players[0].score = 10;
    C.apply(gs, 0, { type: 'play', card: { r: '9', s: '♣' } });
    assert.equal(gs.phase, 'matchOver');
    assert.equal(gs.final.winner, 0);
  });
});

describe('players leaving', () => {
  test('their cards go into the stock and play continues', () => {
    const gs = game(3);
    const before = C.allCards(gs).length;
    const cur = gs.currentPlayer;
    C.removePlayer(gs, cur);
    assert.equal(C.allCards(gs).length, before);
    assert.notEqual(gs.currentPlayer, cur);
  });
});
