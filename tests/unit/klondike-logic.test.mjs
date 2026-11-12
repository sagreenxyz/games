import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, rng } from './load.mjs';
import { play } from './harness.mjs';

const K = loadScripts('cards.js', 'klondike-logic.js').KlondikeLogic;
const c = (t, up = true) => ({ r: t.slice(0, -1), s: t.slice(-1), up });

function fresh(seed = 1, drawCount = 1) {
  const gs = K.create();
  K.start(gs, rng(seed), { drawCount });
  return gs;
}

/** An empty board to arrange by hand. */
function board() {
  const gs = K.create();
  gs.phase = 'playing';
  return gs;
}

describe('deal', () => {
  test('7 piles of 1–7 cards with only the top card face up, 24 in the stock', () => {
    const gs = fresh();
    gs.tableau.forEach((p, i) => {
      assert.equal(p.length, i + 1);
      p.forEach((card, j) => assert.equal(card.up, j === i));
    });
    assert.equal(gs.stock.length, 24);
    assert.equal(K.allCards(gs).length, 52);
  });
});

describe('stock and waste', () => {
  test('draw 3 moves three cards; an empty stock turns the waste over', () => {
    const gs = fresh(2, 3);
    for (let i = 0; i < 8; i++) assert.ok(K.apply(gs, 0, { type: 'draw' }).ok);
    assert.equal(gs.stock.length, 0);
    assert.equal(gs.waste.length, 24);
    const topBefore = gs.waste[gs.waste.length - 1];
    K.apply(gs, 0, { type: 'draw' });
    assert.equal(gs.waste.length, 0);
    assert.equal(gs.passes, 1);
    // First card back on top of the stock is the bottom of the old waste
    assert.ok(gs.stock.every(x => !x.up));
    assert.notDeepEqual(gs.stock[gs.stock.length - 1], { ...topBefore, up: false });
  });
});

describe('moves', () => {
  test('tableau builds down in alternating colours', () => {
    const gs = board();
    gs.tableau[0] = [c('8♠')];
    gs.tableau[1] = [c('7♥')];
    gs.tableau[2] = [c('7♣')];
    assert.ok(K.isLegalMove(gs, { pile: 'tableau', index: 1, cardIndex: 0 }, { pile: 'tableau', index: 0 }));
    assert.equal(K.isLegalMove(gs, { pile: 'tableau', index: 2, cardIndex: 0 }, { pile: 'tableau', index: 0 }), false);
  });

  test('only a King fills an empty column', () => {
    const gs = board();
    gs.tableau[0] = [c('Q♥')];
    gs.tableau[1] = [c('K♣')];
    assert.equal(K.isLegalMove(gs, { pile: 'tableau', index: 0, cardIndex: 0 }, { pile: 'tableau', index: 2 }), false);
    assert.ok(K.isLegalMove(gs, { pile: 'tableau', index: 1, cardIndex: 0 }, { pile: 'tableau', index: 2 }));
  });

  test('moving a run turns up the card underneath', () => {
    const gs = board();
    gs.tableau[0] = [c('2♦', false), c('9♠'), c('8♥')];
    gs.tableau[1] = [c('10♥')];
    assert.ok(K.apply(gs, 0, { type: 'move', from: { pile: 'tableau', index: 0, cardIndex: 1 }, to: { pile: 'tableau', index: 1 } }).ok);
    assert.equal(gs.tableau[1].length, 3);
    assert.equal(gs.tableau[0][0].up, true);
  });

  test('face-down cards and broken runs cannot be moved', () => {
    const gs = board();
    gs.tableau[0] = [c('9♠', false), c('8♥')];
    assert.equal(K.movingCards(gs, { pile: 'tableau', index: 0, cardIndex: 0 }), null);
    gs.tableau[1] = [c('9♠'), c('8♠')];
    assert.equal(K.movingCards(gs, { pile: 'tableau', index: 1, cardIndex: 0 }), null);
  });

  test('foundations build up by suit from the Ace, one card at a time', () => {
    const gs = board();
    gs.waste = [c('2♥')];
    gs.tableau[0] = [c('A♥')];
    assert.equal(K.isLegalMove(gs, { pile: 'waste' }, { pile: 'foundation' }), false);
    assert.ok(K.apply(gs, 0, { type: 'move', from: { pile: 'tableau', index: 0, cardIndex: 0 }, to: { pile: 'foundation' } }).ok);
    assert.ok(K.apply(gs, 0, { type: 'move', from: { pile: 'waste' }, to: { pile: 'foundation' } }).ok);
    assert.equal(gs.foundations['♥'].length, 2);
  });

  test('the last card to the foundations wins', () => {
    const gs = board();
    for (const s of Cards_SUITS()) gs.foundations[s] = Array.from({ length: s === '♣' ? 12 : 13 }, (_, i) => ({ r: ['A','2','3','4','5','6','7','8','9','10','J','Q','K'][i], s, up: true }));
    gs.waste = [c('K♣')];
    assert.ok(K.apply(gs, 0, { type: 'move', from: { pile: 'waste' }, to: { pile: 'foundation' } }).ok);
    assert.equal(gs.phase, 'won');
    assert.ok(K.isOver(gs));
  });

  test('auto-finish is offered once everything is face up and the stock is empty', () => {
    const gs = board();
    gs.tableau[0] = [c('K♠'), c('Q♥')];
    assert.ok(K.canAutoFinish(gs));
    gs.tableau[1] = [c('3♣', false)];
    assert.equal(K.canAutoFinish(gs), false);
  });
});

describe('fuzz', () => {
  test('random play never loses a card or gets an illegal move accepted', () => {
    for (let seed = 1; seed <= 30; seed++) play(K, { players: 1, seed, mustFinish: false, maxSteps: 400 });
  });

  test('following hints plays sensibly and never breaks the deck', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const gs = fresh(seed);
      for (let i = 0; i < 300 && gs.phase === 'playing'; i++) {
        const h = K.hint(gs);
        if (!h) break;
        assert.ok(K.apply(gs, 0, h).ok);
        assert.equal(K.allCards(gs).length, 52);
      }
    }
  });
});

function Cards_SUITS() { return ['♠', '♥', '♦', '♣']; }
