import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, rng } from './load.mjs';

const ctx = loadScripts('cards.js', 'rummy-core.js', 'gin-logic.js');
const R = ctx.RummyCore;
const G = ctx.GinLogic;

const cards = str => str.trim().split(/\s+/).map(t => ({ r: t.slice(0, -1), s: t.slice(-1) }));
const hand = (gs, s) => JSON.parse(gs.players[s].handJSON);
const keys = cs => [...cs].map(c => c.r + c.s).sort();

function match() {
  const gs = G.create('TEST01');
  gs.players[0] = G.freshPlayer('Ann');
  gs.players[1] = G.freshPlayer('Ben');
  assert.ok(G.start(gs, rng(1)));
  return gs;
}

/** Put a hand in a known position: `seat` to discard, holding `mine`, opponent holding `theirs`. */
function position(mine, theirs, seat = 0) {
  const gs = match();
  gs.players[seat].handJSON = JSON.stringify(cards(mine));
  gs.players[1 - seat].handJSON = JSON.stringify(cards(theirs));
  gs.step = 'discard';
  gs.currentPlayer = seat;
  gs.drawnFromDiscard = null;
  return gs;
}

describe('meld engine', () => {
  test('sets and runs', () => {
    assert.ok(R.isSet(cards('7♠ 7♥ 7♦')));
    assert.ok(!R.isSet(cards('7♠ 7♥')));
    assert.ok(R.isRun(cards('3♥ 4♥ 5♥')));
    assert.ok(!R.isRun(cards('3♥ 4♥ 6♥')));
    assert.ok(!R.isRun(cards('3♥ 4♠ 5♥')));
  });

  test('aces are low unless allowed high, and never wrap', () => {
    assert.ok(R.isRun(cards('A♣ 2♣ 3♣')));
    assert.ok(!R.isRun(cards('Q♣ K♣ A♣')));
    assert.ok(R.isRun(cards('Q♣ K♣ A♣'), { aceHigh: true }));
    assert.ok(!R.isRun(cards('K♣ A♣ 2♣'), { aceHigh: true }));
  });

  test('best arrangement minimises deadwood when melds overlap', () => {
    // 7♥ could join the 7s or the heart run; the best split uses both melds fully.
    const res = R.bestMelds(cards('7♠ 7♦ 7♥ 7♣ 5♥ 6♥ K♠'));
    assert.equal(res.value, 10);
    assert.deepEqual(keys(res.deadwood), ['K♠']);
  });

  test('deadwood counts face cards as 10 and aces as 1', () => {
    assert.equal(R.bestMelds(cards('K♠ Q♥ A♦ 2♣')).value, 23);
  });
});

describe('first turn', () => {
  test('non-dealer may pass, then dealer, then non-dealer must draw from stock', () => {
    const gs = match();
    assert.equal(gs.dealer, 1);
    assert.equal(gs.currentPlayer, 0);
    assert.ok(G.apply(gs, 0, { type: 'pass' }).ok);
    assert.equal(gs.currentPlayer, 1);
    assert.ok(G.apply(gs, 1, { type: 'pass' }).ok);
    assert.equal(gs.currentPlayer, 0);
    assert.equal(G.apply(gs, 0, { type: 'takeDiscard' }).ok, false);
    assert.ok(G.apply(gs, 0, { type: 'drawStock' }).ok);
    assert.equal(hand(gs, 0).length, 11);
  });

  test("taking the upcard means you can't throw it straight back", () => {
    const gs = match();
    const up = gs.discard[gs.discard.length - 1];
    assert.ok(G.apply(gs, 0, { type: 'takeDiscard' }).ok);
    assert.equal(G.apply(gs, 0, { type: 'discard', card: up }).ok, false);
  });
});

