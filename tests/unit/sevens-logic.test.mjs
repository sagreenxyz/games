import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, rng } from './load.mjs';

const S = loadScripts('sevens-logic.js').SevensLogic;

const hand = (gs, seat) => JSON.parse(gs.players[seat].handJSON);
const card = str => ({ r: str.slice(0, -1), s: str.slice(-1) });

function table(n) {
  const gs = S.buildFreshRoomState('TEST01');
  for (let i = 0; i < n; i++) gs.players[i] = S.freshPlayer(`P${i}`);
  return gs;
}

function cardsOnBoard(board) {
  return Object.values(board).reduce((a, col) => a + (col ? col.max - col.min + 1 : 0), 0);
}

/** Play whatever is legal for the current player (first valid card, else pass). */
function autoMove(gs, r = Math.random) {
  const seat = gs.currentPlayer;
  const valid = S.getValidMoves(gs.board, hand(gs, seat));
  const res = valid.length
    ? S.applyAction(gs, seat, 'play', valid[Math.floor(r() * valid.length)])
    : S.applyAction(gs, seat, 'pass');
  assert.ok(res.ok, res.error);
}

describe('valid moves', () => {
  test('7♦ must open the game', () => {
    const board = S.emptyBoard();
    const h = [card('7♦'), card('7♣'), card('8♦')].map(c => ({ ...c }));
    assert.deepEqual(S.getValidMoves(board, h).map(c => c.r + c.s), ['7♦']);
  });

  test('other 7s cannot open a suit before 7♦ is down', () => {
    assert.deepEqual(S.getValidMoves(S.emptyBoard(), [card('7♣')]), []);
  });

  test('cards extend either end of a suit', () => {
    const board = S.emptyBoard();
    S.applyCardToBoard(board, card('7♦'));
    const moves = S.getValidMoves(board, [card('6♦'), card('8♦'), card('9♦'), card('7♠')]);
    assert.deepEqual(moves.map(c => c.r + c.s), ['6♦', '8♦', '7♠']);
  });
});

describe('game flow', () => {
  test('all 52 cards are dealt and the 7♦ holder starts', () => {
    const gs = table(3);
    assert.ok(S.startGame(gs, S.makeDeck(rng(1))));
    const total = [0, 1, 2].reduce((a, s) => a + hand(gs, s).length, 0);
    assert.equal(total, 52);
    assert.ok(hand(gs, gs.currentPlayer).some(c => c.r === '7' && c.s === '♦'));
  });

  test('rejects playing out of turn', () => {
    const gs = table(2);
    S.startGame(gs, S.makeDeck(rng(2)));
    const other = gs.currentPlayer === 0 ? 1 : 0;
    const res = S.applyAction(gs, other, 'play', hand(gs, other)[0]);
    assert.equal(res.ok, false);
  });

  test('rejects passing while holding a playable card', () => {
    const gs = table(2);
    S.startGame(gs, S.makeDeck(rng(3)));
    assert.equal(S.applyAction(gs, gs.currentPlayer, 'pass').ok, false);
  });

  test('rejects playing a card you do not hold', () => {
    const gs = table(2);
    S.startGame(gs, S.makeDeck(rng(4)));
    const other = gs.currentPlayer === 0 ? 1 : 0;
    const res = S.applyAction(gs, gs.currentPlayer, 'play', hand(gs, other)[0]);
    assert.equal(res.ok, false);
  });

  test('a full game finishes with every player ranked', () => {
    const gs = table(4);
    S.startGame(gs, S.makeDeck(rng(5)));
    for (let i = 0; gs.phase === 'playing'; i++) { assert.ok(i < 1000); autoMove(gs); }
    assert.equal(gs.phase, 'finished');
    assert.equal(gs.finishOrder.length, 4);
    assert.equal(new Set(gs.finishOrder).size, 4);
  });
});

describe('players leaving', () => {
  test("a leaver's cards are dealt to the others and the turn moves on", () => {
    const gs = table(3);
    S.startGame(gs, S.makeDeck(rng(6)));
    const leaver = gs.currentPlayer;
    gs.players[leaver].disconnected = true;
    S.removePlayer(gs, leaver);
    assert.equal(hand(gs, leaver).length, 0);
    const total = [0, 1, 2].reduce((a, s) => a + hand(gs, s).length, 0);
    assert.equal(total, 52);
    assert.notEqual(gs.currentPlayer, leaver);
    assert.equal(gs.phase, 'playing');
  });

  test('the game ends when only one player is left', () => {
    const gs = table(2);
    S.startGame(gs, S.makeDeck(rng(7)));
    gs.players[1].disconnected = true;
    S.removePlayer(gs, 1);
    assert.equal(gs.phase, 'finished');
    assert.deepEqual([...gs.finishOrder], [0]);
  });

  test('play again drops players who left', () => {
    const gs = table(3);
    S.startGame(gs, S.makeDeck(rng(8)));
    gs.players[2].disconnected = true;
    S.removePlayer(gs, 2);
    S.resetToWaiting(gs);
    assert.deepEqual(Object.keys(gs.players), ['0', '1']);
    assert.ok(S.startGame(gs, S.makeDeck(rng(9))));
    assert.equal(hand(gs, 0).length + hand(gs, 1).length, 52);
  });

  test('fuzz: games with random departures always finish', () => {
    const r = rng(42);
    for (let g = 0; g < 200; g++) {
      const n = 2 + Math.floor(r() * 3);
      const gs = table(n);
      S.startGame(gs, S.makeDeck(r));
      for (let i = 0; gs.phase === 'playing'; i++) {
        assert.ok(i < 2000, 'game did not finish');
        if (r() < 0.01) {
          const seats = Object.keys(gs.players).map(Number).filter(s => !gs.players[s].disconnected && !gs.players[s].finished);
          const s = seats[Math.floor(r() * seats.length)];
          gs.players[s].disconnected = true;
          S.removePlayer(gs, s);
          continue;
        }
        autoMove(gs, r);
        const held = Object.values(gs.players).reduce((a, p) => a + JSON.parse(p.handJSON).length, 0);
        assert.equal(held + cardsOnBoard(gs.board), 52, 'cards lost');
      }
    }
  });
});