describe('knocking and scoring', () => {
  test('knock: knocker scores the deadwood difference after layoffs', () => {
    // Ann: 3 melds + 4♠ deadwood (4) after discarding K♦.
    // Ben: 8♥ lays off on Ann's 5-6-7♥; leftover deadwood 9♣ 9♦ → 18.
    const gs = position('5♥ 6♥ 7♥ J♠ J♥ J♣ 2♦ 3♦ 4♦ 4♠ K♦', '8♥ 9♣ 9♦ Q♠ Q♥ Q♣ A♣ A♠ 10♠ 10♣');
    assert.ok(G.apply(gs, 0, { type: 'knock', card: { r: 'K', s: '♦' } }).ok);
    const res = gs.result;
    assert.equal(res.note, 'Knock');
    assert.deepEqual(keys(res.hands[1].layoffs), ['8♥']);
    assert.equal(res.hands[0].value, 4);
    assert.equal(res.hands[1].value, 9 + 9 + 1 + 1 + 10 + 10);
    assert.equal(res.winner, 0);
    assert.equal(res.points, 40 - 4);
  });

  test('undercut: defender with equal or less deadwood scores difference + 25', () => {
    const gs = position('5♥ 6♥ 7♥ J♠ J♥ J♣ 2♦ 3♦ 4♦ 9♠ K♦', 'A♣ 2♣ 3♣ Q♠ Q♥ Q♣ 8♦ 9♦ 10♦ 5♠');
    assert.ok(G.apply(gs, 0, { type: 'knock', card: { r: 'K', s: '♦' } }).ok);
    assert.equal(gs.result.note, 'Undercut');
    assert.equal(gs.result.winner, 1);
    assert.equal(gs.result.points, 9 - 5 + 25);
    assert.equal(gs.scores[1], 29);
  });

  test('gin: 25 plus all of the defender’s deadwood, no layoffs allowed', () => {
    const gs = position('5♥ 6♥ 7♥ J♠ J♥ J♣ 2♦ 3♦ 4♦ 5♦ K♦', '8♥ 9♣ 9♦ Q♠ Q♥ Q♣ A♣ A♠ 10♠ 10♣');
    assert.ok(G.apply(gs, 0, { type: 'knock', card: { r: 'K', s: '♦' } }).ok);
    assert.equal(gs.result.note, 'Gin');
    assert.equal(gs.result.hands[1].layoffs.length, 0);
    // Ben: Q set melded; deadwood 8+9+9+1+1+10+10 = 48
    assert.equal(gs.result.points, 25 + 48);
  });

  test('big gin: all 11 cards meld, no discard', () => {
    const gs = position('5♥ 6♥ 7♥ J♠ J♥ J♣ 2♦ 3♦ 4♦ 5♦ 6♦', '8♥ 9♣ 9♦ Q♠ Q♥ Q♣ A♣ A♠ 10♠ 10♣');
    assert.ok(G.legalActions(gs, 0).some(a => a.type === 'bigGin'));
    assert.ok(G.apply(gs, 0, { type: 'bigGin' }).ok);
    assert.equal(gs.result.points, 31 + 48);
  });

  test('cannot knock with more than 10 deadwood', () => {
    const gs = position('5♥ 6♥ 7♥ J♠ J♥ J♣ 2♦ 3♦ 9♠ 4♠ K♦', 'A♣ 2♣ 3♣ Q♠ Q♥ Q♣ 8♦ 9♦ 10♦ 5♠');
    const res = G.apply(gs, 0, { type: 'knock', card: { r: 'K', s: '♦' } });
    assert.equal(res.ok, false);
    assert.match(res.error, /10 or less/);
  });

  test('layoffs can extend a run at both ends', () => {
    const gs = position('5♥ 6♥ 7♥ J♠ J♥ J♣ 2♦ 3♦ 4♦ 2♠ K♦', '4♥ 8♥ 9♥ Q♠ Q♥ Q♣ A♣ A♠ 10♠ 10♣');
    assert.ok(G.apply(gs, 0, { type: 'knock', card: { r: 'K', s: '♦' } }).ok);
    assert.deepEqual(keys(gs.result.hands[1].layoffs), ['4♥', '8♥', '9♥']);
  });
});

describe('hand and match flow', () => {
  test('the hand is void when only 2 stock cards are left after a discard', () => {
    const gs = match();
    G.apply(gs, 0, { type: 'pass' }); G.apply(gs, 1, { type: 'pass' });
    gs.stock = gs.stock.slice(-3);
    G.apply(gs, 0, { type: 'drawStock' });
    const card = hand(gs, 0)[0];
    assert.ok(G.apply(gs, 0, { type: 'discard', card }).ok);
    assert.equal(gs.phase, 'handOver');
    assert.equal(gs.result.void, true);
    const dealer = gs.dealer;
    G.nextRound(gs, rng(2));
    assert.equal(gs.dealer, dealer, 'same dealer redeals a void hand');
  });

  test('the deal alternates after a scored hand', () => {
    const gs = position('5♥ 6♥ 7♥ J♠ J♥ J♣ 2♦ 3♦ 4♦ 5♦ K♦', '8♥ 9♣ 9♦ Q♠ Q♥ Q♣ A♣ A♠ 10♠ 10♣');
    G.apply(gs, 0, { type: 'knock', card: { r: 'K', s: '♦' } });
    const dealer = gs.dealer;
    G.nextRound(gs, rng(3));
    assert.equal(gs.dealer, 1 - dealer);
  });

  test('reaching 100 ends the match with game, box and shutout bonuses', () => {
    const gs = position('5♥ 6♥ 7♥ J♠ J♥ J♣ 2♦ 3♦ 4♦ 5♦ K♦', '8♥ 9♣ 9♦ Q♠ Q♥ Q♣ A♣ A♠ 10♠ 10♣');
    gs.scores[0] = 60; gs.handsWon[0] = 2;
    G.apply(gs, 0, { type: 'knock', card: { r: 'K', s: '♦' } });
    assert.equal(gs.phase, 'matchOver');
    // 60 + 73 = 133; +100 game; +3×25 box; ×2 shutout
    assert.equal(gs.final.totals[0], (133 + 100 + 75) * 2);
    assert.equal(gs.final.shutout, true);
  });

  test('if a player leaves, the other wins the match', () => {
    const gs = match();
    G.removePlayer(gs, 1);
    assert.equal(gs.phase, 'matchOver');
    assert.equal(gs.final.winner, 0);
    assert.equal(gs.final.forfeit, true);
  });

  test('hands are hidden during play and shown when the hand ends', () => {
    const gs = position('5♥ 6♥ 7♥ J♠ J♥ J♣ 2♦ 3♦ 4♦ 5♦ K♦', '8♥ 9♣ 9♦ Q♠ Q♥ Q♣ A♣ A♠ 10♠ 10♣');
    assert.equal(G.canSeeHand(gs, 1, 0), false);
    G.apply(gs, 0, { type: 'knock', card: { r: 'K', s: '♦' } });
    assert.equal(G.canSeeHand(gs, 1, 0), true);
  });
});
